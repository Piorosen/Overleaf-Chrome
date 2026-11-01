'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../extension/content/prompts.js');

const DOC = [
  '\\section{Introduction}',
  'First sentence of para one.',
  'Second line of para one.',
  '',
  '% ai: write a sentence about results',
  '',
  'Para two starts here.',
  '\\begin{figure}',
  '\\end{figure}',
].join('\n');

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
  const pos = DOC.indexOf('Second line');
  const p = P.findParagraph(DOC, pos);
  assert.equal(p.text, 'First sentence of para one.\nSecond line of para one.');
  assert.equal(P.findParagraph(DOC, DOC.indexOf('\n\n') + 1), null);
  assert.equal(P.findParagraph(DOC, DOC.indexOf('Para two')).text, 'Para two starts here.');
});

test('resolveTarget: selection wins for transform/custom', () => {
  const from = DOC.indexOf('First');
  const to = from + 'First sentence'.length;
  const t = P.resolveTarget(ctxAt(DOC, from, to), { kind: 'transform' });
  assert.equal(t.mode, 'replace');
  assert.equal(t.kind, 'selection');
  assert.equal(t.text, 'First sentence');
  const c = P.resolveTarget(ctxAt(DOC, from, to), { kind: 'custom' });
  assert.equal(c.kind, 'selection');
});

test('resolveTarget: no selection → paragraph for transform, cursor for custom', () => {
  const pos = DOC.indexOf('Second line') + 3;
  assert.equal(P.resolveTarget(ctxAt(DOC, pos), { kind: 'transform' }).kind, 'paragraph');
  const c = P.resolveTarget(ctxAt(DOC, pos), { kind: 'custom' });
  assert.equal(c.mode, 'insert');
  assert.equal(c.from, pos);
});

test('resolveTarget: directive line', () => {
  const pos = DOC.indexOf('% ai') + 4;
  const t = P.resolveTarget(ctxAt(DOC, pos), { kind: 'directive' });
  assert.equal(t.kind, 'directive');
  assert.equal(t.directive, 'write a sentence about results');
  assert.equal(DOC.slice(t.from, t.to), '% ai: write a sentence about results');
  assert.ok(P.resolveTarget(ctxAt(DOC, DOC.indexOf('Para two')), { kind: 'directive' }).error);
});

test('resolveTarget: transform on blank line is an error', () => {
  const pos = DOC.indexOf('\n\n') + 1;
  assert.ok(P.resolveTarget(ctxAt(DOC, pos), { kind: 'transform' }).error);
});

test('buildRequest picks backend options and embeds target/context', () => {
  const from = DOC.indexOf('Para two');
  const ctx = ctxAt(DOC, from, from + 'Para two starts here.'.length);
  const target = P.resolveTarget(ctx, { kind: 'transform' });
  const req = P.buildRequest({
    settings: { backend: 'codex', codexModel: 'gpt-5', codexEffort: 'low', codexExtraArgs: '-c a="b c"', contextChars: 20, styleGuide: 'Use US English.' },
    instruction: 'Polish it.', target, doc: DOC, fileName: 'main.tex',
  });
  assert.equal(req.backend, 'codex');
  assert.equal(req.model, 'gpt-5');
  assert.equal(req.effort, 'low');
  assert.deepEqual(req.extraArgs, ['-c', 'a=b c']);
  assert.match(req.prompt, /<target>\nPara two starts here.\n<\/target>/);
  assert.match(req.prompt, /<file_name>main.tex<\/file_name>/);
  assert.match(req.system, /Use US English\./);
  const before = /<context_before>\n([\s\S]*?)\n<\/context_before>/.exec(req.prompt)[1];
  assert.equal(before.length, 20);
});

test('postProcess strips fences/tags and keeps target whitespace', () => {
  const target = { mode: 'replace', kind: 'selection', text: '  hello world\n' };
  assert.equal(P.postProcess('```latex\nHi there.\n```', target), '  Hi there.\n');
  assert.equal(P.postProcess('<target>\nHi.\n</target>', target), '  Hi.\n');
  assert.equal(P.postProcess('\n\nNew text.\n\n', { mode: 'insert', kind: 'cursor', text: '' }), 'New text.');
});

test('insertionText adds spaces only where words would touch', () => {
  assert.equal(P.insertionText('next', 'abcdef', 3), ' next ');
  assert.equal(P.insertionText('next', 'abc def', 3), ' next');
  assert.equal(P.insertionText('next', 'abc \n', 4), 'next');
  assert.equal(P.insertionText('next', '', 0), 'next');
});

test('splitArgs follows shell quoting', () => {
  assert.deepEqual(P.splitArgs(`-c model_verbosity="low" --x 'a b' c\\ d ""`), ['-c', 'model_verbosity=low', '--x', 'a b', 'c d', '']);
  assert.deepEqual(P.splitArgs('   '), []);
});

test('parseCustomPresets', () => {
  const list = P.parseCustomPresets('톤 | Be polite.\nbad line\n | empty\n요약|Summarize.');
  assert.deepEqual(list.map((a) => a.label), ['톤', '요약']);
  assert.equal(list[1].instruction, 'Summarize.');
});
