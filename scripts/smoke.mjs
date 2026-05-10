// Smoke test: spawn the built MCP server and verify tools/list returns the
// expected tools. Does NOT exercise the browser — that requires the
// automation Chromium and a real claude.ai login.

import { spawn } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const serverPath = resolve(here, '..', 'dist', 'server', 'index.js');

function send(child, msg) {
  child.stdin.write(JSON.stringify(msg) + '\n');
}

async function main() {
  const dev = process.argv.includes('--dev');
  const child = spawn(process.execPath, [serverPath], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, AI_WEB_BRIDGE_DEV: dev ? '1' : '0' }
  });

  const responses = [];
  let buf = '';
  child.stdout.on('data', (chunk) => {
    buf += chunk.toString('utf8');
    let idx;
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line) continue;
      try {
        responses.push(JSON.parse(line));
      } catch {
        // ignore non-JSON lines
      }
    }
  });
  child.stderr.on('data', (c) => process.stderr.write(`[server stderr] ${c}`));

  send(child, {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      clientInfo: { name: 'smoke', version: '0.0.0' },
      capabilities: {}
    }
  });

  // Wait for initialize response, then list tools.
  const waitFor = (predicate, ms = 5000) =>
    new Promise((res, rej) => {
      const start = Date.now();
      const tick = () => {
        const found = responses.find(predicate);
        if (found) return res(found);
        if (Date.now() - start > ms) return rej(new Error('timeout'));
        setTimeout(tick, 50);
      };
      tick();
    });

  await waitFor((r) => r.id === 1);
  send(child, { jsonrpc: '2.0', method: 'notifications/initialized' });
  send(child, { jsonrpc: '2.0', id: 2, method: 'tools/list' });

  const tools = await waitFor((r) => r.id === 2);
  child.kill('SIGTERM');

  const names = tools.result?.tools?.map((t) => t.name).sort() ?? [];
  console.log('tools:', names);

  const expected = dev ? ['web_eval', 'web_list_adapters', 'web_run'] : ['web_list_adapters', 'web_run'];
  const ok = JSON.stringify(names) === JSON.stringify(expected);
  if (!ok) {
    console.error(`FAIL: expected ${JSON.stringify(expected)}, got ${JSON.stringify(names)}`);
    process.exit(1);
  }
  console.log('OK (dev=' + dev + ')');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
