import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, openSync } from 'node:fs';
import { createServer } from 'node:net';
import { setTimeout as sleep } from 'node:timers/promises';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { DEFAULT_CDP_PORT, getRuntimePaths } from './runtime-paths.js';
import { ensureInitialized, getActiveProfile, runLegacyMigration } from './profile-store.js';

/** Cache of connected browsers, keyed by profile name. */
const browserPromises = new Map<string, Promise<Browser>>();

/** Resolve which profile to operate on. Defaults to the active profile if not specified. */
function resolveProfile(profile?: string): string {
  if (profile) return profile;
  // First-touch initialization: migrate legacy state, then ensure a default profile exists.
  runLegacyMigration();
  ensureInitialized();
  return getActiveProfile();
}

/** Create the runtime directory tree for `profile` if missing. */
function ensureRuntimeDirs(profile: string): void {
  const paths = getRuntimePaths(profile);
  for (const dir of [paths.root, paths.profileDir, paths.runtimeDir, paths.logsDir]) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }
}

/** True if Chromium's CDP HTTP endpoint is responding on `port`. */
async function probeCdp(port: number, timeoutMs = 200): Promise<boolean> {
  const abortController = new AbortController();
  const timer = setTimeout(() => abortController.abort(), timeoutMs);
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: abortController.signal });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** True if a process with `pid` is currently running (sends signal 0 to test). */
function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Ask the OS for a free TCP port by binding to 0 and reading the assigned port back. */
async function findFreePort(): Promise<number> {
  return new Promise<number>((resolveFn, rejectFn) => {
    const server = createServer();
    server.unref();
    server.on('error', rejectFn);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (typeof address === 'object' && address && 'port' in address) {
        const { port } = address;
        server.close(() => resolveFn(port));
      } else {
        rejectFn(new Error('Failed to read assigned port from net.createServer.'));
      }
    });
  });
}

export interface RuntimeStatus {
  profile: string;
  chromeRunning: boolean;
  cdpPort: number | null;
  pid: number | null;
  cdpReachable: boolean;
}

/** Snapshot of the named profile's Chromium runtime state from on-disk pid/port files + a CDP probe. */
export async function getRuntimeStatus(profile?: string): Promise<RuntimeStatus> {
  const profileName = resolveProfile(profile);
  const paths = getRuntimePaths(profileName);
  let pid: number | null = null;
  let cdpPort: number | null = null;
  if (existsSync(paths.pidFile)) {
    const rawPid = readFileSync(paths.pidFile, 'utf8').trim();
    const parsedPid = Number(rawPid);
    if (Number.isInteger(parsedPid) && parsedPid > 0) pid = parsedPid;
  }
  if (existsSync(paths.portFile)) {
    const rawPort = readFileSync(paths.portFile, 'utf8').trim();
    const parsedPort = Number(rawPort);
    if (Number.isInteger(parsedPort) && parsedPort > 0) cdpPort = parsedPort;
  }
  const chromeRunning = pid !== null && isPidAlive(pid);
  const cdpReachable = cdpPort !== null && (await probeCdp(cdpPort, 300));
  return { profile: profileName, chromeRunning, cdpPort, pid, cdpReachable };
}

export interface LaunchOptions {
  profile?: string;
  port?: number;
  detached?: boolean;
}

/**
 * Launch a detached Chromium against the named profile's user-data-dir.
 * The first profile to launch keeps DEFAULT_CDP_PORT (9222) for backward
 * familiarity; subsequent profiles get OS-assigned free ports. The process
 * survives this process exiting so the CLI and MCP server can both attach
 * via CDP independently.
 */
export async function launchChromium(opts: LaunchOptions = {}): Promise<{ profile: string; pid: number; port: number }> {
  const profileName = resolveProfile(opts.profile);
  ensureRuntimeDirs(profileName);
  const paths = getRuntimePaths(profileName);

  const status = await getRuntimeStatus(profileName);
  if (status.chromeRunning && status.cdpReachable && status.pid) {
    return { profile: profileName, pid: status.pid, port: status.cdpPort ?? DEFAULT_CDP_PORT };
  }

  // Pick a port: explicit > previously-used > default if free > OS-assigned.
  let port = opts.port ?? status.cdpPort ?? DEFAULT_CDP_PORT;
  if (await probeCdp(port, 200)) {
    // Port is in use by something else; let the OS pick.
    port = await findFreePort();
  }

  const chromiumExecutable = chromium.executablePath();
  if (!chromiumExecutable) {
    throw new Error("Playwright's bundled Chromium isn't installed. Run: npx playwright install chromium");
  }

  const launchArgs = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${paths.profileDir}`,
    '--no-default-browser-check',
    '--no-first-run',
    '--disable-features=ChromeWhatsNewUI,GlobalMediaControls'
  ];

  const stdoutFd = openSync(`${paths.logsDir}/chrome.out.log`, 'a');
  const stderrFd = openSync(`${paths.logsDir}/chrome.err.log`, 'a');

  const child = spawn(chromiumExecutable, launchArgs, {
    detached: opts.detached !== false,
    stdio: ['ignore', stdoutFd, stderrFd]
  });
  if (typeof child.pid !== 'number') {
    throw new Error('Failed to spawn Chromium: no PID returned.');
  }
  child.unref();

  writeFileSync(paths.pidFile, String(child.pid), 'utf8');
  writeFileSync(paths.portFile, String(port), 'utf8');

  // Wait up to 8s for the CDP port to come up.
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    if (await probeCdp(port, 250)) return { profile: profileName, pid: child.pid, port };
    await sleep(150);
  }
  throw new Error(
    `Chromium for profile "${profileName}" launched (pid ${child.pid}) but CDP port ${port} did not become reachable within 8s.`
  );
}

/** Send SIGTERM to the named profile's recorded Chromium PID; no-op if not running. */
export async function stopChromium(profile?: string): Promise<{ profile: string; stopped: boolean; pid: number | null }> {
  const profileName = resolveProfile(profile);
  const status = await getRuntimeStatus(profileName);
  if (!status.chromeRunning || status.pid === null) return { profile: profileName, stopped: false, pid: null };
  try {
    process.kill(status.pid, 'SIGTERM');
  } catch {
    return { profile: profileName, stopped: false, pid: status.pid };
  }
  // Drop any cached Browser pointing at this profile so the next caller reconnects.
  browserPromises.delete(profileName);
  return { profile: profileName, stopped: true, pid: status.pid };
}

/**
 * Get a connected Browser for the named profile (or the active one). Hybrid
 * recovery: if Chromium isn't reachable, launches it transparently. The
 * returned Browser owns the persistent BrowserContext for that profile's
 * user-data-dir.
 */
export async function getBrowser(profile?: string): Promise<Browser> {
  const profileName = resolveProfile(profile);
  const cached = browserPromises.get(profileName);
  if (cached) {
    try {
      const browser = await cached;
      if (browser.isConnected()) return browser;
    } catch {
      // fall through and reconnect
    }
    browserPromises.delete(profileName);
  }

  const launching = (async () => {
    let status = await getRuntimeStatus(profileName);
    if (!status.cdpReachable) {
      await launchChromium({ profile: profileName });
      status = await getRuntimeStatus(profileName);
    }
    const port = status.cdpPort ?? DEFAULT_CDP_PORT;
    const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    browser.on('disconnected', () => {
      browserPromises.delete(profileName);
    });
    return browser;
  })();

  browserPromises.set(profileName, launching);
  return launching;
}

/**
 * Get the first usable BrowserContext on the named profile's Chromium.
 * Prefers an existing context (so Playwright sees the user's logged-in tabs);
 * creates one only if none exists.
 */
export async function getContext(profile?: string): Promise<BrowserContext> {
  const browser = await getBrowser(profile);
  const contexts = browser.contexts();
  if (contexts.length > 0 && contexts[0]) return contexts[0];
  return browser.newContext();
}

/**
 * Get a Page on the named profile (or active profile) targeting `targetUrl`.
 * If a tab is already on a matching origin, reuse it; otherwise open a new
 * tab.
 */
export async function getPage(targetUrl?: string, profile?: string): Promise<Page> {
  const context = await getContext(profile);
  const openPages = context.pages();
  if (targetUrl) {
    const target = new URL(targetUrl);
    for (const page of openPages) {
      try {
        const pageUrl = new URL(page.url());
        if (pageUrl.host === target.host) {
          if (!page.url().startsWith(targetUrl)) {
            process.stderr.write(`[ai-web-bridge] nav(getPage:reuse): ${page.url()} -> ${targetUrl}\n`);
            await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
          }
          return page;
        }
      } catch {
        // ignore, try next page
      }
    }
    const freshPage = await context.newPage();
    process.stderr.write(`[ai-web-bridge] nav(getPage:newtab): -> ${targetUrl}\n`);
    await freshPage.goto(targetUrl, { waitUntil: 'domcontentloaded' });
    return freshPage;
  }
  if (openPages.length > 0 && openPages[0]) return openPages[0];
  return context.newPage();
}
