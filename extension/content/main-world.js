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
    focus() {
      requireView().focus();
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
