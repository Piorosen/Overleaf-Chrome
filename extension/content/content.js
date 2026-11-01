// Overleaf AI — isolated-world content script: panel UI + run orchestration.
(() => {
  'use strict';
  if (window.__olaiContent) return;
  window.__olaiContent = true;

  const P = globalThis.OLAI;
  const C = globalThis.OLAI_CATALOG;
  const D = globalThis.OLAI_DIFF;
  const L = globalThis.OLAI_LINT;
  const M = globalThis.OLAI_MD;
  const K = globalThis.OLAI_PKG;
  const T = globalThis.OLAI_TERMS;
  const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  const MOD = IS_MAC ? '⌘' : 'Ctrl';
  const ALT = IS_MAC ? '⌥' : 'Alt';
  const PROJECT_ID = (location.pathname.match(/\/project\/([^/?#]+)/) || [])[1] || 'unknown';
  const PROFILE_KEY = `olai-profile:${PROJECT_ID}`;
  const PROFILE_FIELDS = ['venuePreset', 'venueName', 'field', 'audience', 'spelling', 'terms', 'notes'];
  const HISTORY_MAX = 20;

  // ------------------------------------------------------------- settings ---

  let settings = { ...P.DEFAULT_SETTINGS };
  let profile = {};
  let cliInfo = null;
  chrome.storage.sync.get(P.DEFAULT_SETTINGS)
    .then((s) => { settings = { ...P.DEFAULT_SETTINGS, ...s }; currentCat = settings.lastCategory || 'edit'; onSettingsChanged(); })
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
  const allActions = () => [...C.ACTIONS, ...P.parseCustomPresets(settings.customPresets)];
  const backendNow = () => (settings.backend === 'codex' ? 'codex' : 'claude');

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
      <button class="launcher" type="button" title="Overleaf AI (${ALT}+Shift+A)"><span class="spark" aria-hidden="true">✦</span>AI<span class="badge" hidden></span></button>
      <section class="panel" role="dialog" aria-label="Overleaf AI" hidden>
        <header>
          <span class="title"><span class="spark" aria-hidden="true">✦</span>Overleaf AI</span>
          <span class="grow"></span>
          <span class="dot" title="연결 확인 중…"></span>
          <button class="icon text hist" type="button" title="최근 결과" aria-pressed="false">기록</button>
          <button class="icon wide-btn" type="button" title="넓게 보기" aria-pressed="false">⤢</button>
          <button class="icon settings" type="button" title="설정" aria-label="설정">⚙</button>
          <button class="icon close" type="button" title="닫기 (Esc)" aria-label="닫기">✕</button>
        </header>
        <div class="modelbar">
          <select class="backend" aria-label="AI 백엔드">
            <option value="claude">Claude</option>
            <option value="codex">Codex</option>
          </select>
          <select class="model" aria-label="모델"></select>
          <select class="effort" aria-label="사고 수준 (effort)"></select>
        </div>
        <div class="body">
          <div class="notice" hidden></div>
          <div class="history" hidden></div>
          <div class="target ctx">
            <b class="kind">대상</b><span class="preview"></span>
            <select class="scope" aria-label="범위" title="범위: 자동이면 선택 영역, 없으면 기능별 기본 범위">
              <option value="auto">범위 자동</option>
              <option value="paragraph">선택·문단</option>
              <option value="section">현재 섹션</option>
              <option value="document">파일 전체</option>
            </select>
          </div>
          <nav class="cats" role="tablist" aria-label="기능 분류"></nav>
          <input class="search" type="search" placeholder="기능 검색 — 예: 초록, 표, 리뷰, 인용" aria-label="기능 검색">
          <div class="actions"></div>
          <div class="lint-view" hidden></div>
          <div class="custom">
            <div class="row">
              <button class="seg on" type="button" data-mode="edit" title="선택 영역을 고치거나, 커서 위치에 새로 씁니다">수정·작성</button>
              <button class="seg" type="button" data-mode="ask" title="문서는 그대로 두고 답변만 받습니다">질문·분석</button>
              <span class="grow"></span>
              <span class="hint"><kbd>${MOD}</kbd>+<kbd>Enter</kbd></span>
            </div>
            <textarea class="instr" rows="2" placeholder="직접 지시 — 예: 이 문단을 3문장으로 요약 / 실험 설정 문단 작성. 프리셋을 누르면 이 내용이 추가 지시로 함께 전달됩니다."></textarea>
            <div class="row"><span class="hint mode-hint"></span><span class="grow"></span><button class="btn primary run" type="button">실행</button></div>
          </div>
          <details class="profile">
            <summary>논문 정보 <span class="hint profile-sum">(이 프로젝트의 모든 요청에 반영)</span></summary>
            <div class="grid">
              <label>타깃 유형<select data-f="venuePreset"></select></label>
              <label>학회·저널 이름<input data-f="venueName" placeholder="예: NeurIPS 2026"></label>
              <label>분야<input data-f="field" placeholder="예: 강화학습, 의료영상"></label>
              <label>독자<input data-f="audience" placeholder="예: ML 연구자"></label>
              <label>영어 철자<select data-f="spelling"><option value="">지정 안 함</option><option value="us">American</option><option value="uk">British</option></select></label>
              <label class="full">용어집 (한 줄에 "쓸 용어 | 피할 표현")<textarea data-f="terms" rows="2" placeholder="dataset | data set&#10;pre-training | pretraining"></textarea></label>
              <label class="full">메모 (주장, 기여, 주의할 점)<textarea data-f="notes" rows="2" placeholder="예: 핵심 주장은 X. 실험은 3개 데이터셋. 'state-of-the-art' 표현 자제."></textarea></label>
            </div>
          </details>
          <div class="result" hidden>
            <div class="status"><span class="spinner"></span><span class="status-text"></span><span class="grow"></span><button class="btn sm stop" type="button">중지</button></div>
            <pre class="err-detail" hidden></pre>
            <div class="explain" hidden></div>
            <div class="tabs" role="tablist" hidden>
              <button class="tab" type="button" role="tab" data-tab="diff">변경사항</button>
              <button class="tab" type="button" role="tab" data-tab="text">결과 (편집 가능)</button>
            </div>
            <div class="diff-bar" hidden><span class="diff-info"></span><span class="grow"></span><button class="btn sm all-on" type="button">모두 적용</button><button class="btn sm all-off" type="button">모두 취소</button></div>
            <div class="diff" hidden></div>
            <textarea class="out" spellcheck="false" hidden></textarea>
            <div class="variants" hidden></div>
            <div class="report" hidden></div>
            <div class="result-actions" hidden>
              <button class="btn primary apply" type="button">적용</button>
              <button class="btn after" type="button">원문 아래에 추가</button>
              <button class="btn comment" type="button">주석으로 삽입</button>
              <button class="btn bib" type="button">BibTeX 복사</button>
              <button class="btn primary glossary-save" type="button">용어집에 저장 → 통일</button>
              <button class="btn copy" type="button">복사</button>
              <button class="btn retry" type="button">다시 생성</button>
            </div>
            <div class="pkg-prompt" hidden>
              <span class="pkg-msg"></span>
              <div class="row"><span class="grow"></span><button class="btn sm primary pkg-add" type="button">프리앰블에 추가</button><button class="btn sm pkg-copy" type="button">줄 복사</button><button class="btn sm pkg-dismiss" type="button">나중에</button></div>
            </div>
          </div>
        </div>
        <footer>
          <label class="ac" title="자동: 입력을 멈추면 회색 제안 표시 · 수동: ${ALT}+\\ 로 요청 · Tab 수락, ${MOD}→ 단어 수락, Esc 닫기">자동완성
            <select class="ac-mode" aria-label="자동완성">
              <option value="auto">자동</option>
              <option value="manual">수동 (${ALT}+\\)</option>
              <option value="off">끔</option>
            </select>
          </label>
          <span><kbd>${ALT}</kbd>+<kbd>Shift</kbd>+<kbd>I</kbd> 빠른 실행</span>
          <span><code>% ai: 지시</code> 줄에서 실행</span>
        </footer>
      </section>
      <div class="toast" role="status" hidden></div>
    </div>`;
  document.body.appendChild(hostEl);

  const $ = (sel) => shadow.querySelector(sel);
  const ui = {
    root: $('.root'), launcher: $('.launcher'), badge: $('.launcher .badge'), panel: $('.panel'),
    dot: $('.dot'), histBtn: $('.hist'), wideBtn: $('.wide-btn'), settingsBtn: $('.settings'), closeBtn: $('.close'),
    backend: $('.backend'), model: $('.model'), effort: $('.effort'),
    body: $('.body'), notice: $('.notice'), history: $('.history'),
    ctxBox: $('.ctx'), ctxKind: $('.ctx .kind'), ctxPreview: $('.ctx .preview'), scope: $('.scope'),
    cats: $('.cats'), search: $('.search'), actions: $('.actions'), lintView: $('.lint-view'),
    segs: [...shadow.querySelectorAll('.seg')], instr: $('.instr'), modeHint: $('.mode-hint'), runBtn: $('.run'),
    profile: $('.profile'), profileSum: $('.profile-sum'),
    result: $('.result'), spinner: $('.spinner'), status: $('.status'), statusText: $('.status-text'), stopBtn: $('.stop'),
    errDetail: $('.err-detail'), explain: $('.explain'), tabs: $('.tabs'), diffBar: $('.diff-bar'), diffInfo: $('.diff-info'),
    allOn: $('.all-on'), allOff: $('.all-off'), diff: $('.diff'), out: $('.out'), variants: $('.variants'), report: $('.report'),
    resultActions: $('.result-actions'), applyBtn: $('.apply'), afterBtn: $('.after'), commentBtn: $('.comment'),
    bibBtn: $('.bib'), copyBtn: $('.copy'), retryBtn: $('.retry'), toast: $('.toast'),
    glossaryBtn: $('.glossary-save'), pkgPrompt: $('.pkg-prompt'), pkgMsg: $('.pkg-msg'), pkgAdd: $('.pkg-add'),
    pkgCopy: $('.pkg-copy'), pkgDismiss: $('.pkg-dismiss'), acMode: $('.ac-mode'),
  };
  ui.body.style.position = 'relative';

  // Keep keystrokes typed inside the panel away from Overleaf's global shortcuts.
  for (const type of ['keydown', 'keyup', 'keypress']) ui.root.addEventListener(type, (e) => e.stopPropagation());

  let currentCat = 'edit';
  let searchQuery = '';
  let instrMode = 'edit';

  function onSettingsChanged() {
    ui.launcher.hidden = !settings.showLauncher || !ui.panel.hidden;
    ui.acMode.value = settings.autocomplete || 'auto';
    if (settings.autocomplete === 'off') { cancelCompletion(); mw('ghostHide').catch(() => {}); }
    renderModelBar();
    renderCats();
    renderActions();
    renderModeHint();
    if (!ui.panel.hidden) checkConnection();
  }

  let toastTimer = 0;
  function toast(text, ms = 2600) {
    ui.toast.textContent = text;
    ui.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { ui.toast.hidden = true; }, ms);
  }

  // ------------------------------------------------------ model / effort bar ---

  function renderModelBar() {
    const backend = backendNow();
    ui.backend.value = backend;
    const chosen = (backend === 'codex' ? settings.codexModel : settings.claudeModel) || '';
    const defaults = cliInfo?.[backend]?.defaults || {};
    const models = C.modelsFor(backend, settings);
    const groups = new Map();
    for (const m of models) {
      const g = m.group || '';
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(m);
    }
    if (chosen && !models.some((m) => m.id === chosen)) groups.set('현재 설정', [{ id: chosen, label: chosen }]);
    ui.model.textContent = '';
    for (const [g, list] of groups) {
      const parent = g ? document.createElement('optgroup') : ui.model;
      if (g) parent.label = g;
      for (const m of list) {
        const o = document.createElement('option');
        o.value = m.id;
        o.textContent = m.id === '' ? `${m.label}${defaults.model ? ` (${defaults.model})` : ''}` : `${m.label}${m.note ? ` · ${m.note}` : ''}`;
        parent.appendChild(o);
      }
      if (g) ui.model.appendChild(parent);
    }
    ui.model.value = chosen;
    ui.model.title = backend === 'codex' ? 'Codex 모델. 목록에 없는 이름은 설정의 "사용자 지정 모델"에 추가하세요.' : 'Claude 모델';
    renderEffort();
  }

  function renderEffort() {
    const backend = backendNow();
    const model = (backend === 'codex' ? settings.codexModel : settings.claudeModel) || '';
    const supported = C.effortsFor(backend, model, settings);
    const chosen = backend === 'codex' ? settings.codexEffort : settings.claudeEffort;
    const opts = supported.length ? ['auto', '', ...supported] : [''];
    ui.effort.textContent = '';
    for (const e of opts) {
      const o = document.createElement('option');
      o.value = e;
      o.textContent = `사고: ${C.EFFORT_LABELS[e] || e}`;
      ui.effort.appendChild(o);
    }
    ui.effort.value = opts.includes(chosen) ? chosen : (supported.length ? 'auto' : '');
    ui.effort.disabled = !supported.length;
    ui.effort.title = supported.length ? '사고 수준(effort). 자동: 교정 low · 작성 medium · 검토 high' : '이 모델은 effort 설정을 지원하지 않습니다';
  }

  ui.backend.addEventListener('change', () => { saveSetting('backend', ui.backend.value); renderModelBar(); renderActions(); checkConnection(); });
  ui.model.addEventListener('change', () => { saveSetting(backendNow() === 'codex' ? 'codexModel' : 'claudeModel', ui.model.value); renderEffort(); });
  ui.effort.addEventListener('change', () => saveSetting(backendNow() === 'codex' ? 'codexEffort' : 'claudeEffort', ui.effort.value));

  // ------------------------------------------------------ categories/actions ---

  function lintCount() {
    const c = L.counts(lintIssues);
    return c.error + c.warn;
  }

  function renderCats() {
    ui.cats.textContent = '';
    const hasCustom = P.parseCustomPresets(settings.customPresets).length > 0;
    for (const c of C.CATEGORIES) {
      if (c.id === 'custom' && !hasCustom) continue;
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'cat';
      b.dataset.cat = c.id;
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', String(c.id === currentCat && !searchQuery));
      b.textContent = c.label;
      if (c.id === 'check' && lintCount()) {
        const n = document.createElement('span');
        n.className = 'n';
        n.textContent = lintCount();
        b.appendChild(n);
      }
      ui.cats.appendChild(b);
    }
  }

  ui.cats.addEventListener('click', (e) => {
    const b = e.target.closest('.cat');
    if (!b) return;
    currentCat = b.dataset.cat;
    saveSetting('lastCategory', currentCat);
    searchQuery = '';
    ui.search.value = '';
    renderCats();
    renderActions();
    if (currentCat === 'check' && !lintDoc) lintTick(true);
  });
  ui.search.addEventListener('input', () => {
    searchQuery = ui.search.value;
    renderCats();
    renderActions();
  });

  function actionDisabledReason(a) {
    if (a.web && backendNow() === 'codex') return '웹 검색 기능은 Claude 백엔드에서만 사용할 수 있습니다';
    if (a.web && !settings.allowWeb) return '설정에서 "웹 검색 허용"을 켜야 합니다';
    return '';
  }

  function renderActions() {
    ui.actions.textContent = '';
    const q = searchQuery.trim().toLowerCase();
    const list = allActions().filter((a) => (q
      ? `${a.label} ${a.desc || ''} ${a.id}`.toLowerCase().includes(q)
      : a.cat === currentCat));
    if (!list.length) {
      const s = document.createElement('span');
      s.className = 'empty';
      s.textContent = q ? '일치하는 기능이 없습니다.' : '설정에서 "사용자 프리셋"을 추가하면 여기에 표시됩니다.';
      ui.actions.appendChild(s);
    }
    for (const a of list) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `chip${a.custom ? ' custom' : ''}`;
      b.dataset.id = a.id;
      b.textContent = a.label;
      const reason = actionDisabledReason(a);
      b.title = reason || a.desc || a.instruction || '';
      if (reason) b.disabled = true;
      if (a.web || a.kind === 'lint') {
        const t = document.createElement('span');
        t.className = 'tag';
        t.textContent = a.web ? '웹' : '즉시';
        b.appendChild(t);
      }
      ui.actions.appendChild(b);
    }
    ui.lintView.hidden = !(currentCat === 'check' && !q);
    for (const b of ui.actions.querySelectorAll('.chip')) {
      const a = allActions().find((x) => x.id === b.dataset.id);
      if (a && ['lint', 'terms', 'packages'].includes(a.kind)) b.classList.toggle('on', !ui.lintView.hidden && a.kind === checkMode);
    }
    if (!ui.lintView.hidden) renderCheckView();
  }

  function renderCheckView() {
    if (checkMode === 'terms') renderTermsView();
    else if (checkMode === 'packages') renderPackagesView();
    else renderLint();
  }

  ui.actions.addEventListener('click', (e) => {
    const b = e.target.closest('.chip');
    if (!b || !e.isTrusted || b.disabled) return;
    const a = allActions().find((x) => x.id === b.dataset.id);
    if (a) runAction(a);
  });

  function runAction(a, opts = {}) {
    if (a.kind === 'lint' || a.kind === 'terms' || a.kind === 'packages') {
      checkMode = a.kind;
      currentCat = 'check';
      searchQuery = '';
      ui.search.value = '';
      lintTick(true).then(() => {
        if (a.kind === 'terms') analyzeTermsNow();
        renderCats();
        renderActions();
      });
      return;
    }
    if (a.kind === 'fix') { runFix(a); return; }
    start({ action: a, extra: ui.instr.value, autoApply: !!opts.autoApply });
  }

  // ------------------------------------------------------------ local lint ---

  let lintIssues = [];
  let lintDoc = null;
  let checkMode = 'lint';
  const lintFilter = { error: true, warn: true, info: false };

  async function lintTick(force = false) {
    if (!force && (!settings.autoLint || document.visibilityState !== 'visible')) return;
    let r;
    try { r = await mw('getDoc', {}, 3000); } catch { return; }
    if (!force && r.doc === lintDoc) return;
    lintDoc = r.doc;
    try { lintIssues = [...L.lintLatex(r.doc), ...K.asIssues(K.analyze(r.doc))].sort((a, b) => a.line - b.line); } catch { lintIssues = []; }
    updateLintBadges();
    if (!ui.lintView.hidden && checkMode === 'lint') renderLint();
    if (!ui.lintView.hidden && checkMode === 'packages') renderPackagesView();
  }
  setInterval(() => lintTick(false), 5000);
  setTimeout(() => lintTick(false), 2500);

  function updateLintBadges() {
    const n = lintCount();
    ui.badge.hidden = !n;
    ui.badge.textContent = n > 99 ? '99+' : String(n);
    ui.launcher.title = `Overleaf AI (${ALT}+Shift+A)${n ? ` · 로컬 점검 오류·경고 ${n}건` : ''}`;
    renderCats();
  }

  function renderLint() {
    const c = L.counts(lintIssues);
    const shown = lintIssues.filter((i) => lintFilter[i.severity]);
    const sevLabel = { error: '오류', warn: '경고', info: '제안' };
    ui.lintView.innerHTML = `
      <div class="lint-head">
        ${['error', 'warn', 'info'].map((s) => `<label><input type="checkbox" data-sev="${s}" ${lintFilter[s] ? 'checked' : ''}><span class="sev ${s}" style="display:inline-block;width:8px;height:8px;border-radius:50%"></span>${sevLabel[s]} ${c[s]}</label>`).join('')}
        <span class="grow"></span>
        <button class="btn sm relint" type="button">다시 점검</button>
      </div>
      <ul class="lint-list"></ul>`;
    const ul = ui.lintView.querySelector('.lint-list');
    if (!lintDoc) {
      ul.innerHTML = '<li class="none">아직 점검하지 않았습니다.</li>';
      return;
    }
    if (!shown.length) {
      ul.innerHTML = `<li class="none">${lintIssues.length ? '선택한 종류의 항목이 없습니다.' : '발견된 문제가 없습니다 ✓'}</li>`;
      return;
    }
    for (const i of shown.slice(0, 400)) {
      const li = document.createElement('li');
      li.dataset.line = i.line;
      li.title = '클릭하면 해당 줄로 이동';
      li.innerHTML = `<span class="sev ${i.severity}"></span><span class="ln">L${i.line}</span><span>${M.escapeHtml(i.message)}<span class="ex">${M.escapeHtml(i.excerpt)}</span></span>`;
      ul.appendChild(li);
    }
  }

  // ---- 용어 통일 (term unification)

  const termState = { groups: [], choices: new Map(), include: new Set() };
  const SOURCE_LABEL = { glossary: '용어집', hyphen: '하이픈 혼용', usuk: '영/미 철자' };

  function analyzeTermsNow() {
    if (lintDoc == null) return;
    try { termState.groups = T.analyzeTerms(lintDoc, profile.terms || ''); } catch { termState.groups = []; }
    termState.choices = new Map(termState.groups.map((g) => [g.id, g.preferred]));
    termState.include = new Set(termState.groups.filter((g) => g.confidence !== 'low').map((g) => g.id));
  }

  function termPlan() {
    const chosen = new Map([...termState.choices].filter(([id]) => termState.include.has(id)));
    return T.planChanges(termState.groups, chosen);
  }

  function renderTermsView() {
    const nGloss = T.parseGlossary(profile.terms || '').length;
    const groups = termState.groups;
    const plan = termPlan();
    const esc = M.escapeHtml;
    ui.lintView.innerHTML = `
      <div class="lint-head">
        <span>용어집 ${nGloss}개 · 통일할 그룹 ${groups.length}개</span>
        <span class="grow"></span>
        <button class="btn sm edit-glossary" type="button">용어집 편집</button>
        <button class="btn sm reterms" type="button">다시 분석</button>
      </div>
      ${groups.length ? '' : `<p class="hint">통일할 용어 변형이 없습니다. "논문 정보 → 용어집"에 <code>쓸 용어 | 피할 표현, …</code> 을 적거나, "용어집 제안 (AI)"로 후보를 받아 저장하세요.</p>`}
      <div class="term-list">${groups.map((g) => `
        <div class="term-group" data-id="${esc(g.id)}">
          <label class="term-head"><input type="checkbox" data-include ${termState.include.has(g.id) ? 'checked' : ''}><span class="src">${SOURCE_LABEL[g.source]}</span><span class="hint">${g.confidence === 'low' ? '명사 앞 수식어면 하이픈이 맞을 수 있어 기본 해제' : '통일할 형태 선택'}</span></label>
          <div class="forms">${g.forms.map((f) => `
            <label class="form"><input type="radio" name="t-${esc(g.id)}" value="${esc(f.text)}" ${termState.choices.get(g.id) === f.text ? 'checked' : ''}>
              <span>${esc(f.text)}</span><span class="cnt">×${f.count}</span>
              ${f.count ? `<button class="jump" type="button" data-line="${f.occurrences[0].line}" title="첫 위치로 이동">L${f.occurrences[0].line}</button>` : ''}
            </label>`).join('')}
          </div>
        </div>`).join('')}
      </div>
      ${groups.length ? `<div class="row"><span class="hint">한 번의 ${MOD}+Z 로 모두 되돌릴 수 있습니다</span><span class="grow"></span><button class="btn primary terms-apply" type="button" ${plan.length ? '' : 'disabled'}>선택한 그룹 통일 (${plan.length}곳)</button></div>` : ''}`;
  }

  async function applyTerms() {
    const plan = termPlan();
    if (!plan.length) return;
    try {
      await mw('applyChanges', { changes: plan });
      toast(`용어 ${plan.length}곳을 통일했습니다`);
    } catch (e) {
      toast(e.message === 'TARGET_CHANGED' ? '그 사이 문서가 바뀌었습니다. 다시 분석한 뒤 적용하세요.' : explain(e.message));
    }
    await lintTick(true);
    analyzeTermsNow();
    renderTermsView();
  }

  // ---- 필요한 패키지 (missing packages)

  function packageSelection(listEl) {
    return [...listEl.querySelectorAll('input[data-pkg]:checked')].map((cb) => ({ kind: cb.dataset.kind, name: cb.dataset.pkg }));
  }

  function renderPackagesView() {
    if (lintDoc == null) { ui.lintView.innerHTML = '<p class="hint">분석 중…</p>'; return; }
    const r = K.analyze(lintDoc);
    const esc = M.escapeHtml;
    ui.lintView.innerHTML = `
      <div class="lint-head">
        <span>${r.hasPreamble ? `프리앰블: 이 파일${r.docClass ? ` (${esc(r.docClass)})` : ''}` : '이 파일에는 프리앰블이 없습니다 — 메인 파일에 추가하세요'}</span>
        <span class="grow"></span>
        <button class="btn sm repkg" type="button">다시 분석</button>
      </div>
      ${r.missing.length ? `<ul class="lint-list pkg-list">${r.missing.map((m) => `
        <li class="pkg-item"><label><input type="checkbox" data-pkg="${esc(m.name)}" data-kind="${m.kind}" checked>
          <code>${m.kind === 'tikzlib' ? `\\usetikzlibrary{${esc(m.name)}}` : `\\usepackage{${esc(m.name)}}`}</code></label>
          <span class="hint">${esc(m.why)}</span>${m.line ? `<button class="jump" type="button" data-line="${m.line}">L${m.line}</button>` : ''}</li>`).join('')}</ul>
        <div class="row"><span class="hint">학회 템플릿(.sty/.cls)이 이미 불러온 패키지는 제외하세요</span><span class="grow"></span>
          <button class="btn sm pkg-lines" type="button">줄 복사</button>
          <button class="btn primary pkg-insert" type="button" ${r.hasPreamble ? '' : 'disabled'}>프리앰블에 추가</button></div>`
        : '<p class="hint">본문에 필요한 패키지가 모두 불러와져 있습니다 ✓</p>'}`;
  }

  async function insertPackages(items) {
    if (!items.length) return false;
    let r;
    try { r = await mw('getDoc', {}, 3000); } catch (e) { toast(explain(e.message)); return false; }
    const edits = K.insertionEdits(r.doc, items);
    if (!edits) {
      copyText(K.preambleLines(items).join('\n'));
      toast('이 파일에 프리앰블이 없어 줄을 복사했습니다. 메인 파일에 붙여넣으세요.');
      return false;
    }
    const maxPos = Math.max(...edits.map((e) => e.pos));
    try {
      await mw('insertAt', { edits, anchor: r.doc.slice(0, maxPos) });
      toast(`프리앰블에 ${items.length}개 추가했습니다`);
      await lintTick(true);
      return true;
    } catch (e) {
      toast(explain(e.message));
      return false;
    }
  }

  ui.lintView.addEventListener('click', (e) => {
    const jump = e.target.closest('button.jump, li[data-line]');
    if (jump) { mw('selectLines', { line: Number(jump.dataset.line) }).catch(() => {}); return; }
    if (e.target.closest('.relint')) lintTick(true);
    else if (e.target.closest('.reterms')) lintTick(true).then(() => { analyzeTermsNow(); renderTermsView(); });
    else if (e.target.closest('.repkg')) lintTick(true).then(renderPackagesView);
    else if (e.target.closest('.edit-glossary')) { ui.profile.open = true; ui.profile.querySelector('[data-f="terms"]').focus(); }
    else if (e.target.closest('.terms-apply') && e.isTrusted) applyTerms();
    else if (e.target.closest('.pkg-insert') && e.isTrusted) insertPackages(packageSelection(ui.lintView));
    else if (e.target.closest('.pkg-lines')) copyText(K.preambleLines(packageSelection(ui.lintView)).join('\n'));
  });
  ui.lintView.addEventListener('change', (e) => {
    const cb = e.target.closest('input[data-sev]');
    if (cb) { lintFilter[cb.dataset.sev] = cb.checked; renderLint(); return; }
    const group = e.target.closest('.term-group');
    if (group) {
      const id = group.dataset.id;
      if (e.target.matches('[data-include]')) { if (e.target.checked) termState.include.add(id); else termState.include.delete(id); }
      if (e.target.type === 'radio') termState.choices.set(id, e.target.value);
      renderTermsView();
    }
  });

  // --------------------------------------------------------- paper profile ---

  function renderProfile() {
    const sel = ui.profile.querySelector('[data-f="venuePreset"]');
    if (!sel.options.length) {
      for (const v of C.VENUES) {
        const o = document.createElement('option');
        o.value = v.id;
        o.textContent = v.label;
        sel.appendChild(o);
      }
    }
    for (const f of PROFILE_FIELDS) {
      const el = ui.profile.querySelector(`[data-f="${f}"]`);
      if (el) el.value = profile[f] || '';
    }
    const venue = C.VENUES.find((v) => v.id === profile.venuePreset);
    const bits = [profile.venueName || (venue && venue.id ? venue.label : ''), profile.field].filter(Boolean);
    ui.profileSum.textContent = bits.length ? `· ${bits.join(' · ')}` : '(이 프로젝트의 모든 요청에 반영)';
  }
  chrome.storage.local.get(PROFILE_KEY).then((r) => { profile = r[PROFILE_KEY] || {}; renderProfile(); }).catch(() => renderProfile());
  let profileTimer = 0;
  ui.profile.addEventListener('input', (e) => {
    const f = e.target.dataset?.f;
    if (!f) return;
    profile[f] = e.target.value;
    clearTimeout(profileTimer);
    profileTimer = setTimeout(() => {
      chrome.storage.local.set({ [PROFILE_KEY]: profile }).catch(() => {});
      renderProfile();
    }, 400);
  });

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
  ui.wideBtn.addEventListener('click', () => {
    const on = !ui.panel.classList.contains('wide');
    ui.panel.classList.toggle('wide', on);
    ui.wideBtn.setAttribute('aria-pressed', String(on));
  });
  ui.root.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !ui.panel.hidden) { e.preventDefault(); closePanel(); }
  });

  // ------------------------------------------------------ connection check ---

  function checkConnection() {
    if (!chrome.runtime?.id) return showNotice('확장 프로그램이 업데이트되었습니다. 페이지를 새로고침하세요.');
    ui.dot.className = 'dot';
    ui.dot.title = '연결 확인 중…';
    chrome.runtime.sendMessage({ type: 'ping' }).then((resp) => {
      if (!resp?.ok) {
        ui.dot.className = 'dot bad';
        ui.dot.title = resp?.error || '연결 실패';
        showNotice('로컬 브리지에 연결할 수 없습니다. 터미널에서 <code>./scripts/install-host.sh</code> 를 실행한 뒤 확장 프로그램을 새로고침하세요.');
        return;
      }
      cliInfo = resp;
      renderModelBar();
      const name = backendNow();
      const cli = resp[name];
      if (cli?.ok) {
        ui.dot.className = 'dot ok';
        ui.dot.title = `${cli.version} · ${cli.path}`;
        showNotice(null);
      } else {
        ui.dot.className = 'dot bad';
        ui.dot.title = cli?.error || `${name} 없음`;
        showNotice(`<code>${name}</code> CLI 를 찾을 수 없습니다 (${M.escapeHtml(String(cli?.error || ''))}). 설치 후 <code>./scripts/install-host.sh</code> 를 다시 실행하세요.`);
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
  ui.scope.addEventListener('change', refreshTarget);

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
    const hasSel = selLen && sel.trim();
    const directive = !hasSel ? P.parseDirective(info.lineText) : null;
    const scope = ui.scope.value;
    if (hasSel && scope === 'auto') {
      ui.ctxKind.textContent = `선택 ${selLen.toLocaleString()}자`;
      ui.ctxPreview.textContent = sel.replace(/\s+/g, ' ').slice(0, 120);
    } else if (directive && scope === 'auto') {
      ui.ctxKind.textContent = '지시문';
      ui.ctxPreview.textContent = `${directive} — 실행하면 이 줄을 결과로 바꿉니다`;
    } else if (scope === 'section') {
      ui.ctxKind.textContent = '현재 섹션';
      ui.ctxPreview.textContent = '커서가 있는 \\section 전체';
    } else if (scope === 'document') {
      ui.ctxKind.textContent = '파일 전체';
      ui.ctxPreview.textContent = `${info.docLength.toLocaleString()}자`;
    } else {
      ui.ctxKind.textContent = scope === 'paragraph' ? '현재 문단' : '선택 없음';
      ui.ctxPreview.textContent = scope === 'paragraph' ? '커서가 있는 문단' : '교정 → 현재 문단 · 작성 → 커서 위치 · 검토 → 기능별 범위';
    }
  }

  // ------------------------------------------------------------------ runs ---

  let current = null;
  let runSeq = 0;
  let tickTimer = 0;
  const history = [];

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
    TIMEOUT: '시간 초과로 중단했습니다. 설정에서 제한 시간을 늘리거나 사고 수준을 낮추세요.',
    BUSY: '이전 요청이 아직 실행 중입니다.',
    EMPTY_PROMPT: '보낼 내용이 없습니다.',
  };

  function explain(code, detail = '') {
    let text = ERROR_TEXT[code] || code;
    const d = String(detail || '');
    if (/native messaging host not found/i.test(d)) text = '로컬 브리지가 설치되지 않았습니다. 터미널에서 ./scripts/install-host.sh 를 실행하세요.';
    else if (/forbidden/i.test(d)) text = '로컬 브리지가 이 확장 ID 를 허용하지 않습니다. ./scripts/install-host.sh <확장ID> 로 다시 설치하세요.';
    else if (/model/i.test(d) && /(not found|invalid|unknown|not available|does not exist)/i.test(d)) text = '선택한 모델을 이 계정에서 쓸 수 없습니다. 다른 모델을 고르세요.';
    else if (/log ?in|logged|auth|credential|api key|unauthori[sz]ed|401/i.test(d)) text += ' 터미널에서 CLI 를 한 번 실행해 로그인 상태를 확인하세요.';
    return text;
  }

  function setBusy(busy) {
    ui.spinner.hidden = !busy;
    ui.stopBtn.hidden = !busy;
    ui.runBtn.disabled = busy;
    for (const b of ui.actions.querySelectorAll('button')) b.disabled = busy || !!actionDisabledReason(allActions().find((a) => a.id === b.dataset.id) || {});
  }

  function backendLabel(req) {
    const name = req.backend === 'codex' ? 'Codex' : 'Claude';
    const model = C.modelsFor(req.backend, settings).find((m) => m.id === req.model);
    const mlabel = req.model ? (model ? model.label : req.model) : '기본 모델';
    return `${name} ${mlabel}${req.effort ? ` · ${req.effort}` : ''}`;
  }

  function hideResultParts() {
    for (const el of [ui.errDetail, ui.explain, ui.tabs, ui.diffBar, ui.diff, ui.out, ui.variants, ui.report, ui.resultActions, ui.pkgPrompt]) el.hidden = true;
  }

  function scrollToResult() {
    ui.body.scrollTop = Math.max(0, ui.result.offsetTop - 8);
  }

  async function start(spec) {
    if (current && !current.finished) cancel({ silent: true });
    current = null;
    openPanel();
    hideHistory();
    if (!chrome.runtime?.id) return showError('EXTENSION_RELOADED');
    const { action } = spec;
    const reason = actionDisabledReason(action);
    if (reason) return showError(null, reason);

    let ctx = spec.ctx;
    if (!ctx) {
      try { ctx = await mw('getContext'); } catch (e) { return showError(e.message); }
    }
    const target = spec.target || P.resolveTarget(ctx, action, { scope: ui.scope.value });
    if (target.error) return showError(null, target.error);
    const extra = (spec.extra || '').trim();
    if (target.needsInstruction && !extra) return showError(null, '변환할 데이터를 선택하거나, 입력칸에 만들 내용을 설명한 뒤 다시 누르세요.');
    let lintText = spec.lintText;
    if (action.withLint && !lintText) {
      try { lintText = L.summarize(L.lintLatex(ctx.doc)) || '(no issues found)'; } catch { lintText = ''; }
    }
    const request = P.buildRequest({
      settings, action, instruction: spec.instruction, extra: action.kind === 'custom' || action.kind === 'ask' ? '' : extra,
      target, doc: ctx.doc, fileName: ctx.fileName, profile, lintText, logText: spec.logText,
    });

    const run = {
      id: ++runSeq, spec, action, target, request, output: request.output, doc: ctx.doc,
      raw: '', finalText: null, finished: false, applied: false, started: Date.now(),
      statusBase: `${backendLabel(request)} 생성 중`, port: null, label: action.label,
    };
    current = run;

    ui.result.hidden = false;
    ui.status.classList.remove('err');
    hideResultParts();
    if (run.output === 'report') ui.report.hidden = false;
    else { ui.out.hidden = false; ui.out.readOnly = true; ui.out.value = ''; }
    ui.report.innerHTML = '';
    setBusy(true);
    scrollToResult();
    const tick = () => {
      if (current !== run || run.finished) return;
      const secs = ((Date.now() - run.started) / 1000).toFixed(1);
      ui.statusText.textContent = `[${run.label}] ${run.statusBase} · ${secs}s${run.raw ? ` · ${run.raw.length.toLocaleString()}자` : ''}`;
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

  let renderTimer = 0;
  function onRunMessage(run, m) {
    if (run.finished || !m) return;
    switch (m.type) {
      case 'status':
        run.statusBase = m.text;
        break;
      case 'delta':
        run.raw += m.text;
        if (current !== run) break;
        if (run.output === 'report') {
          if (!renderTimer) renderTimer = setTimeout(() => { renderTimer = 0; if (current === run && !run.finished) ui.report.innerHTML = M.renderMarkdown(run.raw); }, 150);
        } else {
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
    const final = run.finalText ?? run.raw;
    run.durationMs = meta.durationMs || Date.now() - run.started;
    run.costUsd = meta.costUsd;
    if (run.output === 'report') run.report = P.postProcessReport(final);
    else if (run.output === 'variants') run.variants = P.parseVariants(final, run.target);
    else if (run.output === 'fix') {
      const f = P.parseFix(final, run.target);
      run.explanation = f.explanation;
      run.result = f.latex;
    } else run.result = P.postProcess(final, run.target);
    history.unshift(run);
    history.length = Math.min(history.length, HISTORY_MAX);
    if (current !== run) return;
    renderResult(run);
    const changed = run.result != null && run.result.trim() && run.result !== run.target.text;
    if (run.spec.autoApply && run.output === 'latex' && changed) apply('replace');
  }

  function renderResult(run) {
    ui.result.hidden = false;
    ui.status.classList.remove('err');
    hideResultParts();
    ui.spinner.hidden = true;
    ui.stopBtn.hidden = true;
    const secs = ((run.durationMs || 0) / 1000).toFixed(1);
    const cost = typeof run.costUsd === 'number' && run.costUsd >= 0.0001 ? ` · ~$${run.costUsd.toFixed(4)}` : '';
    const head = `[${run.label}] ${backendLabel(run.request)} · ${secs}s${cost}`;
    const btns = { apply: false, after: false, comment: false, bib: false, copy: true, retry: true };

    if (run.output === 'report') {
      ui.statusText.textContent = `완료 · ${head}`;
      ui.report.innerHTML = M.renderMarkdown(run.report);
      ui.report.hidden = false;
      // Tables need room: widen automatically on large screens (the ⤢ button toggles it back).
      if (ui.report.querySelector('table') && window.innerWidth >= 1100 && !ui.panel.classList.contains('wide')) {
        ui.panel.classList.add('wide');
        ui.wideBtn.setAttribute('aria-pressed', 'true');
      }
      btns.comment = true;
      btns.bib = M.codeBlocks(run.report, 'bibtex').length > 0;
    } else if (run.output === 'variants') {
      ui.statusText.textContent = `후보 ${run.variants.length}개 · ${head}`;
      renderVariants(run);
    } else {
      if (run.output === 'fix') {
        ui.explain.hidden = !run.explanation;
        ui.explain.textContent = run.explanation || '';
      }
      if (run.result == null) {
        ui.statusText.textContent = `수정안 없음 · ${head}`;
      } else {
        const unchanged = run.target.mode === 'replace' && run.result === run.target.text;
        ui.statusText.textContent = `${unchanged ? '변경할 부분이 없습니다' : '완료'} · ${head}`;
        ui.out.readOnly = false;
        ui.out.value = run.result;
        run.hunksStale = true;
        const canDiff = run.target.mode === 'replace' && run.target.kind !== 'directive';
        ui.tabs.hidden = !canDiff;
        showTab(canDiff ? 'diff' : 'text');
        btns.apply = !!run.result.trim() && !run.applied;
        btns.after = canDiff && !run.applied;
        ui.applyBtn.textContent = run.target.mode === 'insert' ? '커서 위치에 삽입' : run.target.kind === 'directive' ? '지시문 줄 대체' : '적용 (교체)';
      }
    }
    ui.resultActions.hidden = false;
    ui.applyBtn.hidden = !btns.apply;
    ui.afterBtn.hidden = !btns.after;
    ui.commentBtn.hidden = !btns.comment;
    ui.bibBtn.hidden = !btns.bib;
    ui.glossaryBtn.hidden = !(run.output === 'report' && run.action.glossary && M.codeBlocks(run.report, 'glossary').length);
    ui.pkgPrompt.hidden = true;
    ui.copyBtn.hidden = !btns.copy;
    ui.retryBtn.hidden = !btns.retry;
    ui.applyBtn.disabled = false;
    ui.afterBtn.disabled = false;
  }

  function renderVariants(run) {
    ui.variants.hidden = false;
    ui.variants.textContent = '';
    run.variants.forEach((v, i) => {
      const card = document.createElement('div');
      card.className = 'variant';
      const pre = document.createElement('pre');
      pre.textContent = v.trim();
      const row = document.createElement('div');
      row.className = 'row';
      row.innerHTML = `<span class="n">#${i + 1}</span><button class="btn sm v-copy" type="button" data-i="${i}">복사</button><button class="btn sm primary v-apply" type="button" data-i="${i}" ${run.applied ? 'disabled' : ''}>${run.target.mode === 'insert' ? '삽입' : '이걸로 교체'}</button>`;
      card.append(pre, row);
      ui.variants.appendChild(card);
    });
  }

  ui.variants.addEventListener('click', async (e) => {
    const b = e.target.closest('button[data-i]');
    const run = current;
    if (!b || !run?.variants || !e.isTrusted) return;
    const text = run.variants[Number(b.dataset.i)];
    if (b.classList.contains('v-copy')) return copyText(text.trim());
    if (b.classList.contains('v-apply')) {
      const ok = await applyText(run, text, 'replace');
      if (ok) for (const x of ui.variants.querySelectorAll('.v-apply')) x.disabled = true;
    }
  });

  function fail(run, code, detail) {
    if (run.finished) return;
    endRun(run);
    if (current !== run) return;
    showError(code, null, detail);
    if (run.raw && run.output !== 'report') {
      ui.out.hidden = false;
      ui.out.readOnly = false;
      ui.resultActions.hidden = false;
      for (const b of [ui.applyBtn, ui.afterBtn, ui.commentBtn, ui.bibBtn, ui.retryBtn]) b.hidden = true;
    }
  }

  function showError(code, text, detail) {
    ui.result.hidden = false;
    setBusy(false);
    clearInterval(tickTimer);
    if (!current || current.finished) hideResultParts();
    ui.status.classList.add('err');
    ui.statusText.textContent = text || explain(code, detail);
    ui.errDetail.hidden = !detail;
    ui.errDetail.textContent = detail ? String(detail).slice(-2000) : '';
    scrollToResult();
  }

  function cancel({ silent = false } = {}) {
    const run = current;
    if (!run || run.finished) return;
    try { run.port?.postMessage({ type: 'cancel' }); } catch { /* ignore */ }
    endRun(run);
    if (!silent) {
      ui.statusText.textContent = '중지됨';
      if (run.raw && run.output !== 'report') {
        ui.out.readOnly = false;
        ui.resultActions.hidden = false;
        for (const b of [ui.applyBtn, ui.afterBtn, ui.commentBtn, ui.bibBtn]) b.hidden = true;
      }
    }
  }

  // ------------------------------------------------------------ diff & tabs ---

  function renderHunks(run) {
    ui.diff.innerHTML = D.renderHunksHtml(run.hunks);
    const changes = run.hunks.filter((h) => h.type === 'chg');
    const off = changes.filter((h) => !h.accepted).length;
    ui.diffInfo.textContent = changes.length
      ? `변경 ${changes.length}곳${off ? ` · ${off}곳 제외` : ''} · 변경을 클릭하면 개별 취소/복원`
      : '변경 없음';
  }

  function showTab(tab) {
    const run = current;
    for (const t of ui.tabs.querySelectorAll('.tab')) t.setAttribute('aria-selected', String(t.dataset.tab === tab));
    if (tab === 'diff' && run) {
      if (run.hunksStale || !run.hunks) {
        run.hunks = D.toHunks(D.diffWords(run.target.text, ui.out.value));
        run.hunksStale = false;
      }
      renderHunks(run);
      ui.diff.hidden = false;
      ui.diffBar.hidden = false;
      ui.out.hidden = true;
    } else {
      ui.diff.hidden = true;
      ui.diffBar.hidden = true;
      ui.out.hidden = false;
    }
  }
  ui.tabs.addEventListener('click', (e) => {
    const t = e.target.closest('.tab');
    if (t) showTab(t.dataset.tab);
  });
  ui.diff.addEventListener('click', (e) => {
    const span = e.target.closest('.chg');
    const run = current;
    if (!span || !run?.hunks) return;
    const h = run.hunks[Number(span.dataset.i)];
    h.accepted = !h.accepted;
    ui.out.value = D.composeHunks(run.hunks);
    renderHunks(run);
  });
  const setAll = (on) => {
    const run = current;
    if (!run?.hunks) return;
    for (const h of run.hunks) if (h.type === 'chg') h.accepted = on;
    ui.out.value = D.composeHunks(run.hunks);
    renderHunks(run);
  };
  ui.allOn.addEventListener('click', () => setAll(true));
  ui.allOff.addEventListener('click', () => setAll(false));
  ui.out.addEventListener('input', () => { if (current) current.hunksStale = true; });

  // ------------------------------------------------------------- applying ---

  async function applyText(run, text, position) {
    const target = run.target;
    let args;
    if (target.mode === 'insert') {
      const t = P.insertionText(text.replace(/\s+$/, ''), run.doc, target.from);
      args = { from: target.from, to: target.from, expected: '', text: t, anchorBefore: run.doc.slice(Math.max(0, target.from - 80), target.from) };
    } else if (position === 'after') {
      const sep = target.text.endsWith('\n') ? '\n' : '\n\n';
      args = { from: target.from, to: target.to, expected: target.text, text: `${sep}${text.trim()}`, position: 'after' };
    } else {
      args = { from: target.from, to: target.to, expected: target.text, text };
    }
    try {
      await mw('apply', args);
      run.applied = true;
      ui.status.classList.remove('err');
      ui.statusText.textContent = `적용했습니다 · ${MOD}+Z 로 되돌릴 수 있습니다`;
      toast('Overleaf 문서에 적용했습니다');
      setTimeout(refreshTarget, 50);
      setTimeout(() => lintTick(true), 300);
      checkPackagesFor(args.text);
      return true;
    } catch (e) {
      showError(e.message);
      return false;
    }
  }

  // After AI text lands in the document, ask to add any \usepackage it needs (기입 요청).
  let pkgPending = [];
  async function checkPackagesFor(text) {
    ui.pkgPrompt.hidden = true;
    let r;
    try { r = await mw('getDoc', {}, 3000); } catch { return; }
    const res = K.analyze(r.doc, text);
    pkgPending = res.missing;
    if (!pkgPending.length) return;
    const names = pkgPending.map((m) => (m.kind === 'tikzlib' ? `TikZ ${m.name}` : m.name)).join(', ');
    ui.pkgMsg.innerHTML = res.hasPreamble
      ? `이 결과에는 프리앰블에 없는 패키지가 필요합니다: <b>${M.escapeHtml(names)}</b>. 추가할까요?`
      : `이 결과에는 <b>${M.escapeHtml(names)}</b> 가 필요합니다. 이 파일에는 프리앰블이 없으니 메인 파일에 다음 줄을 추가하세요:<br><code>${M.escapeHtml(K.preambleLines(pkgPending).join('  '))}</code>`;
    ui.pkgAdd.hidden = !res.hasPreamble;
    ui.pkgPrompt.hidden = false;
    scrollToResult();
  }
  ui.pkgAdd.addEventListener('click', async (e) => {
    if (!e.isTrusted) return;
    if (await insertPackages(pkgPending)) ui.pkgPrompt.hidden = true;
  });
  ui.pkgCopy.addEventListener('click', () => copyText(K.preambleLines(pkgPending).join('\n')));
  ui.pkgDismiss.addEventListener('click', () => { ui.pkgPrompt.hidden = true; });

  // Save an AI-suggested glossary into the paper profile, then open the unification view.
  ui.glossaryBtn.addEventListener('click', () => {
    const block = M.codeBlocks(current?.report || '', 'glossary').join('\n');
    if (!block.trim()) return;
    profile.terms = T.mergeGlossary(profile.terms || '', block);
    chrome.storage.local.set({ [PROFILE_KEY]: profile }).catch(() => {});
    renderProfile();
    toast(`용어집에 ${T.parseGlossary(block).length}개 항목을 저장했습니다`);
    runAction({ kind: 'terms' });
  });

  async function apply(position) {
    const run = current;
    if (!run || !run.finished || run.applied || run.result == null) return;
    const ok = await applyText(run, ui.out.value, position);
    if (ok) { ui.applyBtn.disabled = true; ui.afterBtn.disabled = true; }
  }

  async function insertComment(run) {
    let ctx;
    try { ctx = await mw('getContext'); } catch (e) { return showError(e.message); }
    const pos = ctx.lineTo;
    const text = `\n${P.asLatexComment(`[AI ${run.label}]\n${run.report}`)}`;
    try {
      await mw('apply', { from: pos, to: pos, expected: '', text, anchorBefore: ctx.doc.slice(Math.max(0, pos - 80), pos) });
      toast('커서 줄 아래에 주석으로 넣었습니다');
    } catch (e) {
      showError(e.message);
    }
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      ui.root.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    toast('클립보드에 복사했습니다');
  }

  ui.applyBtn.addEventListener('click', (e) => { if (e.isTrusted) apply('replace'); });
  ui.afterBtn.addEventListener('click', (e) => { if (e.isTrusted) apply('after'); });
  ui.commentBtn.addEventListener('click', (e) => { if (e.isTrusted && current?.report) insertComment(current); });
  ui.bibBtn.addEventListener('click', () => { if (current?.report) copyText(M.codeBlocks(current.report, 'bibtex').join('\n\n')); });
  ui.stopBtn.addEventListener('click', () => cancel());
  ui.retryBtn.addEventListener('click', (e) => {
    if (!e.isTrusted || !current) return;
    if (current.action.kind === 'fix') runFix(current.action);
    else start({ ...current.spec, autoApply: false, ctx: null, target: null });
  });
  ui.copyBtn.addEventListener('click', () => {
    const run = current;
    if (!run) return;
    if (run.output === 'report') copyText(run.report || run.raw);
    else if (run.output === 'variants') copyText((run.variants || []).map((v) => v.trim()).join('\n\n'));
    else copyText(ui.out.value);
  });
  ui.report.addEventListener('click', (e) => {
    const a = e.target.closest('a.lref');
    if (!a) return;
    e.preventDefault();
    mw('selectLines', { line: Number(a.dataset.line), end: Number(a.dataset.end || a.dataset.line) }).catch(() => {});
  });

  // -------------------------------------------------------------- history ---

  function hideHistory() {
    ui.history.hidden = true;
    ui.histBtn.setAttribute('aria-pressed', 'false');
  }
  function renderHistory() {
    ui.history.textContent = '';
    if (!history.length) {
      ui.history.innerHTML = '<span class="hint">아직 실행 기록이 없습니다.</span>';
      return;
    }
    for (const run of history) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'item';
      const when = new Date(run.started).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const preview = (run.report || run.result || (run.variants || [])[0] || '').replace(/\s+/g, ' ').slice(0, 90);
      b.innerHTML = `<span>${M.escapeHtml(run.label)}${run.applied ? ' ✓' : ''}</span><span class="hint">${when}</span><small>${M.escapeHtml(backendLabel(run.request))} — ${M.escapeHtml(preview)}</small>`;
      b.addEventListener('click', () => { current = run; hideHistory(); renderResult(run); scrollToResult(); });
      ui.history.appendChild(b);
    }
  }
  ui.histBtn.addEventListener('click', () => {
    const show = ui.history.hidden;
    if (show) renderHistory();
    ui.history.hidden = !show;
    ui.histBtn.setAttribute('aria-pressed', String(show));
    if (show) ui.body.scrollTop = 0;
  });

  // ---------------------------------------------------- compile error assist ---

  function readCompileLog() {
    const entries = [...document.querySelectorAll('.log-entry')];
    const list = entries.length ? entries : [...document.querySelectorAll('[class*="log-entry"]')].filter((el) => !el.parentElement?.closest('[class*="log-entry"]'));
    const texts = list.map((el) => (el.innerText || '').trim()).filter(Boolean);
    texts.sort((a, b) => Number(/error/i.test(b)) - Number(/error/i.test(a)));
    return texts.slice(0, 10).join('\n---\n').slice(0, 8000);
  }

  async function runFix(action) {
    const pasted = ui.instr.value.trim();
    const log = readCompileLog() || pasted;
    if (!log) {
      openPanel();
      return showError(null, 'Overleaf 의 로그 패널을 열어 오류가 보이게 하거나, 오류 메시지를 입력칸에 붙여넣은 뒤 다시 실행하세요.');
    }
    let ctx;
    try { ctx = await mw('getContext'); } catch (e) { openPanel(); return showError(e.message); }
    const target = P.resolveFixTarget(ctx, log);
    if (target.error) { openPanel(); return showError(null, target.error); }
    start({ action, ctx, target, logText: log, extra: '' });
  }

  // ------------------------------------------------------- custom / quick ---

  function renderModeHint() {
    ui.segs.forEach((s) => s.classList.toggle('on', s.dataset.mode === instrMode));
    ui.modeHint.textContent = instrMode === 'ask'
      ? '문서는 바꾸지 않고 답변만 받습니다 (범위: 선택 > 설정한 범위 > 파일 전체)'
      : '선택 영역은 수정, 선택이 없으면 커서 위치에 작성';
  }
  ui.segs.forEach((s) => s.addEventListener('click', () => { instrMode = s.dataset.mode; renderModeHint(); }));

  function runCustom() {
    const instruction = ui.instr.value.trim();
    if (instruction) {
      const action = instrMode === 'ask'
        ? { id: 'ask', label: '질문', kind: 'ask', scope: 'document', effort: 'high', instruction }
        : { id: 'custom', label: '직접 지시', kind: 'custom', effort: 'medium', instruction };
      start({ action, instruction });
      return;
    }
    // Empty box: execute a "% ai:" directive on the cursor line if there is one.
    mw('selectionInfo').then((info) => {
      if (P.parseDirective(info.lineText) && !(info.to > info.from)) start({ action: { id: 'directive', label: '지시문', kind: 'directive', effort: 'medium' } });
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
      return start({ action: { id: 'directive', label: '지시문', kind: 'directive', effort: 'medium' }, autoApply });
    }
    const action = allActions().find((a) => a.id === settings.quickActionId) || C.ACTIONS[0];
    return runAction(action, { autoApply });
  }

  // ---------------------------------------------------------- autocomplete ---
  // Trusted keystrokes in the editor arm a timer; after a pause we ask Claude (fast model, no tools)
  // for a continuation and stream it into a ghost overlay drawn by the main-world script.

  const AC = { timer: 0, run: null, seq: 0, accepted: 0 };
  const AC_BLOCK_TEXT = {
    'not-focused': '에디터에 커서가 없습니다', selection: '선택 영역이 있습니다', composing: '한글 조합 중입니다',
    preamble: '프리앰블에서는 동작하지 않습니다', 'mid-line': '줄 끝에서만 동작합니다', comment: '주석 안입니다',
    'typing-command': 'LaTeX 명령을 입력하는 중입니다', 'inline-math': '수식 안입니다', 'math-env': '수식 환경 안입니다', 'display-math': '수식 안입니다',
  };
  const acMode = () => settings.autocomplete || 'auto';
  const inEditor = (t) => !!(t && t.closest && t.closest('.cm-content'));

  function cancelCompletion() {
    const r = AC.run;
    if (r && !r.done) {
      r.done = true;
      try { r.port?.postMessage({ type: 'cancel' }); r.port?.disconnect(); } catch { /* ignore */ }
    }
    AC.run = null;
  }

  async function showGhostText(run, text) {
    if (AC.run !== run && !run.done) return;
    let ok = false;
    try { ok = await mw('ghostShow', { text, head: run.ctx.head, docLength: run.ctx.docLength }, 2000); } catch { ok = false; }
    if (!ok && AC.run === run) cancelCompletion();
  }

  async function triggerCompletion({ manual }) {
    if (!chrome.runtime?.id || acMode() === 'off') return;
    if (cliInfo && cliInfo.claude && !cliInfo.claude.ok) { if (manual) toast('자동완성에는 claude CLI 가 필요합니다'); return; }
    let ctx;
    try { ctx = await mw('completionContext', {}, 2000); } catch { return; }
    const reason = P.completionBlocker(ctx, { manual });
    if (reason) { if (manual) toast(`자동완성: ${AC_BLOCK_TEXT[reason] || reason}`); return; }
    cancelCompletion();
    const request = P.buildCompletionRequest({ settings, before: ctx.before, after: ctx.after, fileName: ctx.fileName, profile });
    const run = { id: ++AC.seq, ctx, raw: '', final: null, port: null, done: false, manual };
    AC.run = run;
    if (manual) toast('자동완성 요청 중…', 1500);
    let port;
    try { port = chrome.runtime.connect({ name: 'olai-run' }); } catch { AC.run = null; return; }
    run.port = port;
    port.onMessage.addListener((m) => {
      if (AC.run !== run || run.done || !m) return;
      if (m.type === 'delta') {
        run.raw += m.text;
        const t = P.postProcessCompletion(run.raw, ctx.before);
        if (t) showGhostText(run, t);
      } else if (m.type === 'final-chunk') {
        run.final = (run.final || '') + m.text;
      } else if (m.type === 'done') {
        run.done = true;
        try { port.disconnect(); } catch { /* ignore */ }
        const t = P.postProcessCompletion(run.final ?? run.raw, ctx.before);
        if (t) showGhostText(run, t); else { mw('ghostHide').catch(() => {}); if (manual) toast('제안할 내용이 없습니다'); }
      } else if (m.type === 'error') {
        run.done = true;
        try { port.disconnect(); } catch { /* ignore */ }
        if (manual) toast(`자동완성 실패: ${explain(m.error, m.detail)}`);
      }
    });
    port.onDisconnect.addListener(() => { if (AC.run === run) run.done = true; });
    port.postMessage({ type: 'run', request });
  }

  document.addEventListener('keydown', (e) => {
    if (!e.isTrusted || !inEditor(e.target)) return;
    if (e.altKey && !e.ctrlKey && !e.metaKey && e.code === 'Backslash') {
      if (acMode() === 'off') return;
      e.preventDefault();
      e.stopPropagation();
      clearTimeout(AC.timer);
      triggerCompletion({ manual: true });
      return;
    }
    if (['Shift', 'Control', 'Alt', 'Meta', 'CapsLock'].includes(e.key)) return;
    cancelCompletion();
    clearTimeout(AC.timer);
    if (acMode() !== 'auto') return;
    if (e.key === 'Tab' || e.key === 'Escape' || e.key.startsWith('Arrow') || e.key.startsWith('Page') || e.key === 'Home' || e.key === 'End' || e.metaKey || e.ctrlKey) return;
    AC.timer = setTimeout(() => triggerCompletion({ manual: false }), Math.max(300, Number(settings.acDelayMs) || 1200));
  }, true);
  document.addEventListener('mousedown', (e) => { if (inEditor(e.target)) { clearTimeout(AC.timer); cancelCompletion(); } }, true);

  // Hints from the main world (treated as untrusted: they can only cancel work).
  window.addEventListener('message', (e) => {
    if (e.source !== window || !e.data || e.data.channel !== 'olai:mw-event') return;
    if (e.data.type === 'ghost-hidden') cancelCompletion();
    if (e.data.type === 'ghost-accepted') { AC.accepted += 1; setTimeout(() => lintTick(false), 500); }
  });

  ui.acMode.addEventListener('change', () => {
    saveSetting('autocomplete', ui.acMode.value);
    toast(ui.acMode.value === 'auto' ? '자동완성: 입력을 멈추면 제안합니다 (Tab 수락)' : ui.acMode.value === 'manual' ? `자동완성: ${ALT}+\\ 로 요청합니다` : '자동완성을 껐습니다');
  });

  // Keyboard commands are delivered by the background worker (chrome.commands).
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type !== 'command') return;
    if (msg.command === 'toggle-panel') togglePanel();
    else if (msg.command === 'quick-action') quickAction();
  });

  renderModeHint();
  renderProfile();
  onSettingsChanged();
})();
