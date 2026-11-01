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
    if (msg?.type === 'tool-result') {
      // Agent mode: the content script answered a tool call — pass it to the bridge.
      if (native) {
        try {
          native.postMessage({
            type: 'tool-result', callId: Number(msg.callId), ok: msg.ok === true,
            result: typeof msg.result === 'string' ? msg.result.slice(0, 300000) : undefined,
            error: typeof msg.error === 'string' ? msg.error.slice(0, 2000) : undefined,
          });
        } catch { /* closed */ }
      }
      return;
    }
    if (msg?.type === 'run' || msg?.type === 'agent') {
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
      if (msg.type === 'agent') {
        native.postMessage({
          type: 'agent',
          projectKey: String(r.projectKey || '').slice(0, 64),
          sessionId: typeof r.sessionId === 'string' ? r.sessionId : '',
          newSession: r.newSession === true,
          model: typeof r.model === 'string' ? r.model : '',
          effort: typeof r.effort === 'string' ? r.effort : '',
          web: r.web === true,
          timeoutSec: Number(r.timeoutSec) || 600,
          maxToolCalls: Number(r.maxToolCalls) || 40,
          system: typeof r.system === 'string' ? r.system : '',
          prompt: typeof r.prompt === 'string' ? r.prompt : '',
        });
        return;
      }
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

// Right-click menu on selected text in Overleaf.
const MENU_PATTERNS = ['https://www.overleaf.com/project/*', 'https://overleaf.com/project/*', 'https://www.overleaf.com/Project/*', 'https://overleaf.com/Project/*'];
const MENU = [['polish', '다듬기'], ['grammar', '문법 교정'], ['concise', '간결하게'], ['academic', '학술체로'], ['to-en', '한→영'], ['to-ko', '영→한'], ['ko-spell', '한국어 맞춤법'], ['explain-ko', '한국어로 설명'], ['cite-needed', '인용 필요 위치'], ['agent', '에이전트에게 맡기기…']];
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: 'olai', title: 'Overleaf AI', contexts: ['selection'], documentUrlPatterns: MENU_PATTERNS });
    for (const [id, title] of MENU) chrome.contextMenus.create({ id: `olai:${id}`, parentId: 'olai', title, contexts: ['selection'], documentUrlPatterns: MENU_PATTERNS });
  });
});
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab?.id || !String(info.menuItemId).startsWith('olai:')) return;
  chrome.tabs.sendMessage(tab.id, { type: 'command', command: 'action', actionId: String(info.menuItemId).slice(5) }).catch(() => {});
});
