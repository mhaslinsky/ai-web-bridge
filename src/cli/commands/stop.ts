import { stopChromium } from '../../server/browser.js';

/** `ai-web-bridge stop` — terminate the active profile's Chromium (silent if not running). */
export async function stopCommand(): Promise<void> {
  const result = await stopChromium();
  if (!result.stopped) {
    console.log(`Automation Chromium for profile "${result.profile}" was not running.`);
    return;
  }
  console.log(`Stopped Chromium for profile "${result.profile}" (was PID ${result.pid}).`);
}
