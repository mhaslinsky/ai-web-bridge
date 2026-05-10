// Verify web_list_adapters returns claude-design with 6 actions and metadata.
import { spawn } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const serverPath = resolve(here, '..', 'dist', 'server', 'index.js');

const send = (c, m) => c.stdin.write(JSON.stringify(m) + '\n');

const child = spawn(process.execPath, [serverPath], { stdio: ['pipe', 'pipe', 'inherit'] });
const out = [];
let buf = '';
child.stdout.on('data', (c) => {
  buf += c.toString();
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (line) try { out.push(JSON.parse(line)); } catch {}
  }
});

const wait = (pred, ms = 5000) => new Promise((res, rej) => {
  const t0 = Date.now();
  const tick = () => {
    const f = out.find(pred);
    if (f) return res(f);
    if (Date.now() - t0 > ms) return rej(new Error('timeout'));
    setTimeout(tick, 50);
  };
  tick();
});

send(child, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', clientInfo: { name: 's', version: '0' }, capabilities: {} } });
await wait((r) => r.id === 1);
send(child, { jsonrpc: '2.0', method: 'notifications/initialized' });
send(child, { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'web_list_adapters', arguments: {} } });
const r = await wait((r) => r.id === 2);
child.kill('SIGTERM');

const text = r.result?.content?.[0]?.text;
const parsed = JSON.parse(text);
const adapter = parsed.adapters?.[0];
console.log('adapter slug:', adapter?.slug);
console.log('display_name:', adapter?.display_name);
console.log('allowed_origins:', adapter?.allowed_origins);
console.log('actions:');
for (const a of adapter?.actions ?? []) {
  console.log(`  - ${a.name} (${a.risk_level}, mutates_state=${a.mutates_state}, writes_files=${a.writes_files}, requires_confirmation=${a.requires_confirmation})`);
}
const expected = ['list_designs', 'open_design', 'screenshot', 'export_design', 'summarize_design', 'tell_canvas_chat'];
const got = (adapter?.actions ?? []).map(a => a.name).sort();
const exSorted = [...expected].sort();
if (JSON.stringify(got) !== JSON.stringify(exSorted)) {
  console.error('FAIL action set mismatch');
  process.exit(1);
}
console.log('OK');
