import { launchChromium, getRuntimeStatus } from '../../server/browser.js';

/** `ai-web-bridge start` — launch the active profile's automation Chromium (no-op if already running). */
export async function startCommand(): Promise<void> {
  const before = await getRuntimeStatus();
  if (before.chromeRunning && before.cdpReachable) {
    console.log(`Already running for profile "${before.profile}". PID ${before.pid}, CDP port ${before.cdpPort}.`);
    return;
  }
  const { profile, pid, port } = await launchChromium();
  console.log(`Launched automation Chromium for profile "${profile}". PID ${pid}, CDP port ${port}.`);
}
