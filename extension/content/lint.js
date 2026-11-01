// Overleaf AI — local LaTeX/manuscript checks. Instant, no AI, pure functions.
(function (root) {
  'use strict';

  const SEVERITY_ORDER = { error: 0, warn: 1, info: 2 };

  // Same-length copy of `doc` with comments blanked (newlines kept), so offsets stay valid.
  function maskComments(doc) {
    return doc.replace(/(^|[^\\])(%[^\n]*)/g, (m, pre, c) => pre + ' '.repeat(c.length));
  }

  const MATH_ENVS = 'equation|equation\\*|align|align\\*|gather|gather\\*|multline|multline\\*|eqnarray|eqnarray\\*|displaymath|math|split|flalign|flalign\\*';
  const VERBATIM_ENVS = 'verbatim|lstlisting|minted|comment';

  function blank(s) { return s.replace(/[^\n]/g, ' '); }

  // Additionally blank math, verbatim and the arguments of reference-like commands (prose-only view).
  function maskForProse(textNoComments) {
    let t = textNoComments;
    t = t.replace(new RegExp(`\\\\begin\\{(${VERBATIM_ENVS})\\}[\\s\\S]*?\\\\end\\{\\1\\}`, 'g'), blank);
    t = t.replace(new RegExp(`\\\\begin\\{(${MATH_ENVS})\\}[\\s\\S]*?\\\\end\\{\\1\\}`, 'g'), blank);
    t = t.replace(/\\\[[\s\S]*?\\\]/g, blank);
    t = t.replace(/\\\([\s\S]*?\\\)/g, blank);
    t = t.replace(/\$\$[\s\S]*?\$\$/g, blank);
    t = t.replace(/(^|[^\\])\$(?:\\.|[^$\\])*\$/g, (m, pre) => pre + blank(m.slice(pre.length)));
    t = t.replace(/\\(cite\w*|ref|eqref|autoref|cref|Cref|pageref|label|url|href|includegraphics|input|include|begin|end|usepackage|documentclass|bibliography|bibliographystyle|newcommand|renewcommand|def|hypersetup)\*?(\[[^\]]*\])*\{[^}]*\}/g, blank);
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

  const ACRONYM_OK = new Set(['I', 'II', 'III', 'IV', 'VI', 'VII', 'VIII', 'IX', 'XI', 'XII', 'US', 'USA', 'UK', 'EU', 'OK', 'PDF', 'URL', 'HTTP', 'HTTPS', 'API', 'GPU', 'GPUs', 'CPU', 'CPUs', 'RAM', 'ID', 'IDs', 'TODO', 'FIXME', 'TBD', 'XXX', 'AND', 'OR', 'NOT', 'LaTeX', 'TeX', 'PhD', 'MSc', 'BSc', 'MIT', 'IEEE', 'ACM', 'ACL', 'NeurIPS', 'ICML', 'ICLR', 'CVPR', 'AAAI', 'IJCAI', 'KDD', 'EMNLP', 'NAACL', 'ECCV', 'ICCV', 'SIGIR', 'WWW', 'CHI', 'GB', 'MB', 'KB', 'TB', 'GHz', 'MHz', 'Hz', 'CC', 'BY', 'SA']);

  /**
   * Returns issues: [{ rule, severity: 'error'|'warn'|'info', line, from, to, message, excerpt }]
   */
  function lintLatex(doc, opts = {}) {
    const issues = [];
    const starts = lineStarts(doc);
    const noComments = maskComments(doc);
    const prose = maskForProse(noComments);
    const add = (rule, severity, from, to, message) => {
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

    // --- labels and references
    const labels = new Map();
    each(/\\label\{([^}]+)\}/g, noComments, (m) => {
      const key = m[1].trim();
      if (labels.has(key)) add('duplicate-label', 'error', m.index, m.index + m[0].length, `중복된 라벨 \\label{${key}} (처음 정의: L${lineOf(starts, labels.get(key))})`);
      else labels.set(key, m.index);
    });
    const referenced = new Set();
    each(/\\(ref|eqref|autoref|pageref|cref|Cref|nameref|vref)\*?\{([^}]*)\}/g, noComments, (m) => {
      for (const key of m[2].split(',').map((k) => k.trim()).filter(Boolean)) {
        referenced.add(key);
        if (!labels.has(key)) add('undefined-ref', 'warn', m.index, m.index + m[0].length, `이 파일에 없는 라벨 참조: ${key} (다른 파일에 정의돼 있으면 무시)`);
      }
    });
    for (const [key, pos] of labels) {
      if (!referenced.has(key) && /^(fig|tab|tbl|alg|eq|sec|app)[:\-_]/i.test(key)) {
        add('unused-label', 'info', pos, pos + key.length + 8, `본문에서 참조되지 않는 라벨: ${key}`);
      }
    }

    // --- citations
    each(/\\cite\w*\*?(\[[^\]]*\])*\{\s*\}/g, noComments, (m) => add('empty-cite', 'error', m.index, m.index + m[0].length, '빈 \\cite{}'));
    each(/[.,;:]\s*(~|\s)?\\cite[pt]?\b/g, noComments, (m) => add('cite-after-punct', 'info', m.index, m.index + m[0].length, '인용은 보통 문장 부호 앞에 둡니다: "... results~\\cite{x}."'));
    each(/([A-Za-z.)\]])[ \t]+\\(ref|eqref|autoref|cref|cite[pt]?|cite)\{/g, noComments, (m) => {
      if (/\\(autoref|cref)/.test(m[0])) return;
      add('nbsp', 'info', m.index + 1, m.index + m[0].length, `줄바꿈 방지를 위해 공백 대신 ~ 사용: "${m[1]}~\\${m[2]}{"`);
    });

    // --- hard-coded numbers instead of \ref
    each(/\b(Figure|Fig\.|Table|Tab\.|Section|Sec\.|Equation|Eq\.|Algorithm|Alg\.|Appendix)\s*~?\(?\d+(\.\d+)?\)?/g, prose, (m) => add('hardcoded-ref', 'info', m.index, m.index + m[0].length, `번호를 직접 쓰지 말고 \\ref 를 쓰세요: "${m[0]}"`));

    // --- environments and braces
    const stack = [];
    each(/\\(begin|end)\{([^}]+)\}/g, noComments, (m) => {
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
      const masked = noComments.replace(new RegExp(`\\\\begin\\{(${VERBATIM_ENVS})\\}[\\s\\S]*?\\\\end\\{\\1\\}`, 'g'), blank).replace(/\\verb(.).*?\1/g, blank);
      for (let i = 0; i < masked.length; i++) {
        const ch = masked[i];
        if (ch === '\\') { i++; continue; }
        if (ch === '{') open.push(i);
        else if (ch === '}') {
          if (open.length) open.pop();
          else add('brace-extra', 'error', i, i + 1, '여는 짝이 없는 }');
        }
      }
      for (const p of open.slice(0, 5)) add('brace-unclosed', 'error', p, p + 1, '닫히지 않은 {');
    }

    // --- floats: caption/label presence and order
    each(/\\begin\{(figure|table|figure\*|table\*)\}([\s\S]*?)\\end\{\1\}/g, noComments, (m) => {
      const body = m[2];
      const cap = body.search(/\\caption\b/);
      const lab = body.search(/\\label\{/);
      if (cap < 0) add('float-no-caption', 'warn', m.index, m.index + 14, `${m[1]} 환경에 \\caption 이 없습니다`);
      if (lab < 0) add('float-no-label', 'warn', m.index, m.index + 14, `${m[1]} 환경에 \\label 이 없습니다 (참조 불가)`);
      if (cap >= 0 && lab >= 0 && lab < cap) add('label-before-caption', 'warn', m.index, m.index + 14, '\\label 은 \\caption 뒤에 와야 번호가 맞습니다');
    });

    // --- prose checks
    each(/(^|[^`\w])"([^"\n]{1,200})"/g, prose, (m) => {
      const at = m.index + m[1].length;
      add('straight-quotes', 'info', at, at + m[2].length + 2, "직선 따옴표 대신 ``…'' 사용");
    });
    each(/\b([A-Za-z]{2,})\s+\1\b/gi, prose, (m) => {
      if (/^(that|had)$/i.test(m[1])) return; // "that that" / "had had" can be grammatical
      add('repeated-word', 'warn', m.index, m.index + m[0].length, `반복된 단어: "${m[0]}"`);
    });
    each(/\b(e\.g\.|i\.e\.)(?=\s)(?!,)/g, prose, (m) => add('eg-comma', 'info', m.index, m.index + m[0].length, `미국식 표기에서는 "${m[1]}," 처럼 쉼표를 붙입니다`));
    each(/\b(TODO|FIXME|TBD|XXX)\b|\\todo\b/g, doc, (m) => add('todo', 'warn', m.index, m.index + m[0].length, `남아 있는 ${m[0]}`));

    // Long sentences (prose only, rough sentence split).
    {
      const body = prose.replace(/\\[A-Za-z@]+\*?/g, (s) => ' '.repeat(s.length)).replace(/[{}]/g, ' ');
      each(/[^.!?\n](?:[^.!?]|\.(?=\d)|\n(?!\s*\n))*[.!?]/g, body, (m) => {
        const words = m[0].trim().split(/\s+/).filter((w) => /[A-Za-z가-힣]/.test(w));
        if (words.length > (opts.maxWords || 45)) {
          const start = m.index + (m[0].length - m[0].trimStart().length);
          add('long-sentence', 'info', start, m.index + m[0].length, `긴 문장 (${words.length}단어) — 나누는 것을 고려하세요`);
        }
      });
    }

    // Acronyms used but never defined as "Long Form (ACR)".
    {
      const bodyStart = Math.max(0, doc.search(/\\begin\{document\}/));
      const defined = new Set();
      each(/\(([A-Z][A-Za-z]*[A-Z]s?)\)/g, prose, (m) => defined.add(m[1].replace(/s$/, '')));
      each(/\\(newacronym|acro|DeclareAcronym)\{([^}]+)\}/g, noComments, (m) => defined.add(m[2]));
      const seen = new Set();
      each(/\b([A-Z][A-Z0-9]{1,6})(s?)\b/g, prose, (m) => {
        if (m.index < bodyStart) return;
        const ac = m[1];
        if (seen.has(ac) || defined.has(ac) || ACRONYM_OK.has(ac) || ACRONYM_OK.has(ac + m[2]) || /^\d/.test(ac) || /^[A-Z]\d*$/.test(ac)) return;
        seen.add(ac);
        add('acronym-undefined', 'info', m.index, m.index + m[0].length, `정의되지 않은 약어일 수 있음: ${ac} (처음 나올 때 "Full Name (${ac})")`);
      });
    }

    // Spelling variants: hyphenated vs closed/open forms, -ise vs -ize.
    {
      const lower = prose.toLowerCase();
      const words = new Map();
      each(/[a-z]+(?:-[a-z]+)*/g, lower, (m) => { if (!words.has(m[0])) words.set(m[0], m.index); });
      const reported = new Set();
      for (const [w, pos] of words) {
        if (!w.includes('-')) continue;
        const closed = w.replace(/-/g, '');
        const open = w.replace(/-/g, ' ');
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

  const api = { lintLatex, summarize, counts, maskComments, maskForProse };
  root.OLAI_LINT = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
