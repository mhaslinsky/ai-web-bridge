import { stopChromium } from '../../server/browser.js';

export async function stopCommand(): Promise<void> {
  const result = await stopChromium();
  if (!result.stopped) {
    console.log('Automation Chromium was not running.');
    return;
  }
  console.log(`Stopped automation Chromium (was PID ${result.pid}).`);
}
