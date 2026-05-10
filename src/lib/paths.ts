import { existsSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { resolve, sep } from 'node:path';

/** Thrown when a destination path escapes the allowed roots or would silently overwrite. */
export class PathPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PathPolicyError';
  }
}

/** True if `child`, after symlink-free resolution, lives at or under `parent`. */
function isUnder(child: string, parent: string): boolean {
  const childAbsolute = resolve(child);
  const parentAbsolute = resolve(parent);
  if (childAbsolute === parentAbsolute) return true;
  return childAbsolute.startsWith(parentAbsolute.endsWith(sep) ? parentAbsolute : parentAbsolute + sep);
}

export interface PathPolicyOptions {
  /** Extra roots beyond tmpdir + ~/Desktop/AIDB. */
  extraRoots?: readonly string[];
}

const DEFAULT_AIDB_ROOT = resolve(homedir(), 'Desktop', 'AIDB');

/** Default writable roots: os.tmpdir() + ~/Desktop/AIDB, plus any `extraRoots` opted in. */
export function defaultAllowedRoots(options: PathPolicyOptions = {}): string[] {
  const roots = [tmpdir(), DEFAULT_AIDB_ROOT];
  if (options.extraRoots) roots.push(...options.extraRoots);
  return roots.map((root) => resolve(root));
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
export function validateDestPath(inputPath: string, options: ValidateDestOptions = {}): string {
  const resolvedPath = resolve(inputPath);
  const allowedRoots = defaultAllowedRoots(options);
  const isUnderAllowedRoot = allowedRoots.some((root) => isUnder(resolvedPath, root));
  if (!isUnderAllowedRoot) {
    throw new PathPolicyError(
      `Refusing to write to ${resolvedPath}: not under an allowed root (${allowedRoots.join(', ')}).`
    );
  }
  if (!options.force && existsSync(resolvedPath)) {
    throw new PathPolicyError(
      `Refusing to overwrite existing file at ${resolvedPath}. Pass force: true to override.`
    );
  }
  return resolvedPath;
}
