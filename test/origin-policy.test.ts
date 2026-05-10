import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { hostMatches, assertAllowedOrigin, OriginPolicyError } from '../src/lib/origin-policy.js';

test('origin: exact host match', () => {
  assert.equal(hostMatches('claude.ai', 'claude.ai'), true);
});

test('origin: subdomain matches parent', () => {
  assert.equal(hostMatches('foo.claude.ai', 'claude.ai'), true);
  assert.equal(hostMatches('a.b.claude.ai', 'claude.ai'), true);
});

test('origin: unrelated host does not match', () => {
  assert.equal(hostMatches('claude.ai.evil.com', 'claude.ai'), false);
  assert.equal(hostMatches('notclaude.ai', 'claude.ai'), false);
  assert.equal(hostMatches('claude.aix', 'claude.ai'), false);
});

test('origin: assertAllowedOrigin throws OriginPolicyError on mismatch', () => {
  const fakePage = { url: () => 'https://evil.com/path' } as unknown as Parameters<typeof assertAllowedOrigin>[0];
  assert.throws(() => assertAllowedOrigin(fakePage, ['claude.ai']), OriginPolicyError);
});

test('origin: assertAllowedOrigin throws on malformed URL', () => {
  const fakePage = { url: () => 'not a url' } as unknown as Parameters<typeof assertAllowedOrigin>[0];
  assert.throws(() => assertAllowedOrigin(fakePage, ['claude.ai']), OriginPolicyError);
});

test('origin: assertAllowedOrigin passes on match', () => {
  const fakePage = { url: () => 'https://claude.ai/design/p/abc' } as unknown as Parameters<typeof assertAllowedOrigin>[0];
  assert.doesNotThrow(() => assertAllowedOrigin(fakePage, ['claude.ai']));
});

test('origin: assertAllowedOrigin passes on subdomain match', () => {
  const fakePage = { url: () => 'https://app.claude.ai/x' } as unknown as Parameters<typeof assertAllowedOrigin>[0];
  assert.doesNotThrow(() => assertAllowedOrigin(fakePage, ['claude.ai']));
});
