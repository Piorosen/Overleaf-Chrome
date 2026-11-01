'use strict';
// Drives host/host.js over the real Native Messaging framing with fake CLIs.
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('child_process');
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

// Send one request; collect messages until `done`/`error`/`pong` (or the host exits).
function talk(request, env = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'olai-test-'));
  const config = path.join(tmp, 'config.json');
  fs.writeFileSync(config, JSON.stringify({
    claudePath: path.join(FIX, 'fake-claude.js'),
    codexPath: path.join(FIX, 'fake-codex.js'),
  }));
  const argsFile = path.join(tmp, 'args.json');
  const proc = spawn(process.execPath, [HOST], {
    env: { ...process.env, OLAI_HOST_CONFIG: config, FAKE_ARGS_FILE: argsFile, ...env },
    stdio: ['pipe', 'pipe', 'inherit'],
  });
  return new Promise((resolve, reject) => {
    const msgs = [];
    let buf = Buffer.alloc(0);
    const timer = setTimeout(() => { proc.kill(); reject(new Error(`timeout: ${JSON.stringify(msgs)}`)); }, 20000);
    proc.stdout.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      while (buf.length >= 4) {
        const len = buf.readUInt32LE(0);
        if (buf.length < 4 + len) break;
        const m = JSON.parse(buf.subarray(4, 4 + len).toString('utf8'));
        buf = buf.subarray(4 + len);
        msgs.push(m);
        if (['done', 'error', 'pong'].includes(m.type)) {
          proc.stdin.end(); // like Chrome disconnecting the port
        }
      }
    });
    proc.on('close', (code) => {
      clearTimeout(timer);
      let args = null;
      try { args = JSON.parse(fs.readFileSync(argsFile, 'utf8')); } catch { /* not written */ }
      fs.rmSync(tmp, { recursive: true, force: true });
      resolve({ msgs, code, args });
    });
    proc.stdin.write(frame(request));
  });
}

test('ping reports both CLIs', async () => {
  const { msgs, code } = await talk({ type: 'ping' });
  assert.equal(code, 0);
  const pong = msgs.find((m) => m.type === 'pong');
  assert.equal(pong.claude.ok, true);
  assert.match(pong.claude.version, /Fake Claude/);
  assert.equal(pong.codex.ok, true);
});

test('ping is answered even if stdin closes right after the request', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'olai-test-'));
  const config = path.join(tmp, 'config.json');
  fs.writeFileSync(config, JSON.stringify({ claudePath: path.join(FIX, 'fake-claude.js'), codexPath: path.join(FIX, 'fake-codex.js') }));
  const proc = spawn(process.execPath, [HOST], { env: { ...process.env, OLAI_HOST_CONFIG: config }, stdio: ['pipe', 'pipe', 'inherit'] });
  const chunks = [];
  proc.stdout.on('data', (d) => chunks.push(d));
  proc.stdin.end(frame({ type: 'ping' }));
  const code = await new Promise((resolve) => proc.on('close', resolve));
  fs.rmSync(tmp, { recursive: true, force: true });
  const buf = Buffer.concat(chunks);
  assert.equal(code, 0);
  assert.equal(JSON.parse(buf.subarray(4, 4 + buf.readUInt32LE(0)).toString()).type, 'pong');
});

test('claude run streams deltas and returns final text', async () => {
  const prompt = '<task>x</task>';
  const { msgs, args } = await talk({ type: 'run', backend: 'claude', system: 'SYS', prompt, model: 'sonnet', effort: 'low', extraArgs: ['--foo'] });
  const deltas = msgs.filter((m) => m.type === 'delta').map((m) => m.text).join('');
  const final = msgs.filter((m) => m.type === 'final-chunk').map((m) => m.text).join('');
  assert.equal(deltas, `ECHO:${prompt.length}`);
  assert.equal(final, `ECHO:${prompt.length}`);
  const done = msgs.at(-1);
  assert.equal(done.type, 'done');
  assert.equal(done.costUsd, 0.0012);
  // CLI flags: print mode, no tools, our system prompt, model/effort, extra args
  assert.equal(args[0], '-p');
  assert.deepEqual(args.slice(args.indexOf('--tools'), args.indexOf('--tools') + 2), ['--tools', '']);
  assert.equal(args[args.indexOf('--system-prompt') + 1], 'SYS');
  assert.equal(args[args.indexOf('--model') + 1], 'sonnet');
  assert.equal(args[args.indexOf('--effort') + 1], 'low');
  assert.equal(args.at(-1), '--foo');
});

test('web flag enables exactly WebSearch/WebFetch for claude, ignored for codex', async () => {
  const { args } = await talk({ type: 'run', backend: 'claude', system: 'S', prompt: 'p', web: true, effort: 'high' });
  const i = args.indexOf('--tools');
  assert.deepEqual(args.slice(i, i + 4), ['--tools', 'WebSearch,WebFetch', '--allowedTools', 'WebSearch,WebFetch']);
  const plain = await talk({ type: 'run', backend: 'claude', system: 'S', prompt: 'p' });
  assert.equal(plain.args[plain.args.indexOf('--tools') + 1], '');
  assert.ok(!plain.args.includes('--allowedTools'));
  const codex = await talk({ type: 'run', backend: 'codex', system: 'S', prompt: '<task>p</task>', web: true, effort: 'none' });
  assert.ok(!codex.args.some((a) => /WebSearch/.test(a)));
  assert.equal(codex.args[codex.args.indexOf('-c') + 1], 'model_reasoning_effort="none"');
});

test('ping includes CLI default settings objects', async () => {
  const { msgs } = await talk({ type: 'ping' });
  const pong = msgs.find((m) => m.type === 'pong');
  assert.equal(typeof pong.claude.defaults, 'object');
  assert.equal(typeof pong.codex.defaults, 'object');
  assert.equal(pong.hostVersion, '0.3.0');
});

test('claude CLI error is surfaced', async () => {
  const { msgs } = await talk({ type: 'run', backend: 'claude', system: '', prompt: 'hi' }, { FAKE_MODE: 'error' });
  const err = msgs.at(-1);
  assert.equal(err.type, 'error');
  assert.equal(err.error, 'CLI_ERROR');
  assert.match(err.detail, /Not logged in/);
});

test('timeout kills a hanging CLI', async () => {
  // timeoutSec is clamped to >= 10s by the host
  const { msgs } = await talk({ type: 'run', backend: 'claude', system: '', prompt: 'hi', timeoutSec: 1 }, { FAKE_MODE: 'hang' });
  assert.equal(msgs.at(-1).error, 'TIMEOUT');
});

test('codex run reads the -o file and prepends the system prompt', async () => {
  const { msgs, args } = await talk({ type: 'run', backend: 'codex', system: 'SYS', prompt: '<task>y</task>', model: 'gpt-5', effort: 'low' });
  const final = msgs.filter((m) => m.type === 'final-chunk').map((m) => m.text).join('');
  assert.equal(final, 'CODEX:ok');
  assert.equal(msgs.at(-1).type, 'done');
  assert.equal(args[0], 'exec');
  assert.ok(args.includes('--skip-git-repo-check'));
  assert.equal(args[args.indexOf('--sandbox') + 1], 'read-only');
  assert.equal(args[args.indexOf('-m') + 1], 'gpt-5');
  assert.equal(args[args.indexOf('-c') + 1], 'model_reasoning_effort="low"');
  assert.equal(args.at(-1), '-');
});

test('rejects bad requests', async () => {
  const bad = await talk({ type: 'run', backend: 'bash', prompt: 'x' });
  assert.equal(bad.msgs.at(-1).error, 'BAD_BACKEND');
  const empty = await talk({ type: 'run', backend: 'claude', prompt: '  ' });
  assert.equal(empty.msgs.at(-1).error, 'EMPTY_PROMPT');
});

test('missing CLI binary → CLI_NOT_FOUND', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'olai-test-'));
  const config = path.join(tmp, 'config.json');
  fs.writeFileSync(config, JSON.stringify({ claudePath: path.join(tmp, 'nope') }));
  const proc = spawn(process.execPath, [HOST], { env: { ...process.env, OLAI_HOST_CONFIG: config }, stdio: ['pipe', 'pipe', 'inherit'] });
  const out = await new Promise((resolve) => {
    let buf = Buffer.alloc(0);
    const msgs = [];
    proc.stdout.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      while (buf.length >= 4 && buf.length >= 4 + buf.readUInt32LE(0)) {
        const len = buf.readUInt32LE(0);
        msgs.push(JSON.parse(buf.subarray(4, 4 + len).toString()));
        buf = buf.subarray(4 + len);
        if (msgs.at(-1).type === 'error') proc.stdin.end();
      }
    });
    proc.on('close', () => resolve(msgs));
    proc.stdin.write(frame({ type: 'run', backend: 'claude', prompt: 'x' }));
  });
  fs.rmSync(tmp, { recursive: true, force: true });
  assert.equal(out.at(-1).error, 'CLI_NOT_FOUND');
});
