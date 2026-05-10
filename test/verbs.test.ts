import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { checkInstruction } from '../src/lib/verbs.js';

test('verbs: empty instruction is rejected', () => {
  const r = checkInstruction('');
  assert.equal(r.ok, false);
  assert.match(r.reason!, /empty/i);
});

test('verbs: whitespace-only instruction is rejected', () => {
  const r = checkInstruction('   \n\t  ');
  assert.equal(r.ok, false);
});

test('verbs: allowed verbs pass through', () => {
  for (const verb of ['add', 'change', 'tweak', 'rename', 'increase', 'move', 'expand']) {
    const r = checkInstruction(`${verb} the title`);
    assert.equal(r.ok, true, `expected "${verb} ..." to pass, got: ${r.reason}`);
  }
});

test('verbs: denylist verb at start is refused', () => {
  for (const verb of ['delete', 'remove', 'clear', 'wipe', 'destroy', 'drop', 'erase', 'reset', 'purge', 'nuke']) {
    const r = checkInstruction(`${verb} the canvas`);
    assert.equal(r.ok, false, `expected "${verb} ..." to be refused`);
    assert.match(r.reason!, new RegExp(verb, 'i'));
  }
});

test('verbs: case-insensitive matching on first verb', () => {
  assert.equal(checkInstruction('Delete the canvas').ok, false);
  assert.equal(checkInstruction('DELETE EVERYTHING').ok, false);
  assert.equal(checkInstruction('Add a heading').ok, true);
});

test('verbs: destructive verb + broad scope qualifier in first 4 tokens is refused even if not at position 0', () => {
  // "please remove all..." — denylisted verb at position 1 + broad scope at position 2
  const r = checkInstruction('please remove all elements');
  assert.equal(r.ok, false);
  assert.match(r.reason!, /sanity check/i);
});

test('verbs: broad-scope qualifier without destructive verb passes', () => {
  // "add everything from the spec" — broad scope but no denylisted verb
  assert.equal(checkInstruction('add everything from the spec').ok, true);
});

test('verbs: destructive verb without broad scope (and not at position 0) passes', () => {
  // The combined-pattern guard requires both a destructive verb AND a broad-scope qualifier in the first 4 tokens.
  // Without broad scope, the deny-only-at-position-0 rule applies.
  assert.equal(checkInstruction('please dismiss the modal').ok, true);
});
