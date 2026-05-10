import { homedir } from 'node:os';
import { resolve } from 'node:path';

/** Resolve the root dir each call so tests can override $HOME without re-importing. */
function getRoot(): string {
  return resolve(homedir(), '.ai-web-bridge');
}

export interface RuntimePaths {
  /** Top-level ~/.ai-web-bridge/ */
  root: string;
  /** Active-profile pointer file (~/.ai-web-bridge/active-profile.json). */
  activeProfileFile: string;
  /** Per-profile Chromium user-data-dir (~/.ai-web-bridge/profile-<name>/). */
  profileDir: string;
  /** Per-profile runtime dir holding pid/port files (~/.ai-web-bridge/runtime-<name>/). */
  runtimeDir: string;
  /** Per-profile Chromium PID file. */
  pidFile: string;
  /** Per-profile CDP port file. */
  portFile: string;
  /** Per-profile log dir. */
  logsDir: string;
  /** Legacy profile dir from the pre-named-profiles era. Used only by the migration check. */
  legacyProfileDir: string;
  /** Legacy runtime dir from the pre-named-profiles era. */
  legacyRuntimeDir: string;
  /** Legacy logs dir from the pre-named-profiles era. */
  legacyLogsDir: string;
}

/** Allowed shape for profile names. Stricter than POSIX filenames so we never collide with our own prefixes. */
const PROFILE_NAME_PATTERN = /^[a-z0-9][a-z0-9_-]{0,31}$/;

/** Throws if `name` doesn't match the allowed profile-name shape. */
export function assertValidProfileName(name: string): void {
  if (!PROFILE_NAME_PATTERN.test(name)) {
    throw new Error(
      `Invalid profile name "${name}". Must be 1–32 chars, lowercase alphanumeric / dashes / underscores, starting with alphanumeric.`
    );
  }
}

/** Resolve the on-disk paths used by the named profile `name`. */
export function getRuntimePaths(name: string): RuntimePaths {
  assertValidProfileName(name);
  const root = getRoot();
  const profileDir = resolve(root, `profile-${name}`);
  const runtimeDir = resolve(root, `runtime-${name}`);
  const logsDir = resolve(root, `logs-${name}`);
  return {
    root,
    activeProfileFile: resolve(root, 'active-profile.json'),
    profileDir,
    runtimeDir,
    pidFile: resolve(runtimeDir, 'chrome.pid'),
    portFile: resolve(runtimeDir, 'chrome.port'),
    logsDir,
    legacyProfileDir: resolve(root, 'profile'),
    legacyRuntimeDir: resolve(root, 'runtime'),
    legacyLogsDir: resolve(root, 'logs')
  };
}

/** Top-level root path; useful for callers that need to enumerate profile dirs. Read each call to honor $HOME overrides in tests. */
export function getAwbRoot(): string {
  return getRoot();
}

/** Default port for the first-launched profile when no CDP port has been allocated yet. */
export const DEFAULT_CDP_PORT = 9222;
