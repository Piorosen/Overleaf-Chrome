// Overleaf AI — panel styles (injected into a closed Shadow DOM).
globalThis.OLAI_CSS = `
:host { all: initial; }
* { box-sizing: border-box; }
[hidden] { display: none !important; }
.root {
  --bg: #ffffff;
  --bg-soft: #f4f5f6;
  --bg-sunk: #eef0f2;
  --fg: #1b222c;
  --fg-muted: #5f6b7a;
  --border: #d9dde2;
  --accent: #098842;
  --accent-fg: #ffffff;
  --accent-soft: #e3f3ea;
  --danger: #b42318;
  --warn: #9a6700;
  --info: #3b5bab;
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
    --warn: #e3b341;
    --info: #8fb0ff;
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
  transition: transform .12s ease;
}
.launcher:hover { transform: translateY(-1px); }
.launcher:focus-visible { outline: 2px solid var(--fg); outline-offset: 2px; }
.badge {
  min-width: 18px; height: 18px; padding: 0 5px; border-radius: 9px;
  background: var(--accent-fg); color: var(--accent); font-size: 11px; line-height: 18px; text-align: center;
}
.spark { font-size: 14px; }

.panel {
  position: fixed; right: 18px; bottom: 18px; z-index: 2147483001;
  width: 440px; max-width: calc(100vw - 32px);
  max-height: min(88vh, 900px);
  display: flex; flex-direction: column;
  background: var(--bg); border: 1px solid var(--border); border-radius: 12px;
  box-shadow: var(--shadow); overflow: hidden;
}
.panel.wide { width: 680px; }

header {
  display: flex; align-items: center; gap: 6px;
  padding: 8px 8px 8px 14px; border-bottom: 1px solid var(--border);
  user-select: none;
}
.title { font-weight: 650; font-size: 13.5px; display: flex; align-items: center; gap: 6px; }
.title .spark { color: var(--accent); }
.grow { flex: 1; }
select, input, textarea, button { font-family: inherit; font-size: 13px; color: var(--fg); }
.dot { width: 8px; height: 8px; border-radius: 50%; background: var(--fg-muted); flex: none; margin-right: 4px; }
.dot.ok { background: var(--accent); }
.dot.bad { background: var(--danger); }
.icon {
  min-width: 28px; height: 28px; padding: 0 6px; border-radius: 7px; border: 0; background: transparent;
  color: var(--fg-muted); cursor: pointer; font-size: 14px; line-height: 1;
}
.icon:hover, .icon[aria-pressed="true"] { background: var(--bg-soft); color: var(--fg); }
.icon.text { font-size: 12px; }

.modelbar { display: flex; gap: 6px; padding: 8px 14px; border-bottom: 1px solid var(--border); background: var(--bg-soft); }
.modelbar select {
  height: 28px; padding: 0 6px; border-radius: 7px; min-width: 0;
  border: 1px solid var(--border); background: var(--bg);
}
.modelbar .backend { flex: 0 0 auto; }
.modelbar .model { flex: 1 1 auto; }
.modelbar .effort { flex: 0 0 auto; max-width: 150px; }

.body { padding: 12px 14px 14px; overflow: auto; display: flex; flex-direction: column; gap: 10px; }
.body > * { flex-shrink: 0; } /* keep tabs/search from collapsing when the panel overflows */

.target {
  display: flex; gap: 8px; align-items: center;
  padding: 6px 6px 6px 10px; border-radius: 8px; background: var(--bg-soft);
  color: var(--fg-muted); font-size: 12px;
}
.target b { color: var(--fg); font-weight: 600; white-space: nowrap; }
.target .preview { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; flex: 1; }
.target.warn b { color: var(--danger); }
.target select.scope { height: 24px; border-radius: 6px; border: 1px solid var(--border); background: var(--bg); font-size: 12px; padding: 0 4px; flex: none; }
.notice { display: block; color: var(--fg); background: var(--del-bg); line-height: 1.5; padding: 8px 10px; border-radius: 8px; font-size: 12px; }
.notice code { background: transparent; font-weight: 600; }

.cats { display: flex; gap: 2px; padding: 2px; background: var(--bg-soft); border-radius: 8px; overflow-x: auto; scrollbar-width: none; }
.cat { flex: none; height: 26px; padding: 0 9px; border: 0; border-radius: 6px; background: transparent; cursor: pointer; color: var(--fg-muted); font-size: 12.5px; }
.cat[aria-selected="true"] { background: var(--bg); color: var(--fg); font-weight: 600; box-shadow: 0 1px 2px rgba(0,0,0,.08); }
.cat .n { margin-left: 4px; font-size: 11px; color: var(--warn); }

input.search {
  width: 100%; height: 30px; padding: 0 10px; border-radius: 8px;
  border: 1px solid var(--border); background: var(--bg);
}
.actions { display: flex; flex-wrap: wrap; gap: 6px; }
.actions .empty { color: var(--fg-muted); font-size: 12px; }
.chip {
  height: 28px; padding: 0 11px; border-radius: 14px; cursor: pointer;
  border: 1px solid var(--border); background: var(--bg);
  display: inline-flex; align-items: center; gap: 5px;
}
.chip:hover { border-color: var(--accent); background: var(--accent-soft); }
.chip.custom { border-style: dashed; }
.chip .tag { font-size: 10.5px; color: var(--fg-muted); border: 1px solid var(--border); border-radius: 4px; padding: 0 3px; line-height: 14px; }
.chip:disabled { opacity: .45; cursor: not-allowed; }

.lint-view { display: flex; flex-direction: column; gap: 6px; }
.lint-head { display: flex; gap: 10px; align-items: center; font-size: 12px; color: var(--fg-muted); flex-wrap: wrap; }
.lint-head label { display: inline-flex; gap: 4px; align-items: center; cursor: pointer; }
.lint-list { list-style: none; margin: 0; padding: 0; max-height: 300px; overflow: auto; border: 1px solid var(--border); border-radius: 8px; }
.lint-list li { display: grid; grid-template-columns: 10px 44px 1fr; gap: 6px; padding: 6px 8px; border-bottom: 1px solid var(--border); cursor: pointer; font-size: 12px; }
.lint-list li:last-child { border-bottom: 0; }
.lint-list li:hover { background: var(--bg-soft); }
.lint-list .sev { width: 8px; height: 8px; border-radius: 50%; margin-top: 5px; }
.sev.error { background: var(--danger); } .sev.warn { background: var(--warn); } .sev.info { background: var(--info); }
.lint-list .ln { color: var(--fg-muted); font-variant-numeric: tabular-nums; }
.lint-list .ex { display: block; color: var(--fg-muted); font: 11px ui-monospace, Menlo, monospace; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.lint-list .none { display: block; cursor: default; color: var(--fg-muted); }

.custom { display: flex; flex-direction: column; gap: 6px; }
.seg { height: 24px; padding: 0 9px; border: 1px solid var(--border); background: var(--bg); color: var(--fg-muted); cursor: pointer; font-size: 12px; }
.seg:first-child { border-radius: 6px 0 0 6px; }
.seg + .seg { border-radius: 0 6px 6px 0; margin-left: -9px; }
.seg.on { background: var(--accent-soft); color: var(--fg); border-color: var(--accent); position: relative; }
textarea.instr {
  width: 100%; min-height: 54px; max-height: 160px; resize: vertical;
  padding: 8px 10px; border-radius: 8px; border: 1px solid var(--border); background: var(--bg);
}
textarea.instr:focus, textarea.out:focus, input.search:focus, .profile input:focus, .profile textarea:focus, .profile select:focus { outline: 2px solid var(--accent); outline-offset: -1px; border-color: transparent; }
.row { display: flex; gap: 8px; align-items: center; }
.hint { color: var(--fg-muted); font-size: 11.5px; }
kbd { font: 11px ui-monospace, SFMono-Regular, Menlo, monospace; padding: 1px 5px; border-radius: 4px; border: 1px solid var(--border); background: var(--bg-soft); }

details.profile { border: 1px solid var(--border); border-radius: 8px; padding: 0 10px; }
details.profile[open] { padding-bottom: 10px; }
details.profile summary { cursor: pointer; padding: 7px 0; font-weight: 600; font-size: 12.5px; }
.profile .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.profile label { display: flex; flex-direction: column; gap: 3px; font-size: 11.5px; color: var(--fg-muted); }
.profile label.full { grid-column: 1 / -1; }
.profile input, .profile select, .profile textarea { height: 28px; padding: 0 8px; border-radius: 6px; border: 1px solid var(--border); background: var(--bg); font-size: 12.5px; }
.profile textarea { height: auto; min-height: 46px; padding: 6px 8px; resize: vertical; }

.btn {
  height: 30px; padding: 0 12px; border-radius: 7px; cursor: pointer;
  border: 1px solid var(--border); background: var(--bg); font-weight: 550;
}
.btn.sm { height: 24px; padding: 0 8px; font-size: 12px; border-radius: 6px; }
.btn:hover { background: var(--bg-soft); }
.btn.primary { background: var(--accent); border-color: var(--accent); color: var(--accent-fg); }
.btn.primary:hover { filter: brightness(1.06); }
.btn:disabled { opacity: .5; cursor: not-allowed; }

.result { display: flex; flex-direction: column; gap: 8px; border-top: 1px solid var(--border); padding-top: 12px; }
.status { display: flex; align-items: center; gap: 8px; color: var(--fg-muted); font-size: 12px; min-height: 22px; }
.status.err { color: var(--danger); }
.spinner {
  width: 12px; height: 12px; border-radius: 50%; flex: none;
  border: 2px solid var(--border); border-top-color: var(--accent);
  animation: spin .8s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .spinner { animation-duration: 2.4s; } }

.tabs { display: flex; gap: 2px; padding: 2px; background: var(--bg-soft); border-radius: 8px; align-self: flex-start; }
.tab { height: 24px; padding: 0 10px; border: 0; border-radius: 6px; background: transparent; cursor: pointer; color: var(--fg-muted); font-size: 12px; }
.tab[aria-selected="true"] { background: var(--bg); color: var(--fg); box-shadow: 0 1px 2px rgba(0,0,0,.08); }
.diff-bar { display: flex; gap: 6px; align-items: center; font-size: 12px; color: var(--fg-muted); }

.diff, textarea.out, .report {
  width: 100%; min-height: 110px; max-height: 44vh; overflow: auto;
  padding: 10px; border-radius: 8px; border: 1px solid var(--border); background: var(--bg-sunk);
}
.diff, textarea.out { font: 12.5px/1.55 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; white-space: pre-wrap; word-break: break-word; }
textarea.out { resize: vertical; }
.diff ins { background: var(--ins-bg); color: var(--ins-fg); text-decoration: none; border-radius: 2px; }
.diff del { background: var(--del-bg); color: var(--del-fg); text-decoration: line-through; border-radius: 2px; }
.diff .chg { cursor: pointer; border-radius: 3px; }
.diff .chg:hover { outline: 1px dashed var(--fg-muted); }
.diff .chg.off del { background: transparent; color: inherit; text-decoration: none; }
.diff .chg.off ins { background: transparent; color: var(--fg-muted); text-decoration: line-through; opacity: .55; }

.explain { padding: 8px 10px; border-radius: 8px; background: var(--accent-soft); font-size: 12.5px; white-space: pre-wrap; }

.report { font-size: 12.5px; line-height: 1.55; }
.report h4 { margin: 10px 0 4px; font-size: 13px; }
.report h4:first-child { margin-top: 0; }
.report p { margin: 4px 0; }
.report ul, .report ol { margin: 4px 0; padding-left: 20px; }
.report li { margin: 2px 0; }
.report li.sub { margin-left: 14px; }
.report code { font: 11.5px ui-monospace, Menlo, monospace; background: var(--bg-soft); padding: 0 3px; border-radius: 3px; }
.report pre.code { margin: 6px 0; padding: 8px; background: var(--bg); border: 1px solid var(--border); border-radius: 6px; overflow: auto; font: 11.5px/1.5 ui-monospace, Menlo, monospace; }
.report pre.code code { background: transparent; padding: 0; }
.report blockquote { margin: 4px 0; padding-left: 8px; border-left: 3px solid var(--border); color: var(--fg-muted); }
.report .table-wrap { overflow-x: auto; }
.report table { border-collapse: collapse; margin: 6px 0; font-size: 12px; }
.report th, .report td { border: 1px solid var(--border); padding: 3px 6px; vertical-align: top; text-align: left; }
.report a { color: var(--accent); }
.report a.lref { font-variant-numeric: tabular-nums; text-decoration: none; background: var(--accent-soft); padding: 0 3px; border-radius: 3px; }
.report hr { border: 0; border-top: 1px solid var(--border); }

.variants { display: flex; flex-direction: column; gap: 6px; }
.variant { border: 1px solid var(--border); border-radius: 8px; padding: 8px 10px; background: var(--bg-sunk); }
.variant pre { margin: 0 0 6px; white-space: pre-wrap; word-break: break-word; font: 12.5px/1.5 ui-monospace, Menlo, monospace; }
.variant .row { justify-content: flex-end; }
.variant .n { color: var(--fg-muted); font-size: 11px; margin-right: auto; }

.err-detail { margin: 0; color: var(--fg-muted); font: 11.5px/1.5 ui-monospace, Menlo, monospace; white-space: pre-wrap; max-height: 140px; overflow: auto; }
.result-actions { display: flex; flex-wrap: wrap; gap: 6px; }

.history { display: flex; flex-direction: column; gap: 4px; }
.history .item { display: grid; grid-template-columns: 1fr auto; gap: 2px 8px; padding: 7px 9px; border: 1px solid var(--border); border-radius: 8px; cursor: pointer; background: var(--bg); text-align: left; }
.history .item:hover { border-color: var(--accent); }
.history .item small { color: var(--fg-muted); grid-column: 1 / -1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

footer {
  padding: 7px 14px; border-top: 1px solid var(--border); background: var(--bg-soft);
  color: var(--fg-muted); font-size: 11.5px; display: flex; gap: 10px; flex-wrap: wrap;
}
code { font: 11px ui-monospace, Menlo, monospace; background: var(--bg-sunk); padding: 1px 4px; border-radius: 4px; }

.toast {
  position: fixed; top: 14px; left: 50%; transform: translateX(-50%); z-index: 2147483002;
  max-width: 360px; padding: 9px 12px; border-radius: 8px;
  background: var(--fg); color: var(--bg); font-size: 12.5px; box-shadow: var(--shadow);
}

.chip.on { border-color: var(--accent); background: var(--accent-soft); font-weight: 600; }
.term-list { display: flex; flex-direction: column; gap: 6px; max-height: 340px; overflow: auto; }
.term-group { border: 1px solid var(--border); border-radius: 8px; padding: 6px 8px; }
.term-head { display: flex; gap: 6px; align-items: center; font-size: 12px; cursor: pointer; }
.term-head .src { font-size: 11px; padding: 0 5px; border-radius: 4px; background: var(--bg-soft); color: var(--fg-muted); }
.term-group .forms { display: flex; flex-wrap: wrap; gap: 4px 12px; margin-top: 4px; padding-left: 20px; }
.term-group .form { display: inline-flex; gap: 4px; align-items: center; font: 12px ui-monospace, Menlo, monospace; cursor: pointer; }
.term-group .cnt { color: var(--fg-muted); }
button.jump { border: 0; background: var(--accent-soft); color: var(--accent); border-radius: 4px; font-size: 11px; padding: 0 4px; cursor: pointer; font-variant-numeric: tabular-nums; }
.pkg-list li.pkg-item { display: flex; gap: 8px; align-items: center; cursor: default; }
.pkg-list li.pkg-item label { display: inline-flex; gap: 6px; align-items: center; cursor: pointer; }
.pkg-list li.pkg-item .hint { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pkg-prompt { display: flex; flex-direction: column; gap: 6px; padding: 8px 10px; border-radius: 8px; border: 1px solid var(--accent); background: var(--accent-soft); font-size: 12.5px; }
.pkg-prompt code { background: var(--bg); }
footer .ac { display: inline-flex; gap: 4px; align-items: center; }
footer .ac select { height: 22px; font-size: 11.5px; border-radius: 5px; border: 1px solid var(--border); background: var(--bg); padding: 0 2px; }
`;
