'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const K = require('../extension/content/packages.js');

const DOC = (preamble, body) => `\\documentclass{article}\n${preamble}\\begin{document}\n${body}\n\\end{document}\n`;
const names = (r) => r.missing.map((m) => m.name);

test('detects missing packages with first-use line numbers', () => {
  const doc = DOC('\\usepackage{amsmath}\n', 'A table \\toprule x \\midrule\n$\\mathbb{R}$ and \\cref{x}.');
  const r = K.analyze(doc);
  assert.deepEqual(names(r), ['booktabs', 'amssymb', 'cleveref']);
  assert.equal(r.missing[0].line, 4);
  assert.equal(r.missing[1].line, 5);
  assert.equal(r.hasPreamble, true);
});

test('alternatives and options satisfy a need', () => {
  assert.deepEqual(names(K.analyze(DOC('\\usepackage{mathtools}\n', '\\begin{align}a\\end{align}'))), []);
  assert.deepEqual(names(K.analyze(DOC('\\usepackage{hyperref}\n', '\\url{x}'))), []);
  assert.deepEqual(names(K.analyze(DOC('\\usepackage{amsfonts}\n', '$\\mathbb{R}$'))), []);
  assert.deepEqual(names(K.analyze(DOC('\\usepackage{xcolor}\n', '\\rowcolor{gray}'))), ['colortbl']);
  assert.deepEqual(names(K.analyze(DOC('\\usepackage[table]{xcolor}\n', '\\rowcolor{gray}'))), []);
  assert.deepEqual(names(K.analyze(DOC('\\usepackage{tikz}\n', '\\textcolor{red}{x}'))), []);
});

test('comments, verbatim and user-defined macros do not trigger needs', () => {
  assert.deepEqual(names(K.analyze(DOC('', '% \\toprule in a comment\n\\begin{verbatim}\\multirow\\end{verbatim}'))), []);
  assert.deepEqual(names(K.analyze(DOC('\\newcommand{\\bm}[1]{\\boldsymbol{#1}}\n', '$\\bm{x}$'))), []);
});

test('tikz libraries and Korean text', () => {
  const tikz = '\\begin{tikzpicture}[node distance=1cm]\\node[right=of a] (b) {B}; \\draw[-{Stealth}] (a) -- (b);\\end{tikzpicture}';
  const r = K.analyze(DOC('\\usepackage{tikz}\n\\usetikzlibrary{positioning}\n', tikz));
  assert.deepEqual(r.missing.map((m) => `${m.kind}:${m.name}`), ['tikzlib:arrows.meta']);
  assert.deepEqual(names(K.analyze(DOC('', '한글 본문'))), ['kotex']);
  assert.deepEqual(names(K.analyze(DOC('\\usepackage{kotex}\n', '한글 본문'))), []);
  // Hangul only in the preamble/comments is not body text
  assert.deepEqual(names(K.analyze(DOC('% 한글 주석\n', 'English only'))), []);
});

test('analyzing a snippet against the document (after applying AI output)', () => {
  const doc = DOC('\\usepackage{booktabs}\n', 'Body.');
  const snippet = '\\begin{table}\\centering\\begin{tabular}{ll}\\toprule a & \\multirow{2}{*}{b}\\\\ \\bottomrule\\end{tabular}\\end{table}';
  const r = K.analyze(doc, snippet);
  assert.deepEqual(names(r), ['multirow']);
  assert.equal(r.missing[0].line, null);
});

test('insertion goes before hyperref, cleveref after it', () => {
  const doc = DOC('\\usepackage{amsmath}\n\\usepackage{hyperref}\n', 'x');
  const edits = K.insertionEdits(doc, [{ kind: 'package', name: 'booktabs' }, { kind: 'package', name: 'cleveref' }, { kind: 'tikzlib', name: 'calc' }]);
  let out = doc;
  for (const e of edits.slice().sort((a, b) => b.pos - a.pos)) out = out.slice(0, e.pos) + e.text + out.slice(e.pos);
  const pre = out.slice(0, out.indexOf('\\begin{document}'));
  assert.equal(pre, '\\documentclass{article}\n\\usepackage{amsmath}\n\\usepackage{booktabs}\n\\usetikzlibrary{calc}\n\\usepackage{hyperref}\n\\usepackage{cleveref}\n');
  assert.equal(K.insertionEdits('no preamble here', [{ kind: 'package', name: 'x' }]), null);
});

test('preambleLines and asIssues', () => {
  assert.deepEqual(K.preambleLines([{ kind: 'package', name: 'hyperref' }, { kind: 'package', name: 'graphicx' }, { kind: 'tikzlib', name: 'fit' }]),
    ['\\usepackage{graphicx}', '\\usepackage{hyperref}', '\\usetikzlibrary{fit}']);
  const issues = K.asIssues(K.analyze(DOC('', '\\includegraphics{x}')));
  assert.equal(issues[0].rule, 'missing-package');
  assert.match(issues[0].message, /graphicx/);
});
