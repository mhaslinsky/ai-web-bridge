import { homedir } from 'node:os';
import { resolve } from 'node:path';

const ROOT = resolve(homedir(), '.ai-web-bridge');

export const RUNTIME_PATHS = {
  root: ROOT,
  profileDir: resolve(ROOT, 'profile'),
  runtimeDir: resolve(ROOT, 'runtime'),
  pidFile: resolve(ROOT, 'runtime', 'chrome.pid'),
  portFile: resolve(ROOT, 'runtime', 'chrome.port'),
  logsDir: resolve(ROOT, 'logs')
} as const;

export const DEFAULT_CDP_PORT = 9222;
