import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Convenience: run the MCP server entry directly so users can invoke it via
 * `ai-web-bridge serve`. Useful when MCP clients don't support arbitrary npm
 * binaries — they can shell out to this command instead.
 */
export async function serveCommand(): Promise<void> {
  const here = dirname(fileURLToPath(import.meta.url));
  const serverPath = resolve(here, '..', 'server', 'index.js');
  const child = spawn(process.execPath, [serverPath], {
    stdio: 'inherit',
    env: process.env
  });
  child.on('exit', (code) => process.exit(code ?? 0));
}
