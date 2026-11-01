#!/usr/bin/env node
/*
 * Overleaf AI — Native Messaging host.
 *
 * Chrome launches this process when the extension calls
 * chrome.runtime.connectNative / sendNativeMessage. It receives one request,
 * runs the local `claude` (Claude Code) or `codex` (OpenAI Codex) CLI, streams
 * the output back, and exits when Chrome closes stdin.
 *
 * Protocol (both directions): 4-byte length (native byte order) + UTF-8 JSON.
 *
 * Requests from the extension:
 *   { type: "ping" }
 *   { type: "run", backend: "claude"|"codex", system, prompt,
 *     model?, effort?, timeoutSec?, extraArgs?: string[] }
 *
 * Messages to the extension:
 *   { type: "pong", ... }                      (reply to ping)
 *   { type: "status", text }                   progress note
 *   { type: "delta", text }                    streamed text (claude only)
 *   { type: "final-chunk", text }              authoritative final text, chunked
 *   { type: "done", durationMs, costUsd? }     run finished successfully
 *   { type: "error", error, detail? }          run failed
 *
 * No dependencies: only Node.js built-ins.
 */
'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const HOST_VERSION = '0.1.0';
const MAX_OUT_MSG = 256 * 1024; // keep every message far below Chrome's 1 MB host->extension cap
const WORKDIR = path.join(os.tmpdir(), 'overleaf-ai-host');

const CONFIG = loadConfig();
if (CONFIG.path) process.env.PATH = CONFIG.path;
try { fs.mkdirSync(WORKDIR, { recursive: true }); } catch { /* ignore */ }

function loadConfig() {
  const file = process.env.OLAI_HOST_CONFIG || path.join(__dirname, 'config.json');
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; }
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
  // Split by characters, sized so the UTF-8 payload stays below MAX_OUT_MSG.
  const step = Math.floor(MAX_OUT_MSG / 4);
  if (!text) { send({ type, text: '' }); return; }
  for (let i = 0; i < text.length; i += step) send({ type, text: text.slice(i, i + step) });
}

process.stdout.on('error', () => process.exit(0)); // Chrome went away

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
let child = null;
let killTimer = null;
let pingsInFlight = 0;
let stdinEnded = false;

// Chrome closes stdin when the port is disconnected (cancel, tab closed, run finished).
// A running CLI is cancelled; a pending ping is allowed to answer; then we flush and exit.
process.stdin.on('end', () => {
  stdinEnded = true;
  if (child && child.exitCode === null) {
    try { child.kill('SIGTERM'); } catch { /* ignore */ }
    setTimeout(() => process.exit(0), 5000).unref();
  }
  maybeExit();
});

function maybeExit() {
  if (!stdinEnded || child || pingsInFlight > 0) return;
  process.stdout.write('', () => process.exit(0)); // callback fires after earlier writes flush
}

// --------------------------------------------------------------- handlers ---

async function handle(msg) {
  if (!msg || typeof msg !== 'object') return send({ type: 'error', error: 'BAD_REQUEST' });
  if (msg.type === 'ping') {
    pingsInFlight += 1;
    try { send(await ping()); } finally { pingsInFlight -= 1; maybeExit(); }
    return undefined;
  }
  if (msg.type === 'run') return run(msg);
  send({ type: 'error', error: 'UNKNOWN_TYPE', detail: String(msg.type) });
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

async function ping() {
  const [claude, codex] = await Promise.all([versionOf('claude'), versionOf('codex')]);
  return { type: 'pong', hostVersion: HOST_VERSION, node: process.version, platform: process.platform, claude, codex };
}

const SAFE_ARG = /^[\w.:\/\[\]@=-]{1,100}$/;

function run(req) {
  if (child) return send({ type: 'error', error: 'BUSY' });
  const backend = req.backend;
  if (backend !== 'claude' && backend !== 'codex') return send({ type: 'error', error: 'BAD_BACKEND' });
  if (typeof req.prompt !== 'string' || !req.prompt.trim()) return send({ type: 'error', error: 'EMPTY_PROMPT' });
  const system = typeof req.system === 'string' ? req.system : '';
  const model = typeof req.model === 'string' && SAFE_ARG.test(req.model) ? req.model : '';
  const effort = typeof req.effort === 'string' && /^(minimal|low|medium|high|xhigh|max)$/.test(req.effort) ? req.effort : '';
  const extra = Array.isArray(req.extraArgs) ? req.extraArgs.filter((a) => typeof a === 'string' && a.length < 500) : [];
  const timeoutSec = Math.min(Math.max(Number(req.timeoutSec) || 180, 10), 1800);

  const started = Date.now();
  const spec = backend === 'claude'
    ? claudeSpec({ system, model, effort, extra })
    : codexSpec({ model, effort, extra });
  const stdinText = backend === 'claude' ? req.prompt : `${system}\n\n${req.prompt}`;

  send({ type: 'status', text: backend === 'claude' ? 'Claude 실행 중…' : 'Codex 실행 중…' });

  try {
    child = spawn(spec.bin, spec.args, { cwd: WORKDIR, stdio: ['pipe', 'pipe', 'pipe'], env: childEnv() });
  } catch (e) {
    return send({ type: 'error', error: 'SPAWN_FAILED', detail: `${spec.bin}: ${e.message}` });
  }

  let stderrTail = '';
  let finished = false;
  const finish = (msg) => {
    if (finished) return;
    finished = true;
    clearTimeout(timeout);
    clearTimeout(killTimer);
    send(msg);
  };

  const timeout = setTimeout(() => {
    finish({ type: 'error', error: 'TIMEOUT', detail: `${timeoutSec}초 안에 응답이 없어 중단했습니다.` });
    try { child.kill('SIGTERM'); } catch { /* ignore */ }
    killTimer = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* ignore */ } }, 3000);
  }, timeoutSec * 1000);

  child.on('error', (e) => {
    finish({
      type: 'error',
      error: e.code === 'ENOENT' ? 'CLI_NOT_FOUND' : 'SPAWN_FAILED',
      detail: `${spec.bin}: ${e.message}`,
    });
  });
  child.stderr.on('data', (d) => { stderrTail = (stderrTail + d).slice(-4000); });
  child.stdin.on('error', () => { /* child may exit before reading everything */ });
  child.stdin.end(stdinText);

  spec.attach(child, {
    delta: (text) => { if (!finished && text) send({ type: 'delta', text }); },
    status: (text) => { if (!finished) send({ type: 'status', text }); },
  });

  child.on('close', (code, signal) => {
    const outcome = spec.result(code, signal, stderrTail);
    child = null;
    if (outcome.error) {
      finish({ type: 'error', error: outcome.error, detail: outcome.detail });
    } else {
      if (!finished) sendChunked('final-chunk', outcome.text);
      finish({ type: 'done', durationMs: Date.now() - started, costUsd: outcome.costUsd });
    }
    maybeExit();
  });
}

function childEnv() {
  const env = { ...process.env };
  // Never let a nested CLI think it is running inside another Claude Code session.
  delete env.CLAUDECODE;
  delete env.CLAUDE_CODE_ENTRYPOINT;
  return env;
}

// ------------------------------------------------------------ claude CLI ---

function claudeSpec({ system, model, effort, extra }) {
  const args = [
    '-p',
    '--output-format', 'stream-json',
    '--verbose',
    '--include-partial-messages',
    '--tools', '',               // pure text generation: no file/shell/web tools
    '--strict-mcp-config',       // skip MCP servers (faster start, no side effects)
    '--no-session-persistence',
    '--disable-slash-commands',
  ];
  if (system) args.push('--system-prompt', system);
  if (model) args.push('--model', model);
  if (effort && effort !== 'minimal') args.push('--effort', effort);
  args.push(...extra);

  let lineBuf = '';
  let streamed = '';
  let resultText = null;
  let resultError = null;
  let costUsd;
  const nonJson = [];

  return {
    bin: cliPath('claude'),
    args,
    attach(proc, cb) {
      proc.stdout.setEncoding('utf8');
      proc.stdout.on('data', (d) => {
        lineBuf += d;
        let nl;
        while ((nl = lineBuf.indexOf('\n')) >= 0) {
          const line = lineBuf.slice(0, nl).trim();
          lineBuf = lineBuf.slice(nl + 1);
          if (!line) continue;
          let ev;
          try { ev = JSON.parse(line); } catch { nonJson.push(line); continue; }
          if (ev.type === 'stream_event') {
            const e = ev.event || {};
            if (e.type === 'content_block_delta' && e.delta && e.delta.type === 'text_delta') {
              streamed += e.delta.text;
              cb.delta(e.delta.text);
            }
          } else if (ev.type === 'result') {
            costUsd = ev.total_cost_usd;
            if (ev.is_error || (ev.subtype && ev.subtype !== 'success')) {
              resultError = String(ev.result || ev.subtype || 'error');
            } else {
              resultText = typeof ev.result === 'string' ? ev.result : '';
            }
          }
        }
      });
    },
    result(code, signal, stderrTail) {
      if (resultError) return { error: 'CLI_ERROR', detail: resultError };
      if (resultText !== null) return { text: resultText, costUsd };
      if (code === 0 && streamed) return { text: streamed, costUsd };
      const detail = [stderrTail.trim(), nonJson.join('\n').trim()].filter(Boolean).join('\n').slice(-2000);
      return { error: 'CLI_FAILED', detail: detail || `exit ${code}${signal ? ` (${signal})` : ''}` };
    },
  };
}

// ------------------------------------------------------------- codex CLI ---

function codexSpec({ model, effort, extra }) {
  const outFile = path.join(WORKDIR, `codex-last-${process.pid}-${Date.now()}.txt`);
  const args = [
    'exec',
    '--skip-git-repo-check',
    '--sandbox', 'read-only',
    '--color', 'never',
    '-C', WORKDIR,
    '-o', outFile,
  ];
  if (model) args.push('-m', model);
  if (effort) args.push('-c', `model_reasoning_effort="${effort}"`);
  args.push(...extra);
  args.push('-'); // read the prompt from stdin

  let stdout = '';
  return {
    bin: cliPath('codex'),
    args,
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
      try { fs.unlinkSync(outFile); } catch { /* ignore */ }
      if (code === 0 && (text.trim() || stdout.trim())) return { text: text.trim() ? text : stdout };
      return { error: 'CLI_FAILED', detail: (stderrTail.trim() || stdout.trim()).slice(-2000) || `exit ${code}${signal ? ` (${signal})` : ''}` };
    },
  };
}
