// Overleaf AI — settings, actions, target resolution and prompt building.
// Pure functions only (no DOM / chrome APIs) so they can be unit-tested in Node.
(function (root) {
  'use strict';

  const DEFAULT_SETTINGS = {
    backend: 'claude',        // 'claude' | 'codex'
    claudeModel: 'sonnet',    // alias or full model id; '' = CLI default
    claudeEffort: '',         // '' | low | medium | high | xhigh | max
    codexModel: '',           // '' = codex default
    codexEffort: 'low',       // '' | minimal | low | medium | high
    claudeExtraArgs: '',
    codexExtraArgs: '',
    timeoutSec: 180,
    contextChars: 3000,       // characters of surrounding text sent before/after the target
    includeFullDoc: false,    // send the entire current file as context
    styleGuide: '',           // extra writing rules appended to the system prompt
    customPresets: '',        // one per line: "라벨 | 지시문"
    quickActionId: 'polish',  // preset used by Alt+Shift+I on a selection/paragraph
    autoApplyQuick: false,    // Alt+Shift+I applies the result without preview
    showLauncher: true,       // floating "AI" button on Overleaf
  };

  // kind 'transform': rewrite the selection (or the current paragraph if nothing is selected).
  // kind 'generate' : write new text at the cursor.
  const ACTIONS = [
    { id: 'polish', label: '다듬기', kind: 'transform',
      instruction: 'Improve clarity, flow and academic tone. Fix grammar and awkward phrasing. Keep the meaning, technical content, terminology and approximate length.' },
    { id: 'grammar', label: '문법 교정', kind: 'transform',
      instruction: 'Fix only grammar, spelling, punctuation and clear word-choice errors. Make minimal edits; do not rephrase sentences that are already correct.' },
    { id: 'concise', label: '간결하게', kind: 'transform',
      instruction: 'Make the text more concise (about 25-35% shorter) by removing redundancy and wordiness, without losing any information or technical nuance.' },
    { id: 'expand', label: '구체화', kind: 'transform',
      instruction: 'Expand the text with clearer explanations, motivation and smoother transitions, consistent with the surrounding context. Do not invent citations, data, numbers or results; where support is needed add a LaTeX comment line "% TODO: ...".' },
    { id: 'to-en', label: '한→영', kind: 'transform',
      instruction: 'Translate the text into natural, fluent academic English suitable for a research paper. Keep LaTeX commands, math, citations and labels intact.' },
    { id: 'to-ko', label: '영→한', kind: 'transform',
      instruction: 'Translate the text into natural Korean (academic register). Keep LaTeX commands, math, citations and labels intact.' },
    { id: 'fix-latex', label: 'LaTeX 수정', kind: 'transform',
      instruction: 'Fix LaTeX errors and bad practices: unbalanced braces/environments, unescaped special characters (%, &, _, #), wrong quotes (use ``...\'\'), missing non-breaking spaces before \\cite/\\ref (use ~). Do not change the wording of the prose.' },
    { id: 'continue', label: '이어쓰기', kind: 'generate',
      instruction: 'Continue writing from the cursor position. If the cursor is in the middle of a paragraph, continue that paragraph; otherwise write the next paragraph (about 80-150 words). Follow the argument, notation and style of the preceding text. Do not invent citations, data or results.' },
  ];

  const SYSTEM_PROMPT = [
    'You are an expert academic writing assistant embedded in the Overleaf LaTeX editor.',
    'Your output is inserted verbatim into a .tex source file, so:',
    '- Output ONLY the resulting LaTeX source text. No explanations, no preamble, no notes, no markdown, no code fences, no surrounding tags.',
    '- Preserve LaTeX commands, environments, math, \\cite{}, \\ref{}, \\label{}, custom macros and comments unless the task requires changing them.',
    '- Never invent citations, references, data or numerical results. If something must be filled in later, write a LaTeX comment line starting with "% TODO:".',
    '- Keep the language of the original text unless the task asks for a translation.',
    '- Match the surrounding text\'s style, tense, terminology and notation.',
    '- Do not add \\documentclass, \\begin{document} or other document scaffolding unless explicitly asked.',
    '- Never run tools or commands and never read files; just write the text.',
  ].join('\n');

  const DIRECTIVE_RE = /^\s*%+\s*ai\s*[:：]\s*(.+?)\s*$/i;

  function parseDirective(lineText) {
    const m = DIRECTIVE_RE.exec(lineText || '');
    return m ? m[1] : null;
  }

  // Lines that delimit paragraphs besides blank lines.
  const STRUCTURAL_RE = /^\s*(\\(begin|end|section|subsection|subsubsection|paragraph|subparagraph|chapter|part|item|maketitle|label|caption|centering|includegraphics|bibliography|bibliographystyle|printbibliography|newpage|clearpage)\b|%)/;

  // Returns {from, to, text} of the paragraph around `pos`, or null on a blank line.
  function findParagraph(doc, pos) {
    const lines = [];
    let start = 0;
    for (let i = 0; i <= doc.length; i++) {
      if (i === doc.length || doc[i] === '\n') {
        lines.push({ from: start, to: i, text: doc.slice(start, i) });
        start = i + 1;
      }
    }
    let idx = lines.findIndex((l) => pos >= l.from && pos <= l.to);
    if (idx < 0) idx = lines.length - 1;
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

  /**
   * Decide what a run operates on.
   * ctx: { doc, from, to, head, lineFrom, lineTo, lineText }
   * request: { kind: 'transform'|'generate'|'custom'|'directive' }
   * Returns { mode: 'replace'|'insert', kind, from, to, text, label, directive? } or { error }.
   */
  function resolveTarget(ctx, request) {
    const { doc } = ctx;
    const sel = doc.slice(ctx.from, ctx.to);
    const hasSel = ctx.to > ctx.from && sel.trim().length > 0;
    const directive = !hasSel ? parseDirective(ctx.lineText) : null;

    if (request.kind === 'directive') {
      if (!directive) return { error: '커서가 있는 줄에 "% ai: 지시문" 이 없습니다.' };
      return { mode: 'replace', kind: 'directive', from: ctx.lineFrom, to: ctx.lineTo, text: ctx.lineText, directive, label: `지시문: ${directive}` };
    }
    if (hasSel && request.kind !== 'generate') {
      return { mode: 'replace', kind: 'selection', from: ctx.from, to: ctx.to, text: sel, label: `선택 영역 (${sel.length}자)` };
    }
    if (request.kind === 'transform') {
      const p = findParagraph(doc, ctx.head);
      if (!p) return { error: '수정할 텍스트를 선택하거나 문단 안에 커서를 두세요.' };
      return { mode: 'replace', kind: 'paragraph', from: p.from, to: p.to, text: p.text, label: `현재 문단 (${p.text.length}자)` };
    }
    // generate / custom without selection → write new text at the cursor
    const pos = request.kind === 'generate' && hasSel ? ctx.to : ctx.head;
    return { mode: 'insert', kind: 'cursor', from: pos, to: pos, text: '', label: '커서 위치에 새로 작성' };
  }

  function contextAround(doc, target, settings) {
    if (settings.includeFullDoc) {
      return { before: doc.slice(0, target.from), after: doc.slice(target.to) };
    }
    const n = Math.max(0, Number(settings.contextChars) || 0);
    return {
      before: doc.slice(Math.max(0, target.from - n), target.from),
      after: doc.slice(target.to, target.to + n),
    };
  }

  // Shell-like word splitting (quotes may appear mid-word: -c a="b c" → ['-c', 'a=b c']).
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

  function parseCustomPresets(text) {
    return String(text || '').split('\n').map((line, i) => {
      const at = line.indexOf('|');
      if (at < 0) return null;
      const label = line.slice(0, at).trim();
      const instruction = line.slice(at + 1).trim();
      if (!label || !instruction) return null;
      return { id: `custom-${i}`, label, kind: 'transform', instruction, custom: true };
    }).filter(Boolean);
  }

  /**
   * Build the native-host request.
   * opts: { settings, instruction, target, doc, fileName }
   */
  function buildRequest({ settings, instruction, target, doc, fileName }) {
    const s = { ...DEFAULT_SETTINGS, ...settings };
    const { before, after } = contextAround(doc, target, s);
    const task = target.kind === 'directive' ? target.directive : instruction;
    const parts = [];
    parts.push(`<task>\n${task}\n</task>`);
    if (fileName) parts.push(`<file_name>${fileName}</file_name>`);
    if (target.mode === 'replace') {
      parts.push(`<context_before>\n${before}\n</context_before>`);
      if (target.kind === 'directive') {
        parts.push('<!-- The directive line is located here. Your output replaces that line. -->');
      } else {
        parts.push(`<target>\n${target.text}\n</target>`);
      }
      parts.push(`<context_after>\n${after}\n</context_after>`);
      parts.push(target.kind === 'directive'
        ? 'Write the LaTeX text requested by <task> so that it fits at the marked location. Output only that text.'
        : 'Apply <task> to the text inside <target>. Output only the rewritten text that will replace <target> (without the tags). The context is for reference only; do not repeat it.');
    } else {
      parts.push(`<context_before>\n${before}\n</context_before>`);
      parts.push('<!-- CURSOR: new text is inserted here -->');
      parts.push(`<context_after>\n${after}\n</context_after>`);
      parts.push('Write the text requested by <task> for insertion at the cursor. Output only the new text; do not repeat the context.');
    }

    let system = SYSTEM_PROMPT;
    if (s.styleGuide && s.styleGuide.trim()) system += `\n\nAdditional style rules from the author:\n${s.styleGuide.trim()}`;

    const isClaude = s.backend !== 'codex';
    return {
      backend: isClaude ? 'claude' : 'codex',
      model: (isClaude ? s.claudeModel : s.codexModel || '').trim(),
      effort: (isClaude ? s.claudeEffort : s.codexEffort) || '',
      extraArgs: splitArgs(isClaude ? s.claudeExtraArgs : s.codexExtraArgs),
      timeoutSec: Number(s.timeoutSec) || 180,
      system,
      prompt: parts.join('\n\n'),
    };
  }

  // Clean model output and fit it to the target's surrounding whitespace.
  function postProcess(raw, target) {
    let s = String(raw || '').replace(/\r\n?/g, '\n');
    const fenced = /^\s*```[\w-]*\n([\s\S]*?)\n```\s*$/.exec(s);
    if (fenced) s = fenced[1];
    s = s.replace(/^\s*<(target|output|result|text)>[ \t]*\n?/i, '').replace(/\n?[ \t]*<\/(target|output|result|text)>\s*$/i, '');
    if (target.mode === 'replace' && target.kind !== 'directive') {
      const lead = /^\s*/.exec(target.text)[0];
      const trail = /\s*$/.exec(target.text.slice(lead.length))[0];
      return lead + s.trim() + trail;
    }
    return s.replace(/^\s*\n/, '').replace(/\s+$/, '');
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

  const api = {
    DEFAULT_SETTINGS, ACTIONS, SYSTEM_PROMPT,
    parseDirective, findParagraph, resolveTarget, buildRequest, postProcess,
    insertionText, splitArgs, parseCustomPresets,
  };
  root.OLAI = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
