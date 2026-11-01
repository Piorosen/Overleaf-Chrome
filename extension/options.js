// Overleaf AI — options page.
(() => {
  'use strict';
  const P = globalThis.OLAI;
  const C = globalThis.OLAI_CATALOG;
  const $ = (id) => document.getElementById(id);
  const FIELDS = ['claudeModel', 'claudeEffort', 'codexModel', 'codexEffort', 'claudeCustomModels', 'codexCustomModels',
    'claudeExtraArgs', 'codexExtraArgs', 'styleGuide', 'customPresets', 'explainLang', 'contextChars', 'timeoutSec',
    'includeFullDoc', 'allowWeb', 'autoLint', 'quickActionId', 'autoApplyQuick', 'showLauncher',
    'autocomplete', 'acModel', 'acEffort', 'acDelayMs', 'acMaxWords'];

  $('ext-id').textContent = chrome.runtime.id;

  let settings = { ...P.DEFAULT_SETTINGS };
  let defaults = { claude: {}, codex: {} };
  let savedTimer = 0;

  function fillModels(backend) {
    const sel = $(backend === 'codex' ? 'codexModel' : 'claudeModel');
    const chosen = settings[backend === 'codex' ? 'codexModel' : 'claudeModel'] || '';
    const models = C.modelsFor(backend, settings);
    sel.textContent = '';
    const groups = new Map();
    for (const m of models) {
      if (!groups.has(m.group || '')) groups.set(m.group || '', []);
      groups.get(m.group || '').push(m);
    }
    if (chosen && !models.some((m) => m.id === chosen)) groups.set('현재 설정', [{ id: chosen, label: chosen }]);
    for (const [g, list] of groups) {
      const parent = g ? document.createElement('optgroup') : sel;
      if (g) parent.label = g;
      for (const m of list) {
        const o = document.createElement('option');
        o.value = m.id;
        const def = defaults[backend]?.model;
        o.textContent = m.id === '' ? `${m.label}${def ? ` (${def})` : ''}` : `${m.label}${m.note ? ` — ${m.note}` : ''}${m.id !== m.label ? `  [${m.id}]` : ''}`;
        parent.appendChild(o);
      }
      if (g) sel.appendChild(parent);
    }
    sel.value = chosen;
  }

  function fillEfforts(backend) {
    const sel = $(backend === 'codex' ? 'codexEffort' : 'claudeEffort');
    const model = settings[backend === 'codex' ? 'codexModel' : 'claudeModel'] || '';
    const supported = C.effortsFor(backend, model, settings);
    const chosen = settings[backend === 'codex' ? 'codexEffort' : 'claudeEffort'];
    const opts = supported.length ? ['auto', '', ...supported] : [''];
    sel.textContent = '';
    for (const e of opts) {
      const o = document.createElement('option');
      o.value = e;
      o.textContent = C.EFFORT_LABELS[e] || e;
      sel.appendChild(o);
    }
    sel.value = opts.includes(chosen) ? chosen : opts[0];
  }

  function fillAutocomplete() {
    const msel = $('acModel');
    msel.textContent = '';
    for (const m of C.modelsFor('claude', settings).filter((x) => x.id)) {
      const o = document.createElement('option');
      o.value = m.id;
      o.textContent = `${m.label}${m.note ? ` — ${m.note}` : ''}`;
      msel.appendChild(o);
    }
    msel.value = settings.acModel;
    const esel = $('acEffort');
    esel.textContent = '';
    const supported = C.effortsFor('claude', settings.acModel, settings);
    for (const e of ['', ...supported]) {
      const o = document.createElement('option');
      o.value = e;
      o.textContent = C.EFFORT_LABELS[e] || e;
      esel.appendChild(o);
    }
    esel.value = ['', ...supported].includes(settings.acEffort) ? settings.acEffort : (supported.includes('low') ? 'low' : '');
  }

  function fillQuickActions() {
    const sel = $('quickActionId');
    const actions = [...C.ACTIONS, ...P.parseCustomPresets(settings.customPresets)].filter((a) => a.kind === 'transform');
    sel.textContent = '';
    for (const a of actions) {
      const o = document.createElement('option');
      o.value = a.id;
      o.textContent = a.label;
      sel.appendChild(o);
    }
    sel.value = actions.some((a) => a.id === settings.quickActionId) ? settings.quickActionId : 'polish';
  }

  function render() {
    for (const r of document.querySelectorAll('input[name="backend"]')) r.checked = r.value === settings.backend;
    fillModels('claude');
    fillModels('codex');
    fillEfforts('claude');
    fillEfforts('codex');
    fillQuickActions();
    fillAutocomplete();
    for (const k of FIELDS) {
      const el = $(k);
      if (el.type === 'checkbox') el.checked = !!settings[k];
      else if (el.tagName !== 'SELECT' || [...el.options].some((o) => o.value === String(settings[k] ?? ''))) el.value = settings[k] ?? '';
    }
  }

  function save(key, value) {
    settings[key] = value;
    chrome.storage.sync.set({ [key]: value }).then(() => {
      $('saved').textContent = '저장됨';
      clearTimeout(savedTimer);
      savedTimer = setTimeout(() => { $('saved').textContent = ''; }, 1500);
    });
    if (key === 'customPresets') fillQuickActions();
    if (key === 'claudeModel' || key === 'claudeCustomModels') { fillModels('claude'); fillEfforts('claude'); }
    if (key === 'codexModel' || key === 'codexCustomModels') { fillModels('codex'); fillEfforts('codex'); }
    if (key === 'backend') testConnection();
    if (key === 'acModel' || key === 'claudeCustomModels') fillAutocomplete();
  }

  for (const r of document.querySelectorAll('input[name="backend"]')) {
    r.addEventListener('change', () => r.checked && save('backend', r.value));
  }
  for (const k of FIELDS) {
    const el = $(k);
    const evt = el.tagName === 'SELECT' || el.type === 'checkbox' ? 'change' : 'input';
    el.addEventListener(evt, () => {
      let v = el.type === 'checkbox' ? el.checked : el.value;
      if (el.type === 'number') v = Number(v) || P.DEFAULT_SETTINGS[k];
      save(k, v);
    });
  }

  function cliLine(name, info) {
    const li = document.createElement('li');
    const ok = !!info?.ok;
    li.className = ok ? 'ok' : 'bad';
    const def = info?.defaults?.model ? ` · 기본 모델 ${info.defaults.model}` : '';
    li.textContent = ok ? `${name}: ${info.version}${def}  (${info.path})` : `${name}: 사용 불가 — ${info?.error || '알 수 없음'}${info?.path ? `  (${info.path})` : ''}`;
    return li;
  }

  function testConnection() {
    const box = $('conn');
    box.className = 'conn';
    box.textContent = '확인 중…';
    chrome.runtime.sendMessage({ type: 'ping' }).then((resp) => {
      box.textContent = '';
      if (!resp?.ok) {
        box.className = 'conn bad';
        box.textContent = `로컬 브리지에 연결할 수 없습니다: ${resp?.error || '응답 없음'}`;
        $('setup').open = true;
        return;
      }
      defaults = { claude: resp.claude?.defaults || {}, codex: resp.codex?.defaults || {} };
      fillModels('claude');
      fillModels('codex');
      box.className = 'conn';
      const head = document.createElement('p');
      head.textContent = `로컬 브리지 v${resp.hostVersion} · Node ${resp.node}`;
      const ul = document.createElement('ul');
      ul.append(cliLine('claude', resp.claude), cliLine('codex', resp.codex));
      box.append(head, ul);
      if (resp.hostVersion !== chrome.runtime.getManifest().version) {
        const warn = document.createElement('p');
        warn.className = 'bad';
        warn.textContent = `브리지(v${resp.hostVersion})와 확장(v${chrome.runtime.getManifest().version}) 버전이 다릅니다. ./scripts/install-host.sh 를 다시 실행하세요.`;
        box.append(warn);
      }
      const active = settings.backend === 'codex' ? resp.codex : resp.claude;
      if (!active?.ok) $('setup').open = true;
    }).catch((e) => {
      box.className = 'conn bad';
      box.textContent = String(e?.message || e);
    });
  }
  $('test').addEventListener('click', testConnection);

  chrome.storage.sync.get(P.DEFAULT_SETTINGS).then((s) => {
    settings = { ...P.DEFAULT_SETTINGS, ...s };
    render();
    testConnection();
  });
})();
