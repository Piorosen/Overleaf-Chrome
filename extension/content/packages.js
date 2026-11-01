// Overleaf AI — which LaTeX packages / TikZ libraries does the text need, and which are missing?
// Pure functions; no AI. Used by the "패키지" check view and after applying AI output.
(function (root) {
  'use strict';

  const L = root.OLAI_LINT || (typeof require !== 'undefined' ? require('./lint.js') : null);

  // sat: packages that satisfy the need ("pkg[opt]" = package loaded with that option).
  // cmds: control sequences (without backslash); envs: environment names; re: extra pattern.
  const RULES = [
    { pkg: 'graphicx', cmds: ['includegraphics', 'resizebox', 'scalebox', 'rotatebox', 'graphicspath'], why: '그림 삽입·크기 조절' },
    { pkg: 'amsmath', sat: ['amsmath', 'mathtools'], envs: ['align', 'align*', 'gather', 'gather*', 'multline', 'multline*', 'split', 'cases', 'pmatrix', 'bmatrix', 'vmatrix', 'Bmatrix', 'matrix', 'aligned', 'gathered', 'flalign', 'alignat', 'equation*', 'subequations'], cmds: ['eqref', 'DeclareMathOperator', 'operatorname', 'dfrac', 'tfrac', 'binom', 'intertext', 'boxed', 'numberwithin', 'tag', 'text', 'boldsymbol', 'xrightarrow', 'xleftarrow', 'overset', 'underset', 'iint', 'iiint'], why: '수식 환경·명령' },
    { pkg: 'amssymb', sat: ['amssymb', 'amsfonts'], cmds: ['mathbb', 'mathfrak'], why: '\\mathbb 등 수학 글꼴' },
    { pkg: 'amssymb', cmds: ['checkmark', 'blacksquare', 'varnothing', 'leqslant', 'geqslant', 'lesssim', 'gtrsim', 'therefore', 'because', 'nexists'], why: '수학 기호' },
    { pkg: 'mathrsfs', cmds: ['mathscr'], why: '\\mathscr' },
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
    { pkg: 'algpseudocode', sat: ['algpseudocode', 'algorithmicx', 'algpseudocodex'], cmds: ['State', 'Require', 'Ensure', 'EndFor', 'EndIf', 'EndWhile', 'EndProcedure', 'Procedure', 'Function', 'EndFunction'], why: '의사코드 (\\State 등)' },
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
    { pkg: 'enumitem', sat: ['enumitem', 'enumerate', 'paralist'], re: /\\begin\{(?:itemize|enumerate|description)\}\s*\[|\\setlist\b|\\newlist\b/, why: '목록 옵션 [label=…]' },
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

  // Conservative knowledge of what classes / venue styles load (only well-established cases).
  const CLASS_LOADS = [
    [/^ams(art|book|proc)$/, ['amsmath', 'amsthm', 'amsfonts']],
    [/^acmart$/, ['amsmath', 'amsfonts', 'amssymb', 'graphicx', 'xcolor', 'hyperref', 'natbib', 'booktabs', 'caption']],
    [/^beamer$/, ['graphicx', 'xcolor', 'hyperref', 'amsmath', 'amssymb', 'amsthm', 'url']],
    [/^elsarticle$/, ['natbib', 'graphicx']],
    [/^revtex4(-\d)?$/, ['natbib', 'graphicx']],
    [/^(memoir)$/, ['url']],
  ];
  const STYLE_LOADS = [
    [/^neurips_?\d{4}$|^nips_?\d{4}$/, ['natbib']],
    [/^icml\d{4}$/, ['natbib', 'hyperref', 'url']],
    [/^iclr\d{4}_conference$/, ['natbib', 'fancyhdr']],
    [/^(acl|naacl|emnlp|eacl|coling)(\d{4})?$/, ['natbib', 'xcolor', 'hyperref', 'url']],
    [/^(cvpr|iccv|wacv)$/, ['hyperref', 'url']],
    [/^aaai\d{2}$/, ['natbib', 'graphicx', 'url']],
    [/^jmlr2e$/, ['natbib', 'graphicx', 'url', 'amsmath', 'amssymb']],
  ];
  const VENUE_STYLE_RE = /^(neurips|nips|icml|iclr|acl|naacl|emnlp|eacl|coling|cvpr|iccv|eccv|wacv|aaai|ijcai|kdd|sigir|www|chi|uist|interspeech|icassp|miccai|mlsys|colm|tmlr|jmlr|corl|rss|icra|iros|aistats|uai|llncs|splncs|IEEEtran|ieeeconf|acmart|elsarticle)/i;

  // TikZ libraries used by common syntax (our TikZ action produces these).
  const TIKZ_LIBS = [
    { lib: 'arrows.meta', re: /-\{?\s*(Stealth|Latex|Triangle|Kite|Circle|Square|To|Rays|Bar)\b|\b(Stealth|Latex)\s*\[/, why: '화살표 끝 모양' },
    { lib: 'positioning', re: /\b(above|below|left|right)(\s+(left|right))?\s*=\s*([-\d.]+\s*(cm|mm|pt|em|ex)?\s+)?of\b|node\s+distance/, why: '"right=of" 배치' },
    { lib: 'calc', re: /\(\$[^$]*\$\)/, why: '좌표 계산 ($...$)' },
    { lib: 'shapes.geometric', re: /\bshape\s*=\s*(diamond|ellipse|regular polygon|trapezium|cylinder|star)\b|[[,]\s*(diamond|ellipse|regular polygon|trapezium|cylinder|star)\s*[,\]]/, why: '노드 모양 (diamond, ellipse 등)' },
    { lib: 'fit', re: /\bfit\s*=/, why: 'fit=' },
    { lib: 'backgrounds', re: /on background layer|\bbackground rectangle\b/, why: '배경 레이어' },
    { lib: 'decorations.pathreplacing', re: /decoration\s*=\s*\{?\s*brace|decorate\b/, why: '중괄호 장식' },
    { lib: 'patterns', re: /\bpattern\s*=/, why: '채우기 패턴' },
    { lib: 'matrix', re: /\bmatrix of (math )?nodes\b/, why: 'matrix of nodes' },
    { lib: 'quotes', re: /edge\s*\["/, why: 'edge["label"]' },
  ];

  // Same-length masking from lint.js (correct % handling, code/verbatim/\iffalse blocks).
  function stripComments(text) {
    return L ? L.maskComments(String(text)) : String(text).replace(/(^|[^\\])%[^\n]*/g, '$1');
  }
  function stripVerbatim(text) {
    return L ? L.maskCode(text) : text;
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
    const docClass = cls ? cls[1].trim() : '';
    // Packages that a class or a well-known venue style loads by itself.
    const add = (name) => { if (!pkgs.has(name)) pkgs.set(name, new Set()); };
    for (const [re, list] of CLASS_LOADS) if (re.test(docClass)) list.forEach(add);
    const styles = [...pkgs.keys()];
    for (const st of styles) for (const [re, list] of STYLE_LOADS) if (re.test(st)) list.forEach(add);
    // Preamble split into other files: \input{preamble}, \include, subfiles — we cannot see it.
    const beginAt = src.search(/\\begin\{document\}/);
    const preambleSrc = beginAt >= 0 ? src.slice(0, beginAt) : src;
    const externalPreamble = /\\(input|include|subfile)\s*\{/.test(preambleSrc) || /^subfiles$/.test(docClass);
    const venueStyle = styles.find((st) => VENUE_STYLE_RE.test(st)) || '';
    const libs = new Set();
    const lre = /\\use(?:tikz|pgf)library\s*\{([^}]*)\}/g;
    while ((m = lre.exec(src))) for (const l of m[1].split(',').map((s) => s.trim()).filter(Boolean)) libs.add(l);
    return { pkgs, docClass, libs, hasPreamble: !!cls, externalPreamble, venueStyle };
  }

  function userDefinedCommands(doc) {
    const src = stripComments(doc);
    const out = new Set();
    const res = [
      /\\(?:re)?newcommand\*?\s*\{?\\([A-Za-z@]+)/g,
      /\\(?:providecommand|DeclareRobustCommand|NewDocumentCommand|RenewDocumentCommand|DeclareDocumentCommand|ProvideDocumentCommand|NewExpandableDocumentCommand)\*?\s*\{?\\([A-Za-z@]+)/g,
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
    // TikZ libraries: only look inside tikzpicture bodies and \tikzset/\tikzstyle definitions.
    const tikzParts = [];
    for (const m of src.matchAll(/\\begin\{tikzpicture\}[\s\S]*?\\end\{tikzpicture\}|\\tikzset\s*\{[^\n]*|\\tikzstyle[^\n]*/g)) tikzParts.push({ text: m[0], at: m.index });
    for (const l of TIKZ_LIBS) {
      for (const part of tikzParts) {
        const m = l.re.exec(part.text);
        if (m) { found.set(`tikzlib:${l.lib}`, { kind: 'tikzlib', name: l.lib, why: l.why, index: part.at + m.index }); break; }
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
    return { hasPreamble: loaded.hasPreamble, docClass: loaded.docClass, externalPreamble: loaded.externalPreamble, venueStyle: loaded.venueStyle, missing };
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
    const masked = stripComments(doc);
    const begin = masked.search(/\\begin\{document\}/);
    const clsAt = masked.search(/\\documentclass\b/);
    if (clsAt < 0 || begin < 0) return null;
    // End offset of a command starting at `at`: skip "\name", then any [..] and {..} groups (brace-matched).
    const commandEnd = (at) => {
      let i = at + 1;
      while (i < masked.length && /[A-Za-z@*]/.test(masked[i])) i++;
      for (;;) {
        let j = i;
        while (j < masked.length && /[ \t\n]/.test(masked[j]) && !(masked[j] === '\n' && masked[j + 1] === '\n')) j++;
        if (masked[j] === '[') { const c = masked.indexOf(']', j); if (c < 0) return i; i = c + 1; continue; }
        if (masked[j] === '{') { const c = L ? L.matchBrace(masked, j) : masked.indexOf('}', j); if (c < 0) return i; i = c + 1; continue; }
        return i;
      }
    };
    const lineEndAfter = (pos) => { const nl = doc.indexOf('\n', pos); return nl < 0 ? doc.length : nl + 1; };
    const cmds = [];
    const re = /\\(usepackage|RequirePackage|usetikzlibrary)\b/g;
    let m;
    while ((m = re.exec(masked)) && m.index < begin) {
      const end = commandEnd(m.index);
      cmds.push({ kind: m[1], at: m.index, end: lineEndAfter(end - 1), text: masked.slice(m.index, end) });
      re.lastIndex = end;
    }
    const clsEnd = lineEndAfter(commandEnd(clsAt) - 1);
    const isLate = (c) => c.kind !== 'usetikzlibrary' && /\{[^}]*\b(hyperref|cleveref)\b/.test(c.text);
    const firstLate = cmds.find(isLate);
    const normalCmds = cmds.filter((c) => !isLate(c) && (!firstLate || c.at < firstLate.at));
    const lastNormalEnd = normalCmds.length ? normalCmds[normalCmds.length - 1].end : clsEnd;
    const preEnd = cmds.length ? cmds[cmds.length - 1].end : clsEnd;
    const tikzLoad = cmds.find((c) => c.kind !== 'usetikzlibrary' && /\{[^}]*\b(tikz|pgfplots)\b/.test(c.text));
    const ensureNl = (s2, pos) => (pos > 0 && doc[pos - 1] !== '\n' ? `\n${s2}` : s2);

    const pkgs = items.filter((i) => i.kind === 'package');
    const libs = items.filter((i) => i.kind === 'tikzlib');
    const normal = pkgs.filter((i) => i.name !== 'hyperref' && i.name !== 'cleveref');
    const late = pkgs.filter((i) => i.name === 'hyperref' || i.name === 'cleveref');
    const edits = [];
    const normalPos = firstLate ? firstLate.at : lastNormalEnd;
    const insertingTikz = normal.some((i) => i.name === 'tikz' || i.name === 'pgfplots');
    // TikZ libraries go right after the line that loads tikz (existing, or the one we insert now).
    const libsWithNormal = libs.length && (insertingTikz || !tikzLoad || tikzLoad.end <= normalPos);
    if (normal.length || libsWithNormal) {
      const lines = preambleLines([...normal, ...(libsWithNormal ? libs : [])]);
      edits.push({ pos: normalPos, text: ensureNl(`${lines.join('\n')}\n`, normalPos) });
    }
    if (libs.length && !libsWithNormal) edits.push({ pos: tikzLoad.end, text: ensureNl(`${preambleLines(libs).join('\n')}\n`, tikzLoad.end) });
    if (late.length) edits.push({ pos: preEnd, text: ensureNl(`${preambleLines(late).join('\n')}\n`, preEnd) });
    return edits;
  }

  // As lint issues so they show up in the "점검" list and the badge count.
  function asIssues(result) {
    const unsure = result.externalPreamble || !!result.venueStyle || !result.hasPreamble;
    return result.missing.filter((m) => m.line).map((m) => ({
      rule: 'missing-package',
      severity: unsure ? 'info' : 'warn',
      line: m.line,
      from: 0,
      to: 0,
      message: m.kind === 'tikzlib' ? `TikZ 라이브러리 필요: \\usetikzlibrary{${m.name}} — ${m.why}` : `패키지 필요: \\usepackage{${m.name}} — ${m.why}`,
      excerpt: !result.hasPreamble ? '이 파일에 프리앰블이 없습니다. main 파일에 이미 있으면 무시하세요.'
        : result.externalPreamble ? '프리앰블 일부가 \\input 된 다른 파일에 있어 확인할 수 없습니다.'
          : result.venueStyle ? `학회 스타일(${result.venueStyle})이 이미 불러왔을 수 있습니다.` : '',
    }));
  }

  const api = { RULES, TIKZ_LIBS, loadedPackages, userDefinedCommands, requirements, analyze, preambleLines, insertionEdits, asIssues };
  root.OLAI_PKG = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
