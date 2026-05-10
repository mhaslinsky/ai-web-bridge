import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { ActionQueue } from '../src/lib/action-queue.js';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

test('action-queue: tasks run sequentially in submission order', async () => {
  const q = new ActionQueue();
  const order: number[] = [];
  await Promise.all([
    q.run(async () => { await sleep(30); order.push(1); }),
    q.run(async () => { await sleep(10); order.push(2); }),
    q.run(async () => { await sleep(5); order.push(3); })
  ]);
  assert.deepEqual(order, [1, 2, 3]);
});

test('action-queue: a failing task does not block the next one', async () => {
  const q = new ActionQueue();
  const order: string[] = [];
  const a = q.run(async () => { order.push('a-start'); throw new Error('boom'); });
  const b = q.run(async () => { order.push('b-start'); return 'b-ok'; });
  await assert.rejects(a, /boom/);
  assert.equal(await b, 'b-ok');
  assert.deepEqual(order, ['a-start', 'b-start']);
});

test('action-queue: returns task results', async () => {
  const q = new ActionQueue();
  const v = await q.run(async () => 42);
  assert.equal(v, 42);
});
