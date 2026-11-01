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
  assert.deepEqual(T.parseGlossary('dataset | data set, data-set\nbad\n | x\nX | x'), [{ preferred: 'dataset', variants: ['data set', 'data-set'] }]);
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
