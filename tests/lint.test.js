'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../extension/content/lint.js');

const rules = (doc) => L.lintLatex(doc).map((i) => i.rule);
const has = (doc, rule) => rules(doc).includes(rule);

const BASE = (body) => `\\documentclass{article}\n\\begin{document}\n${body}\n\\end{document}\n`;

test('labels and references', () => {
  const doc = BASE('See Fig.~\\ref{fig:a} and \\ref{fig:missing}.\n\\label{fig:a}\n\\label{fig:a}\n\\label{tab:unused}');
  const r = rules(doc);
  assert.ok(r.includes('undefined-ref'));
  assert.ok(r.includes('duplicate-label'));
  assert.ok(r.includes('unused-label'));
  assert.ok(!L.lintLatex(doc).some((i) => i.rule === 'undefined-ref' && /fig:a/.test(i.message)));
});

test('citations, nbsp, hard-coded refs', () => {
  assert.ok(has(BASE('Prior work \\cite{}.'), 'empty-cite'));
  assert.ok(has(BASE('Prior work. \\cite{a}'), 'cite-after-punct'));
  assert.ok(has(BASE('as shown in Figure \\ref{fig:x}.\n\\label{fig:x}'), 'nbsp'));
  assert.ok(!has(BASE('as shown in Figure~\\ref{fig:x}.\n\\label{fig:x}'), 'nbsp'));
  assert.ok(has(BASE('as shown in Figure 3, results improve.'), 'hardcoded-ref'));
});

test('environment and brace balance', () => {
  assert.ok(has(BASE('\\begin{itemize}\n\\item a'), 'env-unclosed'));
  assert.ok(has(BASE('text \\end{itemize}'), 'env-extra-end'));
  assert.ok(has(BASE('\\textbf{oops'), 'brace-unclosed'));
  assert.ok(has(BASE('oops}'), 'brace-extra'));
  assert.ok(!has(BASE('escaped \\{ and \\} and % comment {'), 'brace-unclosed'));
});

test('floats need caption and label in the right order', () => {
  assert.ok(has(BASE('\\begin{figure}\\includegraphics{x}\\end{figure}'), 'float-no-caption'));
  assert.ok(has(BASE('\\begin{figure}\\label{fig:x}\\caption{A}\\end{figure}\n\\ref{fig:x}'), 'label-before-caption'));
  assert.ok(!has(BASE('\\begin{figure}\\caption{A}\\label{fig:x}\\end{figure}\n\\ref{fig:x}'), 'label-before-caption'));
});

test('prose checks ignore math, comments and command arguments', () => {
  assert.ok(has(BASE('We use the the model.'), 'repeated-word'));
  assert.ok(!has(BASE('We use $a a$ here.'), 'repeated-word'));
  assert.ok(has(BASE('He said "hello" there.'), 'straight-quotes'));
  assert.ok(!has(BASE("He said ``hello'' there."), 'straight-quotes'));
  assert.ok(has(BASE('% TODO: fix this'), 'todo'));
  assert.ok(has(BASE('Many models, e.g. BERT (BERT), work.'), 'eg-comma'));
});

test('acronyms must be defined', () => {
  assert.ok(has(BASE('We train a CNN on images.'), 'acronym-undefined'));
  assert.ok(!has(BASE('A convolutional neural network (CNN) is used. The CNN works.'), 'acronym-undefined'));
  assert.ok(!has(BASE('We used a GPU and the IEEE format.'), 'acronym-undefined'));
  assert.ok(!has(BASE('See \\cite{ABC2020} and \\label{XYZ}.'), 'acronym-undefined'));
});

test('spelling variants: hyphenation and -ise/-ize', () => {
  assert.ok(has(BASE('We pre-train the model. Pretrain again.'), 'hyphen-variant'));
  assert.ok(!has(BASE('A sparse-attention layer uses sparse attention.'), 'hyphen-variant'));
  assert.ok(has(BASE('We optimise A and optimize B.'), 'us-uk-variant'));
  assert.ok(!has(BASE('We optimize A and optimize B.'), 'us-uk-variant'));
});

test('long sentences are flagged', () => {
  const long = `${Array.from({ length: 60 }, (_, i) => `word${i % 7 ? 'x' : 'y'}`).join(' ')}.`;
  assert.ok(has(BASE(long), 'long-sentence'));
  assert.ok(!has(BASE('Short sentence here.'), 'long-sentence'));
});

test('issues carry line numbers and excerpts; counts/summarize', () => {
  const doc = BASE('ok line\nWe use the the model.');
  const issue = L.lintLatex(doc).find((i) => i.rule === 'repeated-word');
  assert.equal(issue.line, 4);
  assert.match(issue.excerpt, /the the/);
  const c = L.counts(L.lintLatex(doc));
  assert.equal(typeof c.warn, 'number');
  assert.match(L.summarize([issue]), /^L4 \[warn\]/);
});

test('clean document has no errors', () => {
  const doc = BASE('A convolutional neural network (CNN) works well~\\cite{a}.\n\\begin{table}\\caption{T}\\label{tab:t}\\end{table}\nTable~\\ref{tab:t} shows it.');
  const c = L.counts(L.lintLatex(doc));
  assert.equal(c.error, 0);
  assert.equal(c.warn, 0);
});
