import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { tmpdir, homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { validateDestPath, PathPolicyError } from '../src/lib/paths.js';

test('paths: tmpdir is allowed', () => {
  const dest = join(tmpdir(), `awb-test-${Date.now()}.txt`);
  const resolved = validateDestPath(dest);
  assert.equal(resolved, resolve(dest));
});

test('paths: AIDB root is allowed', () => {
  const dest = resolve(homedir(), 'Desktop', 'AIDB', 'awb-test', `f-${Date.now()}.txt`);
  const resolved = validateDestPath(dest);
  assert.equal(resolved, resolve(dest));
});

test('paths: paths outside allowed roots are refused', () => {
  assert.throws(() => validateDestPath('/etc/passwd-test'), PathPolicyError);
  assert.throws(() => validateDestPath('/usr/local/bin/oops'), PathPolicyError);
});

test('paths: traversal escape is refused', () => {
  // resolves out of tmpdir into /etc
  assert.throws(() => validateDestPath(join(tmpdir(), '..', '..', 'etc', 'passwd-test')), PathPolicyError);
});

test('paths: existing file is refused without force', () => {
  const dir = mkdtempSync(join(tmpdir(), 'awb-paths-'));
  try {
    const p = join(dir, 'existing.txt');
    writeFileSync(p, 'hi');
    assert.throws(() => validateDestPath(p), PathPolicyError);
    // with force, it succeeds
    const r = validateDestPath(p, { force: true });
    assert.equal(r, resolve(p));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('paths: extraRoots opens additional allowed directories', () => {
  const dir = mkdtempSync(join(tmpdir(), 'awb-extra-'));
  try {
    // dir is under tmpdir so already allowed; test extra roots with a non-tmpdir path
    const customRoot = mkdtempSync(join(homedir(), '.awb-test-'));
    try {
      const target = join(customRoot, 'inner', 'file.txt');
      assert.throws(() => validateDestPath(target), PathPolicyError);
      const ok = validateDestPath(target, { extraRoots: [customRoot] });
      assert.equal(ok, resolve(target));
    } finally {
      rmSync(customRoot, { recursive: true, force: true });
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
