// Overleaf AI — background service worker.
// Bridges content-script ports to the Native Messaging host and routes keyboard commands.

const HOST_NAME = 'com.olai.cli_bridge';
const OVERLEAF_PROJECT = /^https:\/\/(www\.)?overleaf\.com\/[pP]roject\/(?!.*\/detached)/;

// One port per run. The content script sends {type:'run', request} or {type:'cancel'}.
// Each run gets its own host process; disconnecting it kills the CLI.
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'olai-run') return;
  let native = null;
  let settled = false;

  const closeNative = () => {
    if (native) {
      try { native.disconnect(); } catch { /* already closed */ }
      native = null;
    }
  };
  const toPort = (msg) => { try { port.postMessage(msg); } catch { /* tab gone */ } };

  port.onMessage.addListener((msg) => {
    if (msg?.type === 'run') {
      closeNative();
      settled = false;
      try {
        native = chrome.runtime.connectNative(HOST_NAME);
      } catch (e) {
        toPort({ type: 'error', error: 'NATIVE_CONNECT_FAILED', detail: String(e?.message || e) });
        return;
      }
      native.onMessage.addListener((m) => {
        toPort(m);
        if (m?.type === 'done' || m?.type === 'error') {
          settled = true;
          closeNative(); // host exits when stdin closes
        }
      });
      native.onDisconnect.addListener(() => {
        const err = chrome.runtime.lastError?.message;
        native = null;
        if (!settled) {
          settled = true;
          toPort({ type: 'error', error: 'NATIVE_DISCONNECTED', detail: err || '호스트 프로세스가 예기치 않게 종료되었습니다.' });
        }
      });
      // Rebuild the request field by field: only these reach the bridge (no CLI flags from pages).
      const r = msg.request || {};
      native.postMessage({
        type: 'run',
        backend: r.backend === 'codex' ? 'codex' : 'claude',
        model: typeof r.model === 'string' ? r.model : '',
        effort: typeof r.effort === 'string' ? r.effort : '',
        web: r.web === true,
        timeoutSec: Number(r.timeoutSec) || 180,
        system: typeof r.system === 'string' ? r.system : '',
        prompt: typeof r.prompt === 'string' ? r.prompt : '',
      });
    } else if (msg?.type === 'cancel') {
      settled = true;
      closeNative();
      toPort({ type: 'cancelled' });
    }
  });

  port.onDisconnect.addListener(closeNative);
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'ping') {
    chrome.runtime.sendNativeMessage(HOST_NAME, { type: 'ping' }, (resp) => {
      const err = chrome.runtime.lastError?.message;
      if (err) sendResponse({ ok: false, error: err });
      else sendResponse({ ok: true, ...resp });
    });
    return true; // async response
  }
  if (msg?.type === 'bib') {
    // Bibliographic metadata lookups (arXiv / Semantic Scholar / OpenAlex / DOI / Crossref) via the bridge.
    const q = msg.query || {};
    const allowed = ['arxiv', 'arxiv-search', 's2', 'openalex-work', 'openalex-search', 'doi-bib', 'crossref-search'];
    if (!allowed.includes(q.op)) { sendResponse({ ok: false, error: 'bad op' }); return false; }
    const req = { type: 'bib', op: q.op, ids: Array.isArray(q.ids) ? q.ids.slice(0, 100).map(String) : undefined, q: typeof q.q === 'string' ? q.q : undefined, id: typeof q.id === 'string' ? q.id : undefined, doi: typeof q.doi === 'string' ? q.doi : undefined, max: Number(q.max) || undefined };
    chrome.runtime.sendNativeMessage(HOST_NAME, req, (resp) => {
      const err = chrome.runtime.lastError?.message;
      if (err) sendResponse({ ok: false, error: err });
      else sendResponse(resp && resp.type === 'bib-result' ? resp : { ok: false, error: resp?.error || 'no response' });
    });
    return true;
  }
  if (msg?.type === 'open-options') {
    chrome.runtime.openOptionsPage();
  }
  return false;
});

chrome.commands.onCommand.addListener(async (command, tab) => {
  let target = tab;
  if (!target) [target] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!target?.id || !OVERLEAF_PROJECT.test(target.url || '')) return;
  chrome.tabs.sendMessage(target.id, { type: 'command', command }).catch(() => {});
});
