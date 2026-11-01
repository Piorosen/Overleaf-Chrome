'use strict';
// Runs host/host.js "pyrun" with a real Python + matplotlib (skipped when none is installed).
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const HOST = path.join(__dirname, '..', 'host', 'host.js');

function findPython() {
  const cands = [process.env.OLAI_TEST_PYTHON, 'python3', 'python3.14', 'python3.13', 'python3.12', 'python3.11', 'python3.10', '/opt/homebrew/bin/python3.13', '/usr/bin/python3'].filter(Boolean);
  for (const c of cands) {
    const r = spawnSync(c, ['-c', 'import matplotlib, numpy'], { stdio: 'ignore' });
    if (r.status === 0) return c;
  }
  return null;
}
const PY = findPython();
const skip = PY ? false : 'no Python with matplotlib (set OLAI_TEST_PYTHON)';

function frame(obj) {
  const body = Buffer.from(JSON.stringify(obj), 'utf8');
  const h = Buffer.alloc(4);
  h.writeUInt32LE(body.length, 0);
  return Buffer.concat([h, body]);
}

function talk(request, config = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'olai-fig-'));
  const cfg = path.join(tmp, 'config.json');
  fs.writeFileSync(cfg, JSON.stringify({ pythonPath: PY, ...config }));
  const proc = spawn(process.execPath, [HOST], { env: { ...process.env, OLAI_HOST_CONFIG: cfg, OLAI_WORKDIR: path.join(tmp, 'work') }, stdio: ['pipe', 'pipe', 'inherit'] });
  return new Promise((resolve, reject) => {
    const msgs = [];
    const files = {};
    let buf = Buffer.alloc(0);
    const timer = setTimeout(() => { proc.kill(); reject(new Error(`timeout: ${JSON.stringify(msgs).slice(0, 500)}`)); }, 60000);
    proc.stdout.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      while (buf.length >= 4) {
        const len = buf.readUInt32LE(0);
        if (buf.length < 4 + len) break;
        const m = JSON.parse(buf.subarray(4, 4 + len).toString('utf8'));
        buf = buf.subarray(4 + len);
        if (m.type === 'py-file') { files[m.which] = (files[m.which] || '') + m.data; continue; }
        msgs.push(m);
        if (['done', 'error', 'pong'].includes(m.type)) proc.stdin.end();
      }
    });
    proc.on('close', () => {
      clearTimeout(timer);
      const left = fs.existsSync(path.join(tmp, 'work')) ? fs.readdirSync(path.join(tmp, 'work')).filter((n) => n.startsWith('run-')) : [];
      fs.rmSync(tmp, { recursive: true, force: true });
      resolve({ msgs, last: msgs[msgs.length - 1], files: Object.fromEntries(Object.entries(files).map(([k, v]) => [k, Buffer.from(v, 'base64')])), leftover: left });
    });
    proc.stdin.write(frame(request));
  });
}

const FIG = `# caption: Accuracy over epochs.
# label: fig:acc
import numpy as np
import matplotlib.pyplot as plt
x = np.arange(10)
fig, ax = plt.subplots(figsize=(3.3, 2.2))
ax.plot(x, x ** 1.5, marker="o", label="방법 A")
ax.set_xlabel("Epoch"); ax.set_ylabel("정확도 (%)"); ax.legend()
plt.savefig("/definitely/not/allowed.pdf")  # recorded, not written
plt.show(); plt.close()
`;

test('pyrun draws a PDF + PNG preview with the paper style and cleans up', { skip }, async () => {
  const r = await talk({ type: 'pyrun', code: FIG, format: 'pdf' });
  assert.equal(r.last.type, 'done', JSON.stringify(r.last));
  assert.equal(r.files.figure.subarray(0, 5).toString(), '%PDF-');
  assert.equal(r.files.preview.subarray(1, 4).toString(), 'PNG');
  assert.deepEqual(r.last.figure.size, [3.3, 2.2]);
  assert.equal(r.last.figure.figures, 1);
  if (process.platform === 'darwin') {
    assert.equal(r.last.figure.sandbox, 'macos');
    assert.ok(r.last.figure.cjkFont, 'a Korean fallback font was configured');
  }
  assert.deepEqual(r.leftover, [], 'run directory removed');
  const png = await talk({ type: 'pyrun', code: FIG, format: 'png', dpi: 150 });
  assert.equal(png.files.figure.subarray(1, 4).toString(), 'PNG');
});

test('pyrun reports Python errors with the line in the author\'s code', { skip }, async () => {
  const r = await talk({ type: 'pyrun', code: 'import matplotlib.pyplot as plt\nx = [1, 2]\ny = 1 / 0\n' });
  assert.equal(r.last.type, 'error');
  assert.equal(r.last.error, 'PY_ERROR');
  assert.equal(r.last.line, 3);
  assert.match(r.last.detail, /ZeroDivisionError/);
  assert.doesNotMatch(r.last.detail, /runner\.py/);
  const none = await talk({ type: 'pyrun', code: 'x = 1\n' });
  assert.equal(none.last.error, 'NO_FIGURE');
  const syntax = await talk({ type: 'pyrun', code: 'def (\n' });
  assert.equal(syntax.last.error, 'PY_ERROR');
  assert.match(syntax.last.detail, /SyntaxError/);
});

test('sandbox blocks network, home reads, outside writes and subprocesses (macOS)', { skip: skip || (process.platform !== 'darwin' && 'macOS only') }, async () => {
  const secretDir = fs.mkdtempSync(path.join(os.homedir(), '.olai-sbtest-'));
  const secret = path.join(secretDir, 'secret.txt');
  fs.writeFileSync(secret, 'top secret');
  const outside = path.join(secretDir, 'written.txt');
  try {
    const code = `import socket, subprocess, os
import matplotlib.pyplot as plt
def tryit(name, f):
    try:
        f(); print(name, "ALLOWED")
    except Exception as e:
        print(name, "blocked", type(e).__name__)
tryit("read-home", lambda: open(${JSON.stringify(secret)}).read())
tryit("write-outside", lambda: open(${JSON.stringify(outside)}, "w").write("x"))
tryit("write-tmp", lambda: open("/tmp/olai-sbtest-w", "w").write("x"))
tryit("network", lambda: socket.create_connection(("1.1.1.1", 80), timeout=3))
tryit("exec", lambda: subprocess.run(["/bin/echo", "hi"], check=True, capture_output=True))
tryit("write-cwd", lambda: open("ok.txt", "w").write("x"))
fig, ax = plt.subplots(figsize=(2, 2)); ax.plot([1, 2], [3, 4])
`;
    const r = await talk({ type: 'pyrun', code });
    assert.equal(r.last.type, 'done', JSON.stringify(r.last));
    const log = r.last.figure.log;
    for (const k of ['read-home', 'write-outside', 'write-tmp', 'network', 'exec']) assert.match(log, new RegExp(`${k} blocked`), log);
    assert.match(log, /write-cwd ALLOWED/);
    assert.ok(!fs.existsSync(outside));
    assert.ok(!fs.existsSync('/tmp/olai-sbtest-w'));
  } finally {
    fs.rmSync(secretDir, { recursive: true, force: true });
  }
});

test('pyrun timeout kills the process; missing Python is reported; ping lists Python', { skip }, async () => {
  const t0 = Date.now();
  const r = await talk({ type: 'pyrun', code: 'import time\nwhile True: time.sleep(1)\n', timeoutSec: 5 });
  assert.equal(r.last.error, 'TIMEOUT');
  assert.ok(Date.now() - t0 < 15000);
  const missing = await talk({ type: 'pyrun', code: 'x=1\n' }, { pythonPath: '/nonexistent/python3' });
  assert.equal(missing.last.error, 'PYTHON_NOT_FOUND');
  const bad = await talk({ type: 'pyrun', code: '' });
  assert.equal(bad.last.error, 'BAD_REQUEST');
  const pong = await talk({ type: 'ping' });
  assert.ok(pong.last.caps.includes('figure'));
  assert.equal(pong.last.python.ok, true);
  assert.ok(pong.last.python.pkgs.matplotlib);
});
