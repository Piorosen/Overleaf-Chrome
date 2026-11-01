#!/usr/bin/env node
/*
 * Overleaf AI — Native Messaging host.
 *
 * Chrome launches this process when the extension calls chrome.runtime.connectNative /
 * sendNativeMessage. It receives one request, runs the local `claude` (Claude Code) or
 * `codex` (OpenAI Codex) CLI — or a bibliographic metadata lookup — streams the result
 * back, and exits when Chrome closes stdin.
 *
 * Protocol (both directions): 4-byte length (native byte order) + UTF-8 JSON.
 *
 * Requests from the extension:
 *   { type: "ping" }
 *   { type: "run", backend: "claude"|"codex", system, prompt, model?, effort?, timeoutSec?, web? }
 *       web: Claude only — enables WebSearch plus WebFetch restricted to scholarly domains.
 *   { type: "bib", op: "arxiv"|"arxiv-search"|"s2"|"openalex-work"|"openalex-search"|"doi-bib"|"crossref-search", ... }
 *
 * Messages to the extension:
 *   { type: "pong", hostVersion, caps, ... }   reply to ping
 *   { type: "status", text }                   progress note
 *   { type: "reset" }                          a new assistant message started (drop streamed text)
 *   { type: "delta", text }                    streamed text (claude only)
 *   { type: "final-chunk", text }              authoritative final text, chunked
 *   { type: "done", durationMs, costUsd? }     run finished successfully
 *   { type: "bib-result", ok, data?, error? }  reply to a bib request
 *   { type: "error", error, detail? }          failure
 *
 * Hardening:
 *   - CLIs run in a private 0700 per-run directory; project/local settings, CLAUDE.md, auto-memory
 *     and hooks are disabled; the system prompt is passed in a 0600 file, not on the command line.
 *   - CLI processes run in their own process group and are killed as a group on cancel/timeout.
 *   - Extra CLI arguments come only from this host's config.json, never from the extension.
 *   - Bib lookups only contact a fixed set of scholarly APIs.
 *
 * No dependencies: only Node.js (>= 18) built-ins.
 */
'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const HOST_VERSION = '0.4.0';
const CAPS = ['web', 'web-allowlist', 'bib', 'pgkill', 'sysprompt-file', 'reset'];
const MAX_OUT_MSG = 256 * 1024; // keep every message far below Chrome's 1 MB host->extension cap
const KILL_GRACE_MS = 700;      // Chrome SIGKILLs the host ~2 s after disconnect; finish before that

const CONFIG = loadConfig();
if (CONFIG.path) process.env.PATH = CONFIG.path;

// Domains WebFetch may open when web mode is on (WebSearch itself is always allowed in web mode).
const WEB_DOMAINS = Array.isArray(CONFIG.webDomains) && CONFIG.webDomains.length ? CONFIG.webDomains : [
  'arxiv.org', 'export.arxiv.org', 'doi.org', 'api.crossref.org', 'dblp.org', 'api.semanticscholar.org',
  'www.semanticscholar.org', 'aclanthology.org', 'openreview.net', 'proceedings.neurips.cc', 'papers.nips.cc',
  'proceedings.mlr.press', 'openaccess.thecvf.com', 'ieeexplore.ieee.org', 'dl.acm.org', 'link.springer.com',
  'www.sciencedirect.com', 'pubmed.ncbi.nlm.nih.gov', 'www.ncbi.nlm.nih.gov', 'www.nature.com', 'www.science.org',
  'jmlr.org', 'aaai.org', 'ojs.aaai.org', 'www.ijcai.org', 'iclr.cc', 'scholar.archive.org',
];

function loadConfig() {
  const file = process.env.OLAI_HOST_CONFIG || path.join(__dirname, 'config.json');
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; }
}

// ------------------------------------------------------------ work dirs ---

// A private, user-owned 0700 directory (never the shared /tmp on Linux).
function privateBaseDir() {
  const base = process.env.OLAI_WORKDIR
    || (process.platform === 'darwin'
      ? path.join(os.homedir(), 'Library', 'Caches', 'overleaf-ai-host')
      : path.join(process.env.XDG_RUNTIME_DIR || process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache'), 'overleaf-ai-host'));
  fs.mkdirSync(base, { recursive: true, mode: 0o700 });
  const st = fs.lstatSync(base);
  if (st.isSymbolicLink() || !st.isDirectory()) throw new Error(`work dir is not a directory: ${base}`);
  if (typeof process.getuid === 'function' && st.uid !== process.getuid()) throw new Error(`work dir not owned by current user: ${base}`);
  if ((st.mode & 0o077) !== 0) fs.chmodSync(base, 0o700);
  return base;
}

function makeRunDir() {
  return fs.mkdtempSync(path.join(privateBaseDir(), 'run-'));
}

function removeDir(dir) {
  if (!dir) return;
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
}

// ---------------------------------------------------------------- framing ---

const LE = os.endianness() === 'LE';

function send(obj) {
  const body = Buffer.from(JSON.stringify(obj), 'utf8');
  const header = Buffer.alloc(4);
  if (LE) header.writeUInt32LE(body.length, 0); else header.writeUInt32BE(body.length, 0);
  try { process.stdout.write(Buffer.concat([header, body])); } catch { /* chrome went away */ }
}

function sendChunked(type, text) {
  // JSON-escaping can grow a character to 6 bytes (\u00XX); this keeps each frame < 1 MB.
  const step = Math.floor(MAX_OUT_MSG / 6);
  if (!text) { send({ type, text: '' }); return; }
  for (let i = 0; i < text.length; i += step) send({ type, text: text.slice(i, i + step) });
}

let child = null;
let inFlight = 0;
let stdinEnded = false;

function killTree(signal) {
  const c = child;
  if (!c || c.exitCode !== null || c.signalCode !== null) return;
  try { process.kill(-c.pid, signal); } catch { try { c.kill(signal); } catch { /* gone */ } }
}

function shutdownSoon() {
  killTree('SIGTERM');
  setTimeout(() => killTree('SIGKILL'), KILL_GRACE_MS).unref();
  setTimeout(() => process.exit(0), KILL_GRACE_MS + 400).unref();
}

process.stdout.on('error', () => { killTree('SIGKILL'); process.exit(0); }); // Chrome went away
process.on('uncaughtException', (err) => {
  try { send({ type: 'error', error: 'HOST_EXCEPTION', detail: String(err && err.stack || err) }); } catch { /* ignore */ }
  killTree('SIGKILL');
  setTimeout(() => process.exit(1), 50);
});

let inBuf = Buffer.alloc(0);
process.stdin.on('data', (chunk) => {
  inBuf = Buffer.concat([inBuf, chunk]);
  while (inBuf.length >= 4) {
    const len = LE ? inBuf.readUInt32LE(0) : inBuf.readUInt32BE(0);
    if (inBuf.length < 4 + len) break;
    const raw = inBuf.subarray(4, 4 + len).toString('utf8');
    inBuf = inBuf.subarray(4 + len);
    let msg;
    try { msg = JSON.parse(raw); } catch { send({ type: 'error', error: 'BAD_JSON' }); continue; }
    handle(msg).catch((err) => send({ type: 'error', error: 'HOST_EXCEPTION', detail: String(err && err.stack || err) }));
  }
});

// Chrome closes stdin when the port is disconnected (cancel, tab closed, run finished).
// A running CLI is cancelled (its whole process group); pending lookups may answer; then exit.
process.stdin.on('end', () => {
  stdinEnded = true;
  if (child) shutdownSoon();
  maybeExit();
});

function maybeExit() {
  if (!stdinEnded || child || inFlight > 0) return;
  process.stdout.write('', () => process.exit(0)); // callback fires after earlier writes flush
}

// --------------------------------------------------------------- handlers ---

async function handle(msg) {
  if (!msg || typeof msg !== 'object') return send({ type: 'error', error: 'BAD_REQUEST' });
  if (msg.type === 'ping') {
    inFlight += 1;
    try { send(await ping()); } finally { inFlight -= 1; maybeExit(); }
    return undefined;
  }
  if (msg.type === 'bib') {
    inFlight += 1;
    try { send({ type: 'bib-result', ok: true, data: await bibLookup(msg) }); } catch (e) {
      send({ type: 'bib-result', ok: false, error: String(e && e.message || e) });
    } finally { inFlight -= 1; maybeExit(); }
    return undefined;
  }
  if (msg.type === 'run') return run(msg);
  send({ type: 'error', error: 'UNKNOWN_TYPE', detail: String(msg.type) });
  return undefined;
}

function cliPath(name) {
  if (name === 'claude') return CONFIG.claudePath || 'claude';
  if (name === 'codex') return CONFIG.codexPath || 'codex';
  throw new Error('unknown cli');
}

function versionOf(name) {
  return new Promise((resolve) => {
    const bin = cliPath(name);
    let out = '';
    let p;
    try {
      p = spawn(bin, ['--version'], { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      return resolve({ ok: false, path: bin, error: String(e.message || e) });
    }
    const t = setTimeout(() => { try { p.kill('SIGKILL'); } catch { /* ignore */ } }, 15000);
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { out += d; });
    p.on('error', (e) => { clearTimeout(t); resolve({ ok: false, path: bin, error: e.code === 'ENOENT' ? 'NOT_FOUND' : String(e.message) }); });
    p.on('close', (code) => {
      clearTimeout(t);
      resolve(code === 0 ? { ok: true, path: bin, version: out.trim().split('\n')[0] } : { ok: false, path: bin, error: out.trim().slice(-300) || `exit ${code}` });
    });
  });
}

// Default model/effort configured in each CLI's own settings (shown as "기본값" in the UI).
function cliDefaults() {
  const out = { claude: {}, codex: {} };
  try {
    const j = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.claude', 'settings.json'), 'utf8'));
    if (typeof j.model === 'string') out.claude.model = j.model;
    if (typeof j.effortLevel === 'string') out.claude.effort = j.effortLevel;
  } catch { /* no settings */ }
  try {
    const toml = fs.readFileSync(path.join(os.homedir(), '.codex', 'config.toml'), 'utf8');
    const top = toml.split(/^\s*\[/m)[0]; // only top-level keys, before the first [table]
    const model = /^\s*model\s*=\s*"([^"]+)"/m.exec(top);
    const effort = /^\s*model_reasoning_effort\s*=\s*"([^"]+)"/m.exec(top);
    if (model) out.codex.model = model[1];
    if (effort) out.codex.effort = effort[1];
  } catch { /* no config */ }
  return out;
}

async function ping() {
  const [claude, codex] = await Promise.all([versionOf('claude'), versionOf('codex')]);
  const defaults = cliDefaults();
  return {
    type: 'pong', hostVersion: HOST_VERSION, caps: CAPS, node: process.version, platform: process.platform,
    claude: { ...claude, defaults: defaults.claude },
    codex: { ...codex, defaults: defaults.codex },
  };
}

const SAFE_ARG = /^[\w.:\/\[\]@=-]{1,100}$/;

function configArgs(name) {
  const list = CONFIG[name === 'claude' ? 'claudeExtraArgs' : 'codexExtraArgs'];
  return Array.isArray(list) ? list.filter((a) => typeof a === 'string' && a.length < 500) : [];
}

function run(req) {
  if (child) return send({ type: 'error', error: 'BUSY' });
  const backend = req.backend;
  if (backend !== 'claude' && backend !== 'codex') return send({ type: 'error', error: 'BAD_BACKEND' });
  if (typeof req.prompt !== 'string' || !req.prompt.trim()) return send({ type: 'error', error: 'EMPTY_PROMPT' });
  const system = typeof req.system === 'string' ? req.system : '';
  const model = typeof req.model === 'string' && SAFE_ARG.test(req.model) ? req.model : '';
  const effort = typeof req.effort === 'string' && /^(none|minimal|low|medium|high|xhigh|max)$/.test(req.effort) ? req.effort : '';
  const web = req.web === true && backend === 'claude';
  const timeoutSec = Math.min(Math.max(Number(req.timeoutSec) || 180, 10), 1800);

  let runDir;
  try { runDir = makeRunDir(); } catch (e) { return send({ type: 'error', error: 'WORKDIR_FAILED', detail: String(e.message || e) }); }

  const started = Date.now();
  let spec;
  try {
    spec = backend === 'claude'
      ? claudeSpec({ system, model, effort, web, runDir })
      : codexSpec({ model, effort, runDir });
  } catch (e) {
    removeDir(runDir);
    return send({ type: 'error', error: 'SPAWN_FAILED', detail: String(e.message || e) });
  }
  const stdinText = backend === 'claude' ? req.prompt : `${system}\n\n${req.prompt}`;

  send({ type: 'status', text: backend === 'claude' ? 'Claude 실행 중…' : 'Codex 실행 중…' });

  let proc;
  try {
    proc = spawn(spec.bin, spec.args, { cwd: runDir, stdio: ['pipe', 'pipe', 'pipe'], env: childEnv(spec.env), detached: true });
  } catch (e) {
    removeDir(runDir);
    return send({ type: 'error', error: 'SPAWN_FAILED', detail: `${spec.bin}: ${e.message}` });
  }
  child = proc;

  let stderrTail = '';
  let finished = false;
  let killTimer = null;
  const finish = (msg) => {
    if (finished) return;
    finished = true;
    clearTimeout(timeout);
    send(msg);
  };

  const timeout = setTimeout(() => {
    finish({ type: 'error', error: 'TIMEOUT', detail: `${timeoutSec}초 안에 응답이 없어 중단했습니다.` });
    killTree('SIGTERM');
    killTimer = setTimeout(() => { if (child === proc) killTree('SIGKILL'); }, KILL_GRACE_MS);
  }, timeoutSec * 1000);

  proc.on('error', (e) => {
    finish({ type: 'error', error: e.code === 'ENOENT' ? 'CLI_NOT_FOUND' : 'SPAWN_FAILED', detail: `${spec.bin}: ${e.message}` });
  });
  proc.stderr.on('data', (d) => { stderrTail = (stderrTail + d).slice(-4000); });
  proc.stdin.on('error', () => { /* child may exit before reading everything */ });
  proc.stdin.end(stdinText);

  spec.attach(proc, {
    delta: (text) => { if (!finished && text) send({ type: 'delta', text }); },
    reset: () => { if (!finished) send({ type: 'reset' }); },
    status: (text) => { if (!finished) send({ type: 'status', text }); },
  });

  proc.on('close', (code, signal) => {
    clearTimeout(killTimer);
    let outcome;
    try { outcome = spec.result(code, signal, stderrTail); } catch (e) { outcome = { error: 'HOST_EXCEPTION', detail: String(e && e.stack || e) }; }
    if (child === proc) child = null;
    removeDir(runDir);
    if (outcome.error) {
      finish({ type: 'error', error: outcome.error, detail: outcome.detail });
    } else {
      if (!finished) sendChunked('final-chunk', outcome.text);
      finish({ type: 'done', durationMs: Date.now() - started, costUsd: outcome.costUsd });
    }
    maybeExit();
  });
  return undefined;
}

function childEnv(extra = {}) {
  const env = { ...process.env, ...extra };
  // Never let a nested CLI think it is running inside another Claude Code session.
  delete env.CLAUDECODE;
  delete env.CLAUDE_CODE_ENTRYPOINT;
  // Use the CLI's own login (subscription) unless the user opted into API keys in config.json.
  if (!CONFIG.keepApiKeyEnv) {
    delete env.ANTHROPIC_API_KEY;
    delete env.ANTHROPIC_AUTH_TOKEN;
    delete env.OPENAI_API_KEY;
  }
  return env;
}

// ------------------------------------------------------------ claude CLI ---

function claudeSpec({ system, model, effort, web, runDir }) {
  const sysFile = path.join(runDir, 'system.txt');
  fs.writeFileSync(sysFile, system || 'You are a helpful academic writing assistant.', { mode: 0o600 });
  const args = [
    '-p',
    '--output-format', 'stream-json',
    '--verbose',
    '--include-partial-messages',
    // Explicit mode: a user's defaultMode (e.g. "auto") must not approve tools we did not allow.
    '--permission-mode', 'dontAsk',
    // Pure text generation by default. Web actions get WebSearch + WebFetch limited to scholarly
    // domains; file, shell and edit tools are never available.
    ...(web
      ? ['--tools', 'WebSearch,WebFetch', '--allowedTools', 'WebSearch', ...WEB_DOMAINS.map((d) => `WebFetch(domain:${d})`)]
      : ['--tools', '']),
    '--strict-mcp-config',       // skip MCP servers (faster start, no side effects)
    '--no-session-persistence',
    '--disable-slash-commands',
    '--setting-sources', 'user', // no project/local settings from the working directory
    '--settings', '{"disableAllHooks":true}',
    '--system-prompt-file', sysFile,
  ];
  if (model) args.push('--model', model);
  if (effort && effort !== 'minimal' && effort !== 'none') args.push('--effort', effort);
  args.push(...configArgs('claude'));

  let lineBuf = '';
  let resultText = null;
  let resultError = null;
  let costUsd;
  const messages = [];       // text of each assistant message (web runs have several)
  let cur = null;
  const nonJson = [];

  const onLine = (line, cb) => {
    if (!line) return;
    let ev;
    try { ev = JSON.parse(line); } catch { nonJson.push(line); return; }
    if (!ev || typeof ev !== 'object') return;
    if (ev.type === 'stream_event') {
      const e = ev.event || {};
      if (e.type === 'message_start') {
        if (cur && cur.text) cb.reset();
        cur = { text: '' };
        messages.push(cur);
      }
      const block = e.type === 'content_block_start' ? e.content_block || {} : null;
      if (block && /tool_use$/.test(block.type || '')) {
        cb.status(block.name === 'WebFetch' ? '웹 페이지 확인 중…' : block.name === 'WebSearch' ? '웹 검색 중…' : `도구 사용: ${block.name}`);
      }
      if (e.type === 'content_block_delta' && e.delta && e.delta.type === 'text_delta') {
        if (!cur) { cur = { text: '' }; messages.push(cur); }
        cur.text += e.delta.text;
        cb.delta(e.delta.text);
      }
    } else if (ev.type === 'result') {
      costUsd = ev.total_cost_usd;
      if (ev.is_error || (ev.subtype && ev.subtype !== 'success')) resultError = String(ev.result || ev.subtype || 'error');
      else resultText = typeof ev.result === 'string' ? ev.result : '';
    }
  };

  let cbRef = null;
  return {
    bin: cliPath('claude'),
    args,
    env: { CLAUDE_CODE_DISABLE_CLAUDE_MDS: '1', CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1' },
    attach(proc, cb) {
      cbRef = cb;
      proc.stdout.setEncoding('utf8');
      proc.stdout.on('data', (d) => {
        lineBuf += d;
        let nl;
        while ((nl = lineBuf.indexOf('\n')) >= 0) {
          const line = lineBuf.slice(0, nl).trim();
          lineBuf = lineBuf.slice(nl + 1);
          onLine(line, cb);
        }
      });
    },
    result(code, signal, stderrTail) {
      if (lineBuf.trim()) { onLine(lineBuf.trim(), cbRef || { delta() {}, reset() {}, status() {} }); lineBuf = ''; }
      if (resultError) return { error: 'CLI_ERROR', detail: resultError };
      const longest = messages.reduce((a, m) => (m.text.length > a.length ? m.text : a), '');
      if (resultText !== null) {
        // If the last message is only a short wrap-up after tool use, keep the substantive answer.
        const text = resultText.length < 200 && longest.length > resultText.length * 3 ? `${longest.trim()}\n\n${resultText.trim()}` : resultText;
        return { text, costUsd };
      }
      if (code === 0 && longest) return { text: longest, costUsd };
      const detail = [stderrTail.trim(), nonJson.join('\n').trim()].filter(Boolean).join('\n').slice(-2000);
      return { error: 'CLI_FAILED', detail: detail || `exit ${code}${signal ? ` (${signal})` : ''}` };
    },
  };
}

// ------------------------------------------------------------- codex CLI ---

function codexSpec({ model, effort, runDir }) {
  const outFile = path.join(runDir, 'last-message.txt');
  const args = [
    'exec',
    '--skip-git-repo-check',
    '--sandbox', 'read-only',
    '--color', 'never',
    '-C', runDir,
    '-o', outFile,
    '-c', 'project_doc_max_bytes=0', // ignore AGENTS.md files
  ];
  if (model) args.push('-m', model);
  if (effort) args.push('-c', `model_reasoning_effort="${effort}"`);
  args.push(...configArgs('codex'));
  args.push('-'); // read the prompt from stdin

  let stdout = '';
  return {
    bin: cliPath('codex'),
    args,
    env: {},
    attach(proc, cb) {
      proc.stdout.setEncoding('utf8');
      proc.stdout.on('data', (d) => { stdout += d; });
      let ticks = 0;
      const iv = setInterval(() => { ticks += 1; cb.status(`Codex 생성 중… (${ticks * 5}s)`); }, 5000);
      proc.on('close', () => clearInterval(iv));
    },
    result(code, signal, stderrTail) {
      let text = '';
      try { text = fs.readFileSync(outFile, 'utf8'); } catch { /* not written */ }
      if (code === 0 && (text.trim() || stdout.trim())) return { text: text.trim() ? text : stdout };
      return { error: 'CLI_FAILED', detail: (stderrTail.trim() || stdout.trim()).slice(-2000) || `exit ${code}${signal ? ` (${signal})` : ''}` };
    },
  };
}

// ------------------------------------------------------------ bib lookups ---
// Only these endpoints are contacted; the extension supplies identifiers/queries, never URLs.

const EP = {
  arxiv: process.env.OLAI_EP_ARXIV || 'https://export.arxiv.org',
  s2: process.env.OLAI_EP_S2 || 'https://api.semanticscholar.org',
  openalex: process.env.OLAI_EP_OPENALEX || 'https://api.openalex.org',
  doi: process.env.OLAI_EP_DOI || 'https://doi.org',
  crossref: process.env.OLAI_EP_CROSSREF || 'https://api.crossref.org',
};
const UA = `overleaf-ai-bridge/${HOST_VERSION} (+https://github.com/Piorosen/Overleaf-Chrome)`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// GET/POST with a timeout; retries 429/503 with backoff (Semantic Scholar's shared pool is often busy).
async function httpGet(url, { accept = 'application/json', method = 'GET', body, headers = {}, retries = 2 } = {}) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, {
      method,
      headers: { 'User-Agent': UA, Accept: accept, ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined,
      redirect: 'follow',
      signal: AbortSignal.timeout(15000),
    });
    const text = await res.text();
    if ((res.status === 429 || res.status === 503) && attempt < retries) {
      const wait = Number(res.headers.get('retry-after')) * 1000 || 1500 * (attempt + 1) ** 2;
      await sleep(Math.min(wait, 8000));
      continue;
    }
    if (!res.ok) {
      const err = new Error(`HTTP ${res.status} from ${new URL(url).host}`);
      err.status = res.status;
      throw err;
    }
    if (/^\s*<!doctype html/i.test(text) && !/html/.test(accept)) throw new Error(`${new URL(url).host} returned a web page (blocked or rate-limited)`);
    if (text.length > 4_000_000) throw new Error('response too large');
    return text;
  }
}

const OA_FIELDS = 'id,display_name,doi,type,publication_year,authorships,primary_location,locations,biblio';

function simplifyOpenAlex(w) {
  if (!w || typeof w !== 'object') return null;
  const loc = (l) => ({
    source: ((l || {}).source || {}).display_name || '',
    sourceType: ((l || {}).source || {}).type || '',
    version: (l || {}).version || '',
    url: (l || {}).landing_page_url || '',
    isArxiv: /arxiv/i.test((((l || {}).source || {}).display_name || '') + ((l || {}).landing_page_url || '')),
  });
  return {
    id: w.id,
    title: w.display_name || '',
    doi: (w.doi || '').replace(/^https?:\/\/doi\.org\//i, ''),
    type: w.type || '',
    year: w.publication_year || null,
    authors: (w.authorships || []).map((a) => (a.author || {}).display_name).filter(Boolean),
    primary: loc(w.primary_location),
    locations: (w.locations || []).map(loc),
    biblio: w.biblio || {},
  };
}

function parseArxivAtom(xml) {
  return xml.split('<entry>').slice(1).map((e) => {
    const tag = (name) => { const m = new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`).exec(e); return m ? xmlText(m[1]) : ''; };
    const idUrl = tag('id');
    return {
      id: (/abs\/(.+?)(v\d+)?$/.exec(idUrl) || [])[1] || idUrl,
      title: tag('title'),
      authors: [...e.matchAll(/<name>([\s\S]*?)<\/name>/g)].map((m) => xmlText(m[1])),
      published: tag('published'),
      doi: tag('arxiv:doi'),
      journalRef: tag('arxiv:journal_ref'),
      primary: (/<arxiv:primary_category[^>]*term="([^"]+)"/.exec(e) || [])[1] || '',
    };
  });
}

const ARXIV_ID = /^(\d{4}\.\d{4,5}|[a-z-]+(?:\.[A-Z]{2})?\/\d{7})(v\d+)?$/;
const DOI_RE = /^10\.\d{4,9}\/\S{1,200}$/;
const xmlText = (s) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

async function bibLookup(msg) {
  const op = msg.op;
  if (op === 'arxiv') {
    const ids = (Array.isArray(msg.ids) ? msg.ids : []).map(String).filter((i) => ARXIV_ID.test(i)).slice(0, 50);
    if (!ids.length) return [];
    const xml = await httpGet(`${EP.arxiv}/api/query?id_list=${ids.map(encodeURIComponent).join(',')}&max_results=${ids.length}`, { accept: 'application/atom+xml' });
    return parseArxivAtom(xml);
  }
  if (op === 'arxiv-search') {
    const q = String(msg.q || '').replace(/["\\]/g, ' ').trim().slice(0, 300);
    if (!q) return [];
    const xml = await httpGet(`${EP.arxiv}/api/query?search_query=${encodeURIComponent(`ti:"${q}"`)}&max_results=${Math.min(Number(msg.max) || 5, 10)}`, { accept: 'application/atom+xml' });
    return parseArxivAtom(xml);
  }
  if (op === 's2') {
    const ids = (Array.isArray(msg.ids) ? msg.ids : []).map(String).filter((i) => /^(arXiv:|DOI:|CorpusId:)?[\w./:-]{3,200}$/i.test(i)).slice(0, 100);
    if (!ids.length) return [];
    const fields = 'title,year,venue,publicationVenue,journal,externalIds,publicationTypes,authors';
    const headers = CONFIG.s2ApiKey ? { 'x-api-key': String(CONFIG.s2ApiKey) } : {};
    const text = await httpGet(`${EP.s2}/graph/v1/paper/batch?fields=${fields}`, { method: 'POST', body: { ids }, headers, retries: 3 });
    return JSON.parse(text);
  }
  if (op === 'openalex-work') {
    const id = String(msg.id || '');
    if (!/^(doi:10\.\d{4,9}\/\S{1,200}|W\d{3,12})$/i.test(id)) throw new Error('bad openalex id');
    const text = await httpGet(`${EP.openalex}/works/${encodeURI(id)}?select=${OA_FIELDS}`);
    return simplifyOpenAlex(JSON.parse(text));
  }
  if (op === 'openalex-search') {
    const q = String(msg.q || '').slice(0, 300);
    if (!q.trim()) return [];
    const text = await httpGet(`${EP.openalex}/works?search=${encodeURIComponent(q)}&per-page=${Math.min(Number(msg.max) || 8, 25)}&select=${OA_FIELDS}`);
    return ((JSON.parse(text) || {}).results || []).map(simplifyOpenAlex);
  }
  if (op === 'doi-bib') {
    const doi = String(msg.doi || '').trim();
    if (!DOI_RE.test(doi)) throw new Error('bad doi');
    return httpGet(`${EP.doi}/${encodeURI(doi)}`, { accept: 'application/x-bibtex; charset=utf-8' });
  }
  if (op === 'crossref-search') {
    const q = String(msg.q || '').slice(0, 300);
    if (!q.trim()) return [];
    const text = await httpGet(`${EP.crossref}/works?query.bibliographic=${encodeURIComponent(q)}&rows=${Math.min(Number(msg.max) || 5, 20)}&select=DOI,title,author,issued,container-title,type`);
    const items = ((JSON.parse(text) || {}).message || {}).items || [];
    return items.map((it) => ({
      doi: it.DOI,
      title: (it.title || [])[0] || '',
      venue: (it['container-title'] || [])[0] || '',
      year: (((it.issued || {})['date-parts'] || [])[0] || [])[0] || null,
      type: it.type,
      authors: (it.author || []).map((a) => [a.given, a.family].filter(Boolean).join(' ')),
    }));
  }
  throw new Error(`unknown bib op: ${op}`);
}
