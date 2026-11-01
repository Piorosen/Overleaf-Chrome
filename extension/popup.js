// Overleaf AI — toolbar popup: backend switch + connection status.
(() => {
  'use strict';
  const conn = document.getElementById('conn');
  let backend = 'claude';

  function showStatus(resp) {
    conn.className = 'conn';
    if (!resp?.ok) {
      conn.classList.add('bad');
      conn.textContent = '로컬 브리지 미설치 — 설정 페이지의 안내를 따라주세요.';
      return;
    }
    const cli = backend === 'codex' ? resp.codex : resp.claude;
    if (cli?.ok) {
      conn.classList.add('good');
      conn.textContent = `● ${cli.version}`;
    } else {
      conn.classList.add('bad');
      conn.textContent = `${backend} CLI 사용 불가: ${cli?.error || '알 수 없음'}`;
    }
  }

  let lastResp = null;
  chrome.storage.sync.get({ backend: 'claude' }).then((s) => {
    backend = s.backend;
    for (const r of document.querySelectorAll('input[name="backend"]')) {
      r.checked = r.value === backend;
      r.addEventListener('change', () => {
        if (!r.checked) return;
        backend = r.value;
        chrome.storage.sync.set({ backend });
        if (lastResp) showStatus(lastResp);
      });
    }
    chrome.runtime.sendMessage({ type: 'ping' }).then((resp) => { lastResp = resp; showStatus(resp); });
  });

  document.getElementById('options').addEventListener('click', () => chrome.runtime.openOptionsPage());
})();
