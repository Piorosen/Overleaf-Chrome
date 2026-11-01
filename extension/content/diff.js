// Overleaf AI — tiny word-level diff for previewing changes. No dependencies.
(function (root) {
  'use strict';

  // Words (any script), LaTeX control sequences, whitespace runs, single symbols.
  const TOKEN_RE = /\\[A-Za-z@]+\*?|[\p{L}\p{N}_]+|\s+|[^\s\p{L}\p{N}_]/gu;
  const MAX_CELLS = 4_000_000;

  function tokenize(s) {
    return String(s).match(TOKEN_RE) || [];
  }

  // LCS over token arrays → [{op, text}] (callers keep n*m bounded).
  function lcsDiff(a2, b2, push) {
    const n = a2.length;
    const m = b2.length;
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

  // Sentences/lines, keeping separators attached, for coarse alignment of long texts.
  function splitSentences(s) {
    return String(s).match(/[^\n.!?。]*(?:[.!?。]+["')\]]*\s*|\n+|$)/g).filter((x) => x.length);
  }

  // Returns [{op:'eq'|'del'|'ins', text}], adjacent ops merged.
  function diffWords(a, b) {
    const out = [];
    const push = (op, text) => {
      if (!text) return;
      const last = out[out.length - 1];
      if (last && last.op === op) last.text += text; else out.push({ op, text });
    };
    const A = tokenize(a);
    const B = tokenize(b);
    let pre = 0;
    while (pre < A.length && pre < B.length && A[pre] === B[pre]) pre++;
    let suf = 0;
    while (suf < A.length - pre && suf < B.length - pre && A[A.length - 1 - suf] === B[B.length - 1 - suf]) suf++;
    const a2 = A.slice(pre, A.length - suf);
    const b2 = B.slice(pre, B.length - suf);
    push('eq', A.slice(0, pre).join(''));
    if (a2.length * b2.length <= MAX_CELLS) {
      lcsDiff(a2, b2, push);
    } else {
      // Long texts: align sentences first, then diff words inside each changed stretch.
      const sa = splitSentences(a2.join(''));
      const sb = splitSentences(b2.join(''));
      if (sa.length * sb.length > MAX_CELLS) {
        push('del', a2.join(''));
        push('ins', b2.join(''));
      } else {
        const coarse = [];
        lcsDiff(sa, sb, (op, text) => coarse.push({ op, text }));
        let delBuf = '';
        let insBuf = '';
        const flush = () => {
          if (!delBuf && !insBuf) return;
          const da = tokenize(delBuf);
          const db = tokenize(insBuf);
          if (da.length * db.length <= MAX_CELLS) lcsDiff(da, db, push);
          else { push('del', delBuf); push('ins', insBuf); }
          delBuf = '';
          insBuf = '';
        };
        for (const c of coarse) {
          if (c.op === 'eq') { flush(); push('eq', c.text); } else if (c.op === 'del') delBuf += c.text; else insBuf += c.text;
        }
        flush();
      }
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

  // Group diff parts into hunks: unchanged text, or a change (del + ins) that can be accepted or rejected.
  // Whitespace-only equal runs between two changes are merged into the change so hunks stay readable.
  function toHunks(parts) {
    const hunks = [];
    for (let k = 0; k < parts.length; k++) {
      const p = parts[k];
      const last = hunks[hunks.length - 1];
      if (p.op === 'eq') {
        const next = parts[k + 1];
        if (last && last.type === 'chg' && /^\s+$/.test(p.text) && p.text.length <= 2 && next && next.op !== 'eq') {
          last.del += p.text;
          last.ins += p.text;
          continue;
        }
        hunks.push({ type: 'eq', text: p.text });
      } else {
        const h = last && last.type === 'chg' ? last : (hunks.push({ type: 'chg', del: '', ins: '', accepted: true }), hunks[hunks.length - 1]);
        if (p.op === 'del') h.del += p.text; else h.ins += p.text;
      }
    }
    return hunks;
  }

  function composeHunks(hunks) {
    return hunks.map((h) => (h.type === 'eq' ? h.text : (h.accepted ? h.ins : h.del))).join('');
  }

  function renderHunksHtml(hunks) {
    return hunks.map((h, i) => {
      if (h.type === 'eq') return escapeHtml(h.text);
      const del = h.del ? `<del>${escapeHtml(h.del)}</del>` : '';
      const ins = h.ins ? `<ins>${escapeHtml(h.ins)}</ins>` : '';
      return `<span class="chg${h.accepted ? '' : ' off'}" data-i="${i}" title="클릭: 이 변경 ${h.accepted ? '취소' : '다시 적용'}">${del}${ins}</span>`;
    }).join('');
  }

  const api = { tokenize, diffWords, renderDiffHtml, diffStats, escapeHtml, toHunks, composeHunks, renderHunksHtml };
  root.OLAI_DIFF = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
