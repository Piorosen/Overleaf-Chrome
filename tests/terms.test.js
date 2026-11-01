'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../extension/content/terms.js');

const DOC = String.raw`\begin{document}
Pre-training helps. We use pretraining on a large data set. The dataset is public.
We optimise the loss; later we optimize it again and optimize more. Our data-set is new.
% pretraining in a comment
$pre-training$ \label{sec:pretraining}
\end{document}`;

function apply(doc, changes) {
  let out = doc;
  for (const c of changes.slice().sort((a, b) => b.from - a.from)) {
    assert.equal(out.slice(c.from, c.to), c.expected);
    out = out.slice(0, c.from) + c.insert + out.slice(c.to);
  }
  return out;
}

test('parse and merge glossaries', () => {
  assert.deepEqual(T.parseGlossary('dataset | data set, data-set\nbad\n | x\nLaTeX | Latex'), [{ preferred: 'dataset', variants: ['data set', 'data-set'] }, { preferred: 'LaTeX', variants: ['Latex'] }]);
  const merged = T.mergeGlossary('dataset | data set', 'Dataset | data-set\nfine-tuning | finetuning');
  assert.equal(merged, 'dataset | data set, data-set\nfine-tuning | finetuning');
});

test('finds glossary, hyphenation and US/UK groups in prose only', () => {
  const groups = T.analyzeTerms(DOC, 'dataset | data set, data-set');
  const bySource = Object.fromEntries(groups.map((g) => [g.source, g]));
  assert.deepEqual(bySource.glossary.forms.map((f) => [f.text, f.count]), [['dataset', 1], ['data set', 1], ['data-set', 1]]);
  assert.deepEqual(bySource.hyphen.forms.map((f) => [f.text, f.count]), [['pre-training', 1], ['pretraining', 1]]);
  assert.equal(bySource.usuk.preferred, 'optimize'); // majority form (2 vs 1)
  assert.equal(bySource.usuk.forms.find((f) => f.text === 'optimise').occurrences[0].line, 3);
});

test('planChanges unifies with case preservation; comments/math/labels untouched', () => {
  const groups = T.analyzeTerms(DOC, 'dataset | data set, data-set');
  const choices = new Map(groups.map((g) => [g.id, g.preferred]));
  choices.set(groups.find((g) => g.source === 'hyphen').id, 'pretraining');
  const out = apply(DOC, T.planChanges(groups, choices));
  assert.match(out, /^Pretraining helps\. We use pretraining on a large dataset\. The dataset is public\./m);
  assert.match(out, /We optimize the loss/);
  assert.match(out, /Our dataset is new/);
  assert.match(out, /% pretraining in a comment/);
  assert.match(out, /\$pre-training\$ \\label\{sec:pretraining\}/);
});

test('excluded groups are skipped and matchCase keeps special casing', () => {
  const groups = T.analyzeTerms(DOC, '');
  assert.equal(T.planChanges(groups, new Map()).length, 0);
  assert.equal(T.matchCase('dataset', 'Data set'), 'Dataset');
  assert.equal(T.matchCase('dataset', 'DATA SET'), 'DATASET');
  assert.equal(T.matchCase('ImageNet', 'imagenet'), 'ImageNet');
  assert.equal(T.matchCase('ImageNet', 'Imagenet'), 'ImageNet');
});

test('hyphen vs spaced-only groups are low confidence; closed forms are high', () => {
  const groups = T.analyzeTerms('\\begin{document}\nA sparse-attention layer. We use sparse attention. Pre-training and pretraining.\n\\end{document}', '');
  const byId = Object.fromEntries(groups.map((g) => [g.forms.map((f) => f.text).sort().join('/'), g.confidence]));
  assert.equal(byId['sparse attention/sparse-attention'], 'low');
  assert.equal(byId['pre-training/pretraining'], 'high');
});

const applyAll = (doc, changes) => changes.slice().sort((a, b) => b.from - a.from).reduce((o, c) => o.slice(0, c.from) + c.insert + o.slice(c.to), doc);
const unify = (doc, glossary) => {
  const groups = T.analyzeTerms(doc, glossary);
  return applyAll(doc, T.planChanges(groups, new Map(groups.filter((g) => g.confidence !== 'low').map((g) => [g.id, g.preferred]))));
};

test('never rewrites LaTeX commands, keys, paths or code', () => {
  const doc = '\\begin{document}\nA node here. \\begin{tikzpicture}\\node (a) {A};\\end{tikzpicture} \\item x \\gls{dataset} \\nameref{sec:dataset} \\addbibresource{dataset.bib} \\texttt{dataset()} \\verb|dataset| a dataset.\n\\end{document}';
  const out = unify(doc, 'vertex | node\nentry | item\ndata set | dataset');
  assert.match(out, /A vertex here\./);
  assert.match(out, /\\node \(a\)/);
  assert.match(out, /\\item x/);
  assert.match(out, /\\gls\{dataset\} \\nameref\{sec:dataset\} \\addbibresource\{dataset\.bib\} \\texttt\{dataset\(\)\} \\verb\|dataset\| a data set\./);
});

test('nested forms, plurals, ~, case-only and t-SNE casing', () => {
  assert.equal(unify('A deep neural network is a neural network.', 'deep neural network | neural network'), 'A deep neural network is a deep neural network.');
  assert.equal(unify('Two data sets. One data~set. One dataset.', 'dataset | data set'), 'Two datasets. One dataset. One dataset.');
  assert.equal(unify('We use Latex and LaTeX.', 'LaTeX | Latex'), 'We use LaTeX and LaTeX.');
  assert.equal(unify('We use t-SNE. Then t-SNE again and tSNE once.', ''), 'We use t-SNE. Then t-SNE again and t-SNE once.');
});

test('Korean terms followed by particles, with particle agreement', () => {
  assert.equal(unify('데이터 세트를 만들고 데이터 세트의 크기와 데이터셋을 비교한다.', '데이터셋 | 데이터 세트'), '데이터셋을 만들고 데이터셋의 크기와 데이터셋을 비교한다.');
  assert.equal(unify('모델이 학습한다.', '신경망 | 모델'), '신경망이 학습한다.');
  assert.equal(T.fitParticle('신경망', '가'), '이');
  assert.equal(T.fitParticle('데이터', '을'), '를');
  assert.equal(T.fitParticle('모델', '으로'), '로');
});
