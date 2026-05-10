import { test, before, after } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const SERVER_PATH = resolve(here, '..', 'dist', 'server', 'index.js');

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id?: number | string;
  result?: unknown;
  error?: { code: number; message: string };
}

class McpClient {
  private buf = '';
  private responses: JsonRpcResponse[] = [];
  private nextId = 1;

  constructor(private child: ChildProcessWithoutNullStreams) {
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      this.buf += chunk;
      let idx;
      while ((idx = this.buf.indexOf('\n')) >= 0) {
        const line = this.buf.slice(0, idx).trim();
        this.buf = this.buf.slice(idx + 1);
        if (!line) continue;
        try {
          this.responses.push(JSON.parse(line));
        } catch {
          /* ignore non-JSON noise */
        }
      }
    });
  }

  send(msg: unknown): void {
    this.child.stdin.write(JSON.stringify(msg) + '\n');
  }

  async request(method: string, params: unknown = {}, timeoutMs = 5000): Promise<JsonRpcResponse> {
    const id = this.nextId++;
    this.send({ jsonrpc: '2.0', id, method, params });
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const found = this.responses.find((r) => r.id === id);
      if (found) return found;
      await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error(`MCP request "${method}" timed out after ${timeoutMs}ms`);
  }

  notify(method: string, params: unknown = {}): void {
    this.send({ jsonrpc: '2.0', method, params });
  }
}

async function startServer(env: NodeJS.ProcessEnv = {}): Promise<{ child: ChildProcessWithoutNullStreams; client: McpClient }> {
  const child = spawn(process.execPath, [SERVER_PATH], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, ...env }
  });
  const client = new McpClient(child);
  // Initialize handshake so subsequent requests work.
  await client.request('initialize', {
    protocolVersion: '2024-11-05',
    clientInfo: { name: 'test', version: '0.0.0' },
    capabilities: {}
  });
  client.notify('notifications/initialized');
  return { child, client };
}

before(() => {
  if (!existsSync(SERVER_PATH)) {
    throw new Error(
      `Built server not found at ${SERVER_PATH}. Run \`npm run build\` before \`npm test\` (or rely on the pretest hook).`
    );
  }
});

test('server boots in default mode and registers exactly the public tool surface', async () => {
  const { child, client } = await startServer();
  try {
    const res = await client.request('tools/list');
    const names = ((res.result as { tools: { name: string }[] }).tools.map((t) => t.name)).sort();
    assert.deepEqual(names, ['web_list_adapters', 'web_run']);
  } finally {
    child.kill('SIGTERM');
  }
});

test('server in dev mode registers web_eval as a third tool', async () => {
  const { child, client } = await startServer({ AI_WEB_BRIDGE_DEV: '1' });
  try {
    const res = await client.request('tools/list');
    const names = ((res.result as { tools: { name: string }[] }).tools.map((t) => t.name)).sort();
    assert.deepEqual(names, ['web_eval', 'web_list_adapters', 'web_run']);
  } finally {
    child.kill('SIGTERM');
  }
});

test('web_list_adapters returns the claude-design adapter with all six actions', async () => {
  const { child, client } = await startServer();
  try {
    const res = await client.request('tools/call', {
      name: 'web_list_adapters',
      arguments: {}
    });
    const text = ((res.result as { content: Array<{ text: string }> }).content[0]!.text);
    const parsed = JSON.parse(text) as { adapters: Array<{ slug: string; actions: Array<{ name: string; risk_level: string; mutates_state: boolean }> }> };
    assert.equal(parsed.adapters.length, 1);
    const adapter = parsed.adapters[0]!;
    assert.equal(adapter.slug, 'claude-design');

    const actionNames = adapter.actions.map((a) => a.name).sort();
    assert.deepEqual(actionNames, [
      'export_design',
      'list_designs',
      'open_design',
      'screenshot',
      'summarize_design',
      'tell_canvas_chat'
    ]);

    // Risk metadata: tell_canvas_chat must be flagged as a mutation.
    const tcc = adapter.actions.find((a) => a.name === 'tell_canvas_chat')!;
    assert.equal(tcc.risk_level, 'mutation');
    assert.equal(tcc.mutates_state, true);

    // Read-only actions must not claim mutation.
    for (const name of ['list_designs', 'open_design', 'summarize_design', 'screenshot']) {
      const a = adapter.actions.find((x) => x.name === name)!;
      assert.equal(a.mutates_state, false, `${name} should not claim mutates_state`);
    }
  } finally {
    child.kill('SIGTERM');
  }
});

test('web_run returns an MCP error result for unknown adapter (does not crash server)', async () => {
  const { child, client } = await startServer();
  try {
    const res = await client.request('tools/call', {
      name: 'web_run',
      arguments: { adapter: 'no-such-adapter', action: 'whatever' }
    });
    const result = res.result as { isError?: boolean; content: Array<{ text: string }> };
    assert.equal(result.isError, true);
    assert.match(result.content[0]!.text, /unknown_adapter/);
  } finally {
    child.kill('SIGTERM');
  }
});
