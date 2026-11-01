'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../extension/content/catalog.js');

const KINDS = new Set(['transform', 'generate', 'compose', 'make', 'variants', 'report', 'fix', 'lint', 'terms', 'packages', 'bib']);
const LOCAL = new Set(['lint', 'terms', 'packages', 'bib']);

test('every action is well-formed', () => {
  const ids = new Set();
  const cats = new Set(C.CATEGORIES.map((c) => c.id));
  for (const a of C.ACTIONS) {
    assert.ok(!ids.has(a.id), `duplicate id ${a.id}`);
    ids.add(a.id);
    assert.ok(cats.has(a.cat), `${a.id}: unknown category ${a.cat}`);
    assert.ok(KINDS.has(a.kind), `${a.id}: unknown kind ${a.kind}`);
    assert.ok(a.label && a.desc, `${a.id}: label/desc`);
    if (!LOCAL.has(a.kind)) assert.ok(a.instruction && a.instruction.length > 20, `${a.id}: instruction`);
    if (a.effort) assert.ok(['low', 'medium', 'high'].includes(a.effort), `${a.id}: effort hint`);
    if (a.scope) assert.ok(['paragraph', 'section', 'document'].includes(a.scope), `${a.id}: scope`);
    if (a.kind === 'variants') assert.ok(a.count >= 2, `${a.id}: count`);
  }
  assert.ok(C.ACTIONS.length >= 45, `expected a rich catalog, got ${C.ACTIONS.length}`);
});

test('model catalog includes the current Claude family and custom IDs', () => {
  const ids = C.modelsFor('claude', {}).map((m) => m.id);
  for (const id of ['claude-fable-5-1', 'claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5']) assert.ok(ids.includes(id), id);
  const withCustom = C.modelsFor('claude', { claudeCustomModels: 'opus[1m]\nbad id with spaces\nclaude-opus-5-5' });
  assert.ok(withCustom.some((m) => m.id === 'opus[1m]' && m.group === '사용자 지정'));
  assert.equal(withCustom.filter((m) => m.id === 'claude-opus-5-5').length, 1);
  assert.ok(!withCustom.some((m) => m.id === 'bad id with spaces'));
});

test('resolveEffort maps auto/unsupported levels to what the model supports', () => {
  assert.equal(C.resolveEffort('claude', 'claude-opus-5-5', 'auto', 'high', {}), 'high');
  assert.equal(C.resolveEffort('claude', 'claude-opus-5-5', 'max', 'low', {}), 'max');
  assert.equal(C.resolveEffort('claude', 'claude-opus-5-5', '', 'low', {}), '');
  assert.equal(C.resolveEffort('claude', 'claude-sonnet-4-6', 'xhigh', 'low', {}), 'high'); // no xhigh on 4.6
  assert.equal(C.resolveEffort('claude', 'claude-haiku-4-5', 'high', 'low', {}), '');    // no effort support
  assert.equal(C.resolveEffort('codex', '', 'max', 'low', {}), 'xhigh');
  assert.equal(C.resolveEffort('claude', 'claude-opus-5-5', 'minimal', 'low', {}), 'low');
});
