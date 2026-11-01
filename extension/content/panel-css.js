// Overleaf AI — panel styles (injected into a closed Shadow DOM).
globalThis.OLAI_CSS = `
:host { all: initial; }
* { box-sizing: border-box; }
[hidden] { display: none !important; }
.root {
  --bg: #ffffff;
  --bg-soft: #f4f5f6;
  --bg-sunk: #eceef0;
  --fg: #1b222c;
  --fg-muted: #5f6b7a;
  --border: #d9dde2;
  --accent: #098842;
  --accent-fg: #ffffff;
  --accent-soft: #e3f3ea;
  --danger: #b42318;
  --ins-bg: #d5f0dd;
  --ins-fg: #0b5a2a;
  --del-bg: #fbe0dd;
  --del-fg: #8a1c12;
  --shadow: 0 12px 32px rgba(15, 23, 42, .18), 0 2px 6px rgba(15, 23, 42, .08);
  font: 13px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", "Apple SD Gothic Neo", "Noto Sans KR", sans-serif;
  color: var(--fg);
}
@media (prefers-color-scheme: dark) {
  .root {
    --bg: #1d232b;
    --bg-soft: #262d36;
    --bg-sunk: #151a20;
    --fg: #e6e9ee;
    --fg-muted: #9aa5b4;
    --border: #36404c;
    --accent: #2fb36a;
    --accent-fg: #07150d;
    --accent-soft: #1b3326;
    --danger: #ff7a6b;
    --ins-bg: #1e3b29;
    --ins-fg: #9be3b4;
    --del-bg: #45201c;
    --del-fg: #ffb3aa;
    --shadow: 0 12px 32px rgba(0, 0, 0, .5);
  }
}

.launcher {
  position: fixed; right: 18px; bottom: 18px; z-index: 2147483000;
  display: inline-flex; align-items: center; gap: 6px;
  height: 34px; padding: 0 14px 0 12px; border-radius: 17px;
  background: var(--accent); color: var(--accent-fg);
  border: 0; cursor: pointer; font: 600 13px/1 inherit; font-family: inherit;
  box-shadow: var(--shadow);
  transition: transform .12s ease, opacity .12s ease;
}
.launcher:hover { transform: translateY(-1px); }
.launcher:focus-visible { outline: 2px solid var(--fg); outline-offset: 2px; }
.launcher[hidden] { display: none; }
.spark { font-size: 14px; }

.panel {
  position: fixed; right: 18px; bottom: 18px; z-index: 2147483001;
  width: 400px; max-width: calc(100vw - 36px);
  max-height: min(78vh, 720px);
  display: flex; flex-direction: column;
  background: var(--bg); border: 1px solid var(--border); border-radius: 12px;
  box-shadow: var(--shadow); overflow: hidden;
}
.panel[hidden] { display: none; }

header {
  display: flex; align-items: center; gap: 8px;
  padding: 10px 10px 10px 14px; border-bottom: 1px solid var(--border);
  cursor: default; user-select: none;
}
.title { font-weight: 650; font-size: 13.5px; display: flex; align-items: center; gap: 6px; }
.title .spark { color: var(--accent); }
.grow { flex: 1; }
select, input, textarea, button { font-family: inherit; font-size: 13px; color: var(--fg); }
select.backend {
  height: 28px; padding: 0 8px; border-radius: 7px;
  border: 1px solid var(--border); background: var(--bg-soft);
}
.dot { width: 8px; height: 8px; border-radius: 50%; background: var(--fg-muted); flex: none; }
.dot.ok { background: var(--accent); }
.dot.bad { background: var(--danger); }
.icon {
  width: 28px; height: 28px; border-radius: 7px; border: 0; background: transparent;
  color: var(--fg-muted); cursor: pointer; font-size: 15px; line-height: 1;
}
.icon:hover { background: var(--bg-soft); color: var(--fg); }

.body { padding: 12px 14px 14px; overflow: auto; display: flex; flex-direction: column; gap: 12px; }

.target {
  display: flex; gap: 8px; align-items: baseline;
  padding: 8px 10px; border-radius: 8px; background: var(--bg-soft);
  color: var(--fg-muted); font-size: 12px;
}
.target b { color: var(--fg); font-weight: 600; white-space: nowrap; }
.target .preview { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.target.warn b { color: var(--danger); }
.notice { display: block; color: var(--fg); background: var(--del-bg); line-height: 1.5; }
.notice code { background: transparent; font-weight: 600; }

.actions { display: flex; flex-wrap: wrap; gap: 6px; }
.chip {
  height: 28px; padding: 0 11px; border-radius: 14px; cursor: pointer;
  border: 1px solid var(--border); background: var(--bg);
}
.chip:hover { border-color: var(--accent); background: var(--accent-soft); }
.chip.custom { border-style: dashed; }
.chip:disabled { opacity: .5; cursor: not-allowed; }

.custom { display: flex; flex-direction: column; gap: 6px; }
textarea.instr {
  width: 100%; min-height: 56px; max-height: 160px; resize: vertical;
  padding: 8px 10px; border-radius: 8px; border: 1px solid var(--border); background: var(--bg);
}
textarea.instr:focus, textarea.out:focus { outline: 2px solid var(--accent); outline-offset: -1px; border-color: transparent; }
.row { display: flex; gap: 8px; align-items: center; }
.hint { color: var(--fg-muted); font-size: 11.5px; }
kbd {
  font: 11px ui-monospace, SFMono-Regular, Menlo, monospace;
  padding: 1px 5px; border-radius: 4px; border: 1px solid var(--border); background: var(--bg-soft);
}

.btn {
  height: 30px; padding: 0 13px; border-radius: 7px; cursor: pointer;
  border: 1px solid var(--border); background: var(--bg); font-weight: 550;
}
.btn:hover { background: var(--bg-soft); }
.btn.primary { background: var(--accent); border-color: var(--accent); color: var(--accent-fg); }
.btn.primary:hover { filter: brightness(1.06); }
.btn:disabled { opacity: .5; cursor: not-allowed; }

.result { display: flex; flex-direction: column; gap: 8px; border-top: 1px solid var(--border); padding-top: 12px; }
.result[hidden] { display: none; }
.status { display: flex; align-items: center; gap: 8px; color: var(--fg-muted); font-size: 12px; min-height: 22px; }
.status.err { color: var(--danger); }
.spinner {
  width: 12px; height: 12px; border-radius: 50%; flex: none;
  border: 2px solid var(--border); border-top-color: var(--accent);
  animation: spin .8s linear infinite;
}
.spinner[hidden] { display: none; }
@keyframes spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .spinner { animation-duration: 2.4s; } }

.tabs { display: flex; gap: 2px; padding: 2px; background: var(--bg-soft); border-radius: 8px; align-self: flex-start; }
.tabs[hidden] { display: none; }
.tab { height: 24px; padding: 0 10px; border: 0; border-radius: 6px; background: transparent; cursor: pointer; color: var(--fg-muted); font-size: 12px; }
.tab[aria-selected="true"] { background: var(--bg); color: var(--fg); box-shadow: 0 1px 2px rgba(0,0,0,.08); }

.diff, textarea.out {
  width: 100%; min-height: 120px; max-height: 38vh; overflow: auto;
  padding: 10px; border-radius: 8px; border: 1px solid var(--border); background: var(--bg-sunk);
  font: 12.5px/1.55 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  white-space: pre-wrap; word-break: break-word;
}
textarea.out { resize: vertical; }
.diff[hidden], textarea.out[hidden] { display: none; }
.diff ins { background: var(--ins-bg); color: var(--ins-fg); text-decoration: none; border-radius: 2px; }
.diff del { background: var(--del-bg); color: var(--del-fg); text-decoration: line-through; border-radius: 2px; }
.err-detail { margin: 0; color: var(--fg-muted); font: 11.5px/1.5 ui-monospace, Menlo, monospace; white-space: pre-wrap; max-height: 140px; overflow: auto; }
.err-detail[hidden] { display: none; }

.result-actions { display: flex; flex-wrap: wrap; gap: 6px; }
.result-actions[hidden] { display: none; }

footer {
  padding: 8px 14px; border-top: 1px solid var(--border); background: var(--bg-soft);
  color: var(--fg-muted); font-size: 11.5px; display: flex; gap: 10px; flex-wrap: wrap;
}
code { font: 11px ui-monospace, Menlo, monospace; background: var(--bg-sunk); padding: 1px 4px; border-radius: 4px; }

.toast {
  position: fixed; top: 14px; left: 50%; transform: translateX(-50%); z-index: 2147483002;
  max-width: 360px; padding: 9px 12px; border-radius: 8px;
  background: var(--fg); color: var(--bg); font-size: 12.5px; box-shadow: var(--shadow);
}
.toast[hidden] { display: none; }
`;
