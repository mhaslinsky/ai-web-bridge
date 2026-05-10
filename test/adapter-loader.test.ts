import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadAdapters } from '../src/server/adapter-loader.js';

function makeTempAdaptersDir(): string {
  return mkdtempSync(join(tmpdir(), 'awb-adapters-'));
}

const VALID_ADAPTER_SOURCE = (slug: string, name = slug) =>
  `export const adapter = {
    slug: ${JSON.stringify(slug)},
    display_name: ${JSON.stringify(name)},
    allowed_origins: ['example.com'],
    default_url: 'https://example.com',
    actions: { ping: { description: 'p', params: { safeParse: () => ({ success: true, data: {} }) }, risk_level: 'read', mutates_state: false, writes_files: false, requires_confirmation: false, run: async () => 'pong' } }
  };
  `;

test('adapter-loader: loads valid adapters', async () => {
  const dir = makeTempAdaptersDir();
  try {
    writeFileSync(join(dir, 'a.js'), VALID_ADAPTER_SOURCE('a'));
    writeFileSync(join(dir, 'b.js'), VALID_ADAPTER_SOURCE('b', 'B Adapter'));
    const loaded = await loadAdapters({ dir, warn: () => undefined });
    assert.equal(loaded.list.length, 2);
    assert.ok(loaded.byslug.has('a'));
    assert.ok(loaded.byslug.has('b'));
    assert.equal(loaded.byslug.get('b')!.display_name, 'B Adapter');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('adapter-loader: skips files without an `adapter` export', async () => {
  const dir = makeTempAdaptersDir();
  try {
    writeFileSync(join(dir, 'good.js'), VALID_ADAPTER_SOURCE('good'));
    writeFileSync(join(dir, 'bad.js'), `export const notAdapter = { wrong: true };`);
    const warnings: string[] = [];
    const loaded = await loadAdapters({ dir, warn: (m) => warnings.push(m) });
    assert.equal(loaded.list.length, 1);
    assert.equal(loaded.list[0]!.slug, 'good');
    assert.ok(warnings.some((w) => w.includes('bad.js') && /invalid|missing/i.test(w)));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('adapter-loader: skips files with malformed shape', async () => {
  const dir = makeTempAdaptersDir();
  try {
    writeFileSync(
      join(dir, 'malformed.js'),
      `export const adapter = { slug: 'm', display_name: 'M' /* missing allowed_origins/default_url/actions */ };`
    );
    const warnings: string[] = [];
    const loaded = await loadAdapters({ dir, warn: (m) => warnings.push(m) });
    assert.equal(loaded.list.length, 0);
    assert.ok(warnings.some((w) => w.includes('malformed.js')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('adapter-loader: detects duplicate slug across files', async () => {
  const dir = makeTempAdaptersDir();
  try {
    writeFileSync(join(dir, 'one.js'), VALID_ADAPTER_SOURCE('shared', 'first'));
    writeFileSync(join(dir, 'two.js'), VALID_ADAPTER_SOURCE('shared', 'second'));
    const warnings: string[] = [];
    const loaded = await loadAdapters({ dir, warn: (m) => warnings.push(m) });
    assert.equal(loaded.list.length, 1, 'duplicate must be skipped');
    assert.ok(warnings.some((w) => /duplicate adapter slug: shared/.test(w)));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('adapter-loader: ignores non-js files', async () => {
  const dir = makeTempAdaptersDir();
  try {
    writeFileSync(join(dir, 'real.js'), VALID_ADAPTER_SOURCE('real'));
    writeFileSync(join(dir, 'README.md'), '# not an adapter');
    writeFileSync(join(dir, 'config.json'), '{}');
    const loaded = await loadAdapters({ dir, warn: () => undefined });
    assert.equal(loaded.list.length, 1);
    assert.equal(loaded.list[0]!.slug, 'real');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('adapter-loader: returns empty when directory is missing', async () => {
  const loaded = await loadAdapters({ dir: '/nonexistent/path/that/does/not/exist', warn: () => undefined });
  assert.equal(loaded.list.length, 0);
  assert.equal(loaded.byslug.size, 0);
});

test('adapter-loader: surfaces import-time errors via warn, does not throw', async () => {
  const dir = makeTempAdaptersDir();
  try {
    writeFileSync(join(dir, 'broken.js'), `throw new Error('module-init failed');`);
    writeFileSync(join(dir, 'fine.js'), VALID_ADAPTER_SOURCE('fine'));
    const warnings: string[] = [];
    const loaded = await loadAdapters({ dir, warn: (m) => warnings.push(m) });
    assert.equal(loaded.list.length, 1, 'broken module should not block fine module');
    assert.ok(warnings.some((w) => w.includes('broken.js') && /module-init failed|import failed/.test(w)));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
