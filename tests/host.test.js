'use strict';
// Drives host/host.js over the real Native Messaging framing with fake CLIs and a fake HTTP API.
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const HOST = path.join(ROOT, 'host', 'host.js');
const FIX = path.join(__dirname, 'fixtures');

function frame(obj) {
  const body = Buffer.from(JSON.stringify(obj), 'utf8');
  const h = Buffer.alloc(4);
  h.writeUInt32LE(body.length, 0);
  return Buffer.concat([h, body]);
}

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'olai-test-'));
}

// Send one request; collect messages until a terminal message (or the host exits).
// onToolCall(name, args) answers agent tool calls like the extension would.
function talk(request, env = {}, config = {}, onToolCall = null) {
  const tmp = tmpdir();
  const cfg = path.join(tmp, 'config.json');
  fs.writeFileSync(cfg, JSON.stringify({ claudePath: path.join(FIX, 'fake-claude.js'), codexPath: path.join(FIX, 'fake-codex.js'), ...config }));
  const argsFile = path.join(tmp, 'args.json');
  const workdir = path.join(tmp, 'work');
  const proc = spawn(process.execPath, [HOST], {
    env: { ...process.env, OLAI_HOST_CONFIG: cfg, FAKE_ARGS_FILE: argsFile, OLAI_WORKDIR: workdir, ...env },
    stdio: ['pipe', 'pipe', 'inherit'],
  });
  return new Promise((resolve, reject) => {
    const msgs = [];
    let buf = Buffer.alloc(0);
    const timer = setTimeout(() => { proc.kill(); reject(new Error(`timeout: ${JSON.stringify(msgs)}`)); }, 25000);
    proc.stdout.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      while (buf.length >= 4) {
        const len = buf.readUInt32LE(0);
        if (buf.length < 4 + len) break;
        const m = JSON.parse(buf.subarray(4, 4 + len).toString('utf8'));
        buf = buf.subarray(4 + len);
        msgs.push(m);
        if (m.type === 'tool-call' && onToolCall) {
          let r;
          try { r = { ok: true, result: onToolCall(m.name, m.args) }; } catch (e) { r = { ok: false, error: e.message }; }
          proc.stdin.write(frame({ type: 'tool-result', callId: m.callId, ...r }));
        }
        if (['done', 'error', 'pong', 'bib-result'].includes(m.type)) proc.stdin.end(); // like Chrome disconnecting
      }
    });
    proc.on('close', (code) => {
      clearTimeout(timer);
      let record = null;
      try { record = JSON.parse(fs.readFileSync(argsFile, 'utf8')); } catch { /* not written */ }
      const leftovers = fs.existsSync(workdir) ? fs.readdirSync(workdir) : null;
      const workMode = fs.existsSync(workdir) ? (fs.statSync(workdir).mode & 0o777).toString(8) : null;
      fs.rmSync(tmp, { recursive: true, force: true });
      resolve({ msgs, code, record, args: record && (record.args || record), leftovers, workMode });
    });
    proc.stdin.write(frame(request));
  });
}

const finalText = (msgs) => msgs.filter((m) => m.type === 'final-chunk').map((m) => m.text).join('');

test('ping reports version, capabilities and both CLIs', async () => {
  const { msgs, code } = await talk({ type: 'ping' });
  assert.equal(code, 0);
  const pong = msgs.find((m) => m.type === 'pong');
  assert.equal(pong.hostVersion, require('../package.json').version);
  assert.equal(pong.hostVersion, require('../extension/manifest.json').version);
  for (const cap of ['web-allowlist', 'bib', 'pgkill', 'agent', 'figure']) assert.ok(pong.caps.includes(cap), cap);
  assert.equal(typeof pong.python, 'object');
  assert.equal(pong.claude.ok, true);
  assert.match(pong.claude.version, /Fake Claude/);
  assert.equal(typeof pong.claude.defaults, 'object');
});

test('ping is answered even if stdin closes right after the request', async () => {
  const tmp = tmpdir();
  const cfg = path.join(tmp, 'config.json');
  fs.writeFileSync(cfg, JSON.stringify({ claudePath: path.join(FIX, 'fake-claude.js'), codexPath: path.join(FIX, 'fake-codex.js') }));
  const proc = spawn(process.execPath, [HOST], { env: { ...process.env, OLAI_HOST_CONFIG: cfg }, stdio: ['pipe', 'pipe', 'inherit'] });
  const chunks = [];
  proc.stdout.on('data', (d) => chunks.push(d));
  proc.stdin.end(frame({ type: 'ping' }));
  const code = await new Promise((resolve) => proc.on('close', resolve));
  fs.rmSync(tmp, { recursive: true, force: true });
  const buf = Buffer.concat(chunks);
  assert.equal(code, 0);
  assert.equal(JSON.parse(buf.subarray(4, 4 + buf.readUInt32LE(0)).toString()).type, 'pong');
});

test('claude run: hardened flags, system prompt in a 0600 file, private work dir cleaned up', async () => {
  const prompt = '<task>x</task>';
  const { msgs, record, leftovers, workMode } = await talk(
    { type: 'run', backend: 'claude', system: 'SYS', prompt, model: 'sonnet', effort: 'low', extraArgs: ['--evil'] },
    { ANTHROPIC_API_KEY: 'sk-should-not-leak' },
    { claudeExtraArgs: ['--from-config'] },
  );
  assert.equal(finalText(msgs), `ECHO:${prompt.length}`);
  assert.equal(msgs.at(-1).type, 'done');
  const a = record.args;
  assert.equal(a[0], '-p');
  assert.deepEqual(a.slice(a.indexOf('--tools'), a.indexOf('--tools') + 2), ['--tools', '']);
  assert.equal(a[a.indexOf('--permission-mode') + 1], 'dontAsk');
  assert.equal(a[a.indexOf('--setting-sources') + 1], 'user');
  assert.equal(a[a.indexOf('--settings') + 1], '{"disableAllHooks":true}');
  assert.ok(!a.includes('--system-prompt'), 'system prompt is not on the command line');
  assert.equal(record.system, 'SYS');
  assert.equal(record.systemMode, '600');
  assert.equal(a[a.indexOf('--model') + 1], 'sonnet');
  assert.equal(a[a.indexOf('--effort') + 1], 'low');
  assert.ok(a.includes('--from-config'), 'extra args come from host config');
  assert.ok(!a.includes('--evil'), 'extra args from the request are ignored');
  assert.equal(record.env.ANTHROPIC_API_KEY, null);
  assert.equal(record.env.CLAUDE_CODE_DISABLE_CLAUDE_MDS, '1');
  assert.equal(record.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY, '1');
  assert.match(record.cwd, /work\/run-/);
  assert.equal(workMode, '700');
  assert.deepEqual(leftovers, [], 'per-run directory removed');
});

test('web flag: WebSearch + domain-restricted WebFetch for claude only', async () => {
  const { args } = await talk({ type: 'run', backend: 'claude', system: 'S', prompt: 'p', web: true });
  const i = args.indexOf('--tools');
  assert.equal(args[i + 1], 'WebSearch,WebFetch');
  const allowed = [];
  for (let k = args.indexOf('--allowedTools') + 1; k < args.length && !args[k].startsWith('--'); k++) allowed.push(args[k]);
  assert.ok(allowed.includes('WebSearch'));
  assert.ok(allowed.includes('WebFetch(domain:arxiv.org)'));
  assert.ok(!allowed.includes('WebFetch'), 'unrestricted WebFetch must not be allowed');
  const codex = await talk({ type: 'run', backend: 'codex', system: 'S', prompt: '<task>p</task>', web: true, effort: 'none' });
  assert.ok(!codex.args.some((a) => /WebSearch/.test(a)));
  assert.ok(codex.args.includes('model_reasoning_effort="none"'));
  assert.ok(codex.args.includes('project_doc_max_bytes=0'));
});

test('codex run reads the -o file inside the private run dir', async () => {
  const { msgs, args } = await talk({ type: 'run', backend: 'codex', system: 'SYS', prompt: '<task>y</task>', model: 'gpt-5.5', effort: 'low' });
  assert.equal(finalText(msgs), 'CODEX:ok');
  assert.equal(msgs.at(-1).type, 'done');
  assert.equal(args[0], 'exec');
  assert.equal(args[args.indexOf('--sandbox') + 1], 'read-only');
  assert.equal(args[args.indexOf('-m') + 1], 'gpt-5.5');
  assert.ok(args.includes('model_reasoning_effort="low"'));
  assert.match(args[args.indexOf('-o') + 1], /work\/run-[^/]+\/last-message\.txt$/);
  assert.equal(args.at(-1), '-');
});

test('claude CLI error is surfaced', async () => {
  const { msgs } = await talk({ type: 'run', backend: 'claude', system: '', prompt: 'hi' }, { FAKE_MODE: 'error' });
  assert.equal(msgs.at(-1).error, 'CLI_ERROR');
  assert.match(msgs.at(-1).detail, /Not logged in/);
});

test('stream-json robustness: final line without newline, null lines, multi-message runs', async () => {
  const nn = await talk({ type: 'run', backend: 'claude', system: '', prompt: 'hi' }, { FAKE_MODE: 'no-newline' });
  assert.equal(finalText(nn.msgs), 'FINAL');
  const nl = await talk({ type: 'run', backend: 'claude', system: '', prompt: 'hi' }, { FAKE_MODE: 'null-line' });
  assert.equal(finalText(nl.msgs), 'after-null');
  const mm = await talk({ type: 'run', backend: 'claude', system: '', prompt: 'hi', web: true }, { FAKE_MODE: 'multi' });
  assert.ok(mm.msgs.some((m) => m.type === 'reset'), 'reset sent when a new message starts');
  assert.ok(mm.msgs.some((m) => m.type === 'status' && /웹 검색/.test(m.text)));
  assert.match(finalText(mm.msgs), /substantive report[\s\S]*Done\./, 'short wrap-up does not replace the report');
});

test('timeout kills a hanging CLI that ignores SIGTERM', async () => {
  const { msgs } = await talk({ type: 'run', backend: 'claude', system: '', prompt: 'hi', timeoutSec: 1 }, { FAKE_MODE: 'hang' });
  assert.equal(msgs.at(-1).error, 'TIMEOUT');
});

test('cancel (stdin closed) kills the whole process group, including grandchildren', async () => {
  const tmp = tmpdir();
  const cfg = path.join(tmp, 'config.json');
  const pidFile = path.join(tmp, 'pids.json');
  fs.writeFileSync(cfg, JSON.stringify({ claudePath: path.join(FIX, 'fake-claude.js') }));
  const proc = spawn(process.execPath, [HOST], { env: { ...process.env, OLAI_HOST_CONFIG: cfg, OLAI_WORKDIR: path.join(tmp, 'w'), FAKE_MODE: 'hang-tree', FAKE_PID_FILE: pidFile }, stdio: ['pipe', 'pipe', 'inherit'] });
  proc.stdin.write(frame({ type: 'run', backend: 'claude', system: '', prompt: 'hi' }));
  for (let i = 0; i < 50 && !fs.existsSync(pidFile); i++) await new Promise((r) => setTimeout(r, 100));
  const pids = JSON.parse(fs.readFileSync(pidFile, 'utf8'));
  const t0 = Date.now();
  proc.stdin.end();
  await new Promise((resolve) => proc.on('close', resolve));
  const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
  await new Promise((r) => setTimeout(r, 200));
  const elapsed = Date.now() - t0;
  fs.rmSync(tmp, { recursive: true, force: true });
  assert.equal(alive(pids.child), false, 'CLI killed');
  assert.equal(alive(pids.grandchild), false, 'grandchild killed');
  assert.ok(elapsed < 2000, `host exits before Chrome's ~2 s SIGKILL (took ${elapsed} ms)`);
});

test('rejects bad requests', async () => {
  assert.equal((await talk({ type: 'run', backend: 'bash', prompt: 'x' })).msgs.at(-1).error, 'BAD_BACKEND');
  assert.equal((await talk({ type: 'run', backend: 'claude', prompt: '  ' })).msgs.at(-1).error, 'EMPTY_PROMPT');
});

test('missing CLI binary → CLI_NOT_FOUND', async () => {
  const { msgs } = await talk({ type: 'run', backend: 'claude', prompt: 'x' }, {}, { claudePath: path.join(os.tmpdir(), 'definitely-missing-cli') });
  assert.equal(msgs.at(-1).error, 'CLI_NOT_FOUND');
});

// ---- bib lookups against a local fake API (OLAI_EP_* overrides)

function fakeApi() {
  const seen = [];
  const server = http.createServer((req, res) => {
    seen.push({ method: req.method, url: req.url, accept: req.headers.accept, ua: req.headers['user-agent'] });
    const send = (status, body, type = 'application/json') => { res.writeHead(status, { 'Content-Type': type }); res.end(body); };
    if (req.url.startsWith('/api/query')) {
      return send(200, `<feed><entry><id>http://arxiv.org/abs/1810.04805v2</id><title>BERT: Pre-training</title><published>2018-10-11T00:00:00Z</published><author><name>Jacob Devlin</name></author><arxiv:journal_ref>NAACL 2019</arxiv:journal_ref><arxiv:primary_category term="cs.CL"/></entry></feed>`, 'application/atom+xml');
    }
    if (req.url.startsWith('/graph/v1/paper/batch')) {
      if (seen.filter((s) => s.url.startsWith('/graph')).length === 1) return send(429, '{}'); // first call rate-limited
      return send(200, JSON.stringify([{ title: 'Attention Is All You Need', venue: 'Neural Information Processing Systems', year: 2017, externalIds: { ArXiv: '1706.03762' } }]));
    }
    if (req.url.startsWith('/works/doi:')) return send(200, JSON.stringify({ id: 'https://openalex.org/W1', display_name: 'BERT', doi: 'https://doi.org/10.48550/arxiv.1810.04805', type: 'preprint', publication_year: 2018, authorships: [], locations: [{ source: { display_name: 'arXiv (Cornell University)' }, landing_page_url: 'http://arxiv.org/abs/1810.04805' }] }));
    if (req.url.startsWith('/works?search=')) return send(200, JSON.stringify({ results: [{ id: 'W2', display_name: 'BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding', doi: 'https://doi.org/10.18653/v1/n19-1423', type: 'conference-paper', publication_year: 2019, authorships: [{ author: { display_name: 'Jacob Devlin' } }], primary_location: { source: { display_name: 'NAACL-HLT' } }, locations: [] }] }));
    if (req.url.startsWith('/10.')) return send(200, '@inproceedings{Devlin_2019, title={BERT}, year={2019}}', 'application/x-bibtex');
    if (req.url.startsWith('/works?query.bibliographic=')) return send(200, JSON.stringify({ message: { items: [{ DOI: '10.18653/v1/N19-1423', title: ['BERT'], 'container-title': ['NAACL'], issued: { 'date-parts': [[2019]] }, author: [{ given: 'Jacob', family: 'Devlin' }], type: 'proceedings-article' }] } }));
    if (req.url.startsWith('/blocked')) return send(200, '<!doctype html><title>Making sure you are not a bot</title>', 'text/html');
    return send(404, 'nope');
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, seen, base: `http://127.0.0.1:${server.address().port}` })));
}

test('bib lookups: arXiv, Semantic Scholar (retry on 429), OpenAlex, DOI BibTeX, Crossref; no arbitrary URLs', async () => {
  const api = await fakeApi();
  const env = { OLAI_EP_ARXIV: api.base, OLAI_EP_S2: api.base, OLAI_EP_OPENALEX: api.base, OLAI_EP_DOI: api.base, OLAI_EP_CROSSREF: api.base };
  try {
    const ax = (await talk({ type: 'bib', op: 'arxiv', ids: ['1810.04805', 'not an id; rm -rf'] }, env)).msgs.at(-1);
    assert.equal(ax.ok, true);
    assert.equal(ax.data[0].id, '1810.04805');
    assert.equal(ax.data[0].journalRef, 'NAACL 2019');
    assert.equal(api.seen.at(-1).url, '/api/query?id_list=1810.04805&max_results=1');

    const s2 = (await talk({ type: 'bib', op: 's2', ids: ['arXiv:1706.03762'] }, env)).msgs.at(-1);
    assert.equal(s2.ok, true, JSON.stringify(s2));
    assert.equal(s2.data[0].venue, 'Neural Information Processing Systems');

    const oa = (await talk({ type: 'bib', op: 'openalex-search', q: 'BERT pre-training' }, env)).msgs.at(-1);
    assert.equal(oa.data[0].doi, '10.18653/v1/n19-1423');
    assert.equal(oa.data[0].type, 'conference-paper');
    assert.equal(oa.data[0].primary.source, 'NAACL-HLT');

    const work = (await talk({ type: 'bib', op: 'openalex-work', id: 'doi:10.48550/arxiv.1810.04805' }, env)).msgs.at(-1);
    assert.equal(work.data.locations[0].isArxiv, true);

    const bib = (await talk({ type: 'bib', op: 'doi-bib', doi: '10.18653/v1/N19-1423' }, env)).msgs.at(-1);
    assert.match(bib.data, /@inproceedings\{Devlin_2019/);
    assert.match(api.seen.at(-1).accept, /application\/x-bibtex/);
    assert.match(api.seen.at(-1).ua, /overleaf-ai-bridge/);

    const cr = (await talk({ type: 'bib', op: 'crossref-search', q: 'BERT' }, env)).msgs.at(-1);
    assert.equal(cr.data[0].venue, 'NAACL');

    const bad = (await talk({ type: 'bib', op: 'fetch', url: 'https://evil.example' }, env)).msgs.at(-1);
    assert.equal(bad.ok, false);
    assert.equal((await talk({ type: 'bib', op: 'doi-bib', doi: 'javascript:alert(1)' }, env)).msgs.at(-1).ok, false);
  } finally {
    api.server.close();
  }
});

test('agent mode: MCP tools relayed to the extension, session ids, budget, cleanup', async () => {
  const seen = [];
  const handler = (name, args) => { seen.push(name); if (name === 'list_files') return 'main.tex (open)'; return `1| content of ${args.path}`; };
  const first = await talk({ type: 'agent', projectKey: 'proj12345', system: 'S', prompt: 'do it' }, { FAKE_MODE: 'agent' }, {}, handler);
  const done = first.msgs.at(-1);
  assert.equal(done.type, 'done', JSON.stringify(first.msgs.at(-1)));
  assert.match(finalText(first.msgs), /^TOOLS=9 list_files:main\.tex \(open\) \| read_file:1\| content of main\.tex$/);
  assert.deepEqual(seen, ['list_files', 'read_file']);
  assert.equal(first.msgs.filter((m) => m.type === 'activity').map((m) => m.name).join(','), 'list_files,read_file');
  const session = first.msgs.find((m) => m.type === 'session').sessionId;
  assert.match(session, /^[0-9a-f-]{36}$/);
  assert.equal(done.sessionId, session);
  const a = first.record.args;
  assert.equal(a[a.indexOf('--session-id') + 1], session);
  assert.ok(!a.includes('--no-session-persistence'));
  assert.equal(a[a.indexOf('--tools') + 1], '');
  assert.ok(a.includes('mcp__overleaf__propose_edit'));
  assert.ok(!a.some((x) => /^(Bash|Edit|Write|Read)$/.test(x)));
  assert.match(first.record.cwd, /work\/agent-proj12345$/);
  assert.ok(first.leftovers.every((f) => f === 'agent-proj12345'), `leftovers: ${first.leftovers}`); // socket + run dir removed

  // resume the same conversation; tool budget enforced
  const second = await talk({ type: 'agent', projectKey: 'proj12345', sessionId: session, system: 'S', prompt: 'more', maxToolCalls: 1 }, { FAKE_MODE: 'agent' }, {}, handler);
  const b = second.record.args;
  assert.equal(b[b.indexOf('--resume') + 1], session);
  assert.ok(!b.includes('--session-id'));
  assert.match(finalText(second.msgs), /read_file:ERR:Error: tool budget of 1 calls exhausted/);

  const bad = await talk({ type: 'agent', projectKey: '../etc', system: 'S', prompt: 'x' });
  assert.equal(bad.msgs.at(-1).error, 'BAD_REQUEST');
});
