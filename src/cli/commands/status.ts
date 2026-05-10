import { getRuntimeStatus, getBrowser } from '../../server/browser.js';
import { loadAdapters } from '../../server/adapter-loader.js';

export async function statusCommand(): Promise<void> {
  const status = await getRuntimeStatus();
  console.log(`Chromium running: ${status.chromeRunning ? `yes (PID ${status.pid})` : 'no'}`);
  console.log(`CDP port: ${status.cdpPort ?? '(none)'}`);
  console.log(`CDP reachable: ${status.cdpReachable ? 'yes' : 'no'}`);

  const loaded = await loadAdapters();
  console.log(`Adapters loaded: ${loaded.list.length}`);
  for (const a of loaded.list) {
    console.log(`  - ${a.slug} (${a.display_name}) — origins: ${a.allowed_origins.join(', ')}`);
  }

  if (status.cdpReachable) {
    try {
      const browser = await getBrowser();
      const ctxs = browser.contexts();
      const pageHosts = ctxs
        .flatMap((c) => c.pages())
        .map((p) => {
          try {
            return new URL(p.url()).host;
          } catch {
            return p.url();
          }
        });
      console.log(`Open tabs (${pageHosts.length}): ${pageHosts.join(', ') || '(none)'}`);
    } catch (err) {
      console.log(`(couldn't read tabs: ${err instanceof Error ? err.message : String(err)})`);
    }
  }
}
