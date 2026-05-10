import { getRuntimeStatus, getBrowser } from '../../server/browser.js';
import { loadAdapters } from '../../server/adapter-loader.js';

/** `ai-web-bridge status` — report Chromium PID, CDP reachability, loaded adapters, and open tab hosts. */
export async function statusCommand(): Promise<void> {
  const status = await getRuntimeStatus();
  console.log(`Chromium running: ${status.chromeRunning ? `yes (PID ${status.pid})` : 'no'}`);
  console.log(`CDP port: ${status.cdpPort ?? '(none)'}`);
  console.log(`CDP reachable: ${status.cdpReachable ? 'yes' : 'no'}`);

  const loaded = await loadAdapters();
  console.log(`Adapters loaded: ${loaded.list.length}`);
  for (const adapter of loaded.list) {
    console.log(`  - ${adapter.slug} (${adapter.display_name}) — origins: ${adapter.allowed_origins.join(', ')}`);
  }

  if (status.cdpReachable) {
    try {
      const browser = await getBrowser();
      const contexts = browser.contexts();
      const pageHosts = contexts
        .flatMap((context) => context.pages())
        .map((page) => {
          try {
            return new URL(page.url()).host;
          } catch {
            return page.url();
          }
        });
      console.log(`Open tabs (${pageHosts.length}): ${pageHosts.join(', ') || '(none)'}`);
    } catch (err) {
      console.log(`(couldn't read tabs: ${err instanceof Error ? err.message : String(err)})`);
    }
  }
}
