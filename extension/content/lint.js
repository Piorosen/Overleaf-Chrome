// Overleaf AI — local LaTeX/manuscript checks. Instant, no AI, pure functions.
// Also exports the TeX-aware masking helpers used by terms.js and packages.js.
// Every helper returns a string of the SAME length as its input (characters blanked with spaces,
// newlines kept) so offsets and line numbers stay valid.
(function (root) {
  'use strict';

  const SEVERITY_ORDER = { error: 0, warn: 1, info: 2 };
  const blank = (s) => s.replace(/[^\n]/g, ' ');

  // Index of the brace that closes the group opened at `open` (text[open] === '{'), or -1.
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

  // Comments: a % starts a comment only after an even number of backslashes. The arguments of
  // \url/\href/\path may contain % literally (e.g. %20), so they are skipped.
  function maskComments(doc) {
    const out = doc.split('');
    let i = 0;
    while (i < doc.length) {
      const c = doc[i];
      if (c === '\\') {
        const m = /^\\(url|href|path)\s*\{/.exec(doc.slice(i, i + 12));
        if (m) {
          const open = i + m[0].length - 1;
          const close = matchBrace(doc, open);
          if (close > 0 && !doc.slice(open, close).includes('\n\n')) { i = close + 1; continue; }
        }
        i += 2;
        continue;
      }
      if (c === '%') {
        let j = i;
        while (j < doc.length && doc[j] !== '\n') { out[j] = ' '; j++; }
        i = j;
        continue;
      }
      i++;
    }
    return out.join('');
  }

  const VERBATIM_ENVS = ['verbatim', 'verbatim*', 'Verbatim', 'lstlisting', 'minted', 'comment', 'alltt'];
  const CODE_ENVS = [...VERBATIM_ENVS];
  const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // Code and disabled blocks: verbatim-like environments, \verb|..|, \lstinline, \mintinline,
  // and \iffalse ... \fi. (Run on comment-masked text.)
  function maskCode(text) {
    let t = text;
    const envRe = new RegExp(`\\\\begin\\{(${CODE_ENVS.map(escapeRe).join('|')})\\}[\\s\\S]*?\\\\end\\{\\1\\}`, 'g');
    t = t.replace(envRe, blank);
    t = t.replace(/\\iffalse\b[\s\S]*?\\fi\b/g, blank);
    t = t.replace(/\\(?:verb|lstinline)\*?([^\sA-Za-z{])[\s\S]*?\1/g, blank); // \verb|x|, \lstinline!x!
    t = blankCommandArgs(t, ['lstinline'], { args: 1 });
    t = blankCommandArgs(t, ['mintinline'], { args: 2 });
    return t;
  }

  /**
   * Blank (with spaces) the optional [..] and the first `args` mandatory {..} arguments of the
   * named commands, using real brace matching. opts.keepName keeps "\name" itself visible.
   */
  function blankCommandArgs(text, names, opts = {}) {
    if (!names.length) return text;
    const nArgs = opts.args || 1;
    const re = new RegExp(`\\\\(${names.map(escapeRe).join('|')})(?![A-Za-z@])\\*?`, 'g');
    const out = text.split('');
    let m;
    while ((m = re.exec(text))) {
      let i = m.index + m[0].length;
      let end = i;
      let got = 0;
      while (i < text.length && got < nArgs) {
        while (i < text.length && /[ \t]/.test(text[i])) i++;
        if (text[i] === '[') {
          const close = text.indexOf(']', i);
          if (close < 0) break;
          i = close + 1;
          end = i;
          continue;
        }
        if (text[i] === '{') {
          const close = matchBrace(text, i);
          if (close < 0) break;
          i = close + 1;
          end = i;
          got++;
          continue;
        }
        break;
      }
      const from = opts.keepName ? m.index + m[0].length : m.index;
      for (let k = from; k < end; k++) if (out[k] !== '\n') out[k] = ' ';
      re.lastIndex = Math.max(re.lastIndex, end);
    }
    return out.join('');
  }

  const MATH_ENVS = ['equation', 'equation*', 'align', 'align*', 'gather', 'gather*', 'multline', 'multline*', 'eqnarray', 'eqnarray*',
    'displaymath', 'math', 'split', 'flalign', 'flalign*', 'alignat', 'alignat*', 'IEEEeqnarray', 'IEEEeqnarray*', 'subequations'];
  const NONPROSE_ENVS = ['tikzpicture', 'algorithmic', 'pgfpicture', 'axis', 'forest', 'circuitikz'];
  // Arguments that are keys, paths, code or identifiers — never prose.
  const KEY_COMMANDS = ['cite', 'citep', 'citet', 'citealp', 'citealt', 'citeauthor', 'citeyear', 'citeyearpar', 'Citep', 'Citet',
    'parencite', 'textcite', 'autocite', 'footcite', 'fullcite', 'nocite', 'citeA', 'citeN', 'bibitem',
    'ref', 'eqref', 'autoref', 'pageref', 'cref', 'Cref', 'crefrange', 'nameref', 'vref', 'Vref', 'label', 'hyperref', 'hypertarget', 'hyperlink',
    'url', 'path', 'href', 'includegraphics', 'includesvg', 'includepdf', 'input', 'include', 'subfile', 'import', 'subimport', 'lstinputlisting', 'inputminted',
    'begin', 'end', 'usepackage', 'RequirePackage', 'documentclass', 'bibliography', 'bibliographystyle', 'addbibresource', 'graphicspath',
    'gls', 'Gls', 'glspl', 'Glspl', 'glsentrytext', 'ac', 'acs', 'acl', 'acf', 'acp', 'acsp', 'aclp', 'acfp', 'Ac', 'acrshort', 'acrlong', 'acrfull',
    'texttt', 'verbatiminput', 'newacronym', 'DeclareAcronym', 'newglossaryentry', 'setcounter', 'addtocounter', 'color', 'textcolor', 'definecolor',
    'hypersetup', 'captionsetup', 'tikzset', 'pgfplotsset', 'usetikzlibrary', 'newtheorem', 'theoremstyle', 'pagestyle', 'thispagestyle', 'pagenumbering', 'vspace', 'hspace'];
  const DEFINITION_COMMANDS = ['newcommand', 'renewcommand', 'providecommand', 'DeclareRobustCommand', 'NewDocumentCommand', 'RenewDocumentCommand',
    'DeclareDocumentCommand', 'ProvideDocumentCommand', 'NewExpandableDocumentCommand', 'DeclareMathOperator', 'newenvironment', 'renewenvironment', 'DeclarePairedDelimiter'];

  // Mask math (incl. \[..\], \(..\), $..$, $$..$$) keeping offsets.
  function maskMath(t) {
    let s = t.replace(new RegExp(`\\\\begin\\{(${MATH_ENVS.map(escapeRe).join('|')})\\}[\\s\\S]*?\\\\end\\{\\1\\}`, 'g'), blank);
    s = s.replace(/\\\[[\s\S]*?\\\]/g, blank).replace(/\\\([\s\S]*?\\\)/g, blank).replace(/\$\$[\s\S]*?\$\$/g, blank);
    s = s.replace(/(^|[^\\])\$(?:\\.|[^$\\])*\$/g, (m, pre) => pre + blank(m.slice(pre.length)));
    return s;
  }

  // Prose-only view: comments, code, math, drawings, definitions and key-like arguments blanked.
  function maskForProse(textNoComments, opts = {}) {
    let t = maskCode(textNoComments);
    t = t.replace(new RegExp(`\\\\begin\\{(${NONPROSE_ENVS.map(escapeRe).join('|')})\\}[\\s\\S]*?\\\\end\\{\\1\\}`, 'g'), blank);
    t = maskMath(t);
    t = blankCommandArgs(t, DEFINITION_COMMANDS, { args: 2 });
    t = t.replace(/\\(?:def|edef|gdef|let)\s*\\[A-Za-z@]+[^{\n]*\{[^\n]*\}?/g, blank);
    t = blankCommandArgs(t, ['href'], { args: 1 }); // URL only; link text stays prose
    t = blankCommandArgs(t, KEY_COMMANDS.filter((c) => c !== 'href'), { args: 1 });
    t = blankCommandArgs(t, ['mintinline', 'textcolor'], { args: 2 });
    if (opts.headings) t = blankCommandArgs(t, ['part', 'chapter', 'section', 'subsection', 'subsubsection', 'title', 'author', 'affil', 'institute', 'address'], { args: 1 });
    return t;
  }

  function lineStarts(doc) {
    const starts = [0];
    for (let i = 0; i < doc.length; i++) if (doc[i] === '\n') starts.push(i + 1);
    return starts;
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

  // \begin{document} that is not commented out (−1 if none).
  function bodyStartOf(docNoComments) {
    return docNoComments.search(/\\begin\{document\}/);
  }

  // Sentences in prose, in one linear pass (no regex backtracking).
  function* sentences(prose) {
    const enders = new Set(['.', '!', '?', '。', '！', '？']);
    let start = -1;
    for (let i = 0; i <= prose.length; i++) {
      const c = i < prose.length ? prose[i] : '\n';
      let paraBreak = false;
      if (c === '\n') {
        let j = i + 1;
        while (j < prose.length && (prose[j] === ' ' || prose[j] === '\t')) j++;
        paraBreak = j >= prose.length || prose[j] === '\n';
      }
      if (start < 0) {
        if (c && !/\s/.test(c)) start = i;
        continue;
      }
      const isEnd = enders.has(c) && !(c === '.' && /\d/.test(prose[i + 1] || '') && /\d/.test(prose[i - 1] || ''));
      if (isEnd || paraBreak || i === prose.length) {
        const endPos = isEnd ? i + 1 : i;
        yield { from: start, to: endPos, text: prose.slice(start, endPos) };
        start = -1;
      }
    }
  }

  const ACRONYM_OK = new Set(['I', 'II', 'III', 'IV', 'VI', 'VII', 'VIII', 'IX', 'XI', 'XII', 'US', 'USA', 'UK', 'EU', 'OK', 'PDF', 'URL', 'HTTP', 'HTTPS', 'API', 'GPU', 'GPUs', 'CPU', 'CPUs', 'RAM', 'ID', 'IDs', 'TODO', 'FIXME', 'TBD', 'XXX', 'AND', 'OR', 'NOT', 'LaTeX', 'TeX', 'PhD', 'MSc', 'BSc', 'MIT', 'IEEE', 'ACM', 'ACL', 'NeurIPS', 'ICML', 'ICLR', 'CVPR', 'AAAI', 'IJCAI', 'KDD', 'EMNLP', 'NAACL', 'ECCV', 'ICCV', 'SIGIR', 'WWW', 'CHI', 'GB', 'MB', 'KB', 'TB', 'GHz', 'MHz', 'Hz', 'CC', 'BY', 'SA', 'AM', 'PM', 'TV', 'DNA', 'RNA']);

  /**
   * Returns issues: [{ rule, severity: 'error'|'warn'|'info', line, from, to, message, excerpt }]
   */
  function lintLatex(doc, opts = {}) {
    const issues = [];
    const starts = lineStarts(doc);
    const noComments = maskComments(doc);
    const noCode = maskCode(noComments);
    const prose = maskForProse(noComments);
    const proseNoHeadings = maskForProse(noComments, { headings: true });
    const perRule = new Map();
    const add = (rule, severity, from, to, message) => {
      const n = (perRule.get(rule) || 0) + 1;
      perRule.set(rule, n);
      if (n > (opts.maxPerRule || 50)) return;
      const line = lineOf(starts, from);
      const lineEnd = doc.indexOf('\n', from);
      const excerpt = doc.slice(starts[line - 1], lineEnd < 0 ? doc.length : lineEnd).trim().slice(0, 120);
      issues.push({ rule, severity, line, from, to, message, excerpt });
    };
    const each = (re, text, fn) => {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(text))) {
        fn(m);
        if (m[0].length === 0) re.lastIndex++;
      }
    };
    // Keys built from macro parameters (#1) are templates, not real labels.
    const realKey = (k) => k && !k.includes('#');
    const defsMasked = blankCommandArgs(noCode, DEFINITION_COMMANDS, { args: 2 }).replace(/\\(?:def|edef|gdef)\s*\\[A-Za-z@]+[^{\n]*\{[^\n]*\}?/g, blank);

    // --- labels and references
    const labels = new Map();
    each(/\\label\{([^}]+)\}/g, defsMasked, (m) => {
      const key = m[1].trim();
      if (!realKey(key)) return;
      if (labels.has(key)) add('duplicate-label', 'error', m.index, m.index + m[0].length, `중복된 라벨 \\label{${key}} (처음 정의: L${lineOf(starts, labels.get(key))})`);
      else labels.set(key, m.index);
    });
    const referenced = new Set();
    each(/\\(ref|eqref|autoref|pageref|cref|Cref|nameref|vref|Vref)\*?\{([^}]*)\}/g, defsMasked, (m) => {
      for (const key of m[2].split(',').map((k) => k.trim()).filter(realKey)) {
        referenced.add(key);
        if (!labels.has(key) && !opts.externalLabels?.has?.(key)) add('undefined-ref', 'warn', m.index, m.index + m[0].length, `이 파일에 없는 라벨 참조: ${key} (다른 파일에 정의돼 있으면 무시)`);
      }
    });
    for (const [key, pos] of labels) {
      if (!referenced.has(key) && !opts.externalRefs?.has?.(key) && /^(fig|tab|tbl|alg|eq|sec|app)[:\-_]/i.test(key)) {
        add('unused-label', 'info', pos, pos + key.length + 8, `본문에서 참조되지 않는 라벨: ${key}`);
      }
    }

    // --- citations
    each(/\\cite\w*\*?(\[[^\]]*\])*\{\s*\}/g, noCode, (m) => add('empty-cite', 'error', m.index, m.index + m[0].length, '빈 \\cite{}'));
    each(/([.,;:])\s*(~|\s)?\\(cite|citep|parencite|autocite)\b/g, noCode, (m) => {
      const before = noCode.slice(Math.max(0, m.index - 8), m.index + 1);
      if (/(e\.g\.,|i\.e\.,|cf\.,?|et al\.,?|etc\.,?|vs\.,?)$/.test(before)) return; // "e.g., \cite{x}" is fine
      add('cite-after-punct', 'info', m.index, m.index + m[0].length, '인용은 보통 문장 부호 앞에 둡니다: "... results~\\cite{x}."');
    });
    each(/([A-Za-z]{2,}|[)\]])[ \t]+\\(ref|eqref|cite|citep)\{/g, noCode, (m) => {
      if (/^(and|or|in|of|to|by|see|from|with|as)$/i.test(m[1]) && m[2].startsWith('cite')) return;
      add('nbsp', 'info', m.index + m[1].length, m.index + m[0].length, `줄바꿈 방지를 위해 공백 대신 ~ 사용: "${m[1]}~\\${m[2]}{"`);
    });

    // --- hard-coded numbers instead of \ref
    each(/\b(Figs?\.|Figures?|Tables?|Tabs?\.|Sections?|Secs?\.|Equations?|Eqs?\.|Algorithms?|Algs?\.|Appendix|Appendices)\s*~?\(?\d+(\.\d+)?\)?(\s*(--|–|and|,)\s*\(?\d+\)?)?|(그림|표|수식|식|절|장)\s*\d+/g, prose, (m) => {
      if (/^\s*(of|in|from)\s*~?\\cite/.test(doc.slice(m.index + m[0].length, m.index + m[0].length + 20))) return; // "Table 3 of \citet{x}"
      add('hardcoded-ref', 'info', m.index, m.index + m[0].length, `번호를 직접 쓰지 말고 \\ref 를 쓰세요: "${m[0]}"`);
    });

    // --- environments and braces (code, comments and disabled blocks ignored)
    const stack = [];
    each(/\\(begin|end)\{([^}]+)\}/g, defsMasked, (m) => {
      if (m[1] === 'begin') stack.push({ env: m[2], pos: m.index });
      else {
        const top = stack[stack.length - 1];
        if (top && top.env === m[2]) stack.pop();
        else if (stack.some((s) => s.env === m[2])) {
          while (stack.length && stack[stack.length - 1].env !== m[2]) {
            const s = stack.pop();
            add('env-unclosed', 'error', s.pos, s.pos + s.env.length + 8, `\\begin{${s.env}} 이 닫히지 않았습니다`);
          }
          stack.pop();
        } else add('env-extra-end', 'error', m.index, m.index + m[0].length, `짝이 없는 \\end{${m[2]}}`);
      }
    });
    for (const s of stack) add('env-unclosed', 'error', s.pos, s.pos + s.env.length + 8, `\\begin{${s.env}} 이 닫히지 않았습니다`);

    {
      const open = [];
      let extra = 0;
      for (let i = 0; i < noCode.length; i++) {
        const ch = noCode[i];
        if (ch === '\\') { i++; continue; }
        if (ch === '{') open.push(i);
        else if (ch === '}') {
          if (open.length) open.pop();
          else if (extra++ < 5) add('brace-extra', 'error', i, i + 1, '여는 짝이 없는 }');
        }
      }
      for (const p of open.slice(0, 5)) add('brace-unclosed', 'error', p, p + 1, '닫히지 않은 {');
    }

    // --- floats: caption/label presence and order (sub-figures/sub-tables excluded)
    each(/\\begin\{(figure|table|figure\*|table\*)\}([\s\S]*?)\\end\{\1\}/g, noCode, (m) => {
      let body = m[2].replace(/\\begin\{(subfigure|subtable|minipage)\}[\s\S]*?\\end\{\1\}/g, blank);
      body = blankCommandArgs(body, ['subfloat', 'subcaptionbox', 'subcaption'], { args: 1 });
      const cap = body.search(/\\caption\b/);
      const lab = body.search(/\\label\{/);
      if (cap < 0 && !/\\(subfloat|subcaptionbox)|\\begin\{sub(figure|table)\}/.test(m[2])) add('float-no-caption', 'warn', m.index, m.index + 14, `${m[1]} 환경에 \\caption 이 없습니다`);
      if (lab < 0) add('float-no-label', 'warn', m.index, m.index + 14, `${m[1]} 환경에 (본 캡션의) \\label 이 없습니다 (참조 불가)`);
      if (cap >= 0 && lab >= 0 && lab < cap) add('label-before-caption', 'warn', m.index, m.index + 14, '\\label 은 \\caption 뒤에 와야 번호가 맞습니다');
    });

    // --- prose checks
    each(/(^|[^`\w\\])"([^"\n]{1,200})"/g, prose, (m) => {
      const at = m.index + m[1].length;
      add('straight-quotes', 'info', at, at + m[2].length + 2, "직선 따옴표 대신 ``…'' 사용");
    });
    each(/\b([A-Za-z]{2,})\s+\1\b/gi, prose, (m) => {
      if (/^(that|had)$/i.test(m[1])) return; // "that that" / "had had" can be grammatical
      add('repeated-word', 'warn', m.index, m.index + m[0].length, `반복된 단어: "${m[0]}"`);
    });
    each(/\b(e\.g\.|i\.e\.)(?=\s)(?!,)/g, prose, (m) => add('eg-comma', 'info', m.index, m.index + m[0].length, `미국식 표기에서는 "${m[1]}," 처럼 쉼표를 붙입니다`));
    each(/\b(TODO|FIXME|TBD|XXX)\b|\\todo\b/g, maskCode(doc), (m) => add('todo', 'warn', m.index, m.index + m[0].length, `남아 있는 ${m[0]}`));

    // Long sentences: single linear pass (no backtracking), prose only.
    {
      const body = prose.replace(/\\[A-Za-z@]+\*?/g, (s) => ' '.repeat(s.length)).replace(/[{}]/g, ' ');
      for (const s of sentences(body)) {
        const words = s.text.trim().split(/\s+/).filter((w) => /[A-Za-z가-힣]/.test(w));
        if (words.length > (opts.maxWords || 45)) add('long-sentence', 'info', s.from, s.to, `긴 문장 (${words.length}단어) — 나누는 것을 고려하세요`);
      }
    }

    // Acronyms used but never defined as "Long Form (ACR)" / \newacronym / \DeclareAcronym.
    {
      const bodyStart = Math.max(0, bodyStartOf(noComments));
      const defined = new Set();
      each(/\((?:\\(?:emph|textit|textbf|textsc)\{)?([A-Z][A-Za-z0-9]*[A-Z0-9])s?\}?\s*[;,)]/g, noCode, (m) => defined.add(m[1]));
      each(/\\newacronym(?:\[[^\]]*\])?\{[^}]*\}\{([^}]+)\}/g, noComments, (m) => defined.add(m[1].trim()));
      each(/\\(?:acro|acrodef)\{([^}]+)\}(?:\[([^\]]+)\])?/g, noComments, (m) => { defined.add(m[1].trim()); if (m[2]) defined.add(m[2].trim()); });
      each(/\\DeclareAcronym\{[^}]*\}\{[^}]*short\s*=\s*([^,}]+)/g, noComments, (m) => defined.add(m[1].trim()));
      const seen = new Set();
      each(/\b([A-Z][A-Z0-9]{1,6})(s?)\b/g, proseNoHeadings, (m) => {
        if (m.index < bodyStart) return;
        const ac = m[1];
        if (seen.has(ac) || defined.has(ac) || ACRONYM_OK.has(ac) || ACRONYM_OK.has(ac + m[2]) || /^\d/.test(ac) || /^[A-Z]\d*$/.test(ac)) return;
        // ALL-CAPS phrases (headings/emphasis) are not acronyms
        const around = proseNoHeadings.slice(Math.max(0, m.index - 12), m.index + m[0].length + 12);
        if (/[A-Z]{2,}\s+[A-Z]{2,}\s+[A-Z]{2,}/.test(around)) return;
        seen.add(ac);
        add('acronym-undefined', 'info', m.index, m.index + m[0].length, `정의되지 않은 약어일 수 있음: ${ac} (처음 나올 때 "Full Name (${ac})")`);
      });
    }

    // Spelling variants: hyphenated vs closed forms, -ise vs -ize.
    {
      const lower = prose.toLowerCase();
      const words = new Map();
      each(/[a-z]+(?:-[a-z]+)*/g, lower, (m) => { if (!words.has(m[0])) words.set(m[0], m.index); });
      const reported = new Set();
      for (const [w, pos] of words) {
        if (!w.includes('-') || /^re-[a-z]+$/.test(w)) continue; // re-sign/resign, re-cover/recover are different words
        const closed = w.replace(/-/g, '');
        const other = words.has(closed) ? closed : null; // hyphen vs space is often legitimate (compound modifiers)
        if (other && !reported.has(w)) {
          reported.add(w);
          add('hyphen-variant', 'warn', pos, pos + w.length, `표기 혼용: "${w}" 와 "${other}" — 하나로 통일하세요`);
        }
      }
      for (const [w, pos] of words) {
        const m = /^(\w+)is(e|ed|es|ing|ation|ations)$/.exec(w);
        if (!m) continue;
        const us = `${m[1]}iz${m[2]}`;
        if (words.has(us) && !reported.has(w)) {
          reported.add(w);
          add('us-uk-variant', 'warn', pos, pos + w.length, `영국식/미국식 혼용: "${w}" 와 "${us}"`);
        }
      }
    }

    issues.sort((a, b) => a.line - b.line || SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
    return issues;
  }

  function summarize(issues, max = 60) {
    return issues.slice(0, max).map((i) => `L${i.line} [${i.severity}] ${i.message}`).join('\n') + (issues.length > max ? `\n… ${issues.length - max} more` : '');
  }

  function counts(issues) {
    const c = { error: 0, warn: 0, info: 0 };
    for (const i of issues) c[i.severity]++;
    return c;
  }

  const api = {
    lintLatex, summarize, counts, maskComments, maskCode, maskMath, maskForProse, blankCommandArgs, matchBrace, bodyStartOf, sentences,
    KEY_COMMANDS, DEFINITION_COMMANDS,
  };
  root.OLAI_LINT = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
