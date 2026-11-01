'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../extension/content/catalog.js');
const P = require('../extension/content/prompts.js');

const DOC = [
  '\\documentclass{article}',     // 1
  '\\begin{document}',            // 2
  '\\section{Introduction}',      // 3
  'First sentence of para one.',  // 4
  'Second line of para one.',     // 5
  '',                             // 6
  '% ai: write a sentence about results', // 7
  '',                             // 8
  'Para two starts here.',        // 9
  '\\begin{figure}',              // 10
  '\\end{figure}',                // 11
  '\\section{Method}',            // 12
  'Method text.',                 // 13
  '\\end{document}',              // 14
].join('\n');

const act = (id) => C.ACTIONS.find((a) => a.id === id);

function ctxAt(doc, from, to = from) {
  const lineFrom = doc.lastIndexOf('\n', from - 1) + 1;
  let lineTo = doc.indexOf('\n', from);
  if (lineTo < 0) lineTo = doc.length;
  return { doc, from, to, head: to, lineFrom, lineTo, lineText: doc.slice(lineFrom, lineTo) };
}

test('parseDirective', () => {
  assert.equal(P.parseDirective('% ai: do X'), 'do X');
  assert.equal(P.parseDirective('  %% AI：번역해줘  '), '번역해줘');
  assert.equal(P.parseDirective('% a comment'), null);
  assert.equal(P.parseDirective('text % ai: no'), null);
});

test('findParagraph stops at blank and structural lines', () => {
  const p = P.findParagraph(DOC, DOC.indexOf('Second line'));
  assert.equal(p.text, 'First sentence of para one.\nSecond line of para one.');
  assert.equal(P.findParagraph(DOC, DOC.indexOf('\n\n') + 1), null);
  assert.equal(P.findParagraph(DOC, DOC.indexOf('Para two')).text, 'Para two starts here.');
});

test('findSection spans to the next \\section and stops at \\end{document}', () => {
  const s = P.findSection(DOC, DOC.indexOf('Para two'));
  assert.ok(s.text.startsWith('\\section{Introduction}'));
  assert.ok(s.text.endsWith('\\end{figure}'));
  const m = P.findSection(DOC, DOC.indexOf('Method text'));
  assert.equal(m.text, '\\section{Method}\nMethod text.');
});

test('numberLines / lineNumberAt', () => {
  assert.equal(P.numberLines('a\nb', 41), '41| a\n42| b');
  assert.equal(P.lineNumberAt(DOC, DOC.indexOf('Para two')), 9);
});

test('resolveTarget: transform uses selection, else paragraph; forced scope wins', () => {
  const from = DOC.indexOf('First');
  const sel = ctxAt(DOC, from, from + 'First sentence'.length);
  assert.equal(P.resolveTarget(sel, act('polish')).kind, 'selection');
  const cur = ctxAt(DOC, DOC.indexOf('Second line') + 3);
  assert.equal(P.resolveTarget(cur, act('polish')).kind, 'paragraph');
  assert.equal(P.resolveTarget(cur, act('polish'), { scope: 'section' }).kind, 'section');
  assert.equal(P.resolveTarget(sel, act('polish'), { scope: 'document' }).kind, 'document');
  assert.ok(P.resolveTarget(ctxAt(DOC, DOC.indexOf('\n\n') + 1), act('polish')).error);
});

test('resolveTarget: report defaults to the action scope, read-only', () => {
  const cur = ctxAt(DOC, DOC.indexOf('Para two'));
  const r = P.resolveTarget(cur, act('review'));
  assert.equal(r.mode, 'read');
  assert.equal(r.kind, 'document');
  assert.equal(P.resolveTarget(cur, act('logic')).kind, 'section');
});

test('resolveTarget: compose/variants(document) replace selection or insert at cursor with full-doc context', () => {
  const cur = ctxAt(DOC, DOC.indexOf('Para two'));
  const c = P.resolveTarget(cur, act('abstract'));
  assert.equal(c.mode, 'insert');
  assert.equal(c.context, 'document');
  const from = DOC.indexOf('Method text');
  const v = P.resolveTarget(ctxAt(DOC, from, from + 6), act('title'));
  assert.equal(v.mode, 'replace');
  assert.equal(v.context, 'document');
});

test('resolveTarget: make/generate/needsSelection/directive', () => {
  const cur = ctxAt(DOC, DOC.indexOf('Para two'));
  assert.equal(P.resolveTarget(cur, act('table')).needsInstruction, true);
  assert.ok(P.resolveTarget(cur, act('synonyms')).error);
  const from = DOC.indexOf('First');
  const g = P.resolveTarget(ctxAt(DOC, from, from + 5), act('reviewer-reply'));
  assert.equal(g.mode, 'insert');
  assert.equal(g.from, from + 5);
  assert.equal(g.selectionText, 'First');
  const d = P.resolveTarget(ctxAt(DOC, DOC.indexOf('% ai') + 4), { kind: 'directive' });
  assert.equal(d.directive, 'write a sentence about results');
  assert.equal(P.resolveTarget(ctxAt(DOC, DOC.indexOf('% ai') + 4), { kind: 'custom' }).mode, 'insert');
});

test('resolveFixTarget picks lines around the log error line', () => {
  const t = P.resolveFixTarget(ctxAt(DOC, 0), '! Undefined control sequence.\nl.9 Para two starts here', 2);
  assert.equal(t.kind, 'lines');
  assert.equal(t.errorLine, 9);
  assert.equal(t.text.split('\n').length, 5);
  assert.equal(P.parseLogLine('main.tex:42: LaTeX Error'), 42);
});

test('buildRequest: backend, model, auto effort, profile, extra instructions', () => {
  const cur = ctxAt(DOC, DOC.indexOf('Para two'));
  const target = P.resolveTarget(cur, act('polish'));
  const req = P.buildRequest({
    settings: { backend: 'claude', claudeModel: 'claude-opus-5-5', claudeEffort: 'auto', contextChars: 20, styleGuide: 'Use US English.' },
    action: act('polish'), extra: '더 짧게', target, doc: DOC, fileName: 'main.tex',
    profile: { venuePreset: 'ml', venueName: 'NeurIPS 2026', spelling: 'us', terms: 'dataset | data set' },
  });
  assert.equal(req.backend, 'claude');
  assert.equal(req.model, 'claude-opus-5-5');
  assert.equal(req.effort, 'low'); // polish hint
  assert.equal(req.output, 'latex');
  assert.equal(req.web, false);
  assert.match(req.prompt, /Additional instructions from the author: 더 짧게/);
  assert.match(req.prompt, /<target>\nPara two starts here.\n<\/target>/);
  assert.match(req.system, /NeurIPS 2026/);
  assert.match(req.system, /American English/);
  assert.match(req.system, /dataset \| data set/);
  assert.match(req.system, /Use US English\./);
  assert.match(req.system, /Never run tools/);
});

test('buildRequest: report numbers lines and uses the explain language', () => {
  const cur = ctxAt(DOC, DOC.indexOf('Para two'));
  const req = P.buildRequest({ settings: { explainLang: 'ko' }, action: act('review'), target: P.resolveTarget(cur, act('review')), doc: DOC });
  assert.equal(req.output, 'report');
  assert.equal(req.effort, 'high');
  assert.match(req.prompt, /<document>\n1\| \\documentclass/);
  assert.match(req.prompt, /\n9\| Para two starts here\./);
  assert.match(req.system, /Korean/);
});

test('buildRequest: web actions only on Claude with allowWeb, longer timeout', () => {
  const cur = ctxAt(DOC, DOC.indexOf('Para two'));
  const a = act('find-refs');
  const t = P.resolveTarget(cur, a);
  const on = P.buildRequest({ settings: { backend: 'claude', allowWeb: true, timeoutSec: 100 }, action: a, target: t, doc: DOC });
  assert.equal(on.web, true);
  assert.equal(on.timeoutSec, 200);
  assert.match(on.system, /web search tool/);
  assert.equal(P.buildRequest({ settings: { backend: 'claude', allowWeb: false }, action: a, target: t, doc: DOC }).web, false);
  assert.equal(P.buildRequest({ settings: { backend: 'codex' }, action: a, target: t, doc: DOC }).web, false);
});

test('buildRequest: codex model/effort/extra args', () => {
  const cur = ctxAt(DOC, DOC.indexOf('Para two'));
  const target = P.resolveTarget(cur, act('polish'));
  const req = P.buildRequest({ settings: { backend: 'codex', codexModel: 'gpt-5.5', codexEffort: 'max', codexExtraArgs: '-c a="b c"' }, action: act('polish'), target, doc: DOC });
  assert.equal(req.backend, 'codex');
  assert.equal(req.model, 'gpt-5.5');
  assert.equal(req.effort, 'xhigh'); // max is mapped to codex's xhigh
  assert.equal(req.extraArgs, undefined, 'extra CLI args are never sent with requests (host config only)');
});

test('buildRequest: variants and fix output contracts', () => {
  const cur = ctxAt(DOC, DOC.indexOf('Para two'));
  const v = P.buildRequest({ settings: {}, action: act('title'), target: P.resolveTarget(cur, act('title')), doc: DOC });
  assert.equal(v.output, 'variants');
  assert.match(v.prompt, /exactly 5 options, each wrapped in <option>/);
  assert.match(v.prompt, /complete current file/);
  const ft = P.resolveFixTarget(cur, 'l.9 x', 1);
  const f = P.buildRequest({ settings: {}, action: act('error-assist'), target: ft, doc: DOC, logText: 'l.9 x' });
  assert.equal(f.output, 'fix');
  assert.match(f.prompt, /<compile_log>\nl\.9 x/);
  assert.match(f.prompt, /<explanation>/);
});

test('postProcess strips fences/tags and keeps target whitespace', () => {
  const target = { mode: 'replace', kind: 'selection', text: '  hello world\n' };
  assert.equal(P.postProcess('```latex\nHi there.\n```', target), '  Hi there.\n');
  assert.equal(P.postProcess('<target>\nHi.\n</target>', target), '  Hi.\n');
  assert.equal(P.postProcess('\n\nNew text.\n\n', { mode: 'insert', kind: 'cursor', text: '' }), 'New text.');
});

test('parseVariants handles tags and numbered fallbacks', () => {
  const t = { mode: 'insert', kind: 'cursor', text: '' };
  assert.deepEqual(P.parseVariants('<option>A</option>\n<option>\nB\n</option>', t), ['A', 'B']);
  assert.deepEqual(P.parseVariants('1. Alpha\n2. Beta\n3. Gamma', t), ['Alpha', 'Beta', 'Gamma']);
});

test('parseFix extracts explanation and latex, removing echoed line numbers', () => {
  const target = { mode: 'replace', kind: 'lines', text: 'a\nb' };
  const f = P.parseFix('<explanation>중괄호 누락</explanation>\n<latex>\n9| a}\n10| b\n</latex>', target);
  assert.equal(f.explanation, '중괄호 누락');
  assert.equal(f.latex, 'a}\nb');
});

test('insertionText and asLatexComment', () => {
  assert.equal(P.insertionText('next', 'abcdef', 3), ' next ');
  assert.equal(P.insertionText('next', 'abc def', 3), ' next');
  assert.equal(P.asLatexComment('a\n\nb'), '% a\n%\n% b');
});

test('splitArgs follows shell quoting', () => {
  assert.deepEqual(P.splitArgs(`-c model_verbosity="low" --x 'a b' c\\ d ""`), ['-c', 'model_verbosity=low', '--x', 'a b', 'c d', '']);
  assert.deepEqual(P.splitArgs('   '), []);
});

test('completionBlocker: only at line end, outside comments/math/preamble/commands', () => {
  const ctx = (lineBefore, extra = {}) => ({ focused: true, lineAfter: '', before: `\\begin{document}\n${lineBefore}`, lineBefore, ...extra });
  assert.equal(P.completionBlocker(ctx('We propose a ')), '');
  assert.equal(P.completionBlocker(ctx('Results improve.')), '');
  assert.equal(P.completionBlocker(ctx('text % note ')), 'comment');
  assert.equal(P.completionBlocker(ctx('Let $x = ')), 'inline-math');
  assert.equal(P.completionBlocker(ctx('see \\cite')), 'typing-command');
  assert.equal(P.completionBlocker(ctx('We see', { before: '\\begin{align}\nWe see' })), 'math-env');
  assert.equal(P.completionBlocker(ctx('We see', { lineAfter: ' more text' })), 'mid-line');
  assert.equal(P.completionBlocker(ctx('We see', { lineAfter: '}' })), '');
  assert.equal(P.completionBlocker(ctx('We see', { inPreamble: true })), 'preamble');
  assert.equal(P.completionBlocker(ctx('We see', { composing: true })), 'composing');
  assert.equal(P.completionBlocker(ctx('ab')), 'short-line');
  assert.equal(P.completionBlocker(ctx('ab'), { manual: true }), '');
});

test('buildCompletionRequest always uses Claude with the autocomplete model', () => {
  const req = P.buildCompletionRequest({ settings: { backend: 'codex', acModel: 'claude-haiku-5-5', acEffort: 'low', acMaxWords: 20 }, before: 'We propose a', after: '', fileName: 'main.tex', profile: { field: 'NLP' } });
  assert.equal(req.backend, 'claude');
  assert.equal(req.model, 'claude-haiku-5-5');
  assert.equal(req.effort, 'low');
  assert.match(req.system, /Hard limit: 20 words/);
  assert.match(req.system, /Field: NLP/);
  assert.match(req.prompt, /<text_before_cursor>\nWe propose a<\/text_before_cursor>/);
});

test('postProcessCompletion normalizes spacing, paragraphs, fences and echoes', () => {
  assert.equal(P.postProcessCompletion(' method that works.', 'We propose a '), 'method that works.');
  assert.equal(P.postProcessCompletion('Next sentence.', 'It works.'), ' Next sentence.');
  assert.equal(P.postProcessCompletion('using data', 'We are us'), 'ing data');      // restated fragment → completes the word
  assert.equal(P.postProcessCompletion('have become the', 'models have'), ' become the'); // restated word → new word
  assert.equal(P.postProcessCompletion('become the', 'models have'), ' become the');      // not restated → treated as new word
  assert.equal(P.postProcessCompletion('```\nmethod that\nworks.\n\nNew para', 'We propose a '), 'method that works.');
  assert.equal(P.postProcessCompletion('   \n ', 'x'), '');
  assert.equal(P.postProcessCompletion('have shown strong results.', 'attention models have'), ' shown strong results.');
  assert.equal(P.postProcessCompletion('have', 'attention models have'), '');
  assert.equal(P.postProcessCompletion('models have shown', 'Since then, attention models have'), ' shown');
  assert.equal(P.postProcessCompletion('theory of learning', 'a the'), 'ory of learning');
  assert.equal(P.postProcessCompletion('ha', 'models have'), '');   // partial stream of the restated word
  assert.ok(P.postProcessCompletion('word '.repeat(200), 'x ').length <= 400);
});

test('parseCustomPresets supports an optional kind column', () => {
  const list = P.parseCustomPresets('톤 | Be polite.\nbad line\n | empty\n요약|Summarize.|report\n이상|X|weird');
  assert.deepEqual(list.map((a) => [a.label, a.kind]), [['톤', 'transform'], ['요약', 'report'], ['이상', 'transform']]);
});

test('safetyCheck flags dropped citations, lost math and new numbers', () => {
  const w = P.safetyCheck('We beat X by 3.2% \\cite{a} (Table~\\ref{t}) $x$.', 'We beat X by 4.1% significantly (Table~\\ref{t}).').map((x) => x.message).join(' | ');
  assert.match(w, /인용 사라짐: a/);
  assert.match(w, /수식 1개가 줄었습니다/);
  assert.match(w, /없던 숫자: 4\.1%/);
  assert.deepEqual(P.safetyCheck('', 'New 7.3% gain \\cite{zz}.', 'doc mentions \\cite{aa} only').map((x) => x.message.slice(0, 12)), ['원문에 없던 인용 추가됨'.slice(0, 12), '원문·문서에 없던 숫자'.slice(0, 12)]);
  assert.deepEqual(P.safetyCheck('Same \\cite{a} text $x$.', 'Same text \\cite{a}, rephrased $x$.'), []);
  assert.match(P.safetyCheck('a', '\\begin{table}x').map((x) => x.message).join(), /begin\/\\end|중괄호/);
});

test('sanitizeForOverleaf folds math letters and drops emoji; extractLogErrors keeps errors', () => {
  assert.deepEqual(P.sanitizeForOverleaf('let 𝑥 be 🙂 ok'), { text: 'let x be  ok', removed: 1 });
  const e = P.extractLogErrors('(./main.tex (./sec/a.tex\n! Undefined control sequence.\nl.12 \\foo\nmore');
  assert.match(e, /\[file\] \.\/sec\/a\.tex\n! Undefined control sequence\.\nl\.12/);
  assert.deepEqual(P.parseLogLocation(e), { file: 'sec/a.tex', line: 12 });
});
