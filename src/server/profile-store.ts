import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { assertValidProfileName, getAwbRoot, getRuntimePaths } from './runtime-paths.js';

function activeProfileFile(): string {
  return resolve(getAwbRoot(), 'active-profile.json');
}

function migrationMarker(): string {
  return resolve(getAwbRoot(), '.named-profiles-migrated');
}

/** Default profile created at first init when nothing else exists. */
export const DEFAULT_PROFILE = 'personal';
/** Profiles seeded by the legacy-data migration when the user upgrades. */
export const SEED_PROFILES_ON_MIGRATION = ['personal', 'enterprise'] as const;

interface ActiveProfileFile {
  name: string;
}

/** Ensure ~/.ai-web-bridge/ exists (parent of every other path). */
function ensureRoot(): void {
  const root = getAwbRoot();
  if (!existsSync(root)) mkdirSync(root, { recursive: true });
}

/**
 * One-shot upgrade for users coming from the pre-named-profiles era. If the
 * legacy `~/.ai-web-bridge/profile/` (or runtime/, logs/) dirs exist and no
 * named-profile dirs do, delete the legacy ones and seed `personal` and
 * `enterprise` empty profiles. Per the user's "clean slate" choice, no cookies
 * are migrated — both accounts re-authenticate on next login.
 *
 * Idempotent: writes a marker file once it runs, never repeats.
 */
export function runLegacyMigration(): { migrated: boolean; deletedLegacy: boolean } {
  ensureRoot();
  if (existsSync(migrationMarker())) return { migrated: false, deletedLegacy: false };

  const legacy = getRuntimePaths(DEFAULT_PROFILE);
  const hasLegacyProfile = existsSync(legacy.legacyProfileDir);
  const hasNamedProfiles = listProfiles().length > 0;

  let deletedLegacy = false;
  if (hasLegacyProfile && !hasNamedProfiles) {
    rmSync(legacy.legacyProfileDir, { recursive: true, force: true });
    rmSync(legacy.legacyRuntimeDir, { recursive: true, force: true });
    rmSync(legacy.legacyLogsDir, { recursive: true, force: true });
    deletedLegacy = true;
  }

  if (!hasNamedProfiles) {
    for (const name of SEED_PROFILES_ON_MIGRATION) addProfile(name);
    setActiveProfile(DEFAULT_PROFILE);
  }

  writeFileSync(migrationMarker(), new Date().toISOString(), 'utf8');
  return { migrated: true, deletedLegacy };
}

/** Initialize first-time state: ensure root, ensure default profile exists, ensure active pointer is valid. */
export function ensureInitialized(): void {
  ensureRoot();
  if (listProfiles().length === 0) addProfile(DEFAULT_PROFILE);
  if (!existsSync(activeProfileFile())) setActiveProfile(listProfiles()[0]!);
}

/** Read the names of all named profiles by scanning for `profile-<name>/` dirs. */
export function listProfiles(): string[] {
  const root = getAwbRoot();
  if (!existsSync(root)) return [];
  const entries = readdirSync(root, { withFileTypes: true });
  const names: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (!entry.name.startsWith('profile-')) continue;
    const name = entry.name.slice('profile-'.length);
    if (name) names.push(name);
  }
  return names.sort();
}

/** Read the active profile name from disk. Throws if no active profile is set or pointed-at profile no longer exists. */
export function getActiveProfile(): string {
  const file = activeProfileFile();
  if (!existsSync(file)) {
    throw new Error(
      'No active profile is set. Run `ai-web-bridge profiles use <name>` (or `ai-web-bridge profiles list` to see available profiles).'
    );
  }
  let parsed: ActiveProfileFile;
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8')) as ActiveProfileFile;
  } catch (err) {
    throw new Error(`active-profile.json is corrupted: ${(err as Error).message}`);
  }
  if (!parsed.name || typeof parsed.name !== 'string') {
    throw new Error('active-profile.json is missing the "name" field.');
  }
  assertValidProfileName(parsed.name);
  if (!existsSync(getRuntimePaths(parsed.name).profileDir)) {
    throw new Error(
      `Active profile "${parsed.name}" has no on-disk dir. Run \`ai-web-bridge profiles add ${parsed.name}\` to create it, or \`ai-web-bridge profiles use <other>\` to switch.`
    );
  }
  return parsed.name;
}

/** Set the active profile pointer. Profile must already exist on disk. */
export function setActiveProfile(name: string): void {
  ensureRoot();
  assertValidProfileName(name);
  if (!existsSync(getRuntimePaths(name).profileDir)) {
    throw new Error(`No profile named "${name}". Create it with \`ai-web-bridge profiles add ${name}\`.`);
  }
  const payload: ActiveProfileFile = { name };
  writeFileSync(activeProfileFile(), JSON.stringify(payload, null, 2) + '\n', 'utf8');
}

/** Create an empty profile dir tree for `name`. No-op if it already exists. */
export function addProfile(name: string): void {
  ensureRoot();
  assertValidProfileName(name);
  const paths = getRuntimePaths(name);
  for (const dir of [paths.profileDir, paths.runtimeDir, paths.logsDir]) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }
}

/** Delete a profile's on-disk state. Refuses to remove the active profile or the last remaining profile. */
export function removeProfile(name: string): void {
  assertValidProfileName(name);
  const profiles = listProfiles();
  if (!profiles.includes(name)) {
    throw new Error(`No profile named "${name}".`);
  }
  if (profiles.length === 1) {
    throw new Error(`Cannot remove the last remaining profile ("${name}"). Add another first.`);
  }
  if (existsSync(activeProfileFile())) {
    const active = getActiveProfile();
    if (active === name) {
      throw new Error(
        `Cannot remove the active profile ("${name}"). Run \`ai-web-bridge profiles use <other>\` first.`
      );
    }
  }
  const paths = getRuntimePaths(name);
  rmSync(paths.profileDir, { recursive: true, force: true });
  rmSync(paths.runtimeDir, { recursive: true, force: true });
  rmSync(paths.logsDir, { recursive: true, force: true });
}
