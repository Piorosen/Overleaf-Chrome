'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const F = require('../extension/content/figure.js');

test('buildFigureRequest: size, data rules, environment, revise and fix modes', () => {
  const python = { version: '3.13.2', pkgs: { matplotlib: '3.10.3', numpy: '2.2.0', pandas: null } };
  const r = F.buildFigureRequest({ template: 'curve', description: '세 모델 비교', size: 'full', python, data: 'A & 71.2 \\\\ B & 73.5', dataFile: 'main.tex' });
  assert.match(r.system, /figsize=\(6\.9, H\)/);
  assert.match(r.system, /matplotlib 3\.10\.3, numpy 2\.2\.0/);
  assert.doesNotMatch(r.system, /pandas/);
  assert.match(r.system, /Do NOT call plt\.show\(\), savefig\(\) or close\(\)/);
  assert.match(r.prompt, /<data source="main\.tex">\nA & 71\.2/);
  assert.match(r.prompt, /shaded band[\s\S]*Author's request: 세 모델 비교/);
  const ex = F.buildFigureRequest({ template: 'bars', python });
  assert.match(ex.prompt, /No data was given: use illustrative example numbers/);
  assert.doesNotMatch(F.buildFigureRequest({ template: 'diagram', python }).prompt, /No data was given/);
  const fix = F.buildFigureRequest({ previousCode: 'x = 1/0', error: 'ZeroDivisionError', python });
  assert.match(fix.prompt, /<previous_code>\nx = 1\/0\n<\/previous_code>[\s\S]*<error>\nZeroDivisionError/);
  const rev = F.buildFigureRequest({ previousCode: 'plot()', feedback: '범례를 위로', python });
  assert.match(rev.prompt, /Revise the figure: 범례를 위로/);
});

test('extractCode and parseMeta', () => {
  const reply = 'Here you go:\n```python\n# caption: Accuracy (\\%) over epochs.\n# label: fig:acc-curve\n# EXAMPLE DATA — replace with real results\nimport matplotlib.pyplot as plt\n```\nDone.';
  const code = F.extractCode(reply);
  assert.match(code, /^# caption:/);
  assert.ok(code.endsWith('plt\n'));
  assert.deepEqual(F.parseMeta(code), { caption: 'Accuracy (\\%) over epochs.', label: 'fig:acc-curve', example: true });
  assert.equal(F.extractCode('import numpy as np\nx=1'), 'import numpy as np\nx=1\n');
  assert.equal(F.parseMeta('x=1').example, false);
});

test('file names, paths and the LaTeX snippet', () => {
  assert.equal(F.safeName('fig:Accuracy vs. Épochs'), 'accuracy-vs-epochs');
  assert.equal(F.safeName('정확도'), 'figure');
  assert.deepEqual(F.parsePath('figures/acc.pdf'), { folder: 'figures', base: 'acc', ext: 'pdf', file: 'acc.pdf', path: 'figures/acc.pdf' });
  assert.equal(F.parsePath('acc.pdf'), null);
  assert.equal(F.parsePath('figures/a b.pdf'), null);
  assert.equal(F.parsePath('../x/acc.pdf'), null);
  assert.equal(F.uniquePath('figures/acc.pdf', new Set(['figures/acc.pdf', 'figures/acc-2.pdf'])), 'figures/acc-3.pdf');
  assert.equal(F.uniquePath('figures/new.pdf', new Set(['figures/acc.pdf'])), 'figures/new.pdf');
  const tex = F.figureLatex({ path: 'figures/acc.pdf', caption: 'Top-1 accuracy (50% data) & loss', label: 'fig:acc', size: 'full' });
  assert.match(tex, /^\\begin\{figure\*\}\[t\]/);
  assert.match(tex, /\\includegraphics\[width=\\textwidth\]\{figures\/acc\.pdf\}/);
  assert.match(tex, /\\caption\{Top-1 accuracy \(50\\% data\) \\& loss\}/);
  assert.match(F.figureLatex({ path: 'figures/acc.pdf', caption: 'Already \\% escaped', size: 'column' }), /\\caption\{Already \\% escaped\}[\s\S]*\\label\{fig:acc\}[\s\S]*\\end\{figure\}$/);
  assert.equal(F.defaultSize({ venuePreset: 'thesis-ko' }), 'text');
  assert.equal(F.defaultSize({ venuePreset: 'cv' }), 'column');
});

test('unmatchedNumbers flags plotted values missing from the selected data', () => {
  const data = 'Ours & 71.2 & 0.85 \\\\ Base & 68.4 & 0.80 \\\\ Params & 1,200';
  const code = 'acc = [71.2, 68.4]\nf1 = [85, 80]\nother = [70.0, 66.1]\nx = [0, 1, 2]\nfig, ax = plt.subplots(figsize=(3.3, 2.4))\nsizes = [1200, 900]\n';
  assert.deepEqual(F.unmatchedNumbers(code, data), [70, 66.1, 900]);
  assert.deepEqual(F.unmatchedNumbers(code, ''), []);
});

test('safeInsertPos never puts a figure inside a table, tabular or math', () => {
  const doc = 'Intro.\n\\begin{table}[t]\n\\begin{tabular}{ll}\nA & 1 \\\\\n\\end{tabular}\n\\end{table}\nAfter.\n% \\begin{table}\nEnd.';
  const inRow = doc.indexOf('A & 1');
  const p = F.safeInsertPos(doc, inRow);
  assert.equal(doc.slice(p - 11, p), '\\end{table}');
  assert.equal(F.safeInsertPos(doc, doc.indexOf('After.') + 3), doc.indexOf('After.') + 3);
  assert.equal(F.safeInsertPos(doc, doc.indexOf('End.')), doc.indexOf('End.'), 'commented \\begin is ignored');
  const eq = 'x\n\\begin{align}\na &= b\n\\end{align}\ny';
  assert.equal(F.safeInsertPos(eq, eq.indexOf('a &=')), eq.indexOf('\\end{align}') + '\\end{align}'.length);
  const itemize = '\\begin{itemize}\n\\item one\n\\end{itemize}';
  assert.equal(F.safeInsertPos(itemize, itemize.indexOf('one')), itemize.indexOf('one'));
});
