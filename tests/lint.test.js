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

test('no catastrophic backtracking: macro files, .bib-like text, long runs stay fast', () => {
  const cases = [
    Array.from({ length: 60 }, (_, i) => `\\newcommand{\\m${i}}{\\textbf{v ${i}}}`).join('\n'),
    Array.from({ length: 300 }, (_, i) => `@article{k${i},\n  title={T ${i}},\n  author={A and B}\n}`).join('\n'),
    `\\begin{document}\n${' '.repeat(80000)}x\n\\end{document}`,
    `\\begin{document}\n${'汉'.repeat(90000)}。\n\\end{document}`,
  ];
  for (const doc of cases) {
    const t0 = Date.now();
    L.lintLatex(doc);
    assert.ok(Date.now() - t0 < 1000, `took ${Date.now() - t0} ms`);
  }
});

test('comments, URLs, code and macro templates are not misread', () => {
  assert.ok(!has(BASE('\\url{https://x.org/a%20b} fine.'), 'brace-unclosed'));
  assert.ok(has(BASE('a & b \\\\% the the "q"\n'), 'repeated-word') === false);
  assert.ok(!has(BASE('\\verb|\\begin{itemize}| and \\lstinline{\\end{itemize}}'), 'env-unclosed'));
  assert.ok(!has(BASE('\\iffalse\n\\begin{itemize}\n\\fi'), 'env-unclosed'));
  assert.ok(!has(BASE('\\newcommand{\\mk}[1]{\\label{fig:#1}}\n\\newcommand{\\mkb}[1]{\\label{fig:#1}}'), 'duplicate-label'));
  assert.ok(!has(BASE('\\def\\figref#1{figure~\\ref{#1}}'), 'undefined-ref'));
});

test('sub-figures, acronym definitions, umlauts and textual citations', () => {
  const sub = '\\begin{figure}\\subfloat[A\\label{fig:a}]{x}\\caption{Main}\\label{fig:m}\\end{figure}\n\\ref{fig:a}\\ref{fig:m}';
  assert.ok(!has(BASE(sub), 'label-before-caption'));
  assert.ok(!has(BASE('\\section{RELATED WORK}\nText.'), 'acronym-undefined'));
  assert.ok(!has(BASE('\\newacronym{cnn}{CNN}{convolutional neural network}\nA CNN works.'), 'acronym-undefined'));
  assert.ok(!has(BASE('A network (\\emph{CNN}) works. The CNN is good.'), 'acronym-undefined'));
  assert.ok(!has(BASE('Sch\\"olkopf and M\\"uller wrote it.'), 'straight-quotes'));
  assert.ok(!has(BASE('Many methods, e.g., \\cite{a}, work.'), 'cite-after-punct'));
  assert.ok(has(BASE('as shown in Figs. 1 and 2, results improve.'), 'hardcoded-ref'));
  assert.ok(has(BASE('그림 1 에서 보듯이 성능이 좋다.'), 'hardcoded-ref'));
  assert.ok(!has(BASE('He did not resign. We re-sign it.'), 'hyphen-variant'));
});

test('documentStats counts prose words per section, abstract, floats and citations', () => {
  const d = '\\documentclass{article}\n\\begin{document}\n\\begin{abstract}We propose a method. It works.\\end{abstract}\n\\section{Method} Short text here.\n\\begin{figure}\\caption{c}\\end{figure}\n\\section*{Acknowledgments} Thanks to the NSF \\cite{a,b}.\n\\end{document}';
  const st = L.documentStats(d);
  assert.equal(st.abstract, 6);
  // headings are not part of the section's text; a caption word counts
  assert.deepEqual(st.sections.map((x) => [x.title, x.words]), [['Method', 4], ['Acknowledgments', 4]]);
  assert.equal(L.documentStats('\\begin{document}\nCode: https://github.com/a/b-c.d here.\n\\end{document}').total, 3);
  assert.equal(st.figures, 1);
  assert.equal(st.citations, 2);
});

test('anonymityIssues finds author names, self-citation, identifying links and acknowledgments', () => {
  const d = '\\author{Jane Doe \\thanks{Univ}}\n\\begin{document}\nIn our previous work we showed it. https://github.com/jane/x\n\\section*{Acknowledgments} NSF.\n\\end{document}';
  const msgs = L.anonymityIssues(d).map((i) => i.message).join(' | ');
  assert.match(msgs, /저자 이름/);
  assert.match(msgs, /thanks/);
  assert.match(msgs, /자기 인용/);
  assert.match(msgs, /github\.com/);
  assert.match(msgs, /감사의 글/);
  assert.equal(L.anonymityIssues('\\author{Anonymous Authors}\n\\begin{document}\nFine.\n\\end{document}').length, 0);
});
