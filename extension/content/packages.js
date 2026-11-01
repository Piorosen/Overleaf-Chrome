// Overleaf AI — which LaTeX packages / TikZ libraries does the text need, and which are missing?
// Pure functions; no AI. Used by the "패키지" check view and after applying AI output.
(function (root) {
  'use strict';

  // sat: packages that satisfy the need ("pkg[opt]" = package loaded with that option).
  // cmds: control sequences (without backslash); envs: environment names; re: extra pattern.
  const RULES = [
    { pkg: 'graphicx', cmds: ['includegraphics', 'resizebox', 'scalebox', 'rotatebox', 'graphicspath'], why: '그림 삽입·크기 조절' },
    { pkg: 'amsmath', sat: ['amsmath', 'mathtools'], envs: ['align', 'align*', 'gather', 'gather*', 'multline', 'multline*', 'split', 'cases', 'pmatrix', 'bmatrix', 'vmatrix', 'Bmatrix', 'matrix', 'aligned', 'gathered', 'flalign', 'alignat'], cmds: ['eqref', 'DeclareMathOperator', 'operatorname', 'dfrac', 'tfrac', 'binom', 'intertext', 'boxed', 'numberwithin', 'tag'], why: '수식 환경·명령' },
    { pkg: 'amssymb', sat: ['amssymb', 'amsfonts'], cmds: ['mathbb', 'mathfrak'], why: '\\mathbb 등 수학 글꼴' },
    { pkg: 'amssymb', cmds: ['checkmark', 'blacksquare', 'varnothing', 'leqslant', 'geqslant', 'lesssim', 'gtrsim', 'therefore', 'because', 'nexists', 'mathbbm'], why: '수학 기호' },
    { pkg: 'amsthm', envs: ['proof'], cmds: ['newtheorem*', 'theoremstyle', 'qedhere'], why: '정리·증명 환경' },
    { pkg: 'bm', cmds: ['bm'], why: '굵은 수학 기호 \\bm' },
    { pkg: 'mathtools', cmds: ['coloneqq', 'eqqcolon', 'mathclap', 'DeclarePairedDelimiter', 'prescript', 'shortintertext'], why: 'mathtools 명령' },
    { pkg: 'dsfont', cmds: ['mathds'], why: '\\mathds' },
    { pkg: 'bbm', cmds: ['mathbbm'], why: '\\mathbbm' },
    { pkg: 'booktabs', cmds: ['toprule', 'midrule', 'bottomrule', 'cmidrule', 'addlinespace'], why: '표 가로줄 (\\toprule 등)' },
    { pkg: 'multirow', cmds: ['multirow'], why: '\\multirow' },
    { pkg: 'makecell', cmds: ['makecell', 'thead'], why: '\\makecell' },
    { pkg: 'tabularx', envs: ['tabularx'], why: 'tabularx 환경' },
    { pkg: 'longtable', envs: ['longtable'], why: 'longtable 환경' },
    { pkg: 'threeparttable', envs: ['threeparttable'], cmds: ['tnote'], why: '표 주석' },
    { pkg: 'diagbox', cmds: ['diagbox'], why: '\\diagbox' },
    { pkg: 'colortbl', sat: ['colortbl', 'xcolor[table]'], cmds: ['rowcolor', 'cellcolor', 'columncolor'], why: '표 셀 색' },
    { pkg: 'xcolor', sat: ['xcolor', 'color', 'tikz', 'pgf', 'pgfplots'], cmds: ['textcolor', 'color', 'colorbox', 'definecolor', 'fcolorbox'], why: '글자·배경 색' },
    { pkg: 'hyperref', cmds: ['href', 'autoref', 'hypersetup', 'phantomsection', 'hyperlink', 'hypertarget'], why: '링크·\\autoref' },
    { pkg: 'url', sat: ['url', 'hyperref', 'xurl'], cmds: ['url'], why: '\\url' },
    { pkg: 'cleveref', cmds: ['cref', 'Cref', 'crefname', 'Crefname', 'crefrange'], why: '\\cref' },
    { pkg: 'natbib', sat: ['natbib', 'biblatex'], cmds: ['citep', 'citet', 'citealp', 'citealt', 'citeauthor', 'citeyearpar'], why: '\\citep / \\citet (학회 스타일 파일이 이미 불러올 수 있음)' },
    { pkg: 'biblatex', cmds: ['printbibliography', 'addbibresource', 'parencite', 'textcite', 'autocite'], why: 'biblatex 인용' },
    { pkg: 'siunitx', cmds: ['SI', 'si', 'num', 'qty', 'unit', 'ang', 'SIrange', 'numrange', 'sisetup'], why: '숫자·단위 표기' },
    { pkg: 'algorithm', sat: ['algorithm', 'algorithm2e'], envs: ['algorithm', 'algorithm*'], why: 'algorithm 플로트' },
    { pkg: 'algpseudocode', sat: ['algpseudocode', 'algorithmicx'], cmds: ['State', 'Require', 'Ensure', 'EndFor', 'EndIf', 'EndWhile', 'EndProcedure', 'Procedure', 'Function', 'EndFunction'], why: '의사코드 (\\State 등)' },
    { pkg: 'algorithmic', cmds: ['STATE', 'REQUIRE', 'ENSURE', 'ENDFOR', 'ENDIF', 'ENDWHILE'], why: '의사코드 (\\STATE 등)' },
    { pkg: 'tikz', sat: ['tikz', 'pgfplots'], envs: ['tikzpicture'], cmds: ['tikz', 'usetikzlibrary', 'tikzset'], why: 'TikZ 그림' },
    { pkg: 'pgfplots', envs: ['axis', 'semilogyaxis', 'semilogxaxis', 'loglogaxis'], cmds: ['addplot', 'pgfplotsset'], why: 'pgfplots 그래프' },
    { pkg: 'subcaption', envs: ['subfigure', 'subtable'], cmds: ['subcaption', 'subcaptionbox', 'subref'], why: '하위 그림·표' },
    { pkg: 'subfig', cmds: ['subfloat'], why: '\\subfloat' },
    { pkg: 'caption', sat: ['caption', 'subcaption'], cmds: ['captionof', 'captionsetup'], why: '\\captionof / \\captionsetup' },
    { pkg: 'float', re: /\\begin\{(?:figure|table|algorithm)\*?\}\s*\[H\]/, why: '[H] 배치' },
    { pkg: 'wrapfig', envs: ['wrapfigure', 'wraptable'], why: '본문 감싸는 그림' },
    { pkg: 'rotating', envs: ['sidewaystable', 'sidewaysfigure'], why: '회전된 플로트' },
    { pkg: 'pdflscape', sat: ['pdflscape', 'lscape'], envs: ['landscape'], why: '가로 페이지' },
    { pkg: 'adjustbox', envs: ['adjustbox'], cmds: ['adjustbox'], why: 'adjustbox' },
    { pkg: 'placeins', cmds: ['FloatBarrier'], why: '\\FloatBarrier' },
    { pkg: 'listings', envs: ['lstlisting'], cmds: ['lstinline', 'lstset', 'lstinputlisting'], why: '코드 목록' },
    { pkg: 'minted', envs: ['minted'], cmds: ['mintinline', 'inputminted'], why: '코드 강조 (minted, -shell-escape 필요)' },
    { pkg: 'enumitem', re: /\\begin\{(?:itemize|enumerate|description)\}\s*\[|\\setlist\b|\\newlist\b/, why: '목록 옵션 [label=…]' },
    { pkg: 'todonotes', cmds: ['todo', 'listoftodos', 'missingfigure'], why: '\\todo 메모' },
    { pkg: 'soul', sat: ['soul', 'soulutf8'], cmds: ['hl', 'st'], why: '형광펜 \\hl' },
    { pkg: 'ulem', cmds: ['uline', 'sout', 'uwave'], why: '밑줄·취소선' },
    { pkg: 'cancel', cmds: ['cancel', 'bcancel', 'xcancel'], why: '\\cancel' },
    { pkg: 'csquotes', cmds: ['enquote'], why: '\\enquote' },
    { pkg: 'xspace', cmds: ['xspace'], why: '\\xspace' },
    { pkg: 'nicefrac', sat: ['nicefrac', 'units'], cmds: ['nicefrac'], why: '\\nicefrac' },
    { pkg: 'pifont', cmds: ['ding'], why: '\\ding 기호' },
    { pkg: 'multicol', envs: ['multicols', 'multicols*'], why: '다단' },
    { pkg: 'setspace', envs: ['spacing'], cmds: ['doublespacing', 'onehalfspacing', 'singlespacing', 'setstretch'], why: '줄 간격' },
    { pkg: 'geometry', cmds: ['geometry', 'newgeometry', 'restoregeometry'], why: '여백 설정' },
    { pkg: 'fancyhdr', cmds: ['fancyhead', 'fancyfoot', 'fancyhf'], re: /\\pagestyle\{fancy\}/, why: '머리말·꼬리말' },
    { pkg: 'titlesec', cmds: ['titleformat', 'titlespacing'], why: '제목 서식' },
    { pkg: 'tcolorbox', envs: ['tcolorbox'], cmds: ['newtcolorbox', 'tcbset'], why: '색 상자' },
    { pkg: 'mdframed', envs: ['mdframed'], why: '테두리 상자' },
    { pkg: 'appendix', envs: ['appendices'], why: 'appendices 환경' },
    { pkg: 'glossaries', sat: ['glossaries', 'glossaries-extra'], cmds: ['gls', 'Gls', 'glspl', 'newacronym', 'acrshort', 'acrlong', 'acrfull', 'printglossary', 'makeglossaries'], why: '용어·약어 관리' },
    { pkg: 'acronym', sat: ['acronym', 'acro'], cmds: ['ac', 'acs', 'acl', 'acf', 'acp'], envs: ['acronym'], why: '약어 패키지' },
    { pkg: 'lipsum', cmds: ['lipsum'], why: '\\lipsum' },
    { pkg: 'comment', sat: ['comment', 'verbatim'], envs: ['comment'], why: 'comment 환경' },
    { pkg: 'authblk', cmds: ['affil'], why: '\\affil 소속' },
    { pkg: 'orcidlink', cmds: ['orcidlink'], why: 'ORCID 링크' },
    { pkg: 'fontawesome5', sat: ['fontawesome5', 'fontawesome'], re: /\\fa[A-Z][A-Za-z]+\b/, why: '아이콘' },
    { pkg: 'svg', cmds: ['includesvg'], why: 'SVG 그림' },
    { pkg: 'pdfpages', cmds: ['includepdf'], why: 'PDF 페이지 삽입' },
    { pkg: 'mhchem', sat: ['mhchem', 'chemformula'], cmds: ['ce'], why: '화학식 \\ce' },
    { pkg: 'braket', sat: ['braket', 'physics'], cmds: ['ket', 'bra', 'braket'], why: '브라-켓 표기' },
    { pkg: 'physics', sat: ['physics', 'derivative'], cmds: ['dv', 'pdv'], why: '미분 표기 \\dv' },
    { pkg: 'kotex', sat: ['kotex', 'xeCJK', 'CJKutf8', 'luatexko', 'ko.TeX', 'kotex-utf'], re: /[가-힣]/, body: true, why: '본문에 한글 (XeLaTeX/LuaLaTeX 컴파일러 권장)' },
  ];

  // TikZ libraries used by common syntax (our TikZ action produces these).
  const TIKZ_LIBS = [
    { lib: 'arrows.meta', re: /-\{?\s*(Stealth|Latex|Triangle|Kite|Circle|Square|To|Rays|Bar)\b|\b(Stealth|Latex)\s*\[/, why: '화살표 끝 모양' },
    { lib: 'positioning', re: /\b(above|below|left|right)(\s+(left|right))?\s*=\s*([-\d.]+\s*(cm|mm|pt|em|ex)?\s+)?of\b|node\s+distance/, why: '"right=of" 배치' },
    { lib: 'calc', re: /\(\$[^$]*\$\)/, why: '좌표 계산 ($...$)' },
    { lib: 'shapes.geometric', re: /\b(diamond|ellipse|regular polygon|trapezium|cylinder|star)\b/, why: '도형 (diamond 등)' },
    { lib: 'fit', re: /\bfit\s*=/, why: 'fit=' },
    { lib: 'backgrounds', re: /on background layer|\bbackground rectangle\b/, why: '배경 레이어' },
    { lib: 'decorations.pathreplacing', re: /decoration\s*=\s*\{?\s*brace|decorate\b/, why: '중괄호 장식' },
    { lib: 'patterns', re: /\bpattern\s*=/, why: '채우기 패턴' },
    { lib: 'matrix', re: /\bmatrix of (math )?nodes\b/, why: 'matrix of nodes' },
    { lib: 'quotes', re: /edge\s*\["/, why: 'edge["label"]' },
  ];

  function stripComments(text) {
    return String(text).replace(/(^|[^\\])%[^\n]*/g, '$1');
  }
  function stripVerbatim(text) {
    return text.replace(/\\begin\{(verbatim|lstlisting|minted|comment)\}[\s\S]*?\\end\{\1\}/g, '').replace(/\\verb(.).*?\1/g, '');
  }
  function escapeRe(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  // \usepackage[opts]{a,b} and \RequirePackage, plus the document class.
  function loadedPackages(doc) {
    const src = stripComments(doc);
    const pkgs = new Map(); // name -> Set(options)
    const re = /\\(?:usepackage|RequirePackage)\s*(?:\[([^\]]*)\])?\s*\{([^}]*)\}/g;
    let m;
    while ((m = re.exec(src))) {
      const opts = (m[1] || '').split(',').map((s) => s.trim().split('=')[0]).filter(Boolean);
      for (const name of m[2].split(',').map((s) => s.trim()).filter(Boolean)) {
        if (!pkgs.has(name)) pkgs.set(name, new Set());
        for (const o of opts) pkgs.get(name).add(o);
      }
    }
    const cls = /\\documentclass\s*(?:\[[^\]]*\])?\s*\{([^}]*)\}/.exec(src);
    const libs = new Set();
    const lre = /\\use(?:tikz|pgf)library\s*\{([^}]*)\}/g;
    while ((m = lre.exec(src))) for (const l of m[1].split(',').map((s) => s.trim()).filter(Boolean)) libs.add(l);
    return { pkgs, docClass: cls ? cls[1].trim() : '', libs, hasPreamble: !!cls };
  }

  function userDefinedCommands(doc) {
    const src = stripComments(doc);
    const out = new Set();
    const res = [
      /\\(?:re)?newcommand\*?\s*\{?\\([A-Za-z@]+)/g,
      /\\(?:providecommand|DeclareRobustCommand)\*?\s*\{?\\([A-Za-z@]+)/g,
      /\\(?:DeclareMathOperator|DeclarePairedDelimiter)\*?\s*\{\\([A-Za-z@]+)\}/g,
      /\\def\s*\\([A-Za-z@]+)/g,
      /\\let\s*\\([A-Za-z@]+)/g,
      /\\newenvironment\s*\{([A-Za-z*]+)\}/g,
    ];
    for (const re of res) { let m; while ((m = re.exec(src))) out.add(m[1]); }
    return out;
  }

  function isSatisfied(rule, loaded) {
    const sat = rule.sat || [rule.pkg];
    return sat.some((s) => {
      const m = /^([^[]+)(?:\[(.+)\])?$/.exec(s);
      if (!loaded.pkgs.has(m[1])) return false;
      return !m[2] || loaded.pkgs.get(m[1]).has(m[2]);
    });
  }

  function lineOf(text, pos) {
    let n = 1;
    for (let i = 0; i < pos; i++) if (text[i] === '\n') n++;
    return n;
  }

  /**
   * What does `text` need? Returns [{ kind: 'package'|'tikzlib', name, why, index }] (deduplicated).
   * opts.userCmds: commands defined by the author (skip rules triggered only by them).
   */
  function requirements(text, opts = {}) {
    const src = stripVerbatim(stripComments(text));
    const userCmds = opts.userCmds || new Set();
    const bodyStart = opts.bodyStart || 0;
    const found = new Map();
    RULES.forEach((rule, ri) => {
      let idx = -1;
      for (const c of rule.cmds || []) {
        if (userCmds.has(c.replace(/\*$/, ''))) continue;
        const r = new RegExp(`\\\\${escapeRe(c)}(?![A-Za-z@])`);
        const m = r.exec(src);
        if (m && (idx < 0 || m.index < idx)) idx = m.index;
      }
      for (const e of rule.envs || []) {
        if (userCmds.has(e)) continue;
        const i = src.indexOf(`\\begin{${e}}`);
        if (i >= 0 && (idx < 0 || i < idx)) idx = i;
      }
      if (rule.re) {
        const r = new RegExp(rule.re.source, rule.re.flags.replace('g', ''));
        const sub = rule.body ? src.slice(bodyStart) : src;
        const m = r.exec(sub);
        if (m) {
          const i = m.index + (rule.body ? bodyStart : 0);
          if (idx < 0 || i < idx) idx = i;
        }
      }
      if (idx >= 0) found.set(`rule:${ri}`, { kind: 'package', name: rule.pkg, why: rule.why, index: idx, rule });
    });
    if (/\\begin\{tikzpicture\}|\\tikz\b/.test(src)) {
      for (const l of TIKZ_LIBS) {
        const m = l.re.exec(src);
        if (m) found.set(`tikzlib:${l.lib}`, { kind: 'tikzlib', name: l.lib, why: l.why, index: m.index });
      }
    }
    return [...found.values()].sort((a, b) => a.index - b.index);
  }

  /**
   * Missing packages for `doc` (or for `text` that will live in `doc`).
   * Returns { hasPreamble, docClass, missing: [{ kind, name, why, line }] }.
   */
  function analyze(doc, text) {
    const loaded = loadedPackages(doc);
    const src = text == null ? doc : text;
    const bodyStart = text == null ? Math.max(0, doc.search(/\\begin\{document\}/)) : 0;
    const userCmds = userDefinedCommands(doc);
    const missing = [];
    const seen = new Set();
    for (const r of requirements(src, { userCmds, bodyStart })) {
      if (r.kind === 'package' && isSatisfied(r.rule, loaded)) continue;
      if (r.kind === 'tikzlib' && loaded.libs.has(r.name)) continue;
      if (seen.has(`${r.kind}:${r.name}`)) continue; // requirements() is sorted by first use
      seen.add(`${r.kind}:${r.name}`);
      missing.push({ kind: r.kind, name: r.name, why: r.why, line: text == null ? lineOf(doc, r.index) : null });
    }
    return { hasPreamble: loaded.hasPreamble, docClass: loaded.docClass, missing };
  }

  function preambleLines(items) {
    const pkgs = items.filter((i) => i.kind === 'package').map((i) => i.name);
    const libs = items.filter((i) => i.kind === 'tikzlib').map((i) => i.name);
    const ordered = [...pkgs.filter((p) => p !== 'hyperref' && p !== 'cleveref'), ...pkgs.filter((p) => p === 'hyperref'), ...pkgs.filter((p) => p === 'cleveref')];
    const lines = ordered.map((p) => `\\usepackage{${p}}`);
    if (libs.length) lines.push(`\\usetikzlibrary{${libs.join(',')}}`);
    return lines;
  }

  /**
   * Where to insert into the preamble. Ordinary packages go after the last \usepackage line but
   * before hyperref/cleveref (which should be loaded last); hyperref/cleveref go at the end.
   * Returns [{ pos, text }] edits (pos in `doc`), or null if `doc` has no preamble.
   */
  function insertionEdits(doc, items) {
    const begin = doc.search(/\\begin\{document\}/);
    const cls = /\\documentclass[^\n]*\n?/.exec(doc);
    if (!cls || begin < 0) return null;
    const pre = doc.slice(0, begin);
    const lineRe = /^[ \t]*\\(?:usepackage|RequirePackage|usetikzlibrary)\b[^\n]*\n?/gm;
    let lastEnd = cls.index + cls[0].length;
    let lateStart = -1;
    let m;
    while ((m = lineRe.exec(pre))) {
      const isLate = /usepackage|RequirePackage/.test(m[0]) && /\{[^}]*\b(hyperref|cleveref)\b[^}]*\}/.test(m[0]);
      if (isLate) { if (lateStart < 0) lateStart = m.index; } else if (lateStart < 0) lastEnd = m.index + m[0].length;
    }
    let preEnd = cls.index + cls[0].length;
    lineRe.lastIndex = 0;
    while ((m = lineRe.exec(pre))) preEnd = m.index + m[0].length;
    const ensureNl = (s, pos) => (pos > 0 && doc[pos - 1] !== '\n' ? `\n${s}` : s);
    const normal = items.filter((i) => !(i.kind === 'package' && (i.name === 'hyperref' || i.name === 'cleveref')));
    const late = items.filter((i) => i.kind === 'package' && (i.name === 'hyperref' || i.name === 'cleveref'));
    const edits = [];
    if (normal.length) {
      const pos = lateStart >= 0 ? lateStart : lastEnd;
      edits.push({ pos, text: ensureNl(`${preambleLines(normal).join('\n')}\n`, pos) });
    }
    if (late.length) edits.push({ pos: preEnd, text: ensureNl(`${preambleLines(late).join('\n')}\n`, preEnd) });
    return edits;
  }

  // As lint issues so they show up in the "점검" list and the badge count.
  function asIssues(result) {
    return result.missing.filter((m) => m.line).map((m) => ({
      rule: 'missing-package',
      severity: 'warn',
      line: m.line,
      from: 0,
      to: 0,
      message: m.kind === 'tikzlib' ? `TikZ 라이브러리 필요: \\usetikzlibrary{${m.name}} — ${m.why}` : `패키지 필요: \\usepackage{${m.name}} — ${m.why}`,
      excerpt: result.hasPreamble ? '' : '이 파일에 프리앰블이 없습니다. main 파일에 이미 있으면 무시하세요.',
    }));
  }

  const api = { RULES, TIKZ_LIBS, loadedPackages, userDefinedCommands, requirements, analyze, preambleLines, insertionEdits, asIssues };
  root.OLAI_PKG = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
