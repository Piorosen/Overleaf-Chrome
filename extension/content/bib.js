// Overleaf AI — BibTeX management: parse/serialize .bib, find cited keys, detect arXiv preprints,
// pick the published version from metadata lookups, build clean entries. Pure functions, no I/O.
(function (root) {
  'use strict';

  const L = root.OLAI_LINT || (typeof require !== 'undefined' ? require('./lint.js') : null);

  // ----------------------------------------------------------------- parse ---

  function matchBrace(text, open) {
    let depth = 0;
    for (let i = open; i < text.length; i++) {
      const c = text[i];
      if (c === '\\') { i++; continue; }
      if (c === '{') depth++;
      else if (c === '}') { depth--; if (depth === 0) return i; }
    }
    return -1;
  }

  /**
   * Parse a .bib file. Returns { entries: [{ type, key, fields, order, from, to }] } where `fields`
   * maps lower-cased field names to raw values without the outer braces/quotes, `order` keeps the
   * original field order, and [from, to) is the entry's span in `text` (for in-place replacement).
   */
  function parseBib(text) {
    const entries = [];
    const strings = {};
    const re = /@([A-Za-z]+)\s*([{(])/g;
    let m;
    while ((m = re.exec(text))) {
      const type = m[1].toLowerCase();
      const openIdx = m.index + m[0].length - 1;
      const closeCh = m[2] === '{' ? '}' : ')';
      let end;
      if (m[2] === '{') end = matchBrace(text, openIdx);
      else end = text.indexOf(closeCh, openIdx);
      if (end < 0) break;
      const body = text.slice(openIdx + 1, end);
      re.lastIndex = end + 1;
      if (type === 'comment' || type === 'preamble') continue;
      if (type === 'string') {
        const sm = /^\s*([A-Za-z][\w-]*)\s*=\s*[{"]([\s\S]*)[}"]\s*$/.exec(body);
        if (sm) strings[sm[1].toLowerCase()] = sm[2];
        continue;
      }
      const comma = body.indexOf(',');
      const key = (comma < 0 ? body : body.slice(0, comma)).trim();
      const fields = {};
      const order = [];
      let i = comma < 0 ? body.length : comma + 1;
      while (i < body.length) {
        const fm = /^\s*([A-Za-z][\w:-]*)\s*=\s*/.exec(body.slice(i));
        if (!fm) break;
        const name = fm[1].toLowerCase();
        i += fm[0].length;
        let value = '';
        const parts = [];
        // value: {..} | ".." | number | macro, possibly concatenated with #
        for (;;) {
          while (i < body.length && /\s/.test(body[i])) i++;
          if (body[i] === '{') {
            const c = matchBrace(body, i);
            if (c < 0) { i = body.length; break; }
            parts.push(body.slice(i + 1, c));
            i = c + 1;
          } else if (body[i] === '"') {
            let j = i + 1;
            let depth = 0;
            while (j < body.length && !(body[j] === '"' && depth === 0 && body[j - 1] !== '\\')) { if (body[j] === '{') depth++; else if (body[j] === '}') depth--; j++; }
            parts.push(body.slice(i + 1, j));
            i = j + 1;
          } else {
            const w = /^[\w.:/-]+/.exec(body.slice(i));
            if (!w) break;
            parts.push(strings[w[0].toLowerCase()] ?? w[0]);
            i += w[0].length;
          }
          while (i < body.length && /\s/.test(body[i])) i++;
          if (body[i] === '#') { i++; continue; }
          break;
        }
        value = parts.join('');
        if (!(name in fields)) order.push(name);
        fields[name] = value;
        while (i < body.length && /[\s,]/.test(body[i])) i++;
      }
      entries.push({ type, key, fields, order, from: m.index, to: end + 1 });
    }
    return { entries, strings };
  }

  const FIELD_ORDER = ['author', 'editor', 'title', 'booktitle', 'journal', 'volume', 'number', 'pages', 'year', 'month', 'publisher', 'organization', 'school', 'institution', 'series', 'address', 'edition', 'doi', 'url', 'eprint', 'archiveprefix', 'primaryclass', 'note'];
  const CANON = { archiveprefix: 'archivePrefix', primaryclass: 'primaryClass' };

  function serializeEntry({ type, key, fields, order }, indent = '  ') {
    const names = [...new Set([...(order || []), ...Object.keys(fields)])].filter((n) => fields[n] != null && String(fields[n]).trim() !== '');
    const width = Math.max(...names.map((n) => (CANON[n] || n).length), 4);
    const lines = names.map((n) => `${indent}${(CANON[n] || n).padEnd(width)} = {${String(fields[n]).trim()}}`);
    return `@${type}{${key},\n${lines.join(',\n')}\n}`;
  }

  // ------------------------------------------------------------- identify ---

  const ARXIV_NEW = /(\d{4}\.\d{4,5})(v\d+)?/;
  const ARXIV_OLD = /([a-z-]+(?:\.[A-Z]{2})?\/\d{7})(v\d+)?/;

  function arxivIdOf(entry) {
    const f = entry.fields || {};
    const probes = [f.eprint, f.arxivid, f.arxiv, f.journal, f.booktitle, f.howpublished, f.note, f.url, f.doi, f.volume, f.number];
    const looksArxiv = /arxiv|corr|abs\//i.test([f.journal, f.booktitle, f.howpublished, f.note, f.url, f.doi, f.archiveprefix, f.eprinttype, f.publisher].join(' ')) || !!f.eprint;
    if (!looksArxiv) return null;
    for (const p of probes) {
      if (!p) continue;
      const s = String(p);
      const doi = /10\.48550\/arxiv\.([\w./-]+)/i.exec(s);
      if (doi) return doi[1].replace(/v\d+$/, '');
      const nm = ARXIV_NEW.exec(s);
      if (nm) return nm[1];
      const om = ARXIV_OLD.exec(s);
      if (om) return om[1];
    }
    return null;
  }

  function isPreprint(entry) {
    const f = entry.fields || {};
    if (arxivIdOf(entry)) return true;
    const where = [f.journal, f.booktitle, f.howpublished, f.note, f.publisher].join(' ');
    return /\b(arxiv|corr|preprint|biorxiv|medrxiv|ssrn|research ?square|techrxiv|openreview preprint)\b/i.test(where);
  }

  // Strip LaTeX markup and accents for comparisons.
  function plain(s) {
    return String(s || '')
      .replace(/\\[`'^"~=.uvHtcdbk]\s*\{?([A-Za-z])\}?/g, '$1')
      .replace(/\\[A-Za-z]+\*?/g, ' ')
      .replace(/[{}$~\\]/g, '')
      .normalize('NFKD').replace(/[̀-ͯ]/g, '');
  }

  function normTitle(s) {
    return plain(s).toLowerCase().replace(/[^a-z0-9぀-ヿ㐀-鿿가-힣]+/g, ' ').trim();
  }

  // Dice coefficient over word bigrams+unigrams (robust to small edits).
  function titleSim(a, b) {
    const ta = normTitle(a).split(' ').filter(Boolean);
    const tb = normTitle(b).split(' ').filter(Boolean);
    if (!ta.length || !tb.length) return 0;
    if (ta.join(' ') === tb.join(' ')) return 1;
    const grams = (t) => { const g = new Map(); const add = (k) => g.set(k, (g.get(k) || 0) + 1); t.forEach((w, i) => { add(w); if (i) add(`${t[i - 1]} ${w}`); }); return g; };
    const ga = grams(ta);
    const gb = grams(tb);
    let inter = 0;
    let total = 0;
    for (const [k, v] of ga) { inter += Math.min(v, gb.get(k) || 0); total += v; }
    for (const v of gb.values()) total += v;
    return (2 * inter) / total;
  }

  function lastNames(authorField) {
    return String(authorField || '').split(/\s+and\s+/i).map((a) => {
      const p = plain(a).trim();
      if (!p) return '';
      if (p.includes(',')) return p.split(',')[0].trim().toLowerCase();
      const parts = p.split(/\s+/);
      return parts[parts.length - 1].toLowerCase();
    }).filter(Boolean);
  }

  // ---------------------------------------------------------------- cites ---

  const CITE_RE = /\\(?:[Cc]ite[a-zA-Z]*|[Pp]arencite|[Tt]extcite|[Aa]utocite|[Ff]ootcite|[Ff]ullcite|[Ss]martcite|[Ss]upercite|nocite)\*?\s*(?:\[[^\]]*\]\s*){0,2}\{([^}]*)\}/g;

  /** Map key -> { count, index } of every citation key in a .tex source (comments ignored). */
  function citedKeys(tex) {
    const src = L ? L.maskCode(L.maskComments(String(tex || ''))) : String(tex || '');
    const out = new Map();
    let m;
    CITE_RE.lastIndex = 0;
    while ((m = CITE_RE.exec(src))) {
      for (const k of m[1].split(',').map((x) => x.trim()).filter((x) => x && x !== '*' && !x.includes('#'))) {
        const cur = out.get(k);
        if (cur) cur.count += 1; else out.set(k, { count: 1, index: m.index });
      }
    }
    return out;
  }

  // The sentence around the first use of a key (helps searching for a missing reference).
  function citeContext(tex, index, radius = 220) {
    const a = Math.max(0, index - radius);
    const s = String(tex).slice(a, index + radius);
    return plain(s.replace(/\\cite\w*\*?(\[[^\]]*\])*\{[^}]*\}/g, ' ')).replace(/\s+/g, ' ').trim();
  }

  // Content words right before a citation in the same sentence (+ a few after it) — the best search hint.
  function citeQueryWords(tex, index) {
    const src = String(tex);
    const start = Math.max(src.lastIndexOf('. ', index), src.lastIndexOf('\n\n', index), src.lastIndexOf('\\item', index), index - 300);
    const before = plain(src.slice(start + 1, index).replace(/\\cite\w*\*?(\[[^\]]*\])*\{[^}]*\}/g, ' '));
    const endRel = src.slice(index).search(/[.;:](\s|$)/);
    const after = plain(src.slice(index, index + (endRel < 0 ? 80 : Math.min(endRel, 80))).replace(/\\cite\w*\*?(\[[^\]]*\])*\{[^}]*\}/g, ' '));
    const words = (t) => t.toLowerCase().split(/[^a-z0-9-]+/).filter((w) => w.length > 2 && !STOP.has(w) && !/^\d+$/.test(w) && !CTX_STOP.has(w));
    return { before: words(before).slice(-6), after: words(after).slice(0, 3) };
  }
  const CTX_STOP = new Set(['which', 'that', 'this', 'these', 'those', 'such', 'also', 'were', 'was', 'has', 'have', 'been', 'into', 'their', 'they', 'using', 'used', 'use', 'build', 'based', 'show', 'shown', 'work', 'works', 'recent', 'prior', 'previous', 'proposed', 'propose', 'method', 'methods', 'approach', 'approaches', 'model', 'models', 'paper', 'papers', 'see', 'e.g', 'i.e', 'like', 'similar', 'won', 'many', 'more', 'most', 'other', 'others']);

  const STOP = new Set(['a', 'an', 'the', 'of', 'for', 'and', 'on', 'in', 'to', 'with', 'via', 'by', 'from', 'at', 'is', 'are', 'etal', 'et', 'al']);

  /** "vaswani2017attention" / "Devlin_2019" / "devlin-etal-2019-bert" / "he2016deep" -> {author, year, words} */
  function keyHint(key) {
    const k = String(key);
    const year = (/(19|20)\d{2}/.exec(k) || [])[0] || '';
    const tokens = k.replace(/[:_\-./]+/g, ' ').replace(/(19|20)\d{2}(?:[a-z](?![a-z]))?/, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').split(/\s+/).map((t) => t.toLowerCase()).filter((t) => t && !STOP.has(t) && !/^\d+$/.test(t));
    return { author: tokens[0] || '', year, words: tokens.slice(1) };
  }

  // ----------------------------------------------------------------- build ---

  function asciiFold(s) {
    return plain(s).replace(/[^A-Za-z0-9]/g, '');
  }

  function makeKey(authors, year, title) {
    const first = Array.isArray(authors) ? authors[0] : String(authors || '').split(/\s+and\s+/)[0];
    const last = first ? (first.includes(',') ? first.split(',')[0] : first.trim().split(/\s+/).pop()) : 'anon';
    const word = normTitle(title).split(' ').find((w) => w.length > 2 && !STOP.has(w)) || 'paper';
    return `${asciiFold(last).toLowerCase() || 'anon'}${year || ''}${asciiFold(word).toLowerCase()}`;
  }

  function uniqueKey(key, taken) {
    if (!taken.has(key)) return key;
    for (const suffix of 'bcdefghijklmnopqrstuvwxyz') if (!taken.has(`${key}${suffix}`)) return `${key}${suffix}`;
    return `${key}${Date.now() % 1000}`;
  }

  // Protect capitalization BibTeX styles would otherwise lower-case: acronyms, CamelCase, t-SNE, 3D.
  function protectTitle(title) {
    const t = String(title || '').trim();
    let depth = 0;
    return t.split(/(\s+)/).map((tok) => {
      const opens = (tok.match(/\{/g) || []).length;
      const closes = (tok.match(/\}/g) || []).length;
      const inside = depth > 0;
      depth += opens - closes;
      if (inside || opens || closes || /^\s+$/.test(tok) || tok.includes('\\') || tok.includes('$')) return tok;
      const m = /^([("'`]*)(.*?)([.,:;!?)"']*)$/.exec(tok);
      const core = m[2];
      if (/[A-Z].*[A-Z]|[a-z][A-Z]|\d[A-Z]|[A-Z]\d/.test(core)) return `${m[1]}{${core}}${m[3]}`;
      return tok;
    }).join('');
  }

  const authorsField = (list) => (list || []).filter(Boolean).map((a) => {
    const s = String(a).trim();
    if (s.includes(',')) return s;
    const parts = s.split(/\s+/);
    if (parts.length < 2) return s;
    return `${parts[parts.length - 1]}, ${parts.slice(0, -1).join(' ')}`;
  }).join(' and ');

  const VENUE_NAMES = [
    [/^(neural information processing systems|neurips|nips)$/i, 'Advances in Neural Information Processing Systems'],
    [/^(international conference on learning representations|iclr)$/i, 'International Conference on Learning Representations'],
    [/^(international conference on machine learning|icml)$/i, 'International Conference on Machine Learning'],
    [/computer vision and pattern recognition|^cvpr$/i, 'Proceedings of the IEEE/CVF Conference on Computer Vision and Pattern Recognition'],
    [/^(ieee\/cvf )?international conference on computer vision$|^iccv$/i, 'Proceedings of the IEEE/CVF International Conference on Computer Vision'],
    [/^(european conference on computer vision|eccv)$/i, 'European Conference on Computer Vision'],
    [/^(aaai conference on artificial intelligence|aaai)$/i, 'Proceedings of the AAAI Conference on Artificial Intelligence'],
  ];
  const canonicalVenue = (v) => { const s = String(v || '').trim(); for (const [re, name] of VENUE_NAMES) if (re.test(s)) return name; return s; };

  /**
   * Build an entry from metadata. meta: { kind: 'conference'|'journal'|'preprint'|'other', title,
   * authors: [..], year, venue, doi, volume, number, pages, publisher, url, arxivId }
   */
  function entryFromMeta(meta, key) {
    const fields = {};
    const order = [];
    const set = (k, v) => { if (v != null && String(v).trim() !== '') { fields[k] = String(v); order.push(k); } };
    set('author', authorsField(meta.authors));
    set('title', protectTitle(meta.title));
    let type = 'misc';
    if (meta.kind === 'conference') { type = 'inproceedings'; set('booktitle', canonicalVenue(meta.venue)); }
    else if (meta.kind === 'journal') { type = 'article'; set('journal', meta.venue); set('volume', meta.volume); set('number', meta.number); }
    else if (meta.kind === 'preprint') { type = 'article'; set('journal', `arXiv preprint arXiv:${meta.arxivId}`); }
    else set('howpublished', meta.venue);
    set('pages', meta.pages);
    set('year', meta.year);
    set('publisher', meta.publisher);
    set('doi', meta.doi);
    if (!meta.doi) set('url', meta.url);
    if (meta.kind === 'preprint' && meta.arxivId) { set('eprint', meta.arxivId); set('archiveprefix', 'arXiv'); set('primaryclass', meta.primary); }
    return serializeEntry({ type, key, fields, order });
  }

  /** Clean a BibTeX entry obtained from doi.org/Crossref: re-key, protect title, tidy fields. */
  function cleanImported(bibtex, key) {
    const parsed = parseBib(String(bibtex || ''));
    const e = parsed.entries[0];
    if (!e) return null;
    const fields = { ...e.fields };
    if (fields.title) fields.title = protectTitle(plain(fields.title.replace(/\{\\textendash\}/g, '--').replace(/\{\\&\}amp;/g, '\\&')));
    if (fields.doi && fields.url && /doi\.org/i.test(fields.url)) delete fields.url;
    delete fields.month;
    if (fields.pages) fields.pages = fields.pages.replace(/\s*[–-]\s*/g, '--');
    const order = FIELD_ORDER.filter((n) => n in fields).concat(Object.keys(fields).filter((n) => !FIELD_ORDER.includes(n)));
    return serializeEntry({ type: e.type, key: key || e.key, fields, order });
  }

  // ---------------------------------------------------------- publication ---

  const isArxivDoi = (d) => /^10\.48550\//i.test(String(d || ''));
  const notPreprintVenue = (v) => v && !/arxiv|corr|preprint|biorxiv|medrxiv|ssrn|research square|openreview/i.test(v);

  /**
   * Choose the published version of a preprint from lookup results.
   * input: { title, year, authors (bib author field), arxiv: arXiv API record, s2: S2 record,
   *          openalex: [simplified works], crossref: [items] }
   * Returns { kind, title, authors, year, venue, doi, source, confidence: 'high'|'medium' } or null.
   */
  function choosePublication(input) {
    const title = input.title || (input.arxiv && input.arxiv.title) || '';
    const names = lastNames(input.authors || '');
    const arxivYear = input.arxiv && input.arxiv.published ? Number(input.arxiv.published.slice(0, 4)) : Number(input.year) || null;
    const authorsOk = (list) => !names.length || (list || []).some((a) => names.includes(String(a).trim().split(/\s+/).pop().toLowerCase()));
    const cands = [];
    const push = (c) => { if (c && c.title && titleSim(c.title, title) >= 0.85 && (!arxivYear || !c.year || c.year >= arxivYear - 1)) cands.push(c); };

    const ax = input.arxiv;
    if (ax && ax.doi && !isArxivDoi(ax.doi)) push({ kind: 'journal', title, authors: ax.authors, year: arxivYear, venue: ax.journalRef || '', doi: ax.doi, source: 'arXiv (저자 등록 DOI)', score: 3 });
    const s2 = input.s2;
    if (s2 && s2.title) {
      const doi = s2.externalIds && s2.externalIds.DOI;
      const pv = s2.publicationVenue || {};
      const venue = (s2.journal && s2.journal.name && notPreprintVenue(s2.journal.name) ? s2.journal.name : '') || (notPreprintVenue(pv.name) ? pv.name : '') || (notPreprintVenue(s2.venue) ? s2.venue : '');
      if (venue || (doi && !isArxivDoi(doi))) {
        const kind = pv.type === 'conference' || (s2.publicationTypes || []).includes('Conference') ? 'conference' : (pv.type === 'journal' || (s2.publicationTypes || []).includes('JournalArticle')) ? 'journal' : 'conference';
        push({ kind, title: s2.title, authors: (s2.authors || []).map((a) => a.name), year: s2.year, venue, doi: doi && !isArxivDoi(doi) ? doi : '', volume: s2.journal && s2.journal.volume, pages: s2.journal && s2.journal.pages, source: 'Semantic Scholar', score: 2 + (doi ? 0.5 : 0) });
      }
    }
    for (const w of input.openalex || []) {
      if (!w) continue;
      if (/preprint|posted-content/.test(w.type) && !(w.locations || []).some((l) => !l.isArxiv && /published|accepted/i.test(l.version) && l.source)) continue;
      const loc = (w.locations || []).find((l) => !l.isArxiv && l.source && /published|accepted/i.test(l.version)) || (!w.primary.isArxiv ? w.primary : null);
      const venue = loc && loc.source;
      if (!venue && !(w.doi && !isArxivDoi(w.doi))) continue;
      const kind = /conference|proceedings/i.test(`${w.type} ${loc && loc.sourceType}`) ? 'conference' : 'journal';
      if (!authorsOk(w.authors)) continue;
      push({ kind, title: w.title, authors: w.authors, year: w.year, venue, doi: w.doi && !isArxivDoi(w.doi) ? w.doi : '', volume: w.biblio && w.biblio.volume, number: w.biblio && w.biblio.issue, pages: w.biblio && w.biblio.first_page ? `${w.biblio.first_page}${w.biblio.last_page ? `--${w.biblio.last_page}` : ''}` : '', source: 'OpenAlex', score: 1.5 });
    }
    for (const c of input.crossref || []) {
      if (!c || !c.doi || isArxivDoi(c.doi) || !/proceedings-article|journal-article|book-chapter/.test(c.type || '')) continue;
      if (!authorsOk(c.authors)) continue;
      push({ kind: /proceedings/.test(c.type) ? 'conference' : 'journal', title: c.title, authors: c.authors, year: c.year, venue: c.venue, doi: c.doi, source: 'Crossref', score: 1 });
    }
    if (!cands.length) return null;
    cands.sort((a, b) => (titleSim(b.title, title) + b.score) - (titleSim(a.title, title) + a.score));
    const best = cands[0];
    const sim = titleSim(best.title, title);
    const agree = cands.filter((c) => c !== best && (c.doi && c.doi.toLowerCase() === String(best.doi || '').toLowerCase() || normTitle(c.venue) === normTitle(best.venue))).length;
    best.confidence = sim >= 0.95 && (best.doi || agree >= 1 || best.source === 'Semantic Scholar') ? 'high' : 'medium';
    delete best.score;
    return best;
  }

  // ---------------------------------------------------------------- audit ---

  /** Problems in a parsed .bib: duplicates, unused (if cited given), missing fields, unprotected caps, preprints. */
  function auditBib(entries, cited) {
    const issues = [];
    const byKey = new Map();
    const byDoi = new Map();
    const byArxiv = new Map();
    const byTitle = new Map();
    for (const e of entries) {
      const f = e.fields;
      if (byKey.has(e.key)) issues.push({ key: e.key, kind: 'dup-key', message: `같은 키가 두 번 정의됨: ${e.key}`, entry: e });
      byKey.set(e.key, e);
      const add = (map, k, label) => { if (!k) return; if (map.has(k) && map.get(k).key !== e.key) issues.push({ key: e.key, kind: 'duplicate', message: `${map.get(k).key} 와 같은 논문 (${label})`, entry: e }); else map.set(k, e); };
      add(byDoi, (f.doi || '').toLowerCase().replace(/^https?:\/\/doi\.org\//, ''), 'DOI');
      add(byArxiv, arxivIdOf(e), 'arXiv');
      add(byTitle, normTitle(f.title).length > 20 ? normTitle(f.title) : '', '제목');
      const need = { article: ['author', 'title', 'journal', 'year'], inproceedings: ['author', 'title', 'booktitle', 'year'], book: ['title', 'year'], misc: ['title'] }[e.type] || ['title', 'year'];
      const missing = need.filter((n) => !f[n] && !(n === 'author' && f.editor));
      if (missing.length) issues.push({ key: e.key, kind: 'missing-field', message: `필수 필드 누락: ${missing.join(', ')}`, entry: e });
      if (f.title && protectTitle(f.title) !== f.title.trim() && !/^\{[\s\S]*\}$/.test(f.title.trim())) issues.push({ key: e.key, kind: 'unprotected', message: '제목의 약어·대문자가 {} 로 보호되지 않아 소문자로 바뀔 수 있음', entry: e, fix: protectTitle(f.title) });
      if (isPreprint(e)) issues.push({ key: e.key, kind: 'preprint', message: 'arXiv/프리프린트로 인용됨 — 출판본이 있는지 확인', entry: e });
      if (cited && !cited.has(e.key)) issues.push({ key: e.key, kind: 'unused', message: '본문에서 인용되지 않음', entry: e });
    }
    return issues;
  }

  /** Edits to append entries at the end of a .bib document. */
  function appendEdits(bibDoc, entryTexts) {
    const body = entryTexts.map((t) => t.trim()).join('\n\n');
    const sep = !bibDoc.trim() ? '' : bibDoc.endsWith('\n\n') ? '' : bibDoc.endsWith('\n') ? '\n' : '\n\n';
    return [{ pos: bibDoc.length, text: `${sep}${body}\n` }];
  }

  // Parse what the user typed into "BibTeX 추가".
  function parseLookupInput(s) {
    const t = String(s || '').trim();
    const doi = /(?:doi\.org\/|doi:\s*)?(10\.\d{4,9}\/[^\s"<>]+)/i.exec(t);
    if (doi && !/arxiv/i.test(doi[1])) return { kind: 'doi', value: doi[1].replace(/[.,;]$/, '') };
    const ax = /(?:arxiv\.org\/(?:abs|pdf)\/|arxiv:\s*|10\.48550\/arxiv\.)?(\d{4}\.\d{4,5}|[a-z-]+(?:\.[A-Z]{2})?\/\d{7})(v\d+)?/i.exec(t);
    if (ax && (/arxiv/i.test(t) || /^\d{4}\.\d{4,5}(v\d+)?$/.test(t))) return { kind: 'arxiv', value: ax[1] };
    return t ? { kind: 'title', value: t } : null;
  }

  const api = {
    parseBib, serializeEntry, arxivIdOf, isPreprint, plain, normTitle, titleSim, lastNames, citedKeys, citeContext,
    citeQueryWords, keyHint, makeKey, uniqueKey, protectTitle, entryFromMeta, cleanImported, choosePublication, auditBib, appendEdits,
    parseLookupInput, canonicalVenue, isArxivDoi,
  };
  root.OLAI_BIB = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
