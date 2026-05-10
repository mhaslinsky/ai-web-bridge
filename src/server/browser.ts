import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, openSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { DEFAULT_CDP_PORT, RUNTIME_PATHS } from './runtime-paths.js';

let browserPromise: Promise<Browser> | null = null;

function ensureRuntimeDirs(): void {
  for (const dir of [RUNTIME_PATHS.root, RUNTIME_PATHS.profileDir, RUNTIME_PATHS.runtimeDir, RUNTIME_PATHS.logsDir]) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }
}

async function probeCdp(port: number, timeoutMs = 200): Promise<boolean> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: ctrl.signal });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export interface RuntimeStatus {
  chromeRunning: boolean;
  cdpPort: number | null;
  pid: number | null;
  cdpReachable: boolean;
}

export async function getRuntimeStatus(): Promise<RuntimeStatus> {
  let pid: number | null = null;
  let cdpPort: number | null = null;
  if (existsSync(RUNTIME_PATHS.pidFile)) {
    const raw = readFileSync(RUNTIME_PATHS.pidFile, 'utf8').trim();
    const parsed = Number(raw);
    if (Number.isInteger(parsed) && parsed > 0) pid = parsed;
  }
  if (existsSync(RUNTIME_PATHS.portFile)) {
    const raw = readFileSync(RUNTIME_PATHS.portFile, 'utf8').trim();
    const parsed = Number(raw);
    if (Number.isInteger(parsed) && parsed > 0) cdpPort = parsed;
  }
  const chromeRunning = pid !== null && isPidAlive(pid);
  const cdpReachable = cdpPort !== null && (await probeCdp(cdpPort, 300));
  return { chromeRunning, cdpPort, pid, cdpReachable };
}

export interface LaunchOptions {
  port?: number;
  detached?: boolean;
}

/**
 * Launch a detached Chromium with a remote debugging port and the dedicated
 * automation profile. The process survives this process exiting so the CLI
 * and MCP server can both attach via CDP independently.
 */
export async function launchChromium(opts: LaunchOptions = {}): Promise<{ pid: number; port: number }> {
  ensureRuntimeDirs();
  const port = opts.port ?? DEFAULT_CDP_PORT;
  const status = await getRuntimeStatus();
  if (status.chromeRunning && status.cdpReachable && status.pid) {
    return { pid: status.pid, port: status.cdpPort ?? port };
  }

  const exec = chromium.executablePath();
  if (!exec) {
    throw new Error(
      "Playwright's bundled Chromium isn't installed. Run: npx playwright install chromium"
    );
  }

  const args = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${RUNTIME_PATHS.profileDir}`,
    '--no-default-browser-check',
    '--no-first-run',
    '--disable-features=ChromeWhatsNewUI,GlobalMediaControls'
  ];

  const out = openSync(`${RUNTIME_PATHS.logsDir}/chrome.out.log`, 'a');
  const err = openSync(`${RUNTIME_PATHS.logsDir}/chrome.err.log`, 'a');

  const child = spawn(exec, args, {
    detached: opts.detached !== false,
    stdio: ['ignore', out, err]
  });
  if (typeof child.pid !== 'number') {
    throw new Error('Failed to spawn Chromium: no PID returned.');
  }
  child.unref();

  writeFileSync(RUNTIME_PATHS.pidFile, String(child.pid), 'utf8');
  writeFileSync(RUNTIME_PATHS.portFile, String(port), 'utf8');

  // Wait up to 8s for the CDP port to come up.
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    if (await probeCdp(port, 250)) return { pid: child.pid, port };
    await sleep(150);
  }
  throw new Error(`Chromium launched (pid ${child.pid}) but CDP port ${port} did not become reachable within 8s.`);
}

export async function stopChromium(): Promise<{ stopped: boolean; pid: number | null }> {
  const status = await getRuntimeStatus();
  if (!status.chromeRunning || status.pid === null) return { stopped: false, pid: null };
  try {
    process.kill(status.pid, 'SIGTERM');
  } catch {
    return { stopped: false, pid: status.pid };
  }
  return { stopped: true, pid: status.pid };
}

/**
 * Get a connected Browser. Hybrid recovery: if Chromium isn't reachable,
 * launches it transparently. The returned Browser owns the persistent
 * BrowserContext for the automation profile.
 */
export async function getBrowser(): Promise<Browser> {
  if (browserPromise) {
    try {
      const b = await browserPromise;
      if (b.isConnected()) return b;
    } catch {
      // fall through and reconnect
    }
    browserPromise = null;
  }

  browserPromise = (async () => {
    let status = await getRuntimeStatus();
    if (!status.cdpReachable) {
      await launchChromium();
      status = await getRuntimeStatus();
    }
    const port = status.cdpPort ?? DEFAULT_CDP_PORT;
    const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    browser.on('disconnected', () => {
      browserPromise = null;
    });
    return browser;
  })();

  return browserPromise;
}

/**
 * Get the first usable BrowserContext on the running Chromium. Prefers an
 * existing context (so Playwright sees the user's logged-in tabs); creates
 * one only if none exists.
 */
export async function getContext(): Promise<BrowserContext> {
  const browser = await getBrowser();
  const ctxs = browser.contexts();
  if (ctxs.length > 0 && ctxs[0]) return ctxs[0];
  return browser.newContext();
}

/**
 * Get a Page targeting `targetUrl`. If a tab is already on a matching origin,
 * reuse it; otherwise open a new tab.
 */
export async function getPage(targetUrl?: string): Promise<Page> {
  const ctx = await getContext();
  const pages = ctx.pages();
  if (targetUrl) {
    const target = new URL(targetUrl);
    for (const p of pages) {
      try {
        const u = new URL(p.url());
        if (u.host === target.host) {
          if (!p.url().startsWith(targetUrl)) await p.goto(targetUrl, { waitUntil: 'domcontentloaded' });
          return p;
        }
      } catch {
        // ignore, try next page
      }
    }
    const fresh = await ctx.newPage();
    await fresh.goto(targetUrl, { waitUntil: 'domcontentloaded' });
    return fresh;
  }
  if (pages.length > 0 && pages[0]) return pages[0];
  return ctx.newPage();
}
