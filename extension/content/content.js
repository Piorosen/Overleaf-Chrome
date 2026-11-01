// Overleaf AI — isolated-world content script: panel UI + run orchestration.
(() => {
  'use strict';
  if (window.__olaiContent) return;
  window.__olaiContent = true;

  const P = globalThis.OLAI;
  const D = globalThis.OLAI_DIFF;
  const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  const MOD = IS_MAC ? '⌘' : 'Ctrl';
  const ALT = IS_MAC ? '⌥' : 'Alt';

  // ------------------------------------------------------------- settings ---

  let settings = { ...P.DEFAULT_SETTINGS };
  chrome.storage.sync.get(P.DEFAULT_SETTINGS)
    .then((s) => { settings = { ...P.DEFAULT_SETTINGS, ...s }; onSettingsChanged(); })
    .catch(() => {});
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return;
    for (const [k, c] of Object.entries(changes)) settings[k] = c.newValue === undefined ? P.DEFAULT_SETTINGS[k] : c.newValue;
    onSettingsChanged();
  });
  function saveSetting(key, value) {
    settings[key] = value;
    chrome.storage.sync.set({ [key]: value }).catch(() => {});
  }
  const allActions = () => [...P.ACTIONS, ...P.parseCustomPresets(settings.customPresets)];

  // ------------------------------------------------ main-world (editor) RPC ---

  let rpcSeq = 0;
  const pending = new Map();
  window.addEventListener('message', (e) => {
    if (e.source !== window || !e.data || e.data.channel !== 'olai:mw->cs') return;
    const p = pending.get(e.data.id);
    if (!p) return;
    pending.delete(e.data.id);
    if (e.data.ok) p.resolve(e.data.result); else p.reject(new Error(e.data.error));
  });
  function mw(cmd, args = {}, timeoutMs = 5000) {
    return new Promise((resolve, reject) => {
      const id = `olai-${Date.now()}-${++rpcSeq}`;
      pending.set(id, { resolve, reject });
      setTimeout(() => { if (pending.delete(id)) reject(new Error('MAIN_WORLD_TIMEOUT')); }, timeoutMs);
      window.postMessage({ channel: 'olai:cs->mw', id, cmd, args }, location.origin);
    });
  }

  // ------------------------------------------------------------------- UI ---

  const hostEl = document.createElement('div');
  hostEl.id = 'overleaf-ai-extension-root';
  const shadow = hostEl.attachShadow({ mode: 'closed' });
  shadow.innerHTML = `
    <style>${globalThis.OLAI_CSS}</style>
    <div class="root">
      <button class="launcher" type="button" title="Overleaf AI (${ALT}+Shift+A)"><span class="spark" aria-hidden="true">✦</span>AI</button>
      <section class="panel" role="dialog" aria-label="Overleaf AI" hidden>
        <header>
          <span class="title"><span class="spark" aria-hidden="true">✦</span>Overleaf AI</span>
          <span class="grow"></span>
          <span class="dot" title="연결 확인 중…"></span>
          <select class="backend" aria-label="AI 백엔드">
            <option value="claude">Claude</option>
            <option value="codex">Codex (ChatGPT)</option>
          </select>
          <button class="icon settings" type="button" title="설정" aria-label="설정">⚙</button>
          <button class="icon close" type="button" title="닫기 (Esc)" aria-label="닫기">✕</button>
        </header>
        <div class="body">
          <div class="notice target warn" hidden></div>
          <div class="target ctx"><b class="kind">대상</b><span class="preview"></span></div>
          <div class="actions"></div>
          <div class="custom">
            <textarea class="instr" rows="2" placeholder="직접 지시 — 예: 이 문단을 3문장으로 요약 / 실험 설정을 설명하는 문단 작성"></textarea>
            <div class="row">
              <span class="hint"><kbd>${MOD}</kbd>+<kbd>Enter</kbd> 실행</span>
              <span class="grow"></span>
              <button class="btn primary run" type="button">실행</button>
            </div>
          </div>
          <div class="result" hidden>
            <div class="status"><span class="spinner"></span><span class="status-text"></span><span class="grow"></span><button class="btn stop" type="button">중지</button></div>
            <pre class="err-detail" hidden></pre>
            <div class="tabs" role="tablist" hidden>
              <button class="tab" type="button" role="tab" data-tab="diff">변경사항</button>
              <button class="tab" type="button" role="tab" data-tab="text">결과 (편집 가능)</button>
            </div>
            <div class="diff" hidden></div>
            <textarea class="out" spellcheck="false" hidden></textarea>
            <div class="result-actions" hidden>
              <button class="btn primary apply" type="button">적용</button>
              <button class="btn after" type="button">원문 아래에 추가</button>
              <button class="btn copy" type="button">복사</button>
              <button class="btn retry" type="button">다시 생성</button>
            </div>
          </div>
        </div>
        <footer>
          <span><kbd>${ALT}</kbd>+<kbd>Shift</kbd>+<kbd>I</kbd> 빠른 실행</span>
          <span><code>% ai: 지시</code> 줄에서 실행하면 그 자리에 작성</span>
        </footer>
      </section>
      <div class="toast" role="status" hidden></div>
    </div>`;
  document.body.appendChild(hostEl);

  const $ = (sel) => shadow.querySelector(sel);
  const ui = {
    root: $('.root'),
    launcher: $('.launcher'),
    panel: $('.panel'),
    dot: $('.dot'),
    backend: $('.backend'),
    settingsBtn: $('.settings'),
    closeBtn: $('.close'),
    notice: $('.notice'),
    ctxBox: $('.ctx'),
    ctxKind: $('.ctx .kind'),
    ctxPreview: $('.ctx .preview'),
    actions: $('.actions'),
    instr: $('.instr'),
    runBtn: $('.run'),
    result: $('.result'),
    spinner: $('.spinner'),
    status: $('.status'),
    statusText: $('.status-text'),
    stopBtn: $('.stop'),
    errDetail: $('.err-detail'),
    tabs: $('.tabs'),
    diff: $('.diff'),
    out: $('.out'),
    resultActions: $('.result-actions'),
    applyBtn: $('.apply'),
    afterBtn: $('.after'),
    copyBtn: $('.copy'),
    retryBtn: $('.retry'),
    toast: $('.toast'),
  };

  // Keep keystrokes typed inside the panel away from Overleaf's global shortcuts.
  for (const type of ['keydown', 'keyup', 'keypress']) {
    ui.root.addEventListener(type, (e) => e.stopPropagation());
  }

  function onSettingsChanged() {
    ui.backend.value = settings.backend === 'codex' ? 'codex' : 'claude';
    ui.launcher.hidden = !settings.showLauncher || !ui.panel.hidden;
    renderActions();
    if (!ui.panel.hidden) checkConnection();
  }

  function renderActions() {
    ui.actions.textContent = '';
    for (const a of allActions()) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `chip${a.custom ? ' custom' : ''}`;
      b.textContent = a.label;
      b.title = a.instruction;
      b.addEventListener('click', (e) => {
        if (!e.isTrusted) return;
        start({ kind: a.kind, instruction: a.instruction, label: a.label });
      });
      ui.actions.appendChild(b);
    }
  }

  let toastTimer = 0;
  function toast(text, ms = 2600) {
    ui.toast.textContent = text;
    ui.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { ui.toast.hidden = true; }, ms);
  }

  // ------------------------------------------------------- panel open/close ---

  function openPanel({ focusInput = false } = {}) {
    if (!ui.panel.hidden) { if (focusInput) ui.instr.focus(); return; }
    ui.panel.hidden = false;
    ui.launcher.hidden = true;
    refreshTarget();
    checkConnection();
    if (focusInput) ui.instr.focus();
  }
  function closePanel() {
    ui.panel.hidden = true;
    ui.launcher.hidden = !settings.showLauncher;
    mw('focus').catch(() => {});
  }
  const togglePanel = () => (ui.panel.hidden ? openPanel({ focusInput: true }) : closePanel());

  ui.launcher.addEventListener('click', (e) => { if (e.isTrusted) openPanel({ focusInput: true }); });
  ui.closeBtn.addEventListener('click', closePanel);
  ui.settingsBtn.addEventListener('click', () => {
    try { chrome.runtime.sendMessage({ type: 'open-options' }); } catch { toast('확장 프로그램이 업데이트되었습니다. 페이지를 새로고침하세요.'); }
  });
  ui.backend.addEventListener('change', () => { saveSetting('backend', ui.backend.value); checkConnection(); });
  ui.root.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !ui.panel.hidden) { e.preventDefault(); closePanel(); }
  });

  // ------------------------------------------------------ connection check ---

  let lastPing = null;
  function checkConnection() {
    if (!chrome.runtime?.id) return showNotice('확장 프로그램이 업데이트되었습니다. 페이지를 새로고침하세요.');
    ui.dot.className = 'dot';
    ui.dot.title = '연결 확인 중…';
    chrome.runtime.sendMessage({ type: 'ping' }).then((resp) => {
      lastPing = resp;
      if (!resp?.ok) {
        ui.dot.className = 'dot bad';
        ui.dot.title = resp?.error || '연결 실패';
        showNotice('로컬 브리지에 연결할 수 없습니다. 터미널에서 <code>./scripts/install-host.sh</code> 를 실행한 뒤 확장 프로그램을 새로고침하세요.');
        return;
      }
      const cli = settings.backend === 'codex' ? resp.codex : resp.claude;
      const name = settings.backend === 'codex' ? 'codex' : 'claude';
      if (cli?.ok) {
        ui.dot.className = 'dot ok';
        ui.dot.title = `${cli.version} · ${cli.path}`;
        showNotice(null);
      } else {
        ui.dot.className = 'dot bad';
        ui.dot.title = cli?.error || `${name} 없음`;
        showNotice(`<code>${name}</code> CLI 를 찾을 수 없습니다 (${D.escapeHtml(String(cli?.error || ''))}). 설치 후 <code>./scripts/install-host.sh</code> 를 다시 실행하세요.`);
      }
    }).catch((e) => {
      ui.dot.className = 'dot bad';
      ui.dot.title = String(e?.message || e);
    });
  }
  function showNotice(html) {
    ui.notice.hidden = !html;
    ui.notice.innerHTML = html || '';
  }

  // ----------------------------------------------------- target indicator ---

  let refreshTimer = 0;
  function scheduleRefresh() {
    if (ui.panel.hidden) return;
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(refreshTarget, 250);
  }
  document.addEventListener('selectionchange', scheduleRefresh);
  document.addEventListener('keyup', scheduleRefresh, true);
  document.addEventListener('mouseup', scheduleRefresh, true);

  async function refreshTarget() {
    let info;
    try {
      info = await mw('selectionInfo');
    } catch (e) {
      ui.ctxBox.classList.add('warn');
      ui.ctxKind.textContent = '에디터 없음';
      ui.ctxPreview.textContent = e.message === 'EDITOR_NOT_FOUND' ? '소스 편집기를 열어주세요' : '페이지를 새로고침하세요';
      return;
    }
    ui.ctxBox.classList.remove('warn');
    const sel = info.selText || '';
    const selLen = info.to - info.from;
    const directive = !(selLen && sel.trim()) ? P.parseDirective(info.lineText) : null;
    if (selLen && sel.trim()) {
      ui.ctxKind.textContent = `선택 ${selLen.toLocaleString()}자`;
      ui.ctxPreview.textContent = sel.replace(/\s+/g, ' ').slice(0, 120);
    } else if (directive) {
      ui.ctxKind.textContent = '지시문';
      ui.ctxPreview.textContent = `${directive}  — 실행하면 이 줄을 결과로 바꿉니다`;
    } else {
      ui.ctxKind.textContent = '선택 없음';
      ui.ctxPreview.textContent = '프리셋 → 현재 문단 수정 · 직접 지시 → 커서 위치에 작성';
    }
  }

  // ------------------------------------------------------------------ runs ---

  let current = null;
  let runSeq = 0;
  let tickTimer = 0;

  const ERROR_TEXT = {
    EDITOR_NOT_FOUND: 'Overleaf 소스 편집기를 찾지 못했습니다. 편집기가 열려 있는지 확인하세요.',
    MAIN_WORLD_TIMEOUT: '페이지 스크립트가 응답하지 않습니다. 페이지를 새로고침하세요.',
    TARGET_CHANGED: '그 사이 원문이 바뀌어 자동으로 적용할 수 없습니다. "복사" 후 직접 붙여넣으세요.',
    EXTENSION_RELOADED: '확장 프로그램이 업데이트되었습니다. 페이지를 새로고침하세요.',
    NATIVE_CONNECT_FAILED: '로컬 브리지에 연결하지 못했습니다.',
    NATIVE_DISCONNECTED: '로컬 브리지에 연결하지 못했습니다.',
    BACKGROUND_DISCONNECTED: '확장 프로그램 백그라운드와 연결이 끊겼습니다.',
    CLI_NOT_FOUND: 'CLI 를 찾지 못했습니다. 설치 후 install-host.sh 를 다시 실행하세요.',
    CLI_FAILED: 'CLI 실행이 실패했습니다.',
    CLI_ERROR: 'CLI 가 오류를 반환했습니다.',
    TIMEOUT: '시간 초과로 중단했습니다. 설정에서 제한 시간을 늘릴 수 있습니다.',
    BUSY: '이전 요청이 아직 실행 중입니다.',
    EMPTY_PROMPT: '보낼 내용이 없습니다.',
  };

  function explain(code, detail = '') {
    let text = ERROR_TEXT[code] || code;
    const d = String(detail || '');
    if (/native messaging host not found/i.test(d)) text = '로컬 브리지가 설치되지 않았습니다. 터미널에서 ./scripts/install-host.sh 를 실행하세요.';
    else if (/forbidden/i.test(d)) text = '로컬 브리지가 이 확장 ID 를 허용하지 않습니다. ./scripts/install-host.sh <확장ID> 로 다시 설치하세요.';
    else if (/log ?in|logged|auth|credential|api key|unauthori[sz]ed|401/i.test(d)) text += ' 터미널에서 CLI 를 한 번 실행해 로그인 상태를 확인하세요.';
    return text;
  }

  function setBusy(busy) {
    ui.spinner.hidden = !busy;
    ui.stopBtn.hidden = !busy;
    ui.runBtn.disabled = busy;
    for (const b of ui.actions.querySelectorAll('button')) b.disabled = busy;
  }

  function backendLabel(req) {
    const name = req.backend === 'codex' ? 'Codex' : 'Claude';
    return req.model ? `${name} · ${req.model}` : name;
  }

  async function start({ kind, instruction, label, autoApply = false }) {
    if (current && !current.finished) cancel({ silent: true });
    current = null;
    openPanel();
    if (!chrome.runtime?.id) return showError('EXTENSION_RELOADED');

    let ctx;
    try { ctx = await mw('getContext'); } catch (e) { return showError(e.message); }

    const target = P.resolveTarget(ctx, { kind });
    if (target.error) return showError(null, target.error);
    const request = P.buildRequest({ settings, instruction, target, doc: ctx.doc, fileName: ctx.fileName });

    const run = {
      id: ++runSeq,
      spec: { kind, instruction, label, autoApply },
      target,
      request,
      doc: ctx.doc,
      raw: '',
      finalText: null,
      result: null,
      finished: false,
      applied: false,
      started: Date.now(),
      statusBase: `${backendLabel(request)} 생성 중`,
      port: null,
    };
    current = run;

    ui.result.hidden = false;
    ui.status.classList.remove('err');
    ui.errDetail.hidden = true;
    ui.tabs.hidden = true;
    ui.diff.hidden = true;
    ui.resultActions.hidden = true;
    ui.out.hidden = false;
    ui.out.readOnly = true;
    ui.out.value = '';
    setBusy(true);
    const tick = () => {
      if (current !== run || run.finished) return;
      const secs = ((Date.now() - run.started) / 1000).toFixed(1);
      ui.statusText.textContent = `${label ? `[${label}] ` : ''}${run.statusBase} · ${secs}s${run.raw ? ` · ${run.raw.length.toLocaleString()}자` : ''}`;
    };
    clearInterval(tickTimer);
    tickTimer = setInterval(tick, 200);
    tick();

    let port;
    try {
      port = chrome.runtime.connect({ name: 'olai-run' });
    } catch {
      return fail(run, 'EXTENSION_RELOADED');
    }
    run.port = port;
    port.onMessage.addListener((m) => onRunMessage(run, m));
    port.onDisconnect.addListener(() => {
      if (!run.finished) fail(run, 'BACKGROUND_DISCONNECTED', chrome.runtime.lastError?.message);
    });
    port.postMessage({ type: 'run', request });
  }

  function onRunMessage(run, m) {
    if (run.finished || !m) return;
    switch (m.type) {
      case 'status':
        run.statusBase = m.text;
        break;
      case 'delta':
        run.raw += m.text;
        if (current === run) {
          const atBottom = ui.out.scrollTop + ui.out.clientHeight >= ui.out.scrollHeight - 8;
          ui.out.value = run.raw;
          if (atBottom) ui.out.scrollTop = ui.out.scrollHeight;
        }
        break;
      case 'final-chunk':
        run.finalText = (run.finalText || '') + m.text;
        break;
      case 'done':
        finish(run, m);
        break;
      case 'error':
        fail(run, m.error, m.detail);
        break;
      default:
        break;
    }
  }

  function endRun(run) {
    run.finished = true;
    try { run.port?.disconnect(); } catch { /* ignore */ }
    if (current === run) {
      clearInterval(tickTimer);
      setBusy(false);
    }
  }

  function finish(run, meta) {
    endRun(run);
    run.result = P.postProcess(run.finalText ?? run.raw, run.target);
    if (current !== run) return;

    const secs = ((meta.durationMs || Date.now() - run.started) / 1000).toFixed(1);
    const cost = typeof meta.costUsd === 'number' && meta.costUsd >= 0.0001 ? ` · ~$${meta.costUsd.toFixed(4)}` : '';
    const unchanged = run.target.mode === 'replace' && run.result === run.target.text;
    ui.statusText.textContent = `${unchanged ? '변경할 부분이 없습니다' : '완료'} · ${backendLabel(run.request)} · ${secs}s${cost}`;

    ui.out.readOnly = false;
    ui.out.value = run.result;
    const canDiff = run.target.mode === 'replace' && run.target.kind !== 'directive';
    ui.tabs.hidden = !canDiff;
    showTab(canDiff ? 'diff' : 'text');

    ui.resultActions.hidden = false;
    ui.applyBtn.disabled = !run.result.trim();
    ui.applyBtn.textContent = run.target.mode === 'insert' ? '커서 위치에 삽입' : run.target.kind === 'directive' ? '지시문 줄 대체' : '적용 (교체)';
    ui.afterBtn.hidden = !canDiff;
    ui.afterBtn.disabled = false;

    if (run.spec.autoApply && !unchanged && run.result.trim()) apply('replace');
  }

  function fail(run, code, detail) {
    if (run.finished) return;
    endRun(run);
    if (current !== run) return;
    showError(code, null, detail);
    if (run.raw) {
      ui.out.readOnly = false;
      ui.resultActions.hidden = false;
      ui.applyBtn.disabled = true;
      ui.afterBtn.hidden = true;
    }
  }

  function showError(code, text, detail) {
    ui.result.hidden = false;
    setBusy(false);
    clearInterval(tickTimer);
    ui.status.classList.add('err');
    ui.statusText.textContent = text || explain(code, detail);
    ui.errDetail.hidden = !detail;
    ui.errDetail.textContent = detail ? String(detail).slice(-2000) : '';
    if (!current || current.finished) {
      ui.tabs.hidden = true;
      ui.diff.hidden = true;
      if (!current?.raw) { ui.out.hidden = true; ui.resultActions.hidden = true; }
    }
  }

  function cancel({ silent = false } = {}) {
    const run = current;
    if (!run || run.finished) return;
    try { run.port?.postMessage({ type: 'cancel' }); } catch { /* ignore */ }
    endRun(run);
    if (!silent) {
      ui.statusText.textContent = '중지됨';
      if (run.raw) { ui.out.readOnly = false; ui.resultActions.hidden = false; ui.applyBtn.disabled = true; ui.afterBtn.hidden = true; }
    }
  }

  // ------------------------------------------------------------ result UI ---

  function showTab(tab) {
    for (const t of ui.tabs.querySelectorAll('.tab')) t.setAttribute('aria-selected', String(t.dataset.tab === tab));
    if (tab === 'diff' && current) {
      ui.diff.innerHTML = D.renderDiffHtml(D.diffWords(current.target.text, ui.out.value));
      ui.diff.hidden = false;
      ui.out.hidden = true;
    } else {
      ui.diff.hidden = true;
      ui.out.hidden = false;
    }
  }
  ui.tabs.addEventListener('click', (e) => {
    const t = e.target.closest('.tab');
    if (t) showTab(t.dataset.tab);
  });

  async function apply(position) {
    const run = current;
    if (!run || !run.finished || run.applied) return;
    const target = run.target;
    let text = ui.out.value;
    let args;
    if (target.mode === 'insert') {
      text = P.insertionText(text.replace(/\s+$/, ''), run.doc, target.from);
      args = { from: target.from, to: target.from, expected: '', text, anchorBefore: run.doc.slice(Math.max(0, target.from - 80), target.from) };
    } else if (position === 'after') {
      const sep = target.text.endsWith('\n') ? '\n' : '\n\n';
      args = { from: target.from, to: target.to, expected: target.text, text: `${sep}${text.trim()}`, position: 'after' };
    } else {
      args = { from: target.from, to: target.to, expected: target.text, text };
    }
    try {
      await mw('apply', args);
      run.applied = true;
      ui.applyBtn.disabled = true;
      ui.afterBtn.disabled = true;
      ui.status.classList.remove('err');
      ui.statusText.textContent = `적용했습니다 · ${MOD}+Z 로 되돌릴 수 있습니다`;
      toast('Overleaf 문서에 적용했습니다');
      setTimeout(refreshTarget, 50);
    } catch (e) {
      showError(e.message);
    }
  }

  ui.applyBtn.addEventListener('click', (e) => { if (e.isTrusted) apply('replace'); });
  ui.afterBtn.addEventListener('click', (e) => { if (e.isTrusted) apply('after'); });
  ui.stopBtn.addEventListener('click', () => cancel());
  ui.retryBtn.addEventListener('click', (e) => { if (e.isTrusted && current) start({ ...current.spec, autoApply: false }); });
  ui.copyBtn.addEventListener('click', async () => {
    const text = ui.out.value;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      ui.out.hidden = false;
      ui.out.select();
      document.execCommand('copy');
    }
    toast('클립보드에 복사했습니다');
  });

  // ------------------------------------------------------- custom / quick ---

  function runCustom() {
    const instruction = ui.instr.value.trim();
    if (instruction) {
      start({ kind: 'custom', instruction, label: '직접 지시' });
      return;
    }
    // Empty box: execute a "% ai:" directive on the cursor line if there is one.
    mw('selectionInfo').then((info) => {
      if (P.parseDirective(info.lineText) && !(info.to > info.from)) start({ kind: 'directive', instruction: '', label: '지시문' });
      else { toast('지시 내용을 입력하세요'); ui.instr.focus(); }
    }).catch((e) => showError(e.message));
  }
  ui.runBtn.addEventListener('click', (e) => { if (e.isTrusted) runCustom(); });
  ui.instr.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !e.isComposing) {
      e.preventDefault();
      if (e.isTrusted) runCustom();
    }
  });

  async function quickAction() {
    let info;
    try { info = await mw('selectionInfo'); } catch (e) { openPanel(); return showError(e.message); }
    const hasSel = info.to > info.from && (info.selText || '').trim();
    const autoApply = !!settings.autoApplyQuick;
    if (!hasSel && P.parseDirective(info.lineText)) {
      return start({ kind: 'directive', instruction: '', label: '지시문', autoApply });
    }
    const action = allActions().find((a) => a.id === settings.quickActionId) || P.ACTIONS[0];
    return start({ kind: action.kind, instruction: action.instruction, label: action.label, autoApply });
  }

  // Keyboard commands are delivered by the background worker (chrome.commands).
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type !== 'command') return;
    if (msg.command === 'toggle-panel') togglePanel();
    else if (msg.command === 'quick-action') quickAction();
  });

  onSettingsChanged();
})();
