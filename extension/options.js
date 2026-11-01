// Overleaf AI — options page.
(() => {
  'use strict';
  const P = globalThis.OLAI;
  const $ = (id) => document.getElementById(id);
  const FIELDS = ['claudeModel', 'claudeEffort', 'codexModel', 'codexEffort', 'claudeExtraArgs', 'codexExtraArgs',
    'styleGuide', 'customPresets', 'contextChars', 'timeoutSec', 'includeFullDoc', 'quickActionId', 'autoApplyQuick', 'showLauncher'];

  $('ext-id').textContent = chrome.runtime.id;

  let settings = { ...P.DEFAULT_SETTINGS };
  let savedTimer = 0;

  function fillQuickActions() {
    const sel = $('quickActionId');
    const actions = [...P.ACTIONS, ...P.parseCustomPresets(settings.customPresets)].filter((a) => a.kind === 'transform');
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
    fillQuickActions();
    for (const k of FIELDS) {
      const el = $(k);
      if (el.type === 'checkbox') el.checked = !!settings[k];
      else el.value = settings[k] ?? '';
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
    if (key === 'backend') testConnection();
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
    li.textContent = ok ? `${name}: ${info.version}  (${info.path})` : `${name}: 사용 불가 — ${info?.error || '알 수 없음'}${info?.path ? `  (${info.path})` : ''}`;
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
      box.className = 'conn';
      const head = document.createElement('p');
      head.textContent = `로컬 브리지 v${resp.hostVersion} · Node ${resp.node}`;
      const ul = document.createElement('ul');
      ul.append(cliLine('claude', resp.claude), cliLine('codex', resp.codex));
      box.append(head, ul);
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
