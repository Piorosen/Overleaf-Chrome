// Overleaf AI — settings, target resolution and prompt building.
// Pure functions only (no DOM / chrome APIs) so they can be unit-tested in Node.
(function (root) {
  'use strict';

  const C = root.OLAI_CATALOG || (typeof require !== 'undefined' ? require('./catalog.js') : null);

  const DEFAULT_SETTINGS = {
    backend: 'claude',             // 'claude' | 'codex'
    claudeModel: 'claude-opus-5-5',
    claudeEffort: 'auto',          // 'auto' | '' (CLI default) | low … max
    codexModel: '',
    codexEffort: 'auto',
    claudeCustomModels: '',        // extra model IDs, one per line
    codexCustomModels: '',
    claudeExtraArgs: '',
    codexExtraArgs: '',
    timeoutSec: 300,
    contextChars: 3000,            // characters of surrounding text sent before/after the target
    includeFullDoc: false,         // always send the entire current file as context
    styleGuide: '',                // extra writing rules appended to the system prompt
    customPresets: '',             // one per line: "라벨 | 지시문 [| transform|generate|compose|report]"
    quickActionId: 'polish',       // preset used by Alt+Shift+I on a selection/paragraph
    autoApplyQuick: false,
    showLauncher: true,
    explainLang: 'ko',             // language of reports/explanations: 'ko' | 'en'
    autoLint: true,                // re-run local checks while typing (no AI)
    allowWeb: true,                // allow web-search actions (Claude backend only)
    lastCategory: 'edit',
  };

  const LATEX_RULES = [
    'You are an expert academic writing assistant embedded in the Overleaf LaTeX editor.',
    'Your output is inserted verbatim into a .tex source file, so:',
    '- Output ONLY the resulting LaTeX source text. No explanations, no preamble, no notes, no markdown, no code fences, no surrounding tags.',
    '- Preserve LaTeX commands, environments, math, \\cite{}, \\ref{}, \\label{}, custom macros and comments unless the task requires changing them.',
    '- Never invent citations, references, data or numerical results. If something must be filled in later, write a LaTeX comment line starting with "% TODO:".',
    '- Keep the language of the original text unless the task asks for a translation.',
    '- Match the surrounding text\'s style, tense, terminology and notation.',
    '- Do not add \\documentclass, \\begin{document} or other document scaffolding unless explicitly asked.',
  ].join('\n');

  const REPORT_RULES = (lang) => [
    'You are an expert academic editor and reviewer helping an author who writes in the Overleaf LaTeX editor.',
    `Write your answer in ${lang === 'en' ? 'English' : 'Korean (한국어)'}; keep quoted source text and suggested English rewrites in their original language.`,
    '- Use concise Markdown: short headings, bullet lists, and tables where they help.',
    '- Source lines are prefixed with their line number like "42| text". Refer to locations as L42 or L42-L45 so the author can jump there.',
    '- Quote the exact phrase you are talking about, briefly.',
    '- Be specific and actionable. Never invent citations, data or results.',
  ].join('\n');

  const DIRECTIVE_RE = /^\s*%+\s*ai\s*[:：]\s*(.+?)\s*$/i;

  function parseDirective(lineText) {
    const m = DIRECTIVE_RE.exec(lineText || '');
    return m ? m[1] : null;
  }

  // ------------------------------------------------------------ geometry ---

  function splitLines(doc) {
    const lines = [];
    let start = 0;
    for (let i = 0; i <= doc.length; i++) {
      if (i === doc.length || doc[i] === '\n') {
        lines.push({ from: start, to: i, text: doc.slice(start, i) });
        start = i + 1;
      }
    }
    return lines;
  }

  function lineIndexAt(lines, pos) {
    let lo = 0;
    let hi = lines.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lines[mid].from <= pos) lo = mid; else hi = mid - 1;
    }
    return lo;
  }

  function lineNumberAt(doc, pos) {
    let n = 1;
    for (let i = 0; i < pos && i < doc.length; i++) if (doc[i] === '\n') n++;
    return n;
  }

  // Prefix each line with its 1-based number: "42| text".
  function numberLines(text, startLine = 1) {
    return text.split('\n').map((l, i) => `${startLine + i}| ${l}`).join('\n');
  }

  // Lines that delimit paragraphs besides blank lines.
  const STRUCTURAL_RE = /^\s*(\\(begin|end|section|subsection|subsubsection|paragraph|subparagraph|chapter|part|item|maketitle|label|caption|centering|includegraphics|bibliography|bibliographystyle|printbibliography|newpage|clearpage)\b|%)/;

  // Returns {from, to, text} of the paragraph around `pos`, or null on a blank line.
  function findParagraph(doc, pos) {
    const lines = splitLines(doc);
    const idx = lineIndexAt(lines, Math.min(pos, doc.length));
    const isBlank = (l) => !l.text.trim();
    const isStruct = (l) => STRUCTURAL_RE.test(l.text);
    const cur = lines[idx];
    if (!cur || isBlank(cur)) return null;
    if (isStruct(cur)) {
      if (/^\s*%/.test(cur.text)) return null; // comment lines are not a paragraph
      return { from: cur.from, to: cur.to, text: cur.text };
    }
    let a = idx;
    let b = idx;
    while (a - 1 >= 0 && !isBlank(lines[a - 1]) && !isStruct(lines[a - 1])) a--;
    while (b + 1 < lines.length && !isBlank(lines[b + 1]) && !isStruct(lines[b + 1])) b++;
    const from = lines[a].from;
    const to = lines[b].to;
    return { from, to, text: doc.slice(from, to) };
  }

  const HEADING_RE = /^\s*\\(part|chapter|section|subsection|subsubsection)\*?\s*[[{]/;
  const LEVEL = { part: 0, chapter: 1, section: 2, subsection: 3, subsubsection: 4 };
  const SECTION_END_RE = /^\s*(\\end\{document\}|\\bibliography\{|\\printbibliography|\\appendix\b)/;

  // The \section (or \chapter) containing `pos`, up to the next heading of the same or higher level.
  function findSection(doc, pos) {
    const lines = splitLines(doc);
    const idx = lineIndexAt(lines, Math.min(pos, doc.length));
    let start = -1;
    let level = 9;
    for (let i = idx; i >= 0; i--) {
      const m = HEADING_RE.exec(lines[i].text);
      if (m && LEVEL[m[1]] <= LEVEL.section) { start = i; level = LEVEL[m[1]]; break; }
    }
    if (start < 0) {
      const begin = lines.findIndex((l) => /\\begin\{document\}/.test(l.text));
      start = begin >= 0 && begin <= idx ? begin + 1 : 0;
    }
    let end = lines.length - 1;
    for (let i = Math.max(start + 1, 0); i < lines.length; i++) {
      const m = HEADING_RE.exec(lines[i].text);
      if ((m && LEVEL[m[1]] <= level) || SECTION_END_RE.test(lines[i].text)) { end = i - 1; break; }
    }
    if (end < start) end = start;
    while (end > start && !lines[end].text.trim()) end--;
    const from = lines[start].from;
    const to = lines[end].to;
    const heading = HEADING_RE.test(lines[start].text) ? lines[start].text.trim() : '';
    return { from, to, text: doc.slice(from, to), heading };
  }

  // ------------------------------------------------------ target resolution ---

  /**
   * Decide what a run operates on.
   * ctx: { doc, from, to, head, lineFrom, lineTo, lineText }
   * action: catalog action or { kind: 'custom'|'ask'|'directive', ... }
   * opts: { scope: 'auto'|'paragraph'|'section'|'document' }
   * Returns { mode: 'replace'|'insert'|'read', kind, from, to, text, label, context: 'around'|'document' } or { error }.
   */
  function resolveTarget(ctx, action, opts = {}) {
    const { doc } = ctx;
    const sel = doc.slice(ctx.from, ctx.to);
    const hasSel = ctx.to > ctx.from && sel.trim().length > 0;
    const forced = opts.scope && opts.scope !== 'auto' ? opts.scope : null;
    const scope = forced || action.scope || 'paragraph';
    const kind = action.kind;

    const selection = (mode) => ({ mode, kind: 'selection', from: ctx.from, to: ctx.to, text: sel, label: `선택 영역 (${sel.length.toLocaleString()}자)`, context: 'around' });
    const cursor = (pos, label = '커서 위치에 새로 작성') => ({ mode: 'insert', kind: 'cursor', from: pos, to: pos, text: '', label, context: 'around' });
    const scoped = (mode, which) => {
      if (which === 'document') {
        return { mode, kind: 'document', from: 0, to: doc.length, text: doc, label: `파일 전체 (${doc.length.toLocaleString()}자)`, context: 'document' };
      }
      if (which === 'section') {
        const s = findSection(doc, ctx.head);
        if (!s.text.trim()) return { error: '현재 섹션을 찾지 못했습니다.' };
        return { mode, kind: 'section', from: s.from, to: s.to, text: s.text, label: `현재 섹션 (${s.text.length.toLocaleString()}자)`, context: 'around' };
      }
      const p = findParagraph(doc, ctx.head);
      if (!p) return { error: '대상 텍스트를 선택하거나 문단 안에 커서를 두세요.' };
      return { mode, kind: 'paragraph', from: p.from, to: p.to, text: p.text, label: `현재 문단 (${p.text.length.toLocaleString()}자)`, context: 'around' };
    };

    if (kind === 'directive') {
      const directive = !hasSel ? parseDirective(ctx.lineText) : null;
      if (!directive) return { error: '커서가 있는 줄에 "% ai: 지시문" 이 없습니다.' };
      return { mode: 'replace', kind: 'directive', from: ctx.lineFrom, to: ctx.lineTo, text: ctx.lineText, directive, label: `지시문: ${directive}`, context: 'around' };
    }
    if (action.needsSelection && !hasSel) return { error: `"${action.label || '이 기능'}" 은 먼저 텍스트를 선택해야 합니다.` };

    switch (kind) {
      case 'transform':
        if (hasSel && !forced) return selection('replace');
        return scoped('replace', scope);
      case 'report':
      case 'ask':
        if (hasSel && !forced) return selection('read');
        return scoped('read', scope);
      case 'variants': {
        if (action.source === 'document') {
          const t = hasSel ? selection('replace') : cursor(ctx.head, '커서 위치에 삽입');
          return { ...t, context: 'document' };
        }
        if (hasSel) return selection('replace');
        return scoped('replace', 'paragraph');
      }
      case 'compose': {
        const t = hasSel ? selection('replace') : cursor(ctx.head, '커서 위치에 작성');
        return { ...t, context: 'document' };
      }
      case 'make':
        if (hasSel) return selection('replace');
        return { ...cursor(ctx.head, '커서 위치에 작성 (입력칸의 설명 사용)'), needsInstruction: true };
      case 'generate':
        if (hasSel) return { ...cursor(ctx.to, '선택 영역 뒤에 작성'), selectionText: sel };
        return cursor(ctx.head);
      case 'custom':
        if (hasSel && !forced) return selection('replace');
        if (forced) return scoped('replace', forced);
        return cursor(ctx.head);
      default:
        return { error: `알 수 없는 작업 종류: ${kind}` };
    }
  }

  // Compile-error target: lines around the first error line in the log, else selection/paragraph.
  function parseLogLine(logText) {
    const m = /(?:^|\n)\s*l\.(\d+)\b/.exec(logText) || /:(\d+):\s/.exec(logText) || /\bline\s+(\d+)\b/i.exec(logText);
    return m ? Number(m[1]) : null;
  }

  function resolveFixTarget(ctx, logText, radius = 10) {
    const { doc } = ctx;
    const line = parseLogLine(logText || '');
    const lines = splitLines(doc);
    if (line && line >= 1 && line <= lines.length) {
      const a = Math.max(0, line - 1 - radius);
      const b = Math.min(lines.length - 1, line - 1 + radius);
      const from = lines[a].from;
      const to = lines[b].to;
      return { mode: 'replace', kind: 'lines', from, to, text: doc.slice(from, to), label: `L${a + 1}-L${b + 1} (오류 L${line} 주변)`, context: 'around', errorLine: line };
    }
    const sel = doc.slice(ctx.from, ctx.to);
    if (ctx.to > ctx.from && sel.trim()) return { mode: 'replace', kind: 'selection', from: ctx.from, to: ctx.to, text: sel, label: `선택 영역 (${sel.length}자)`, context: 'around' };
    const p = findParagraph(doc, ctx.head);
    if (p) return { mode: 'replace', kind: 'paragraph', from: p.from, to: p.to, text: p.text, label: `현재 문단 (${p.text.length}자)`, context: 'around' };
    return { error: '로그에서 오류 줄을 찾지 못했습니다. 오류가 난 부분을 선택한 뒤 다시 실행하세요.' };
  }

  // ------------------------------------------------------------- prompts ---

  function contextAround(doc, target, settings) {
    if (target.context === 'document' || settings.includeFullDoc) {
      return { before: doc.slice(0, target.from), after: doc.slice(target.to), full: true };
    }
    const n = Math.max(0, Number(settings.contextChars) || 0);
    return {
      before: doc.slice(Math.max(0, target.from - n), target.from),
      after: doc.slice(target.to, target.to + n),
      full: false,
    };
  }

  function profileText(profile, catalog) {
    if (!profile) return '';
    const lines = [];
    const venue = (catalog?.VENUES || []).find((v) => v.id === profile.venuePreset);
    if (profile.venueName || (venue && venue.id)) lines.push(`Target venue: ${[profile.venueName, venue && venue.id ? venue.label : ''].filter(Boolean).join(' / ')}`);
    if (venue && venue.guide) lines.push(`Venue style: ${venue.guide}`);
    if (profile.field) lines.push(`Field: ${profile.field}`);
    if (profile.audience) lines.push(`Audience: ${profile.audience}`);
    if (profile.spelling === 'us') lines.push('Spelling: American English (e.g., -ize, color, modeling).');
    if (profile.spelling === 'uk') lines.push('Spelling: British English (e.g., -ise, colour, modelling).');
    if (profile.terms && profile.terms.trim()) lines.push(`Terminology to use consistently (preferred | avoid):\n${profile.terms.trim()}`);
    if (profile.notes && profile.notes.trim()) lines.push(`Author notes about this paper:\n${profile.notes.trim()}`);
    return lines.length ? `<paper_profile>\n${lines.join('\n')}\n</paper_profile>` : '';
  }

  function splitArgs(str) {
    const out = [];
    let cur = '';
    let has = false;
    let quote = null;
    const s = String(str || '');
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (quote === "'") {
        if (ch === "'") quote = null; else cur += ch;
      } else if (quote === '"') {
        if (ch === '"') quote = null;
        else if (ch === '\\' && i + 1 < s.length && /["\\$`]/.test(s[i + 1])) cur += s[++i];
        else cur += ch;
      } else if (ch === "'" || ch === '"') {
        quote = ch;
        has = true;
      } else if (ch === '\\' && i + 1 < s.length) {
        cur += s[++i];
        has = true;
      } else if (/\s/.test(ch)) {
        if (has) { out.push(cur); cur = ''; has = false; }
      } else {
        cur += ch;
        has = true;
      }
    }
    if (has) out.push(cur);
    return out;
  }

  const CUSTOM_KINDS = new Set(['transform', 'generate', 'compose', 'report']);

  function parseCustomPresets(text) {
    return String(text || '').split('\n').map((line, i) => {
      const parts = line.split('|').map((s) => s.trim());
      if (parts.length < 2 || !parts[0] || !parts[1]) return null;
      const kind = CUSTOM_KINDS.has(parts[2]) ? parts[2] : 'transform';
      return { id: `custom-${i}`, cat: 'custom', label: parts[0], kind, instruction: parts[1], desc: parts[1], effort: kind === 'report' ? 'high' : 'medium', custom: true };
    }).filter(Boolean);
  }

  function outputKind(action) {
    if (action.kind === 'report' || action.kind === 'ask') return 'report';
    if (action.kind === 'variants') return 'variants';
    if (action.kind === 'fix') return 'fix';
    return 'latex';
  }

  /**
   * Build the native-host request.
   * opts: { settings, action, instruction?, extra?, target, doc, fileName?, profile?, lintText?, logText? }
   */
  function buildRequest(opts) {
    const s = { ...DEFAULT_SETTINGS, ...opts.settings };
    const { action, target, doc } = opts;
    const output = outputKind(action);
    const isClaude = s.backend !== 'codex';
    const backend = isClaude ? 'claude' : 'codex';
    const extra = (opts.extra || '').trim();

    let task = target.kind === 'directive' ? target.directive : (opts.instruction || action.instruction || '');
    if (extra && extra !== task) task += `\n\nAdditional instructions from the author: ${extra}`;

    const parts = [`<task>\n${task}\n</task>`];
    if (opts.fileName) parts.push(`<file_name>${opts.fileName}</file_name>`);
    const startLine = lineNumberAt(doc, target.from);

    if (output === 'report') {
      if (target.kind === 'document') {
        parts.push(`<document>\n${numberLines(doc, 1)}\n</document>`);
      } else {
        const { before, after } = contextAround(doc, target, { ...s, includeFullDoc: s.includeFullDoc });
        if (before.trim()) parts.push(`<context_before>\n${before}\n</context_before>`);
        parts.push(`<target>\n${numberLines(target.text, startLine)}\n</target>`);
        if (after.trim()) parts.push(`<context_after>\n${after}\n</context_after>`);
      }
      if (opts.lintText) parts.push(`<local_lint>\n${opts.lintText}\n</local_lint>`);
      parts.push(target.kind === 'document'
        ? 'Carry out <task> on the document.'
        : 'Carry out <task> on the text inside <target>; the context is for reference.');
    } else if (output === 'fix') {
      const { before, after } = contextAround(doc, target, s);
      parts.push(`<compile_log>\n${opts.logText || '(no log available)'}\n</compile_log>`);
      if (before.trim()) parts.push(`<context_before>\n${before}\n</context_before>`);
      parts.push(`<target>\n${numberLines(target.text, startLine)}\n</target>`);
      if (after.trim()) parts.push(`<context_after>\n${after}\n</context_after>`);
      parts.push([
        'Find the cause of the error(s) in <compile_log> that relate to <target> and fix the LaTeX source.',
        'Reply in exactly this format:',
        `<explanation>2-5 sentences in ${s.explainLang === 'en' ? 'English' : 'Korean'}: what caused the error and what you changed. If the error is in another file or a package issue, say so.</explanation>`,
        '<latex>the corrected replacement for the full <target> text, WITHOUT the line-number prefixes</latex>',
        'If no change to <target> is needed, return the target text unchanged inside <latex>.',
      ].join('\n'));
    } else {
      const { before, after, full } = contextAround(doc, target, s);
      const ctxBefore = `<context_before>\n${before}\n</context_before>`;
      const ctxAfter = `<context_after>\n${after}\n</context_after>`;
      if (target.selectionText) parts.push(`<selected_text>\n${target.selectionText}\n</selected_text>`);
      if (target.mode === 'replace') {
        parts.push(ctxBefore);
        parts.push(target.kind === 'directive'
          ? '<!-- The directive line is located here. Your output replaces that line. -->'
          : `<target>\n${target.text}\n</target>`);
        parts.push(ctxAfter);
      } else {
        parts.push(ctxBefore, '<!-- CURSOR: new text is inserted here -->', ctxAfter);
      }
      if (full) parts.push('(The context above is the complete current file.)');
      if (output === 'variants') {
        const n = action.count || 3;
        parts.push(`Return exactly ${n} options, each wrapped in <option>...</option>, and nothing else. Each option must be ready to ${target.mode === 'replace' ? 'replace <target>' : 'insert at the cursor'} as LaTeX source.`);
      } else if (target.kind === 'directive') {
        parts.push('Write the LaTeX text requested by <task> so that it fits at the marked location. Output only that text.');
      } else if (target.mode === 'replace') {
        parts.push('Apply <task> to the text inside <target>. Output only the rewritten text that will replace <target> (without the tags). The context is for reference only; do not repeat it.');
      } else {
        parts.push('Write the text requested by <task> for insertion at the cursor. Output only the new text; do not repeat the context.');
      }
    }

    const reportLang = action.reportLang || s.explainLang;
    let system = output === 'report' ? REPORT_RULES(reportLang) : LATEX_RULES;
    if (output === 'fix') system = `${LATEX_RULES}\nException for this task: follow the <explanation>/<latex> reply format exactly.`;
    if (action.web) system += '\n- Use the web search tool to verify every paper you mention. Include the URL or DOI you verified. If you cannot verify a paper, do not list it.';
    else system += '\n- Never run tools or commands and never read files; just write.';
    const prof = profileText(opts.profile, C);
    if (prof) system += `\n\n${prof}`;
    if (s.styleGuide && s.styleGuide.trim()) system += `\n\nAdditional style rules from the author:\n${s.styleGuide.trim()}`;

    const model = (isClaude ? s.claudeModel : s.codexModel || '').trim();
    const chosenEffort = isClaude ? s.claudeEffort : s.codexEffort;
    const effort = C ? C.resolveEffort(backend, model, chosenEffort, action.effort, s) : (chosenEffort === 'auto' ? '' : chosenEffort);
    let timeoutSec = Number(s.timeoutSec) || 300;
    if (effort === 'xhigh' || effort === 'max') timeoutSec *= 2;
    if (action.web) timeoutSec *= 2;

    return {
      backend,
      model,
      effort,
      web: !!(action.web && isClaude && s.allowWeb),
      extraArgs: splitArgs(isClaude ? s.claudeExtraArgs : s.codexExtraArgs),
      timeoutSec: Math.min(timeoutSec, 1800),
      system,
      prompt: parts.join('\n\n'),
      output,
    };
  }

  // ------------------------------------------------------------- outputs ---

  function stripFence(s) {
    const fenced = /^\s*```[\w-]*\n([\s\S]*?)\n```\s*$/.exec(s);
    return fenced ? fenced[1] : s;
  }

  // Clean model output and fit it to the target's surrounding whitespace.
  function postProcess(raw, target) {
    let s = stripFence(String(raw || '').replace(/\r\n?/g, '\n'));
    s = s.replace(/^\s*<(target|output|result|text|latex)>[ \t]*\n?/i, '').replace(/\n?[ \t]*<\/(target|output|result|text|latex)>\s*$/i, '');
    if (target.mode === 'replace' && target.kind !== 'directive') {
      const lead = /^\s*/.exec(target.text)[0];
      const trail = /\s*$/.exec(target.text.slice(lead.length))[0];
      return lead + s.trim() + trail;
    }
    return s.replace(/^\s*\n/, '').replace(/\s+$/, '');
  }

  function parseVariants(raw, target) {
    const text = String(raw || '').replace(/\r\n?/g, '\n');
    const out = [];
    const re = /<option>\s*([\s\S]*?)\s*<\/option>/gi;
    let m;
    while ((m = re.exec(text))) if (m[1].trim()) out.push(m[1]);
    if (!out.length) {
      // Fallback: numbered list or blank-line separated blocks.
      const blocks = stripFence(text).split(/\n\s*\n|\n(?=\s*\d+[.)]\s)/).map((b) => b.replace(/^\s*\d+[.)]\s*/, '').trim()).filter(Boolean);
      out.push(...blocks);
    }
    return out.map((o) => postProcess(o, target));
  }

  function parseFix(raw, target) {
    const text = String(raw || '');
    const ex = /<explanation>\s*([\s\S]*?)\s*<\/explanation>/i.exec(text);
    const lx = /<latex>\s*\n?([\s\S]*?)\n?\s*<\/latex>/i.exec(text);
    let latex = lx ? lx[1] : null;
    if (latex != null) {
      // Remove line-number prefixes if the model echoed them on every line.
      const lines = latex.split('\n');
      if (lines.length && lines.every((l) => /^\s*\d+\|\s?/.test(l) || !l.trim())) latex = lines.map((l) => l.replace(/^\s*\d+\|\s?/, '')).join('\n');
      latex = postProcess(latex, target);
    }
    return { explanation: ex ? ex[1].trim() : (lx ? '' : text.trim()), latex };
  }

  function postProcessReport(raw) {
    return String(raw || '').replace(/\r\n?/g, '\n').trim();
  }

  // Spacing so inserted text does not glue onto the neighbouring word.
  function insertionText(text, doc, pos) {
    const prev = pos > 0 ? doc[pos - 1] : '\n';
    const next = pos < doc.length ? doc[pos] : '\n';
    let out = text;
    if (prev && !/\s/.test(prev) && !/^\s/.test(out)) out = ` ${out}`;
    if (next && !/\s/.test(next) && !/\s$/.test(out)) out = `${out} `;
    return out;
  }

  // Turn a Markdown report into LaTeX comment lines.
  function asLatexComment(text) {
    return String(text).split('\n').map((l) => (l.trim() ? `% ${l}` : '%')).join('\n');
  }

  const api = {
    DEFAULT_SETTINGS, LATEX_RULES, REPORT_RULES,
    parseDirective, splitLines, lineNumberAt, numberLines, findParagraph, findSection,
    resolveTarget, parseLogLine, resolveFixTarget, profileText, buildRequest, outputKind,
    postProcess, parseVariants, parseFix, postProcessReport, insertionText, asLatexComment,
    splitArgs, parseCustomPresets,
  };
  root.OLAI = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
