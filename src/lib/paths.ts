import { existsSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { resolve, sep } from 'node:path';

export class PathPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PathPolicyError';
  }
}

function isUnder(child: string, parent: string): boolean {
  const c = resolve(child);
  const p = resolve(parent);
  if (c === p) return true;
  return c.startsWith(p.endsWith(sep) ? p : p + sep);
}

export interface PathPolicyOptions {
  /** Extra roots beyond tmpdir + ~/Desktop/AIDB. */
  extraRoots?: readonly string[];
}

const DEFAULT_AIDB_ROOT = resolve(homedir(), 'Desktop', 'AIDB');

export function defaultAllowedRoots(opts: PathPolicyOptions = {}): string[] {
  const roots = [tmpdir(), DEFAULT_AIDB_ROOT];
  if (opts.extraRoots) roots.push(...opts.extraRoots);
  return roots.map((r) => resolve(r));
}

export interface ValidateDestOptions extends PathPolicyOptions {
  /** Allow overwriting an existing file at the resolved path. */
  force?: boolean;
}

/**
 * Resolve `inputPath` and ensure it lives under one of the allowed roots and
 * does not collide with an existing file unless `force` is set.
 *
 * Throws PathPolicyError on violation. Returns the resolved absolute path.
 */
export function validateDestPath(inputPath: string, opts: ValidateDestOptions = {}): string {
  const resolved = resolve(inputPath);
  const roots = defaultAllowedRoots(opts);
  const ok = roots.some((root) => isUnder(resolved, root));
  if (!ok) {
    throw new PathPolicyError(
      `Refusing to write to ${resolved}: not under an allowed root (${roots.join(', ')}).`
    );
  }
  if (!opts.force && existsSync(resolved)) {
    throw new PathPolicyError(
      `Refusing to overwrite existing file at ${resolved}. Pass force: true to override.`
    );
  }
  return resolved;
}
