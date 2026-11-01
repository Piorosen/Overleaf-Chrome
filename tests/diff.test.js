'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../extension/content/diff.js');

const join = (parts, ops) => parts.filter((p) => ops.includes(p.op)).map((p) => p.text).join('');

test('diff reconstructs both sides', () => {
  const a = 'We propose a novel method \\cite{x} that is fast.';
  const b = 'We present a new method \\cite{x} that is very fast.';
  const parts = D.diffWords(a, b);
  assert.equal(join(parts, ['eq', 'del']), a);
  assert.equal(join(parts, ['eq', 'ins']), b);
  assert.ok(parts.some((p) => p.op === 'del' && p.text.includes('propose')));
  assert.ok(parts.some((p) => p.op === 'ins' && p.text.includes('very')));
});

test('diff handles Korean and identical input', () => {
  const a = '이 방법은 빠르다.';
  const b = '이 방법은 매우 빠르다.';
  const parts = D.diffWords(a, b);
  assert.equal(join(parts, ['eq', 'ins']), b);
  assert.deepEqual(D.diffWords(a, a), [{ op: 'eq', text: a }]);
});

test('hunks can be accepted or rejected individually', () => {
  const a = 'We propose an method that are fast.';
  const b = 'We propose a method that is fast.';
  const hunks = D.toHunks(D.diffWords(a, b));
  const changes = hunks.filter((h) => h.type === 'chg');
  assert.equal(changes.length, 2);
  assert.equal(D.composeHunks(hunks), b);
  changes[1].accepted = false;
  assert.equal(D.composeHunks(hunks), 'We propose a method that are fast.');
  for (const h of changes) h.accepted = false;
  assert.equal(D.composeHunks(hunks), a);
  const html = D.renderHunksHtml(hunks);
  assert.match(html, /class="chg off" data-i="\d+"/);
});

test('renderDiffHtml escapes markup', () => {
  const html = D.renderDiffHtml(D.diffWords('a <b> & x', 'a <i> & y'));
  const withoutDiffTags = html.replace(/<\/?(del|ins)>/g, '');
  assert.ok(!/[<>]/.test(withoutDiffTags));
  assert.equal(withoutDiffTags, 'a &lt;bi&gt; &amp; xy');
});

test('long rewrites still produce many small, accept/reject-able changes', () => {
  const sent = (i, w) => `Sentence number ${i} talks about the ${w} result in some detail.`;
  const a = Array.from({ length: 220 }, (_, i) => sent(i, 'first')).join(' ');
  const b = Array.from({ length: 220 }, (_, i) => sent(i, i % 3 ? 'first' : 'second')).join(' ');
  const parts = D.diffWords(a, b);
  const changes = D.toHunks(parts).filter((h) => h.type === 'chg');
  assert.ok(changes.length > 50, `got ${changes.length} hunks`);
  assert.equal(parts.filter((p) => p.op !== 'ins').map((p) => p.text).join(''), a);
  assert.equal(parts.filter((p) => p.op !== 'del').map((p) => p.text).join(''), b);
});
