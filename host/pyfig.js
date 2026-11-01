/*
 * Overleaf AI — run AI-written matplotlib code safely enough to draw a figure.
 *
 * The code is model output, so it is treated as untrusted:
 *   - macOS: sandbox-exec profile — no network, no subprocesses (other than the Python runtime),
 *     no writes outside the per-run directory and the matplotlib cache, and no reads anywhere in the
 *     home folder except the Python installation, the user's site-packages and fonts.
 *   - Linux: bubblewrap (bwrap) when installed — read-only root, empty home, no network.
 *   - Otherwise it runs unsandboxed and the extension requires the author to read and approve it.
 * A small runner applies a paper style, executes the code, and saves the figure itself.
 * No dependencies: Node.js built-ins only.
 */
'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const IS_WIN = process.platform === 'win32';

const PROBE_PY = `import sys, json, site
from importlib import metadata
def v(n):
    try:
        return metadata.version(n)
    except Exception:
        return None
def g(f):
    try:
        return f()
    except Exception:
        return None
print(json.dumps({"version": sys.version.split()[0], "executable": sys.executable, "prefix": sys.prefix,
  "base": sys.base_prefix, "exec": sys.exec_prefix, "userbase": g(site.getuserbase), "usersite": g(site.getusersitepackages),
  "path": [p for p in sys.path if p], "pkgs": {n: v(n) for n in ["matplotlib", "numpy", "pandas", "scipy", "seaborn"]}}))
`;

// Executed in the run directory: python runner.py <fmt> <font> <dpi>
const RUNNER_PY = String.raw`import sys, os, json, traceback, warnings
fmt, font, dpi = sys.argv[1], sys.argv[2], int(sys.argv[3])
res = {"ok": False}
def finish():
    with open("result.json", "w", encoding="utf-8") as f:
        json.dump(res, f)
    sys.exit(0)
try:
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from matplotlib import font_manager
    from matplotlib.figure import Figure
    from cycler import cycler
except Exception as e:
    res.update(error="NO_MATPLOTLIB", detail="%s: %s" % (type(e).__name__, e))
    finish()

names = {f.name for f in font_manager.fontManager.ttflist}
cjk = next((n for n in ["Apple SD Gothic Neo", "AppleGothic", "Noto Sans CJK KR", "Noto Sans KR", "NanumGothic",
                        "Malgun Gothic", "Source Han Sans K", "Noto Sans CJK JP"] if n in names), None)
if font == "serif":
    base = next((n for n in ["Times New Roman", "Times", "Nimbus Roman", "TeX Gyre Termes", "STIXGeneral"] if n in names), "DejaVu Serif")
    mathfont = "stix"
else:
    base, mathfont = "DejaVu Sans", "dejavusans"
plt.rcParams.update({
    "font.family": [base] + ([cjk] if cjk else []), "mathtext.fontset": mathfont,
    "pdf.fonttype": 42, "ps.fonttype": 42,
    "savefig.bbox": "tight", "savefig.pad_inches": 0.02,
    "font.size": 8, "axes.titlesize": 9, "axes.labelsize": 8, "xtick.labelsize": 7, "ytick.labelsize": 7, "legend.fontsize": 7,
    "axes.linewidth": 0.6, "lines.linewidth": 1.4, "lines.markersize": 4, "patch.linewidth": 0.6,
    "xtick.major.width": 0.6, "ytick.major.width": 0.6, "xtick.major.size": 3, "ytick.major.size": 3,
    "grid.linewidth": 0.4, "grid.alpha": 0.4, "axes.spines.top": False, "axes.spines.right": False,
    "legend.frameon": False,
    "axes.prop_cycle": cycler(color=["#0072B2", "#E69F00", "#009E73", "#D55E00", "#CC79A7", "#56B4E9", "#F0E442", "#000000"]),
})

# The harness saves the figure: savefig() only records which figure was meant, show()/close() do nothing.
saved = []
real_savefig = Figure.savefig
Figure.savefig = lambda self, *a, **k: saved.append(self)
plt.show = lambda *a, **k: None
plt.close = lambda *a, **k: None

caught = []
def note(ws):
    for w in ws:
        m = "%s: %s" % (w.category.__name__, w.message)
        if m not in caught and "non-interactive" not in m:
            caught.append(m[:300])

code = open("figure_code.py", encoding="utf-8").read()
scope = {"__name__": "__main__", "__file__": "figure_code.py"}
try:
    with warnings.catch_warnings(record=True) as ws:
        warnings.simplefilter("always")
        exec(compile(code, "figure_code.py", "exec"), scope)
    note(ws)
except SystemExit:
    pass
except BaseException as e:
    frames = [f for f in traceback.extract_tb(e.__traceback__) if f.filename == "figure_code.py"]
    tb = traceback.format_exception(type(e), e, e.__traceback__)
    keep = []
    started = False
    for chunk in tb:
        if 'File "figure_code.py"' in chunk:
            started = True
        if started or chunk == tb[-1]:
            keep.append(chunk)
    res.update(error="PY_ERROR", detail=("Traceback (most recent call last):\n" + "".join(keep))[-6000:],
               line=frames[-1].lineno if frames else None)
    finish()

figs = [plt.figure(n) for n in plt.get_fignums()]
fig = saved[-1] if saved else (figs[-1] if figs else None)
if fig is None:
    res.update(error="NO_FIGURE", detail="The code did not create a matplotlib figure.")
    finish()
w, h = fig.get_size_inches()
try:
    with warnings.catch_warnings(record=True) as ws:
        warnings.simplefilter("always")
        kw = {"dpi": dpi} if fmt == "png" else {}
        real_savefig(fig, "figure." + fmt, format=fmt, **kw)
        real_savefig(fig, "preview.png", format="png", dpi=max(60, min(220, 1600.0 / max(w, 0.5))))
    note(ws)
except BaseException as e:
    res.update(error="PY_ERROR", detail="Saving the figure failed: %s: %s" % (type(e).__name__, e))
    finish()
res.update(ok=True, size=[round(float(w), 2), round(float(h), 2)], figures=len(figs), font=base, cjkFont=cjk, warnings=caught[:10])
finish()
`;

function realpath(p) { try { return fs.realpathSync(p); } catch { return p; } }
const both = (list) => [...new Set(list.filter(Boolean).flatMap((p) => [path.resolve(p), realpath(p)]))];

function probePython(bin, env, timeoutMs = 15000) {
  return new Promise((resolve) => {
    let out = '';
    let err = '';
    let p;
    try {
      p = spawn(bin, ['-c', PROBE_PY], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...env, PYTHONIOENCODING: 'utf-8' } });
    } catch (e) {
      resolve({ ok: false, path: bin, error: String(e.message || e) });
      return;
    }
    const t = setTimeout(() => { try { p.kill('SIGKILL'); } catch { /* gone */ } }, timeoutMs);
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', (e) => { clearTimeout(t); resolve({ ok: false, path: bin, error: e.code === 'ENOENT' ? `${bin} 를 찾을 수 없습니다` : String(e.message) }); });
    p.on('close', (code) => {
      clearTimeout(t);
      try {
        const j = JSON.parse(out.trim().split('\n').pop());
        resolve({ ok: true, path: bin, ...j });
      } catch {
        resolve({ ok: false, path: bin, error: (err || out || `exit ${code}`).trim().slice(-400) });
      }
    });
  });
}

function which(name, envPath) {
  for (const dir of String(envPath || '').split(path.delimiter)) {
    if (!dir) continue;
    const f = path.join(dir, name);
    try { fs.accessSync(f, fs.constants.X_OK); return f; } catch { /* next */ }
  }
  return null;
}

function sandboxKind(config, envPath) {
  if (config.pythonSandbox === false) return null;
  if (process.platform === 'darwin' && fs.existsSync('/usr/bin/sandbox-exec')) return 'macos';
  if (process.platform === 'linux' && which('bwrap', envPath)) return 'bwrap';
  return null;
}

const sb = (p) => `"${String(p).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

// Python installation directories that must stay readable (and executable) inside the sandbox.
function pythonDirs(py) {
  const dirs = [py.prefix, py.base, py.exec, py.userbase, py.usersite, path.dirname(py.executable || ''), path.dirname(realpath(py.executable || ''))];
  for (const p of py.path || []) if (path.isAbsolute(p)) dirs.push(p.endsWith('.zip') ? path.dirname(p) : p);
  return both(dirs.filter((d) => d && d !== '/' && d !== os.homedir()));
}

function macProfile({ runDir, mplDir, py, home }) {
  const writable = both([runDir, mplDir]);
  const readable = [...writable, ...pythonDirs(py), ...both([path.join(home, 'Library', 'Fonts')])];
  const exec = both([...pythonDirs(py).filter((d) => !d.includes('site-packages')), py.executable]);
  return [
    '(version 1)',
    '(allow default)',
    '(deny network*)',
    '(deny file-write*)',
    `(allow file-write* ${writable.map((p) => `(subpath ${sb(p)})`).join(' ')} (literal "/dev/null") (literal "/dev/zero") (literal "/dev/dtracehelper"))`,
    `(deny file-read* (subpath ${sb(realpath(home))}) (subpath ${sb(home)}) (subpath "/Volumes") (subpath "/private/var/folders"))`,
    `(allow file-read* ${readable.map((p) => `(subpath ${sb(p)})`).join(' ')} (literal ${sb(home)}))`,
    '(deny process-exec)',
    `(allow process-exec ${exec.map((p) => `(subpath ${sb(p)})`).join(' ')})`,
  ].join('\n');
}

/**
 * The command that runs runner.py. Returns { bin, args, env, sandbox }.
 */
function buildCommand({ py, runDir, mplDir, sandbox, format, font, dpi, baseEnv }) {
  const home = os.homedir();
  const env = IS_WIN ? { ...baseEnv } : { PATH: [path.dirname(py.executable), '/usr/bin', '/bin'].join(':'), LANG: baseEnv.LANG || 'en_US.UTF-8' };
  Object.assign(env, {
    HOME: runDir, MPLCONFIGDIR: mplDir, MPLBACKEND: 'Agg', TMPDIR: runDir, TEMP: runDir, TMP: runDir,
    PYTHONDONTWRITEBYTECODE: '1', PYTHONIOENCODING: 'utf-8',
  });
  if (py.userbase) env.PYTHONUSERBASE = py.userbase;
  const pyArgs = [path.join(runDir, 'runner.py'), format, font, String(dpi)];
  if (sandbox === 'macos') {
    const profile = path.join(runDir, 'sandbox.sb');
    fs.writeFileSync(profile, macProfile({ runDir, mplDir, py, home }), { mode: 0o600 });
    return { bin: '/usr/bin/sandbox-exec', args: ['-f', profile, py.executable, ...pyArgs], env, sandbox };
  }
  if (sandbox === 'bwrap') {
    const args = ['--ro-bind', '/', '/', '--dev', '/dev', '--proc', '/proc', '--tmpfs', '/tmp', '--tmpfs', home];
    for (const d of pythonDirs(py)) if (d.startsWith(`${home}/`) && fs.existsSync(d)) args.push('--ro-bind', d, d);
    args.push('--bind', runDir, runDir, '--bind', mplDir, mplDir, '--unshare-net', '--unshare-pid', '--die-with-parent', '--new-session', '--chdir', runDir, '--', py.executable, ...pyArgs);
    return { bin: 'bwrap', args, env, sandbox };
  }
  return { bin: py.executable, args: pyArgs, env, sandbox: null };
}

module.exports = { PROBE_PY, RUNNER_PY, probePython, sandboxKind, buildCommand, macProfile, pythonDirs };
