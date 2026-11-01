'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const B = require('../extension/content/bib.js');

const BIB = String.raw`@string{nips = "NeurIPS"}
@article{vaswani2017attention,
  title={Attention is all you need},
  author={Vaswani, Ashish and Shazeer, Noam},
  journal={arXiv preprint arXiv:1706.03762},
  year={2017}
}
@misc{devlin2018bert,
  title = "{BERT}: Pre-training of Deep Bidirectional Transformers",
  author = {Devlin, Jacob and Chang, Ming-Wei},
  eprint = {1810.04805}, archivePrefix = {arXiv},
  year = 2018
}
@inproceedings{he2016deep, title={Deep residual learning for image recognition}, author={He, Kaiming}, booktitle=nips # " 2016", year={2016}}
@article{dblp, author={X}, title={Y}, journal={CoRR}, volume={abs/2106.09685}, year={2021}}
@comment{ignored @article{nope, title={x}} }`;

test('parseBib: braces, quotes, numbers, @string macros and concatenation, positions', () => {
  const { entries } = B.parseBib(BIB);
  assert.deepEqual(entries.map((e) => e.key), ['vaswani2017attention', 'devlin2018bert', 'he2016deep', 'dblp']);
  const he = entries[2];
  assert.equal(he.fields.booktitle, 'NeurIPS 2016');
  assert.equal(entries[1].fields.title, '{BERT}: Pre-training of Deep Bidirectional Transformers');
  assert.equal(entries[1].fields.year, '2018');
  assert.ok(BIB.slice(entries[0].from, entries[0].to).startsWith('@article{vaswani2017attention'));
  assert.ok(BIB.slice(entries[0].from, entries[0].to).endsWith('}'));
});

test('arXiv / preprint detection in all common styles', () => {
  const { entries } = B.parseBib(BIB);
  assert.deepEqual(entries.map((e) => B.arxivIdOf(e)), ['1706.03762', '1810.04805', null, '2106.09685']);
  assert.deepEqual(entries.map((e) => B.isPreprint(e)), [true, true, false, true]);
  assert.equal(B.arxivIdOf({ fields: { doi: '10.48550/arXiv.2303.08774' } }), '2303.08774');
  assert.equal(B.arxivIdOf({ fields: { url: 'https://arxiv.org/abs/hep-th/9901001v2' } }), 'hep-th/9901001');
});

test('citedKeys covers natbib/biblatex commands and ignores comments', () => {
  const tex = String.raw`\citep[see][p.~3]{a, b} \citet{c} \parencite{d} \textcite{e} \autocite[12]{f} \nocite{g} \Citep{h} % \cite{commented}
\begin{verbatim}\cite{code}\end{verbatim}`;
  assert.deepEqual([...B.citedKeys(tex).keys()], ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']);
});

test('keyHint, makeKey, uniqueKey, protectTitle', () => {
  assert.deepEqual(B.keyHint('vaswani2017attention'), { author: 'vaswani', year: '2017', words: ['attention'] });
  assert.deepEqual(B.keyHint('devlin-etal-2019-bert'), { author: 'devlin', year: '2019', words: ['bert'] });
  assert.equal(B.keyHint('smith2020a').year, '2020');
  assert.equal(B.makeKey(['Jacob Devlin'], 2019, 'BERT: Pre-training'), 'devlin2019bert');
  assert.equal(B.makeKey(['Müller, Klaus'], 2001, 'An introduction'), 'muller2001introduction');
  assert.equal(B.uniqueKey('a2020x', new Set(['a2020x', 'a2020xb'])), 'a2020xc');
  assert.equal(B.protectTitle('BERT: Pre-training for ImageNet and t-SNE in 3D'), '{BERT}: Pre-training for {ImageNet} and {t-SNE} in {3D}');
  assert.equal(B.protectTitle('{BERT}: already {GPU} protected'), '{BERT}: already {GPU} protected');
  assert.equal(B.protectTitle('Plain Title Case Words'), 'Plain Title Case Words');
});

test('choosePublication prefers a matching published version and rejects wrong papers', () => {
  const base = { title: 'Attention is all you need', authors: 'Vaswani, Ashish and Shazeer, Noam', arxiv: { published: '2017-06-12', authors: ['Ashish Vaswani'], doi: '', journalRef: '' } };
  const s2 = { title: 'Attention is All you Need', venue: 'Neural Information Processing Systems', year: 2017, publicationVenue: { name: 'Neural Information Processing Systems', type: 'conference' }, externalIds: {}, authors: [{ name: 'Ashish Vaswani' }], publicationTypes: ['Conference'] };
  const pub = B.choosePublication({ ...base, s2, openalex: [], crossref: [] });
  assert.equal(pub.kind, 'conference');
  assert.equal(pub.confidence, 'high');
  // A different paper with a similar title is rejected
  const wrong = B.choosePublication({ ...base, s2: null, openalex: [], crossref: [{ doi: '10.1109/x', title: 'Attention Is All You Need In Speech Separation', venue: 'ICASSP', year: 2021, type: 'proceedings-article', authors: ['C Subakan'] }] });
  assert.equal(wrong, null);
  // arXiv-only S2 record is not a publication
  assert.equal(B.choosePublication({ ...base, s2: { ...s2, venue: 'arXiv.org', publicationVenue: { name: 'arXiv.org' }, journal: { name: 'ArXiv' } }, openalex: [], crossref: [] }), null);
  // OpenAlex conference record with DOI
  const bert = B.choosePublication({ title: 'BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding', authors: 'Devlin, Jacob', arxiv: { published: '2018-10-11' }, openalex: [{ title: 'BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding', type: 'conference-paper', year: 2019, doi: '10.18653/v1/n19-1423', authors: ['Jacob Devlin'], primary: { source: 'NAACL-HLT', isArxiv: false }, locations: [] }], crossref: [] });
  assert.equal(bert.doi, '10.18653/v1/n19-1423');
  assert.equal(bert.kind, 'conference');
});

test('entryFromMeta / cleanImported keep the original key and tidy fields', () => {
  const t = B.entryFromMeta({ kind: 'conference', title: 'Attention is All you Need', authors: ['Ashish Vaswani', 'Noam Shazeer'], year: 2017, venue: 'Neural Information Processing Systems' }, 'vaswani2017attention');
  assert.match(t, /^@inproceedings\{vaswani2017attention,/);
  assert.match(t, /author\s+= \{Vaswani, Ashish and Shazeer, Noam\}/);
  assert.match(t, /booktitle = \{Advances in Neural Information Processing Systems\}/);
  const imported = B.cleanImported('@inproceedings{Devlin_2019, title={BERT: Pre-training of Deep Bidirectional Transformers}, url={http://dx.doi.org/10.18653/v1/n19-1423}, DOI={10.18653/v1/n19-1423}, booktitle={Proceedings of NAACL}, author={Devlin, Jacob}, year={2019}, month=jun, pages={4171–4186}}', 'devlin2018bert');
  assert.match(imported, /^@inproceedings\{devlin2018bert,/);
  assert.match(imported, /title\s+= \{\{BERT\}: Pre-training/);
  assert.match(imported, /pages\s+= \{4171--4186\}/);
  assert.doesNotMatch(imported, /url|month/);
  const preprint = B.entryFromMeta({ kind: 'preprint', title: 'X', authors: ['A B'], year: 2024, arxivId: '2401.00001', primary: 'cs.CL' }, 'b2024x');
  assert.match(preprint, /journal\s+= \{arXiv preprint arXiv:2401\.00001\}/);
  assert.match(preprint, /archivePrefix = \{arXiv\}/);
});

test('auditBib: duplicates, missing fields, unprotected caps, preprints, unused', () => {
  const bib = String.raw`@article{a, title={BERT is good}, author={X}, journal={J}, year={2020}, doi={10.1/x}}
@article{b, title={Another BERT}, author={Y}, journal={J}, year={2020}, doi={10.1/X}}
@inproceedings{c, title={{Protected}}, author={Z}, year={2021}}`;
  const kinds = B.auditBib(B.parseBib(bib).entries, new Set(['a'])).map((i) => `${i.key}:${i.kind}`);
  assert.ok(kinds.includes('b:duplicate'));
  assert.ok(kinds.includes('c:missing-field'));
  assert.ok(kinds.includes('a:unprotected'));
  assert.ok(kinds.includes('b:unused'));
  assert.ok(!kinds.includes('a:unused'));
});

test('appendEdits and parseLookupInput', () => {
  assert.deepEqual(B.appendEdits('@a{x,}\n', ['@b{y,}']), [{ pos: 7, text: '\n@b{y,}\n' }]);
  assert.deepEqual(B.appendEdits('', ['@b{y,}']), [{ pos: 0, text: '@b{y,}\n' }]);
  assert.deepEqual(B.parseLookupInput('https://doi.org/10.18653/v1/N19-1423.'), { kind: 'doi', value: '10.18653/v1/N19-1423' });
  assert.deepEqual(B.parseLookupInput('arXiv:1706.03762v5'), { kind: 'arxiv', value: '1706.03762' });
  assert.deepEqual(B.parseLookupInput('https://arxiv.org/pdf/2106.09685'), { kind: 'arxiv', value: '2106.09685' });
  assert.deepEqual(B.parseLookupInput('10.48550/arXiv.2303.08774'), { kind: 'arxiv', value: '2303.08774' });
  assert.deepEqual(B.parseLookupInput('Deep residual learning'), { kind: 'title', value: 'Deep residual learning' });
});
