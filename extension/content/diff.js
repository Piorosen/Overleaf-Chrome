// Overleaf AI — tiny word-level diff for previewing changes. No dependencies.
(function (root) {
  'use strict';

  // Words (any script), LaTeX control sequences, whitespace runs, single symbols.
  const TOKEN_RE = /\\[A-Za-z@]+\*?|[\p{L}\p{N}_]+|\s+|[^\s\p{L}\p{N}_]/gu;
  const MAX_CELLS = 4_000_000;

  function tokenize(s) {
    return String(s).match(TOKEN_RE) || [];
  }

  // Returns [{op:'eq'|'del'|'ins', text}], adjacent ops merged.
  function diffWords(a, b) {
    const A = tokenize(a);
    const B = tokenize(b);
    let pre = 0;
    while (pre < A.length && pre < B.length && A[pre] === B[pre]) pre++;
    let suf = 0;
    while (suf < A.length - pre && suf < B.length - pre && A[A.length - 1 - suf] === B[B.length - 1 - suf]) suf++;
    const a2 = A.slice(pre, A.length - suf);
    const b2 = B.slice(pre, B.length - suf);
    const out = [];
    const push = (op, text) => {
      if (!text) return;
      const last = out[out.length - 1];
      if (last && last.op === op) last.text += text; else out.push({ op, text });
    };
    push('eq', A.slice(0, pre).join(''));

    const n = a2.length;
    const m = b2.length;
    if (n * m > MAX_CELLS) {
      push('del', a2.join(''));
      push('ins', b2.join(''));
    } else {
      // LCS lengths, row-major (n+1) x (m+1)
      const w = m + 1;
      const L = new Uint32Array((n + 1) * w);
      for (let i = n - 1; i >= 0; i--) {
        for (let j = m - 1; j >= 0; j--) {
          L[i * w + j] = a2[i] === b2[j] ? L[(i + 1) * w + j + 1] + 1 : Math.max(L[(i + 1) * w + j], L[i * w + j + 1]);
        }
      }
      let i = 0;
      let j = 0;
      while (i < n && j < m) {
        if (a2[i] === b2[j]) { push('eq', a2[i]); i++; j++; }
        else if (L[(i + 1) * w + j] >= L[i * w + j + 1]) { push('del', a2[i]); i++; }
        else { push('ins', b2[j]); j++; }
      }
      while (i < n) push('del', a2[i++]);
      while (j < m) push('ins', b2[j++]);
    }
    push('eq', A.slice(A.length - suf).join(''));
    return out;
  }

  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function renderDiffHtml(parts) {
    return parts.map(({ op, text }) => {
      const t = escapeHtml(text);
      if (op === 'del') return `<del>${t}</del>`;
      if (op === 'ins') return `<ins>${t}</ins>`;
      return t;
    }).join('');
  }

  function diffStats(parts) {
    let ins = 0;
    let del = 0;
    for (const p of parts) {
      if (p.op === 'ins') ins += p.text.length;
      else if (p.op === 'del') del += p.text.length;
    }
    return { ins, del };
  }

  const api = { tokenize, diffWords, renderDiffHtml, diffStats, escapeHtml };
  root.OLAI_DIFF = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
