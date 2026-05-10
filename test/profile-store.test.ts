import { test, beforeEach, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  addProfile,
  ensureInitialized,
  getActiveProfile,
  listProfiles,
  removeProfile,
  runLegacyMigration,
  setActiveProfile
} from '../src/server/profile-store.js';

let originalHome: string | undefined;
let testHome: string;

beforeEach(() => {
  originalHome = process.env.HOME;
  testHome = mkdtempSync(join(tmpdir(), 'awb-profile-store-'));
  process.env.HOME = testHome;
});

afterEach(() => {
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  rmSync(testHome, { recursive: true, force: true });
});

const root = (): string => resolve(testHome, '.ai-web-bridge');

test('profile-store: ensureInitialized creates default personal profile and sets it active', () => {
  ensureInitialized();
  assert.deepEqual(listProfiles(), ['personal']);
  assert.equal(getActiveProfile(), 'personal');
  assert.ok(existsSync(resolve(root(), 'profile-personal')));
  assert.ok(existsSync(resolve(root(), 'active-profile.json')));
});

test('profile-store: addProfile creates dir tree, listProfiles enumerates them sorted', () => {
  addProfile('personal');
  addProfile('enterprise');
  addProfile('work');
  assert.deepEqual(listProfiles(), ['enterprise', 'personal', 'work']);
});

test('profile-store: addProfile is idempotent', () => {
  addProfile('foo');
  addProfile('foo');
  assert.deepEqual(listProfiles(), ['foo']);
});

test('profile-store: setActiveProfile rejects unknown profiles', () => {
  addProfile('a');
  assert.throws(() => setActiveProfile('b'), /No profile named "b"/);
});

test('profile-store: setActiveProfile rejects invalid names', () => {
  assert.throws(() => setActiveProfile('Bad-Name'), /Invalid profile name/);
  assert.throws(() => setActiveProfile('has spaces'), /Invalid profile name/);
});

test('profile-store: getActiveProfile throws clearly when never set', () => {
  assert.throws(() => getActiveProfile(), /No active profile is set/);
});

test('profile-store: getActiveProfile detects orphaned active pointer', () => {
  addProfile('a');
  setActiveProfile('a');
  rmSync(resolve(root(), 'profile-a'), { recursive: true, force: true });
  assert.throws(() => getActiveProfile(), /has no on-disk dir/);
});

test('profile-store: removeProfile refuses last remaining', () => {
  addProfile('only');
  setActiveProfile('only');
  assert.throws(() => removeProfile('only'), /Cannot remove the last remaining/);
});

test('profile-store: removeProfile refuses active profile', () => {
  addProfile('a');
  addProfile('b');
  setActiveProfile('a');
  assert.throws(() => removeProfile('a'), /Cannot remove the active profile/);
});

test('profile-store: removeProfile deletes dir tree of inactive profile', () => {
  addProfile('a');
  addProfile('b');
  setActiveProfile('a');
  removeProfile('b');
  assert.deepEqual(listProfiles(), ['a']);
  assert.ok(!existsSync(resolve(root(), 'profile-b')));
});

test('migration: legacy profile/ dir is removed and personal+enterprise seeded on first run', () => {
  // Simulate a pre-named-profiles install.
  mkdirSync(resolve(root(), 'profile'), { recursive: true });
  writeFileSync(resolve(root(), 'profile', 'cookies.fake'), 'legacy', 'utf8');
  mkdirSync(resolve(root(), 'runtime'), { recursive: true });
  mkdirSync(resolve(root(), 'logs'), { recursive: true });

  const result = runLegacyMigration();
  assert.equal(result.migrated, true);
  assert.equal(result.deletedLegacy, true);
  assert.ok(!existsSync(resolve(root(), 'profile')));
  assert.ok(!existsSync(resolve(root(), 'runtime')));
  assert.ok(!existsSync(resolve(root(), 'logs')));
  assert.deepEqual(listProfiles().sort(), ['enterprise', 'personal']);
  assert.equal(getActiveProfile(), 'personal');
});

test('migration: idempotent — second run is a no-op', () => {
  mkdirSync(resolve(root(), 'profile'), { recursive: true });
  runLegacyMigration();
  const second = runLegacyMigration();
  assert.equal(second.migrated, false);
  assert.equal(second.deletedLegacy, false);
});

test('migration: skipped when named profiles already exist (preserves user setup)', () => {
  addProfile('custom');
  setActiveProfile('custom');
  // Even if a stray legacy dir appears, migration should not touch user state.
  mkdirSync(resolve(root(), 'profile'), { recursive: true });
  writeFileSync(resolve(root(), 'profile', 'leftover'), '', 'utf8');

  const result = runLegacyMigration();
  // Profile-already-exists path: marker is written but legacy NOT deleted (named profiles present means user is already on the new system).
  assert.equal(result.deletedLegacy, false);
  assert.deepEqual(listProfiles(), ['custom']);
  assert.equal(getActiveProfile(), 'custom');
  // Legacy dir is left alone since user is already migrated.
  assert.ok(existsSync(resolve(root(), 'profile')));
});

test('migration: writes marker file', () => {
  runLegacyMigration();
  const marker = resolve(root(), '.named-profiles-migrated');
  assert.ok(existsSync(marker));
  const contents = readFileSync(marker, 'utf8');
  assert.match(contents, /^\d{4}-\d{2}-\d{2}T/);
});
