// Overleaf AI — runs in the page's MAIN world on Overleaf project pages.
//
// Overleaf's source editor is CodeMirror 6. Its EditorView is only reachable from
// the page's own JS world (it hangs off DOM expando properties), so this script
// locates the view and performs read/edit operations on behalf of the isolated
// content script, which talks to it through window.postMessage.
//
// This script never contacts the AI backend; it only reads the document and
// applies edits the user has approved in the panel.
(() => {
  if (window.__olaiMainWorld) return;
  window.__olaiMainWorld = true;

  const IN = 'olai:cs->mw';
  const OUT = 'olai:mw->cs';

  let lastFocusedEditor = null;
  let cachedView = null;

  document.addEventListener('focusin', (e) => {
    const ed = e.target?.closest?.('.cm-editor');
    if (ed) lastFocusedEditor = ed;
  }, true);

  // ------------------------------------------------------- find EditorView ---

  function looksLikeView(o) {
    return !!o && typeof o === 'object'
      && typeof o.dispatch === 'function'
      && !!o.state && !!o.state.doc && typeof o.state.doc.sliceString === 'function'
      && o.dom instanceof Element;
  }

  // CodeMirror keeps a back-reference on .cm-content (currently `cmView.view`
  // or `cmView.rootView.view`). Probe generically so internal renames do not break us.
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
    const els = [editorEl.querySelector('.cm-content'), editorEl, editorEl.querySelector('.cm-scroller')].filter(Boolean);
    for (const el of els) {
      const direct = probe(el.cmView, 0);
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

  function editorCandidates() {
    const all = [...document.querySelectorAll('.cm-editor')].filter((ed) => ed.isConnected && ed.querySelector('.cm-content'));
    const editable = all.filter((ed) => ed.querySelector('.cm-content[contenteditable="true"]'));
    const list = editable.length ? editable : all;
    const area = (ed) => { const r = ed.getBoundingClientRect(); return r.width * r.height; };
    const active = document.activeElement?.closest?.('.cm-editor');
    return list.sort((a, b) => {
      const score = (ed) => (ed === active ? 4 : 0) + (ed === lastFocusedEditor ? 2 : 0);
      return score(b) - score(a) || area(b) - area(a);
    });
  }

  function getView() {
    const candidates = editorCandidates();
    if (cachedView && cachedView.dom?.isConnected && candidates[0] === cachedView.dom) return cachedView;
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

  function currentFileName() {
    const sel = document.querySelector('.file-tree [aria-selected="true"], [role="treeitem"][aria-selected="true"]');
    const name = (sel?.getAttribute('aria-label') || sel?.textContent || '').trim();
    return name.slice(0, 200);
  }

  function nearestIndexOf(hay, needle, pos) {
    if (!needle) return -1;
    let best = -1;
    let bestDist = Infinity;
    let i = hay.indexOf(needle);
    let guard = 0;
    while (i >= 0 && guard++ < 10000) {
      const d = Math.abs(i - pos);
      if (d < bestDist) { best = i; bestDist = d; }
      i = hay.indexOf(needle, i + 1);
    }
    return best;
  }

  // ----------------------------------------------------------- ghost text ---
  // Inline autocomplete preview drawn as an overlay at the cursor (no CodeMirror internals needed).
  // Tab accepts, ⌘/Ctrl+→ accepts the next word, Esc dismisses, typing a matching character keeps it.

  const EVT = 'olai:mw-event';
  const ghost = { text: '', pos: -1, len: -1, view: null, el: null, hint: null, card: null, bound: new WeakSet(), raf: 0 };

  function notify(type, detail = {}) {
    window.postMessage({ channel: EVT, type, ...detail }, location.origin);
  }

  function ensureGhostEls() {
    if (ghost.el && ghost.el.isConnected) return;
    const base = 'position:fixed;z-index:1000;pointer-events:none;margin:0;box-sizing:border-box;';
    ghost.el = Object.assign(document.createElement('div'), { className: 'olai-ghost' });
    ghost.el.style.cssText = `${base}white-space:pre;overflow:hidden;text-overflow:ellipsis;opacity:.5;`;
    ghost.hint = Object.assign(document.createElement('div'), { className: 'olai-ghost-hint' });
    ghost.hint.style.cssText = `${base}font:11px/16px -apple-system,BlinkMacSystemFont,sans-serif;padding:0 5px;border-radius:4px;background:rgba(9,136,66,.14);color:#0b6b35;white-space:nowrap;`;
    ghost.card = Object.assign(document.createElement('div'), { className: 'olai-ghost-card' });
    ghost.card.style.cssText = `${base}max-width:560px;padding:6px 9px;border-radius:7px;background:#fff;color:#1b222c;border:1px solid #d9dde2;box-shadow:0 6px 18px rgba(15,23,42,.18);white-space:pre-wrap;font:12.5px/1.5 ui-monospace,Menlo,monospace;`;
    document.body.append(ghost.el, ghost.hint, ghost.card);
  }

  function hideGhost(reason) {
    const had = !!ghost.text;
    ghost.text = '';
    ghost.pos = -1;
    for (const el of [ghost.el, ghost.hint, ghost.card]) if (el) el.style.display = 'none';
    if (had && reason) notify('ghost-hidden', { reason });
  }

  function renderGhost() {
    const v = ghost.view;
    if (!v || !ghost.text) return hideGhost();
    const c = v.coordsAtPos(ghost.pos);
    const scroller = v.scrollDOM.getBoundingClientRect();
    if (!c || c.top < scroller.top - 2 || c.bottom > scroller.bottom + 2) {
      for (const el of [ghost.el, ghost.hint, ghost.card]) el.style.display = 'none';
      return;
    }
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
  }

  function acceptGhost(part) {
    const v = ghost.view;
    if (!v || !ghost.text) return false;
    const sel = v.state.selection.main;
    if (sel.from !== sel.to || sel.head !== ghost.pos || v.state.doc.length !== ghost.len) { hideGhost('stale'); return false; }
    const text = part == null ? ghost.text : part;
    const rest = ghost.text.slice(text.length);
    v.dispatch({ changes: { from: ghost.pos, insert: text }, selection: { anchor: ghost.pos + text.length }, scrollIntoView: true, userEvent: 'input.complete' });
    if (rest) {
      ghost.text = rest;
      ghost.pos += text.length;
      ghost.len += text.length;
      renderGhost();
      notify('ghost-partial', { accepted: text.length });
    } else {
      hideGhost();
      notify('ghost-accepted', { chars: text.length });
    }
    return true;
  }

  function bindGhostEvents(v) {
    if (ghost.bound.has(v)) return;
    ghost.bound.add(v);
    v.dom.addEventListener('keydown', (e) => {
      if (!ghost.text) return;
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
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopImmediatePropagation();
        hideGhost('escape');
        return;
      }
      if (['Shift', 'Control', 'Alt', 'Meta', 'CapsLock'].includes(e.key)) return;
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && ghost.text.startsWith(e.key) && ghost.text.length > 1) {
        // Type-through: keep the rest of the suggestion after CodeMirror inserts the character.
        const rest = ghost.text.slice(1);
        const pos = ghost.pos + 1;
        const len = ghost.len + 1;
        requestAnimationFrame(() => {
          const s = v.state.selection.main;
          if (s.empty && s.head === pos && v.state.doc.length === len) { ghost.text = rest; ghost.pos = pos; ghost.len = len; renderGhost(); } else hideGhost('typing');
        });
        return;
      }
      hideGhost('typing');
    }, true);
    v.dom.addEventListener('mousedown', () => hideGhost('mouse'), true);
    v.scrollDOM.addEventListener('scroll', () => {
      if (!ghost.text || ghost.raf) return;
      ghost.raf = requestAnimationFrame(() => { ghost.raf = 0; renderGhost(); });
    }, { passive: true });
    v.contentDOM.addEventListener('blur', () => setTimeout(() => { if (!v.hasFocus) hideGhost('blur'); }, 150));
    window.addEventListener('resize', () => { if (ghost.text) renderGhost(); });
  }

  // -------------------------------------------------------------- commands ---

  function selectionInfo(v) {
    const r = v.state.selection.main;
    const line = v.state.doc.lineAt(r.head);
    return {
      from: r.from,
      to: r.to,
      head: r.head,
      lineFrom: line.from,
      lineTo: line.to,
      lineText: line.text,
      docLength: v.state.doc.length,
    };
  }

  const handlers = {
    status() {
      return { ready: !!getView() };
    },
    selectionInfo() {
      const v = requireView();
      const info = selectionInfo(v);
      // Short preview only; the full document is fetched by getContext when a run starts.
      info.selText = v.state.doc.sliceString(info.from, Math.min(info.to, info.from + 2000));
      return info;
    },
    getContext() {
      const v = requireView();
      return { ...selectionInfo(v), doc: v.state.doc.toString(), fileName: currentFileName() };
    },
    // Replace [from,to) (expected to still contain `expected`) with `text`, or insert
    // at `from` when `expected` is empty (`anchorBefore` re-locates the cursor if the
    // document changed meanwhile). position:'after' inserts right after the target.
    apply({ from, to, expected = '', text = '', anchorBefore = '', position = 'replace' }) {
      const v = requireView();
      const doc = v.state.doc;
      const len = doc.length;
      let f = from;
      let t = to;
      if (expected) {
        const intact = f >= 0 && t <= len && f <= t && doc.sliceString(f, t) === expected;
        if (!intact) {
          const idx = nearestIndexOf(doc.toString(), expected, from);
          if (idx < 0) throw new Error('TARGET_CHANGED');
          f = idx;
          t = idx + expected.length;
        }
        if (position === 'after') f = t;
      } else {
        const k = anchorBefore.length;
        const intact = f >= 0 && f <= len && (!k || (f - k >= 0 && doc.sliceString(f - k, f) === anchorBefore));
        if (!intact) {
          if (!k) throw new Error('TARGET_CHANGED');
          const idx = nearestIndexOf(doc.toString(), anchorBefore, from - k);
          if (idx < 0) throw new Error('TARGET_CHANGED');
          f = idx + k;
        }
        t = f;
      }
      v.dispatch({
        changes: { from: f, to: t, insert: text },
        selection: { anchor: f, head: f + text.length },
        scrollIntoView: true,
        userEvent: 'input',
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
    // Select whole lines (1-based, inclusive) and scroll them into view.
    selectLines({ line, end }) {
      const v = requireView();
      const doc = v.state.doc;
      const a = Math.max(1, Math.min(Number(line) || 1, doc.lines));
      const b = Math.max(a, Math.min(Number(end) || a, doc.lines));
      v.dispatch({ selection: { anchor: doc.line(a).from, head: doc.line(b).to }, scrollIntoView: true });
      v.focus();
      return true;
    },
    // Plain document text, for local checks while typing.
    getDoc() {
      const v = requireView();
      return { doc: v.state.doc.toString(), fileName: currentFileName() };
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
      const beginDoc = doc.sliceString(0, Math.min(doc.length, 200000)).indexOf('\\begin{document}');
      const hasClass = /\\documentclass/.test(doc.sliceString(0, Math.min(doc.length, 5000)));
      return {
        head: r.head,
        docLength: doc.length,
        hasSelection: !r.empty,
        focused: v.hasFocus,
        composing: !!v.composing,
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
      if (!text || !s.empty || s.head !== head || v.state.doc.length !== docLength || !v.hasFocus) { hideGhost(); return false; }
      ensureGhostEls();
      bindGhostEvents(v);
      ghost.view = v;
      ghost.text = text;
      ghost.pos = head;
      ghost.len = docLength;
      renderGhost();
      return true;
    },
    ghostHide() {
      hideGhost();
      return true;
    },
    ghostState() {
      return { visible: !!ghost.text, text: ghost.text, pos: ghost.pos };
    },
    // Apply many replacements as ONE transaction (one undo step). Each change carries the text it
    // expects to replace; if any no longer matches, nothing is applied.
    applyChanges({ changes }) {
      const v = requireView();
      const doc = v.state.doc;
      const list = (changes || []).slice().sort((a, b) => a.from - b.from);
      for (const c of list) {
        if (c.from < 0 || c.to > doc.length || doc.sliceString(c.from, c.to) !== c.expected) throw new Error('TARGET_CHANGED');
      }
      v.dispatch({ changes: list.map((c) => ({ from: c.from, to: c.to, insert: c.insert })), userEvent: 'input' });
      return { applied: list.length };
    },
    // Insert several snippets at given positions (e.g. preamble lines) as one transaction.
    insertAt({ edits, anchor }) {
      const v = requireView();
      const doc = v.state.doc;
      if (anchor && doc.sliceString(0, anchor.length) !== anchor) throw new Error('TARGET_CHANGED');
      const list = (edits || []).slice().sort((a, b) => a.pos - b.pos);
      if (list.some((e) => e.pos < 0 || e.pos > doc.length)) throw new Error('TARGET_CHANGED');
      v.dispatch({ changes: list.map((e) => ({ from: e.pos, insert: e.text })), userEvent: 'input' });
      return true;
    },
  };

  window.addEventListener('message', async (e) => {
    if (e.source !== window || !e.data || e.data.channel !== IN) return;
    const { id, cmd, args } = e.data;
    let resp;
    try {
      const h = Object.prototype.hasOwnProperty.call(handlers, cmd) ? handlers[cmd] : null;
      if (!h) throw new Error('UNKNOWN_CMD');
      resp = { ok: true, result: await h(args || {}) };
    } catch (err) {
      resp = { ok: false, error: String(err?.message || err) };
    }
    window.postMessage({ channel: OUT, id, ...resp }, location.origin);
  });
})();
