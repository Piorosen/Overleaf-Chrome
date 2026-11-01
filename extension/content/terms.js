// Overleaf AI — terminology unification (용어 통일). Pure functions, no AI.
// Sources of term groups:
//   glossary – the paper profile's "preferred | variant, variant" lines (and AI suggestions saved there)
//   hyphen   – the same word written hyphenated / closed / open (pre-training, pretraining, pre training)
//   usuk     – -ise vs -ize families (optimise / optimize)
// Only prose is touched: comments, code, math, drawings, macro definitions, and key-like command
// arguments (\cite, \ref, \label, \gls, \texttt, \url, paths …) are masked first, and a match never
// starts right after a backslash (so \node, \item, \draw are never rewritten).
(function (root) {
  'use strict';

  const L = root.OLAI_LINT || (typeof require !== 'undefined' ? require('./lint.js') : null);

  function escapeRe(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  // "preferred | variant1, variant2" per line. Case-only variants (LaTeX | Latex) are kept.
  function parseGlossary(text) {
    const out = [];
    for (const line of String(text || '').split('\n')) {
      const at = line.indexOf('|');
      if (at < 0) continue;
      const preferred = line.slice(0, at).trim();
      const variants = line.slice(at + 1).split(',').map((s) => s.trim()).filter((v) => v && v !== preferred);
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
      if (cur) for (const v of g.variants) { if (!cur.variants.includes(v)) cur.variants.push(v); }
      else map.set(keyOf(g.preferred), { preferred: g.preferred, variants: [...g.variants] });
    }
    return [...map.values()].map((g) => `${g.preferred} | ${g.variants.join(', ')}`).join('\n');
  }

  // Prose-only view with identical offsets.
  function proseView(doc) {
    return L ? L.maskForProse(L.maskComments(doc)) : doc;
  }

  const HANGUL_END = /[가-힣]$/;
  // Korean particles / copula endings that may follow a term without a space.
  const KO_PARTICLES = '(?:은|는|이|가|을|를|의|에|에서|에게|께|으로|로|와|과|도|만|까지|부터|보다|처럼|이나|나|이라|라|이란|란|이라는|라는|이다|다|들|들은|들이|들을|들의)';

  /**
   * Regex for a term: words separated by flexible whitespace or ~, not glued to other word
   * characters, never right after a backslash. Optional plural s/es for glossary terms.
   * caseSensitive: for case-only variants (LaTeX vs Latex).
   */
  function termRegex(term, { plural = false, caseSensitive = false } = {}) {
    const body = term.trim().split(/\s+/).map(escapeRe).join('[\\s~]+');
    const pl = plural && /[A-Za-z]$/.test(term) ? '(?:e?s)?' : '';
    const after = HANGUL_END.test(term)
      ? `(?=${KO_PARTICLES}?(?![\\p{L}\\p{N}_]))`
      : '(?![\\p{L}\\p{N}_]|-[\\p{L}])';
    return new RegExp(`(?<![\\\\\\p{L}\\p{N}_-])${body}${pl}${after}`, caseSensitive ? 'gu' : 'giu');
  }

  function findAll(prose, term, opts) {
    const re = termRegex(term, opts);
    const out = [];
    let m;
    while ((m = re.exec(prose))) out.push({ from: m.index, to: m.index + m[0].length, matched: m[0] });
    return out;
  }

  // Keep the occurrence's capitalization style when replacing.
  function matchCase(replacement, original) {
    if (/[A-Z]/.test(replacement.slice(1)) || /[^\x00-\x7F]/.test(replacement)) {
      // Preferred form has its own casing (e.g., "ImageNet", "t-SNE"): only capitalize the first letter if needed.
      return /^[A-Z]/.test(original) && /^[a-z]/.test(replacement) ? replacement[0].toUpperCase() + replacement.slice(1) : replacement;
    }
    if (original.length > 1 && original === original.toUpperCase() && /[A-Z]{2}/.test(original)) return replacement.toUpperCase();
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

  // Most common original spelling among occurrences ("t-SNE" rather than "t-sne"). A form that is only
  // capitalized because it starts a sentence ("Pre-training helps.") is shown in lower case.
  function displayForm(occurrences, fallback) {
    const counts = new Map();
    for (const o of occurrences) {
      let t = o.text.replace(/[\s~]+/g, ' ');
      if (/^[A-Z][^A-Z]*$/.test(t)) t = t.toLowerCase();
      counts.set(t, (counts.get(t) || 0) + 1);
    }
    let best = fallback;
    let n = -1;
    for (const [t, c] of counts) if (c > n) { best = t; n = c; }
    return best;
  }

  // Korean particles whose form depends on whether the previous syllable has a final consonant.
  const KO_PAIRS = [['을', '를'], ['이', '가'], ['은', '는'], ['과', '와'], ['으로', '로'], ['이나', '나'], ['이라', '라'], ['이란', '란'], ['이라는', '라는']];
  function hasBatchim(word) {
    const c = word.charCodeAt(word.length - 1);
    if (c < 0xAC00 || c > 0xD7A3) return null;
    return (c - 0xAC00) % 28;
  }
  function fitParticle(word, particle) {
    const b = hasBatchim(word);
    if (b === null || !particle) return particle;
    for (const [withB, withoutB] of KO_PAIRS) {
      if (particle === withB || particle === withoutB) {
        if (withB === '으로') return b === 0 || b === 8 ? withoutB : withB; // ㄹ 받침 + 로
        return b ? withB : withoutB;
      }
    }
    return particle;
  }

  /**
   * Build term groups for the document.
   * Returns [{ id, source, preferred, confidence, forms: [{ text, count, occurrences: [{from,to,text,line}] }] }]
   * Only groups where at least one non-preferred form actually occurs are returned.
   */
  function analyzeTerms(doc, glossaryText) {
    const prose = proseView(doc);
    const lower = prose.toLowerCase();
    const starts = [0];
    for (let i = 0; i < doc.length; i++) if (doc[i] === '\n') starts.push(i + 1);
    const occ = (term, opts) => findAll(prose, term, opts).map((o) => {
      // Strip a trailing Korean particle from the replaced span (keep the particle in the text).
      let particle = '';
      if (HANGUL_END.test(term)) {
        const p = new RegExp(`^${KO_PARTICLES}(?![\\p{L}\\p{N}_])`, 'u').exec(doc.slice(o.to, o.to + 6));
        if (p) particle = p[0];
      }
      return { from: o.from, to: o.to, text: doc.slice(o.from, o.to), particle, line: lineOf(starts, o.from) };
    });
    const groups = [];
    const claimed = new Set(); // lowercased forms already in a group

    for (const g of parseGlossary(glossaryText)) {
      const forms = [g.preferred, ...g.variants].map((t) => {
        const caseSensitive = t.toLowerCase() === g.preferred.toLowerCase() && t !== g.preferred || (t === g.preferred && g.variants.some((v) => v.toLowerCase() === t.toLowerCase()));
        return { text: t, occurrences: occ(t, { plural: true, caseSensitive }) };
      });
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
      if (seenWords.has(w) || (m.index > 0 && lower[m.index - 1] === '\\')) continue;
      seenWords.add(w);
      const variants = [w, w.replace(/-/g, ''), w.replace(/-/g, ' ')];
      if (variants.some((v) => claimed.has(v))) continue;
      const forms = variants.map((t) => ({ key: t, occurrences: occ(t) })).filter((f) => f.occurrences.length);
      for (const f of forms) { f.count = f.occurrences.length; f.text = displayForm(f.occurrences, f.key); }
      if (forms.length >= 2) {
        forms.sort((a, b) => b.count - a.count);
        forms.forEach((f) => claimed.add(f.key));
        // Hyphenated vs spaced only ("sparse-attention layer" / "sparse attention") is often correct English
        // (compound modifier before a noun); re-sign/resign are different words. Offered, not pre-selected.
        const hasClosed = forms.some((f) => !/[-\s]/.test(f.key));
        const reWord = /^re-[a-z]+$/.test(w);
        groups.push({ id: `h:${w}`, source: 'hyphen', preferred: forms[0].text, forms, confidence: hasClosed && !reWord ? 'high' : 'low' });
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
      const forms = [us, uk].map((t) => ({ key: t, occurrences: occ(t) })).filter((f) => f.occurrences.length);
      for (const f of forms) { f.count = f.occurrences.length; f.text = displayForm(f.occurrences, f.key); }
      if (forms.length === 2) {
        forms.sort((a, b) => b.count - a.count);
        forms.forEach((f) => claimed.add(f.key));
        groups.push({ id: `s:${us}`, source: 'usuk', preferred: forms[0].text, forms, confidence: 'high' });
      }
    }
    return groups;
  }

  /**
   * Replacement plan for the chosen groups.
   * choices: Map(groupId -> preferred text) (groups not in the map are skipped).
   * Occurrences of a form that lie inside an occurrence of a LONGER form of the same group are
   * skipped ("neural network" inside "deep neural network").
   * Returns [{ from, to, expected, insert }] sorted, non-overlapping.
   */
  function planChanges(groups, choices) {
    const changes = [];
    for (const g of groups) {
      if (!choices.has(g.id)) continue;
      const preferred = choices.get(g.id);
      const covered = [];
      const byLength = [...g.forms].sort((a, b) => b.text.length - a.text.length);
      for (const f of byLength) {
        for (const o of f.occurrences) {
          const inside = covered.some((c) => o.from >= c.from && o.to <= c.to && (o.from !== c.from || o.to !== c.to));
          if (inside) continue;
          covered.push(o);
          if (f.text.toLowerCase() === preferred.toLowerCase() && f.text === preferred) continue;
          const base = o.text;
          const pluralSuffix = /e?s$/i.test(base) && !/e?s$/i.test(f.text) && g.source === 'glossary' ? /e?s$/i.exec(base)[0] : '';
          const insert = matchCase(preferred, base) + pluralSuffix;
          if (o.particle) {
            // Replace term + particle together so 을/를, 이/가 … agree with the new word.
            const p2 = fitParticle(insert, o.particle);
            if (insert !== base || p2 !== o.particle) changes.push({ from: o.from, to: o.to + o.particle.length, expected: base + o.particle, insert: insert + p2 });
            continue;
          }
          if (insert !== base) changes.push({ from: o.from, to: o.to, expected: base, insert });
        }
      }
    }
    changes.sort((a, b) => a.from - b.from);
    const out = [];
    let end = -1;
    for (const c of changes) { if (c.from >= end) { out.push(c); end = c.to; } }
    return out;
  }

  const api = { parseGlossary, mergeGlossary, analyzeTerms, planChanges, matchCase, termRegex, displayForm, fitParticle };
  root.OLAI_TERMS = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
