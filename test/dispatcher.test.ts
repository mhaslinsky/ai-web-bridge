import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { z } from 'zod';
import type { BrowserContext, Page } from 'playwright';
import { dispatch, DispatcherError, type BrowserAccess } from '../src/server/dispatcher.js';
import type { AdapterDef, ActionDef } from '../src/server/adapter-types.js';

function makeFakePage(url: string): Page {
  return { url: () => url } as unknown as Page;
}

function makeFakeContext(): BrowserContext {
  return {} as unknown as BrowserContext;
}

function makeBrowser(pageUrl: string): BrowserAccess {
  return {
    getContext: async () => makeFakeContext(),
    getPage: async () => makeFakePage(pageUrl)
  };
}

function makeAdapter(overrides: Partial<AdapterDef> = {}): AdapterDef {
  const echo: ActionDef<{ msg: string }> = {
    description: 'echo',
    params: z.object({ msg: z.string() }).strict(),
    risk_level: 'read',
    mutates_state: false,
    writes_files: false,
    requires_confirmation: false,
    run: async (_ctx, args) => ({ echoed: args.msg })
  };
  return {
    slug: 'test-adapter',
    display_name: 'Test',
    allowed_origins: ['example.com'],
    default_url: 'https://example.com',
    actions: { echo },
    ...overrides
  };
}

test('dispatcher: runs an action and returns metadata', async () => {
  const adapter = makeAdapter();
  const out = await dispatch(adapter, 'echo', { msg: 'hi' }, makeBrowser('https://example.com/path'));
  assert.deepEqual(out.result, { echoed: 'hi' });
  assert.equal(out.meta.adapter, 'test-adapter');
  assert.equal(out.meta.action, 'echo');
  assert.equal(out.meta.risk_level, 'read');
  assert.equal(out.meta.mutates_state, false);
  assert.equal(out.meta.writes_files, false);
});

test('dispatcher: unknown action returns DispatcherError code "unknown_action"', async () => {
  const adapter = makeAdapter();
  await assert.rejects(
    dispatch(adapter, 'nonexistent', {}, makeBrowser('https://example.com/')),
    (err: unknown) => err instanceof DispatcherError && err.code === 'unknown_action'
  );
});

test('dispatcher: invalid args return DispatcherError code "invalid_args"', async () => {
  const adapter = makeAdapter();
  await assert.rejects(
    dispatch(adapter, 'echo', { msg: 123 }, makeBrowser('https://example.com/')),
    (err: unknown) => err instanceof DispatcherError && err.code === 'invalid_args'
  );
});

test('dispatcher: origin policy violation returns DispatcherError code "origin_violation"', async () => {
  const adapter = makeAdapter();
  await assert.rejects(
    dispatch(adapter, 'echo', { msg: 'hi' }, makeBrowser('https://evil.com/path')),
    (err: unknown) => err instanceof DispatcherError && err.code === 'origin_violation'
  );
});

test('dispatcher: subdomain origin matches allowlist parent', async () => {
  const adapter = makeAdapter({ allowed_origins: ['example.com'] });
  const out = await dispatch(adapter, 'echo', { msg: 'sub' }, makeBrowser('https://app.example.com/x'));
  assert.deepEqual(out.result, { echoed: 'sub' });
});

test('dispatcher: action error propagates', async () => {
  const explode: ActionDef<{}> = {
    description: 'explode',
    params: z.object({}).strict(),
    risk_level: 'read',
    mutates_state: false,
    writes_files: false,
    requires_confirmation: false,
    run: async () => {
      throw new Error('action-internal failure');
    }
  };
  const adapter = makeAdapter({ actions: { explode } });
  await assert.rejects(dispatch(adapter, 'explode', {}, makeBrowser('https://example.com/')), /action-internal failure/);
});

test('dispatcher: meta carries mutation flag for mutating actions', async () => {
  const mutate: ActionDef<{}> = {
    description: 'mutate',
    params: z.object({}).strict(),
    risk_level: 'mutation',
    mutates_state: true,
    writes_files: true,
    requires_confirmation: true,
    run: async () => 'done'
  };
  const adapter = makeAdapter({ actions: { mutate } });
  const out = await dispatch(adapter, 'mutate', {}, makeBrowser('https://example.com/'));
  assert.equal(out.meta.risk_level, 'mutation');
  assert.equal(out.meta.mutates_state, true);
  assert.equal(out.meta.writes_files, true);
});

test('dispatcher: queues concurrent calls (FIFO)', async () => {
  const order: number[] = [];
  const slowEcho: ActionDef<{ delay: number; tag: number }> = {
    description: 'slow',
    params: z.object({ delay: z.number(), tag: z.number() }).strict(),
    risk_level: 'read',
    mutates_state: false,
    writes_files: false,
    requires_confirmation: false,
    run: async (_ctx, args) => {
      await new Promise((r) => setTimeout(r, args.delay));
      order.push(args.tag);
      return args.tag;
    }
  };
  const adapter = makeAdapter({ actions: { slowEcho } });
  const browser = makeBrowser('https://example.com/');
  await Promise.all([
    dispatch(adapter, 'slowEcho', { delay: 30, tag: 1 }, browser),
    dispatch(adapter, 'slowEcho', { delay: 10, tag: 2 }, browser),
    dispatch(adapter, 'slowEcho', { delay: 5, tag: 3 }, browser)
  ]);
  assert.deepEqual(order, [1, 2, 3]);
});
