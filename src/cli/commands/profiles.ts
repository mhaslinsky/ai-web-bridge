import {
  addProfile,
  ensureInitialized,
  getActiveProfile,
  listProfiles,
  removeProfile,
  runLegacyMigration,
  setActiveProfile
} from '../../server/profile-store.js';
import { getRuntimePaths } from '../../server/runtime-paths.js';
import { stopChromium } from '../../server/browser.js';

function bootstrap(): void {
  runLegacyMigration();
  ensureInitialized();
}

/** `ai-web-bridge profiles list` — show all profiles with the active one marked. */
export async function profilesListCommand(): Promise<void> {
  bootstrap();
  const profiles = listProfiles();
  if (profiles.length === 0) {
    console.log('No profiles. Run `ai-web-bridge profiles add <name>` to create one.');
    return;
  }
  let active = '';
  try {
    active = getActiveProfile();
  } catch {
    // active not set; fine.
  }
  for (const name of profiles) {
    const marker = name === active ? '* ' : '  ';
    const dir = getRuntimePaths(name).profileDir;
    console.log(`${marker}${name}\t${dir}`);
  }
  if (!active) {
    console.log('\n(no active profile set — run `ai-web-bridge profiles use <name>`)');
  }
}

/** `ai-web-bridge profiles add <name>` — create an empty profile dir tree. */
export async function profilesAddCommand(name: string): Promise<void> {
  bootstrap();
  const before = listProfiles();
  if (before.includes(name)) {
    console.log(`Profile "${name}" already exists.`);
    return;
  }
  addProfile(name);
  console.log(`Created profile "${name}". Run \`ai-web-bridge profiles use ${name}\` to switch, then \`ai-web-bridge login <site>\` to authenticate.`);
}

/** `ai-web-bridge profiles use <name>` — switch the active profile. */
export async function profilesUseCommand(name: string): Promise<void> {
  bootstrap();
  setActiveProfile(name);
  console.log(`Active profile is now "${name}". Subsequent web_run / login / start calls target this profile.`);
}

/** `ai-web-bridge profiles remove <name>` — delete a profile's on-disk state. Refuses active or last-remaining profile. */
export async function profilesRemoveCommand(name: string): Promise<void> {
  bootstrap();
  // Stop the profile's Chromium first so we don't leave an orphaned process holding the dir.
  await stopChromium(name).catch(() => undefined);
  removeProfile(name);
  console.log(`Removed profile "${name}".`);
}
