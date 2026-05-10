import { launchChromium, getRuntimeStatus } from '../../server/browser.js';

export async function startCommand(): Promise<void> {
  const before = await getRuntimeStatus();
  if (before.chromeRunning && before.cdpReachable) {
    console.log(`Already running. PID ${before.pid}, CDP port ${before.cdpPort}.`);
    return;
  }
  const { pid, port } = await launchChromium();
  console.log(`Launched automation Chromium. PID ${pid}, CDP port ${port}.`);
}
