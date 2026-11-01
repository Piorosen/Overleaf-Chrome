// Overleaf AI — runs in the page's MAIN world on Overleaf project pages.
//
// Overleaf's source editor is CodeMirror 6. Its EditorView is only reachable from the page's own
// JS world, so this script locates the view and performs read/edit operations on behalf of the
// isolated content script. Communication uses a private detached DOM node handed over at
// document_start by bridge.js (see there), not window.postMessage.
//
// This script never contacts the AI backend; it only reads the document and applies edits the
// user has approved in the panel.
(() => {
  if (window.__olaiMainWorld) return;
  window.__olaiMainWorld = true;

  // ------------------------------------------------------ private channel ---

  let channel = null;
  function adopt(node) {
    if (channel || !node) return;
    channel = node;
    node.remove(); // detached: page scripts can no longer find it
    node.addEventListener('olai-req', onRequest);
    node.dispatchEvent(new CustomEvent('olai-main-ack'));
  }
  document.addEventListener('olai-bridge-offer', (e) => adopt(e.target), { capture: true, once: true });
  adopt(document.querySelector('olai-bridge'));

  function emit(type, detail = {}) {
    if (channel) channel.dispatchEvent(new CustomEvent('olai-evt', { detail: JSON.stringify({ type, ...detail }) }));
  }

  // ------------------------------------------- Overleaf hooks (read-only use) ---

  // Overleaf dispatches this on every file open; we only keep a reference to its CodeMirror bundle
  // (EditorView, isolateHistory …). We do not add extensions.
  let CM = null;
  window.addEventListener('UNSTABLE_editor:extensions', (e) => {
    try { if (e.detail && e.detail.CodeMirror) CM = e.detail.CodeMirror; } catch { /* ignore */ }
  });
  const store = () => { try { return window.overleaf && window.overleaf.unstable && window.overleaf.unstable.store; } catch { return null; } };
  const storeGet = (key) => { try { const s = store(); return s && typeof s.get === 'function' ? s.get(key) : undefined; } catch { return undefined; } };

  // Compile responses carry the URL of output.log; remember the latest so we can read the real log.
  let lastCompile = null;
  try {
    const origFetch = window.fetch;
    window.fetch = function olaiFetch(input, init) {
      const p = origFetch.apply(this, arguments);
      try {
        const url = typeof input === 'string' ? input : (input && input.url) || '';
        if (/\/project\/[^/]+\/compile(\?|$)/.test(url)) {
          p.then((res) => res.clone().json()).then((data) => {
            const log = (data && data.outputFiles || []).find((f) => f.path === 'output.log');
            if (log) lastCompile = { at: Date.now(), status: data.status, url: (data.pdfDownloadDomain && log.build ? data.pdfDownloadDomain : '') + log.url };
          }).catch(() => {});
        }
      } catch { /* never interfere with Overleaf */ }
      return p;
    };
  } catch { /* ignore */ }

  let lastFocusedEditor = null;
  let cachedView = null;
  let docRef = null;
  let docVersion = 0;

  document.addEventListener('focusin', (e) => {
    const ed = e.target && e.target.closest && e.target.closest('.cm-editor');
    if (ed) lastFocusedEditor = ed;
  }, true);

  // ------------------------------------------------------- find EditorView ---

  function looksLikeView(o) {
    return !!o && typeof o === 'object'
      && typeof o.dispatch === 'function'
      && !!o.state && !!o.state.doc && typeof o.state.doc.sliceString === 'function'
      && o.dom instanceof Element;
  }

  // CodeMirror keeps a back-reference on .cm-content (`cmView.rootView.view` before 6.39,
  // `cmTile.root.view` after). Probe generically so internal renames do not break us.
  function probe(o, depth) {
    if (!o || typeof o !== 'object') return null;
    if (looksLikeView(o)) return o;
    if (depth >= 3) return null;
    for (const k of ['view', 'rootView', 'root', 'editorView']) {
      let v;
      try { v = o[k]; } catch { continue; }
      const found = probe(v, depth + 1);
      if (found) return found;
    }
    return null;
  }

  function viewFromEditorEl(editorEl) {
    if (CM && CM.EditorView && typeof CM.EditorView.findFromDOM === 'function') {
      try { const v = CM.EditorView.findFromDOM(editorEl); if (looksLikeView(v)) return v; } catch { /* ignore */ }
    }
    const els = [editorEl.querySelector('.cm-content'), editorEl, editorEl.querySelector('.cm-scroller')].filter(Boolean);
    for (const el of els) {
      const direct = probe(el.cmView, 0) || probe(el.cmTile, 0);
      if (direct) return direct;
      for (const key of Object.keys(el)) {
        let v;
        try { v = el[key]; } catch { continue; }
        const found = probe(v, 0);
        if (found) return found;
      }
    }
    return null;
  }

  const visible = (el) => {
    try { if (typeof el.checkVisibility === 'function') return el.checkVisibility(); } catch { /* ignore */ }
    return !!(el.offsetParent || el.getClientRects().length);
  };

  function editorCandidates() {
    const all = [...document.querySelectorAll('.cm-editor')].filter((ed) => ed.isConnected && ed.querySelector('.cm-content') && visible(ed));
    const editable = all.filter((ed) => ed.querySelector('.cm-content[contenteditable="true"]'));
    const list = editable.length ? editable : all;
    const area = (ed) => { const r = ed.getBoundingClientRect(); return r.width * r.height; };
    const active = document.activeElement && document.activeElement.closest && document.activeElement.closest('.cm-editor');
    return list.sort((a, b) => {
      const score = (ed) => (ed === active ? 4 : 0) + (ed === lastFocusedEditor ? 2 : 0);
      return score(b) - score(a) || area(b) - area(a);
    });
  }

  function getView() {
    // 1) Overleaf's own store (the main source editor), 2) DOM.
    const fromStore = storeGet('editor.view');
    if (looksLikeView(fromStore) && fromStore.dom.isConnected && visible(fromStore.dom)) return (cachedView = fromStore);
    const candidates = editorCandidates();
    if (cachedView && cachedView.dom && cachedView.dom.isConnected && candidates[0] === cachedView.dom) return cachedView;
    for (const ed of candidates) {
      const v = viewFromEditorEl(ed);
      if (v) { cachedView = v; return v; }
    }
    cachedView = null;
    return null;
  }

  function requireView() {
    const v = getView();
    if (!v) throw new Error('EDITOR_NOT_FOUND');
    return v;
  }

  function requireWritable(v) {
    let ro = false;
    try { ro = !!v.state.readOnly; } catch { /* ignore */ }
    const ce = v.contentDOM && v.contentDOM.getAttribute('contenteditable');
    if (ro || ce === 'false') throw new Error('READ_ONLY');
  }

  function currentFileName() {
    const fromStore = storeGet('editor.open_doc_name');
    if (typeof fromStore === 'string' && fromStore) return fromStore.slice(0, 200);
    const tab = document.querySelector('[role="tab"][aria-selected="true"] .editor-file-tab-path');
    if (tab && tab.textContent.trim()) return tab.textContent.trim().slice(0, 200);
    const sel = document.querySelector('.file-tree li[role="treeitem"][aria-selected="true"], [role="treeitem"][aria-selected="true"]');
    const name = ((sel && (sel.getAttribute('aria-label') || sel.textContent)) || '').trim();
    return name.slice(0, 200);
  }

  function currentDocId() {
    const id = storeGet('editor.open_doc_id');
    return typeof id === 'string' ? id : '';
  }

  function isolate() {
    try { return CM && CM.isolateHistory ? [CM.isolateHistory.of('full')] : []; } catch { return []; }
  }

  function preambleEnd(doc) {
    const m = /^[^%\n]*\\begin\{document\}/m.exec(doc);
    return m ? m.index : -1;
  }

  // ----------------------------------------------------------- ghost text ---
  // Inline autocomplete preview drawn as an overlay at the cursor. Tab accepts, ⌘/Ctrl+→ accepts
  // the next word, Esc dismisses (and still reaches Overleaf), typing a matching character keeps it.

  const ghost = { text: '', pos: -1, len: -1, view: null, el: null, hint: null, card: null, shown: false, bound: new WeakSet(), raf: 0 };

  function ensureGhostEls() {
    if (ghost.el && ghost.el.isConnected) return;
    const base = 'position:fixed;z-index:450;pointer-events:none;margin:0;box-sizing:border-box;';
    ghost.el = Object.assign(document.createElement('div'), { className: 'olai-ghost' });
    ghost.el.style.cssText = `${base}white-space:pre;overflow:hidden;text-overflow:ellipsis;opacity:.5;`;
    ghost.hint = Object.assign(document.createElement('div'), { className: 'olai-ghost-hint' });
    ghost.hint.style.cssText = `${base}font:11px/16px -apple-system,BlinkMacSystemFont,sans-serif;padding:0 5px;border-radius:4px;background:rgba(9,136,66,.14);color:#0b6b35;white-space:nowrap;`;
    ghost.card = Object.assign(document.createElement('div'), { className: 'olai-ghost-card' });
    ghost.card.style.cssText = `${base}max-width:560px;padding:6px 9px;border-radius:7px;background:#fff;color:#1b222c;border:1px solid #d9dde2;box-shadow:0 6px 18px rgba(15,23,42,.18);white-space:pre-wrap;font:12.5px/1.5 ui-monospace,Menlo,monospace;`;
    document.body.append(ghost.el, ghost.hint, ghost.card);
  }

  function hideEls() {
    ghost.shown = false;
    for (const el of [ghost.el, ghost.hint, ghost.card]) if (el) el.style.display = 'none';
  }

  function hideGhost(reason) {
    const had = !!ghost.text;
    ghost.text = '';
    ghost.pos = -1;
    hideEls();
    if (had && reason) emit('ghost-hidden', { reason });
  }

  const overleafPopupOpen = () => !!document.querySelector('.cm-tooltip-autocomplete, .cm-tooltip.cm-completionInfo');

  function ghostStale(v) {
    try {
      const s = v.state.selection.main;
      return !s.empty || s.head !== ghost.pos || v.state.doc.length !== ghost.len;
    } catch { return true; }
  }

  function renderGhost() {
    const v = ghost.view;
    if (!v || !ghost.text) return hideGhost();
    if (ghostStale(v) || overleafPopupOpen()) return hideGhost('stale');
    let c = null;
    try { c = v.coordsAtPos(ghost.pos); } catch { c = null; }
    const scroller = v.scrollDOM.getBoundingClientRect();
    if (!c || c.top < scroller.top - 2 || c.bottom > scroller.bottom + 2) { hideEls(); return; }
    const content = v.contentDOM.getBoundingClientRect();
    let lineEl = v.domAtPos(ghost.pos).node;
    if (lineEl.nodeType !== 1) lineEl = lineEl.parentElement;
    const cs = getComputedStyle(lineEl.closest('.cm-line') || v.contentDOM);
    const dark = (() => { const m = /(\d+),\s*(\d+),\s*(\d+)/.exec(getComputedStyle(v.dom).color); return m && (Number(m[1]) + Number(m[2]) + Number(m[3])) / 3 > 140; })();
    const right = Math.min(content.right, scroller.right) - 8;
    const width = Math.max(40, right - c.left);
    Object.assign(ghost.el.style, {
      display: 'block', left: `${c.left}px`, top: `${c.top}px`, height: `${c.bottom - c.top}px`, maxWidth: `${width}px`,
      font: cs.font, letterSpacing: cs.letterSpacing, lineHeight: `${c.bottom - c.top}px`, color: dark ? '#c9d1d9' : '#5f6b7a',
    });
    ghost.el.textContent = ghost.text;
    const truncated = ghost.el.scrollWidth > ghost.el.clientWidth + 1;
    const keyHint = `Tab 수락 · ${/Mac/.test(navigator.platform) ? '⌘' : 'Ctrl'}→ 단어 · Esc`;
    if (truncated) {
      ghost.hint.style.display = 'none';
      ghost.card.style.display = 'block';
      ghost.card.textContent = `${ghost.text.trim()}\n— ${keyHint}`;
      ghost.card.style.left = `${Math.max(content.left, Math.min(c.left, right - 360))}px`;
      ghost.card.style.top = `${c.bottom + 4}px`;
      ghost.card.style.background = dark ? '#1d232b' : '#fff';
      ghost.card.style.color = dark ? '#e6e9ee' : '#1b222c';
    } else {
      ghost.card.style.display = 'none';
      const end = c.left + ghost.el.getBoundingClientRect().width + 6;
      Object.assign(ghost.hint.style, { display: end + 120 < right + 140 ? 'block' : 'none', left: `${end}px`, top: `${c.top + Math.max(0, (c.bottom - c.top - 16) / 2)}px` });
      ghost.hint.textContent = keyHint;
    }
    ghost.shown = true;
  }

  function acceptGhost(part) {
    const v = ghost.view;
    if (!v || !ghost.text || !ghost.shown) return false;
    if (ghostStale(v)) { hideGhost('stale'); return false; }
    try { requireWritable(v); } catch { hideGhost('read-only'); return false; }
    const text = part == null ? ghost.text : part;
    const rest = ghost.text.slice(text.length);
    v.dispatch({ changes: { from: ghost.pos, insert: text }, selection: { anchor: ghost.pos + text.length }, scrollIntoView: true, userEvent: 'input.complete', annotations: isolate() });
    if (rest) {
      ghost.text = rest;
      ghost.pos += text.length;
      ghost.len += text.length;
      renderGhost();
      emit('ghost-partial', { accepted: text.length });
    } else {
      hideGhost();
      emit('ghost-accepted', { chars: text.length });
    }
    return true;
  }

  function bindGhostEvents(v) {
    if (ghost.bound.has(v)) return;
    ghost.bound.add(v);
    v.dom.addEventListener('keydown', (e) => {
      if (!ghost.text) return;
      // Only an actually visible, current suggestion may take keys; Overleaf's own popup wins.
      if (!ghost.shown || ghostStale(v) || overleafPopupOpen()) { hideGhost('stale'); return; }
      if (e.isComposing || e.keyCode === 229) { hideGhost('typing'); return; }
      const plainTab = e.key === 'Tab' && !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey;
      if (plainTab) {
        if (acceptGhost()) { e.preventDefault(); e.stopImmediatePropagation(); }
        return;
      }
      if (e.key === 'ArrowRight' && (e.metaKey || e.ctrlKey) && !e.shiftKey) {
        const word = /^\s*[^\s]+/.exec(ghost.text);
        if (word && acceptGhost(word[0])) { e.preventDefault(); e.stopImmediatePropagation(); }
        return;
      }
      if (e.key === 'Escape') { hideGhost('escape'); return; } // let Overleaf/vim also see Esc
      if (['Shift', 'Control', 'Alt', 'Meta', 'CapsLock'].includes(e.key)) return;
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && ghost.text.startsWith(e.key) && ghost.text.length > 1) {
        // Type-through: keep the rest of the suggestion after CodeMirror inserts the character.
        const rest = ghost.text.slice(1);
        const pos = ghost.pos + 1;
        const len = ghost.len + 1;
        requestAnimationFrame(() => {
          try {
            const s = v.state.selection.main;
            if (s.empty && s.head === pos && v.state.doc.length === len) { ghost.text = rest; ghost.pos = pos; ghost.len = len; renderGhost(); } else hideGhost('typing');
          } catch { hideGhost('typing'); }
        });
        return;
      }
      hideGhost('typing');
    }, true);
    v.dom.addEventListener('mousedown', () => hideGhost('mouse'), true);
    v.scrollDOM.addEventListener('scroll', () => {
      if (!ghost.text || ghost.raf) return;
      ghost.raf = requestAnimationFrame(() => { ghost.raf = 0; try { renderGhost(); } catch { hideGhost(); } });
    }, { passive: true });
    v.contentDOM.addEventListener('blur', () => setTimeout(() => { if (!v.hasFocus) hideGhost('blur'); }, 150));
    window.addEventListener('resize', () => { if (ghost.text) { try { renderGhost(); } catch { hideGhost(); } } });
  }
  // Switching files keeps the same view but changes the document.
  window.addEventListener('doc:after-opened', () => { hideGhost('file-changed'); cachedView = null; });

  // -------------------------------------------------------------- helpers ---

  function selectionInfo(v) {
    const r = v.state.selection.main;
    const line = v.state.doc.lineAt(r.head);
    let readOnly = false;
    try { readOnly = !!v.state.readOnly || v.contentDOM.getAttribute('contenteditable') === 'false'; } catch { /* ignore */ }
    return {
      from: r.from,
      to: r.to,
      head: r.head,
      lineFrom: line.from,
      lineTo: line.to,
      lineText: line.text,
      docLength: v.state.doc.length,
      readOnly,
    };
  }

  // All occurrences of `needle`; pick the one whose surrounding text matches the saved context best.
  function relocate(full, needle, ctxBefore, ctxAfter, hint) {
    const hits = [];
    let i = full.indexOf(needle);
    let guard = 0;
    while (i >= 0 && guard++ < 20000) { hits.push(i); i = full.indexOf(needle, i + 1); }
    if (!hits.length) return -1;
    const commonSuffix = (a, b) => { let k = 0; while (k < a.length && k < b.length && a[a.length - 1 - k] === b[b.length - 1 - k]) k++; return k; };
    const commonPrefix = (a, b) => { let k = 0; while (k < a.length && k < b.length && a[k] === b[k]) k++; return k; };
    const scored = hits.map((at) => ({
      at,
      score: commonSuffix(full.slice(Math.max(0, at - ctxBefore.length), at), ctxBefore)
        + commonPrefix(full.slice(at + needle.length, at + needle.length + ctxAfter.length), ctxAfter),
    })).sort((a, b) => b.score - a.score || Math.abs(a.at - hint) - Math.abs(b.at - hint));
    const best = scored[0];
    const needed = Math.min(24, ctxBefore.length + ctxAfter.length);
    if (scored.length > 1 && scored[1].score === best.score) return -1; // ambiguous
    if (best.score < needed && hits.length > 1) return -1;              // context lost and not unique
    return best.at;
  }

  // ------------------------------------------------------------- commands ---

  const handlers = {
    status() {
      return { ready: !!getView(), cm: !!CM, store: !!store() };
    },
    selectionInfo() {
      const v = requireView();
      const info = selectionInfo(v);
      info.selText = v.state.doc.sliceString(info.from, Math.min(info.to, info.from + 2000));
      info.fileName = currentFileName();
      return info;
    },
    getContext() {
      const v = requireView();
      return { ...selectionInfo(v), doc: v.state.doc.toString(), fileName: currentFileName(), docId: currentDocId() };
    },
    // Plain document text for local checks. Returns {unchanged:true} when the doc did not change.
    getDoc({ knownVersion } = {}) {
      const v = requireView();
      if (v.state.doc !== docRef) { docRef = v.state.doc; docVersion += 1; }
      const base = { version: docVersion, fileName: currentFileName(), docId: currentDocId() };
      if (knownVersion === docVersion) return { ...base, unchanged: true };
      return { ...base, doc: v.state.doc.toString() };
    },
    /**
     * Replace [from,to) — which should still contain `expected` — with `text`, or insert at `from`
     * when `expected` is empty. ctxBefore/ctxAfter (text around the target when the run started)
     * re-locate the target if the document changed; ambiguous or lost targets are refused.
     * fileName (when given) must match the open file. position:'after' inserts right after the target.
     */
    apply({ from, to, expected = '', text = '', ctxBefore = '', ctxAfter = '', anchorBefore, position = 'replace', fileName = '' }) {
      const v = requireView();
      requireWritable(v);
      if (fileName && currentFileName() && fileName !== currentFileName()) throw new Error('WRONG_FILE');
      const doc = v.state.doc;
      const len = doc.length;
      const before = ctxBefore || anchorBefore || '';
      let f = from;
      let t = to;
      const intactAt = (a, b) => a >= 0 && b <= len && a <= b && doc.sliceString(a, b) === expected
        && (!before || doc.sliceString(Math.max(0, a - before.length), a) === before.slice(Math.max(0, before.length - a)));
      if (expected) {
        if (!intactAt(f, t)) {
          const idx = relocate(doc.toString(), expected, before, ctxAfter, from);
          if (idx < 0) throw new Error('TARGET_CHANGED');
          f = idx;
          t = idx + expected.length;
        }
        if (position === 'after') f = t;
      } else {
        const ok = f >= 0 && f <= len
          && (!before || doc.sliceString(Math.max(0, f - before.length), f) === before.slice(Math.max(0, before.length - f)))
          && (!ctxAfter || doc.sliceString(f, Math.min(len, f + ctxAfter.length)) === ctxAfter.slice(0, len - f));
        if (!ok) {
          if (!before && !ctxAfter) throw new Error('TARGET_CHANGED');
          const full = doc.toString();
          const probeText = before + ctxAfter;
          const idx = probeText ? relocate(full, probeText, '', '', from - before.length) : -1;
          if (idx < 0) throw new Error('TARGET_CHANGED');
          f = idx + before.length;
        }
        t = f;
      }
      v.dispatch({
        changes: { from: f, to: t, insert: text },
        selection: { anchor: f, head: f + text.length },
        scrollIntoView: true,
        userEvent: 'input',
        annotations: isolate(),
      });
      v.focus();
      return { from: f, to: f + text.length };
    },
    select({ from, to }) {
      const v = requireView();
      const len = v.state.doc.length;
      const a = Math.max(0, Math.min(from, len));
      const b = Math.max(0, Math.min(to, len));
      v.dispatch({ selection: { anchor: a, head: b }, scrollIntoView: true });
      v.focus();
      return true;
    },
    // Select whole lines (1-based, inclusive). When `text` (the line as it was when the link was made)
    // is given and that line moved, jump to the nearest line with the same text instead.
    selectLines({ line, end, text }) {
      const v = requireView();
      const doc = v.state.doc;
      let a = Math.max(1, Math.min(Number(line) || 1, doc.lines));
      let moved = false;
      if (typeof text === 'string' && text.trim() && doc.line(a).text !== text) {
        for (let d = 1; d <= 400; d++) {
          if (a - d >= 1 && doc.line(a - d).text === text) { a -= d; moved = true; break; }
          if (a + d <= doc.lines && doc.line(a + d).text === text) { a += d; moved = true; break; }
        }
      }
      const span = Math.max(0, (Number(end) || Number(line) || 1) - (Number(line) || 1));
      const b = Math.min(doc.lines, a + span);
      v.dispatch({ selection: { anchor: doc.line(a).from, head: doc.line(b).to }, scrollIntoView: true });
      v.focus();
      return { line: a, moved };
    },
    focus() {
      requireView().focus();
      return true;
    },
    // Text around the cursor for autocomplete, plus whether completing makes sense right now.
    completionContext() {
      const v = requireView();
      const r = v.state.selection.main;
      const doc = v.state.doc;
      const line = doc.lineAt(r.head);
      const before = doc.sliceString(Math.max(0, r.head - 3500), r.head);
      const head = doc.sliceString(0, Math.min(doc.length, 200000));
      const beginDoc = preambleEnd(head);
      const hasClass = /^[^%\n]*\\documentclass/m.test(head.slice(0, 5000));
      let readOnly = false;
      try { readOnly = !!v.state.readOnly || v.contentDOM.getAttribute('contenteditable') === 'false'; } catch { /* ignore */ }
      return {
        head: r.head,
        docLength: doc.length,
        hasSelection: !r.empty,
        focused: v.hasFocus,
        composing: !!v.composing,
        readOnly,
        inPreamble: hasClass && (beginDoc < 0 || r.head < beginDoc),
        before,
        after: doc.sliceString(r.head, Math.min(doc.length, r.head + 600)),
        lineBefore: doc.sliceString(line.from, r.head),
        lineAfter: doc.sliceString(r.head, line.to),
        fileName: currentFileName(),
      };
    },
    // Show / update the ghost suggestion; refuses if the cursor or document moved meanwhile.
    ghostShow({ text, head, docLength }) {
      const v = requireView();
      const s = v.state.selection.main;
      if (!text || !s.empty || s.head !== head || v.state.doc.length !== docLength || !v.hasFocus || overleafPopupOpen()) { hideGhost(); return false; }
      ensureGhostEls();
      bindGhostEvents(v);
      ghost.view = v;
      ghost.text = text;
      ghost.pos = head;
      ghost.len = docLength;
      renderGhost();
      return ghost.shown;
    },
    ghostHide() {
      hideGhost();
      return true;
    },
    ghostState() {
      return { visible: ghost.shown, text: ghost.text, pos: ghost.pos };
    },
    // Apply many replacements as ONE transaction (one undo step). Each change carries the text it
    // expects to replace; if any no longer matches, nothing is applied.
    applyChanges({ changes, fileName = '' }) {
      const v = requireView();
      requireWritable(v);
      if (fileName && currentFileName() && fileName !== currentFileName()) throw new Error('WRONG_FILE');
      const doc = v.state.doc;
      const list = (changes || []).slice().sort((a, b) => a.from - b.from);
      for (const c of list) {
        if (c.from < 0 || c.to > doc.length || doc.sliceString(c.from, c.to) !== c.expected) throw new Error('TARGET_CHANGED');
      }
      v.dispatch({ changes: list.map((c) => ({ from: c.from, to: c.to, insert: c.insert })), userEvent: 'input', annotations: isolate() });
      return { applied: list.length };
    },
    // Insert several snippets at given positions (e.g. preamble lines) as one transaction.
    insertAt({ edits, anchor, fileName = '' }) {
      const v = requireView();
      requireWritable(v);
      if (fileName && currentFileName() && fileName !== currentFileName()) throw new Error('WRONG_FILE');
      const doc = v.state.doc;
      if (anchor && doc.sliceString(0, anchor.length) !== anchor) throw new Error('TARGET_CHANGED');
      const list = (edits || []).slice().sort((a, b) => a.pos - b.pos);
      if (list.some((e) => e.pos < 0 || e.pos > doc.length)) throw new Error('TARGET_CHANGED');
      v.dispatch({ changes: list.map((e) => ({ from: e.pos, insert: e.text })), userEvent: 'input', annotations: isolate() });
      return true;
    },
    // The real compile log (captured from Overleaf's compile response), or null.
    async compileLog() {
      if (!lastCompile) return null;
      try {
        const res = await fetch(lastCompile.url, { credentials: 'include' });
        if (!res.ok) return null;
        const text = await res.text();
        return { at: lastCompile.at, status: lastCompile.status, text: text.slice(-400000) };
      } catch { return null; }
    },
    // Open a file from the file tree (best effort) — used to switch to refs.bib for BibTeX edits.
    openFile({ name }) {
      const items = [...document.querySelectorAll('li[role="treeitem"]')];
      const it = items.find((li) => (li.getAttribute('aria-label') || '').trim() === name);
      if (!it) return false;
      const target = it.querySelector('.entity, .item-name-button, button, [data-file-id]') || it;
      target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
      return true;
    },
    // Doc ids of project files visible in the file tree (for reading other files).
    listDocs() {
      const out = [];
      for (const el of document.querySelectorAll('[data-file-id][data-file-type]')) {
        const li = el.closest('li[role="treeitem"]');
        out.push({ id: el.getAttribute('data-file-id'), type: el.getAttribute('data-file-type'), name: ((li && li.getAttribute('aria-label')) || el.textContent || '').trim() });
      }
      return out;
    },
  };

  async function onRequest(e) {
    let req;
    try { req = JSON.parse(e.detail); } catch { return; }
    const { id, cmd, args } = req || {};
    let resp;
    try {
      const h = Object.prototype.hasOwnProperty.call(handlers, cmd) ? handlers[cmd] : null;
      if (!h) throw new Error('UNKNOWN_CMD');
      resp = { id, ok: true, result: await h(args || {}) };
    } catch (err) {
      resp = { id, ok: false, error: String((err && err.message) || err) };
    }
    channel.dispatchEvent(new CustomEvent('olai-res', { detail: JSON.stringify(resp) }));
  }
})();
