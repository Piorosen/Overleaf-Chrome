// Overleaf AI — options page.
(() => {
  'use strict';
  const P = globalThis.OLAI;
  const C = globalThis.OLAI_CATALOG;
  const $ = (id) => document.getElementById(id);
  const LOCAL_KEYS = ['styleGuide', 'customPresets', 'claudeCustomModels', 'codexCustomModels', 'lastCategory'];
  const FIELDS = ['claudeModel', 'claudeEffort', 'codexModel', 'codexEffort', 'claudeCustomModels', 'codexCustomModels',
    'styleGuide', 'customPresets', 'explainLang', 'contextChars', 'timeoutSec',
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
    const area = LOCAL_KEYS.includes(key) ? chrome.storage.local : chrome.storage.sync;
    area.set({ [key]: value }).then(() => {
      $('saved').textContent = '저장됨';
      $('saved').classList.remove('bad');
      clearTimeout(savedTimer);
      savedTimer = setTimeout(() => { $('saved').textContent = ''; }, 1500);
    }).catch((e) => {
      $('saved').textContent = `저장 실패: ${e && e.message ? e.message : e}`;
      $('saved').classList.add('bad');
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
    let t = 0;
    el.addEventListener(evt, () => {
      let v = el.type === 'checkbox' ? el.checked : el.value;
      if (el.type === 'number') v = Number(v) || P.DEFAULT_SETTINGS[k];
      clearTimeout(t);
      // Text fields: save after typing pauses (sync storage allows only ~120 writes per minute).
      if (evt === 'input') t = setTimeout(() => save(k, v), 600); else save(k, v);
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
      const py = resp.python;
      if (py) {
        const li = document.createElement('li');
        li.textContent = py.ok
          ? `python: ${py.version}${py.pkgs?.matplotlib ? ` · matplotlib ${py.pkgs.matplotlib}` : ' · matplotlib 없음 (./scripts/install-host.sh --with-matplotlib)'} · ${py.sandbox ? `샌드박스 ${py.sandbox}` : '샌드박스 없음'}  (${py.path})`
          : `python: 사용 불가 — ${py.error || '알 수 없음'} (그림 기능에 필요)`;
        ul.append(li);
      }
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

  // Usage: per-day counters written by the panel (olai-usage:YYYY-MM-DD).
  chrome.storage.local.get(null).then((all) => {
    const days = Object.keys(all).filter((k) => k.startsWith('olai-usage:')).sort();
    const cutoff = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
    const old = days.filter((k) => k.slice(11) < cutoff);
    if (old.length) chrome.storage.local.remove(old).catch(() => {});
    const recent = days.filter((k) => k.slice(11) >= cutoff).slice(-7).reverse();
    const box = $('usage');
    if (!recent.length) { box.textContent = '아직 기록이 없습니다.'; return; }
    const tbl = document.createElement('table');
    tbl.className = 'usage';
    let runs = 0;
    let cost = 0;
    for (const k of recent) {
      const u = all[k] || {};
      runs += u.runs || 0;
      cost += u.cost || 0;
      const tr = tbl.insertRow();
      tr.insertCell().textContent = k.slice(11);
      tr.insertCell().textContent = `${u.runs || 0}회`;
      tr.insertCell().textContent = u.cost ? `~$${u.cost.toFixed(2)}` : '–';
    }
    const tr = tbl.insertRow();
    tr.className = 'sum';
    tr.insertCell().textContent = '합계';
    tr.insertCell().textContent = `${runs}회`;
    tr.insertCell().textContent = cost ? `~$${cost.toFixed(2)}` : '–';
    box.textContent = '';
    box.append(tbl);
  }).catch(() => { $('usage').textContent = '불러오지 못했습니다.'; });

  Promise.all([chrome.storage.sync.get(null), chrome.storage.local.get(LOCAL_KEYS)]).then(([syncAll, loc]) => {
    const fromSync = Object.fromEntries(Object.entries(syncAll).filter(([k]) => k in P.DEFAULT_SETTINGS && !LOCAL_KEYS.includes(k)));
    const legacy = Object.fromEntries(LOCAL_KEYS.filter((k) => syncAll[k] !== undefined && loc[k] === undefined).map((k) => [k, syncAll[k]]));
    settings = { ...P.DEFAULT_SETTINGS, ...fromSync, ...legacy, ...loc };
    render();
    testConnection();
  });
})();
