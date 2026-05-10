import { getContext, launchChromium, getRuntimeStatus } from '../../server/browser.js';
import { loadAdapters } from '../../server/adapter-loader.js';

const SITE_HINTS: Record<string, string> = {
  'claude.ai': 'https://claude.ai/login',
  'claude-design': 'https://claude.ai/login'
};

/** `ai-web-bridge login <site>` — open the named site in the automation profile so the user can sign in. */
export async function loginCommand(site: string): Promise<void> {
  const status = await getRuntimeStatus();
  if (!status.cdpReachable) await launchChromium();

  // Resolve a target URL. Prefer adapter-specified default_url; fall back to a hint or raw site.
  const loaded = await loadAdapters();
  const matchedAdapter = loaded.byslug.get(site);
  let targetUrl = matchedAdapter?.default_url ?? SITE_HINTS[site];
  if (!targetUrl) targetUrl = `https://${site.replace(/^https?:\/\//, '')}`;

  const context = await getContext();
  const page = await context.newPage();
  await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
  page.bringToFront().catch(() => undefined);
  console.log(
    `Opened ${targetUrl} in the automation Chromium. Sign in there, then close this command. The session will persist in ~/.ai-web-bridge/profile/.`
  );
}
