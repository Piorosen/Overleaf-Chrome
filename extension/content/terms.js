// Overleaf AI — terminology unification (용어 통일). Pure functions, no AI.
// Sources of term groups:
//   glossary – the paper profile's "preferred | variant, variant" lines (and AI suggestions saved there)
//   hyphen   – the same word written hyphenated / closed / open (pre-training, pretraining, pre training)
//   usuk     – -ise vs -ize families (optimise / optimize)
(function (root) {
  'use strict';

  const L = root.OLAI_LINT || (typeof require !== 'undefined' ? require('./lint.js') : null);

  function escapeRe(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  // "preferred | variant1, variant2" per line.
  function parseGlossary(text) {
    const out = [];
    for (const line of String(text || '').split('\n')) {
      const at = line.indexOf('|');
      if (at < 0) continue;
      const preferred = line.slice(0, at).trim();
      const variants = line.slice(at + 1).split(',').map((s) => s.trim()).filter((v) => v && v.toLowerCase() !== preferred.toLowerCase());
      if (preferred && variants.length) out.push({ preferred, variants });
    }
    return out;
  }

  function mergeGlossary(existing, addition) {
    const have = parseGlossary(existing);
    const keyOf = (p) => p.toLowerCase();
    const map = new Map(have.map((g) => [keyOf(g.preferred), g]));
    for (const g of parseGlossary(addition)) {
      const cur = map.get(keyOf(g.preferred));
      if (cur) for (const v of g.variants) { if (!cur.variants.some((x) => x.toLowerCase() === v.toLowerCase())) cur.variants.push(v); }
      else map.set(keyOf(g.preferred), { preferred: g.preferred, variants: [...g.variants] });
    }
    return [...map.values()].map((g) => `${g.preferred} | ${g.variants.join(', ')}`).join('\n');
  }

  // Prose-only view with identical offsets (comments, math, verbatim, ref/cite/label args blanked).
  function proseView(doc) {
    return L ? L.maskForProse(L.maskComments(doc)) : doc;
  }

  // Regex for a term: words separated by flexible whitespace, not glued to other word chars.
  function termRegex(term) {
    const body = term.trim().split(/\s+/).map(escapeRe).join('\\s+');
    return new RegExp(`(?<![\\p{L}\\p{N}_-])${body}(?![\\p{L}\\p{N}_]|-[\\p{L}])`, 'giu');
  }

  function findAll(prose, term) {
    const re = termRegex(term);
    const out = [];
    let m;
    while ((m = re.exec(prose))) out.push({ from: m.index, to: m.index + m[0].length });
    return out;
  }

  // Keep the occurrence's capitalization style when replacing.
  function matchCase(replacement, original) {
    if (/[A-Z]/.test(replacement.slice(1)) || /[^\x00-\x7F]/.test(replacement)) {
      // Preferred form has its own casing (e.g., "ImageNet", "BERT"): only capitalize the first letter if needed.
      return /^[A-Z]/.test(original) && /^[a-z]/.test(replacement) ? replacement[0].toUpperCase() + replacement.slice(1) : replacement;
    }
    if (original.length > 1 && original === original.toUpperCase() && /[A-Z]/.test(original)) return replacement.toUpperCase();
    if (/^[A-Z]/.test(original)) return replacement[0].toUpperCase() + replacement.slice(1);
    return replacement;
  }

  function lineOf(starts, pos) {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= pos) lo = mid; else hi = mid - 1;
    }
    return lo + 1;
  }

  /**
   * Build term groups for the document.
   * Returns [{ id, source, preferred, forms: [{ text, count, occurrences: [{from,to,text,line}] }] }]
   * Only groups where at least one non-preferred form actually occurs are returned.
   */
  function analyzeTerms(doc, glossaryText) {
    const prose = proseView(doc);
    const lower = prose.toLowerCase();
    const starts = [0];
    for (let i = 0; i < doc.length; i++) if (doc[i] === '\n') starts.push(i + 1);
    const occ = (term) => findAll(prose, term).map((o) => ({ ...o, text: doc.slice(o.from, o.to), line: lineOf(starts, o.from) }));
    const groups = [];
    const claimed = new Set(); // lowercased forms already in a group

    for (const g of parseGlossary(glossaryText)) {
      const forms = [g.preferred, ...g.variants].map((t) => ({ text: t, occurrences: occ(t) }));
      for (const f of forms) f.count = f.occurrences.length;
      forms.forEach((f) => claimed.add(f.text.toLowerCase()));
      if (forms.slice(1).some((f) => f.count)) groups.push({ id: `g:${g.preferred.toLowerCase()}`, source: 'glossary', preferred: g.preferred, forms, confidence: 'high' });
    }

    // hyphenated vs closed vs open forms
    const seenWords = new Set();
    const re = /[a-z]+(?:-[a-z]+)+/g;
    let m;
    while ((m = re.exec(lower))) {
      const w = m[0];
      if (seenWords.has(w)) continue;
      seenWords.add(w);
      const variants = [w, w.replace(/-/g, ''), w.replace(/-/g, ' ')];
      if (variants.some((v) => claimed.has(v))) continue;
      const forms = variants.map((t) => ({ text: t, occurrences: occ(t) })).filter((f) => f.occurrences.length);
      for (const f of forms) f.count = f.occurrences.length;
      if (forms.length >= 2) {
        forms.sort((a, b) => b.count - a.count);
        forms.forEach((f) => claimed.add(f.text));
        // Hyphenated vs spaced only ("sparse-attention layer" / "sparse attention") is often correct
        // English (compound modifier before a noun), so it is offered but not pre-selected.
        const hasClosed = forms.some((f) => !/[-\s]/.test(f.text));
        groups.push({ id: `h:${w}`, source: 'hyphen', preferred: forms[0].text, forms, confidence: hasClosed ? 'high' : 'low' });
      }
    }

    // -ise / -ize families
    const isRe = /\b([a-z]{3,})is(e|ed|es|ing|ation|ations|er|ers)\b/g;
    const seenIs = new Set();
    while ((m = isRe.exec(lower))) {
      const uk = m[0];
      const us = `${m[1]}iz${m[2]}`;
      if (seenIs.has(uk) || claimed.has(uk) || claimed.has(us)) continue;
      seenIs.add(uk);
      const forms = [us, uk].map((t) => ({ text: t, occurrences: occ(t) })).filter((f) => f.occurrences.length);
      for (const f of forms) f.count = f.occurrences.length;
      if (forms.length === 2) {
        forms.sort((a, b) => b.count - a.count);
        forms.forEach((f) => claimed.add(f.text));
        groups.push({ id: `s:${us}`, source: 'usuk', preferred: forms[0].text, forms, confidence: 'high' });
      }
    }
    return groups;
  }

  /**
   * Replacement plan for the chosen groups.
   * choices: Map(groupId -> preferred text) (groups not in the map are skipped).
   * Returns [{ from, to, expected, insert }] sorted, non-overlapping.
   */
  function planChanges(groups, choices) {
    const changes = [];
    for (const g of groups) {
      if (!choices.has(g.id)) continue;
      const preferred = choices.get(g.id);
      for (const f of g.forms) {
        if (f.text.toLowerCase() === preferred.toLowerCase()) continue;
        for (const o of f.occurrences) {
          const insert = matchCase(preferred, o.text);
          if (insert !== o.text) changes.push({ from: o.from, to: o.to, expected: o.text, insert });
        }
      }
    }
    changes.sort((a, b) => a.from - b.from);
    const out = [];
    let end = -1;
    for (const c of changes) { if (c.from >= end) { out.push(c); end = c.to; } }
    return out;
  }

  const api = { parseGlossary, mergeGlossary, analyzeTerms, planChanges, matchCase, termRegex };
  root.OLAI_TERMS = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
