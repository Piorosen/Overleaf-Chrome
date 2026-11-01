'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../extension/content/markdown.js');

test('escapes HTML everywhere', () => {
  const html = M.renderMarkdown('# <script>alert(1)</script>\n- <img src=x onerror=alert(1)>\n`<b>`');
  assert.ok(!/<script|<img|<b>/.test(html));
  assert.match(html, /&lt;script&gt;/);
});

test('line references become jump links', () => {
  const html = M.renderMarkdown('See L42 and L10-L12, also L7–9.');
  assert.match(html, /<a class="lref" href="#" data-line="42">L42<\/a>/);
  assert.match(html, /data-line="10" data-end="12"/);
  assert.match(html, /data-line="7" data-end="9"/);
});

test('lists, headings, tables, code fences, links', () => {
  const md = '## 강점\n- **명확함**\n  계속\n1. one\n2. two\n\n| a | b |\n|---|---|\n| 1 | L3 |\n\n```bibtex\n@article{x}\n```\nhttps://arxiv.org/abs/1706.03762';
  const html = M.renderMarkdown(md);
  assert.match(html, /<h4 class="h2">강점<\/h4>/);
  assert.match(html, /<ul><li><strong>명확함<\/strong> 계속<\/li><\/ul>/);
  assert.match(html, /<ol><li>one<\/li><li>two<\/li><\/ol>/);
  assert.match(html, /<table><thead><tr><th>a<\/th><th>b<\/th><\/tr><\/thead><tbody><tr><td>1<\/td><td><a class="lref"/);
  assert.match(html, /<pre class="code" data-lang="bibtex"><code>@article\{x\}<\/code><\/pre>/);
  assert.match(html, /<a href="https:\/\/arxiv\.org\/abs\/1706\.03762" target="_blank" rel="noopener noreferrer">/);
  assert.deepEqual(M.codeBlocks(md, 'bibtex'), ['@article{x}']);
});

test('single-asterisk italics without breaking math-like stars', () => {
  assert.match(M.renderMarkdown('Vaswani et al., *Attention Is All You Need*, 2017'), /<em>Attention Is All You Need<\/em>/);
  assert.doesNotMatch(M.renderMarkdown('a * b * c'), /<em>/);
});
