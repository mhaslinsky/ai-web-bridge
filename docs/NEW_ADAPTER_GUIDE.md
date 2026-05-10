# Building a new adapter

This is the quick-start guide for adding support for a new auth-walled web tool. The whole exercise is usually 30–90 minutes — most of it spent probing the live DOM to find good locators.

> **Audience:** AI agents and humans extending ai-web-bridge to a site beyond claude.ai/design. Read the [troubleshooting playbook](ADAPTER_TROUBLESHOOTING.md) first if you also need to debug an existing adapter — it covers the `web_eval` workflow you'll lean on heavily here too.

---

## When to write a new adapter

Reach for an adapter when **all** of these are true:
- The site has no public API, MCP, or CLI you could use instead.
- You'll plausibly do the same operation more than once. (One-off scrapes are not worth an adapter.)
- The operations you want are reachable via DOM interaction — clicks, form fills, link follows, content extraction.

Don't write an adapter for:
- Sites with first-party APIs (use the API; you'll thank yourself).
- Single-use scraping. Use `web_eval` (dev mode) directly.
- Highly dynamic apps where the DOM rotates per session — adapters there will break weekly.

---

## Step 1 — pick your slug and shape

Decide three things up front:

| Field | Convention | Example |
|---|---|---|
| `slug` | kebab-case, short, the canonical handle | `notion-pages` |
| `display_name` | Title case, human-friendly | `Notion Pages` |
| `allowed_origins` | host(s) the dispatcher will permit pages to be on | `['notion.so']` |
| `default_url` | where the adapter starts when invoked cold | `https://notion.so` |

The `allowed_origins` field is enforced server-side. If your site spans subdomains (`app.example.com`, `www.example.com`), list the **parent** — `'example.com'` matches `app.example.com` automatically via the subdomain rule. Don't add unrelated hosts here just to dodge a refusal; if the action navigates somewhere outside the allowlist, that's a bug to fix in the action, not the policy.

---

## Step 2 — scaffold the file

Create `src/adapters/<slug>.ts`:

```ts
import { z } from 'zod';
import type { AdapterDef, ActionDef } from '../server/adapter-types.js';

const HOME = 'https://example.com';
const ALLOWED_ORIGINS = ['example.com'] as const;

// Add actions below, then plug them into `adapter.actions`.

export const adapter: AdapterDef = {
  slug: 'my-site',
  display_name: 'My Site',
  allowed_origins: ALLOWED_ORIGINS,
  default_url: HOME,
  actions: {
    // list_things,
    // open_thing,
    // ...
  }
};
```

That's a valid (if empty) adapter. The loader will pick it up after `npm run build`.

---

## Step 3 — log into the site once

Add the site to your automation profile:

```bash
ai-web-bridge login my-site   # opens default_url in the automation Chromium
```

Sign in there. Cookies persist in `~/.ai-web-bridge/profile/` — you only do this once per site (or whenever the session expires).

---

## Step 4 — explore the DOM with `web_eval`

Enable dev mode (see [troubleshooting playbook](ADAPTER_TROUBLESHOOTING.md#step-2--enable-dev-mode-and-probe) for the toggle steps), then probe with `web_eval`. The probe snippets in the playbook (sections A–G) are reusable here too:

- **A** to enumerate all visible buttons (find what actions are available)
- **C** to find input fields (chat, search, comment boxes)
- **D** to open a menu and list items (overflow menus, dropdowns)
- **E** to inspect a list item's container structure (sidebars, tables)
- **F** to check `document.title` (often reflects the current entity's name)

Aim to leave Step 4 with a **list of locators that are stable on this site**. Prefer in this order:

1. `getByPlaceholder('exact text')` — placeholders are translation-stable and rarely change
2. `page.locator('button', { hasText: /^\s*Label\s*$/ })` — text-based, immune to icon-child contamination of accessible-name computation
3. `getByRole('button', { name: 'X', exact: true })` — only when the button has no icon child
4. URL-pattern matchers via `page.waitForURL(...)` for navigation completion
5. CSS class selectors — **avoid**. Class names are hashed and rotate per deploy.

---

## Step 5 — write the first action (read-only)

Always start with a `risk_level: 'read'` action that proves the basics work. For most sites this is a list-or-enumerate operation:

```ts
const list_things: ActionDef<{}> = {
  description: 'List things visible on the home page.',
  params: z.object({}).strict(),
  risk_level: 'read',
  mutates_state: false,
  writes_files: false,
  requires_confirmation: false,
  run: async (context) => {
    await context.page.goto(HOME, { waitUntil: 'domcontentloaded' });
    const things = await context.page.evaluate(() => {
      // Use the locator you found in Step 4.
      return Array.from(document.querySelectorAll('YOUR_SELECTOR'))
        .map(element => ({ /* ... */ }));
    });
    return { count: things.length, things };
  }
};
```

Plug it into `adapter.actions`, build, reconnect, run. If it returns the right data, you've got a working adapter. Everything else builds on this foundation.

---

## Step 6 — add navigation + screenshot actions

These two are mostly free once `list_things` works. They make the adapter self-debugging — you can always screenshot to see what state the browser is in when something behaves oddly.

```ts
const open_thing: ActionDef<{ name: string }> = {
  description: 'Navigate to a specific thing by name.',
  params: z.object({ name: z.string().min(1) }).strict(),
  risk_level: 'navigation',
  mutates_state: false,
  writes_files: false,
  requires_confirmation: false,
  run: async (context, { name }) => {
    // Resolve name → URL (probably via list_things), then goto.
    return { opened: { name, url: context.page.url() } };
  }
};

const screenshot: ActionDef<{ path?: string; full_page: boolean }> = {
  description: 'Capture a PNG screenshot of the current page.',
  params: z.object({ path: z.string().optional(), full_page: z.boolean().default(false) }).strict(),
  risk_level: 'read',
  mutates_state: false,
  writes_files: true,
  requires_confirmation: false,
  run: async (context, args) => {
    const { validateDestPath } = await import('../lib/paths.js');
    const { resolve } = await import('node:path');
    const { mkdir } = await import('node:fs/promises');
    const { dirname } = await import('node:path');

    const defaultPath = resolve(process.env.TMPDIR || '/tmp', 'ai-web-bridge', 'screenshots', `my-site-${Date.now()}.png`);
    const targetPath = validateDestPath(args.path ?? defaultPath, { force: true });
    await mkdir(dirname(targetPath), { recursive: true });
    await context.page.screenshot({ path: targetPath, fullPage: args.full_page });
    return { path: targetPath };
  }
};
```

Note the dynamic imports in `screenshot` — this is fine in adapters (tsup bundles them inline) and keeps adapters explicit about what helpers they reach for.

---

## Step 7 — risk metadata

Every action declares its risk profile so callers can decide what to do without inspecting the body. Pick honestly:

| Field | When true | Effect on caller |
|---|---|---|
| `risk_level: 'read'` | reads only; no DOM mutation, no remote-state change, no file writes | safe to chain, no confirmation needed |
| `risk_level: 'navigation'` | navigates without mutating state | safe but observable (URL changes are visible to the user) |
| `risk_level: 'mutation'` | changes remote state; might be reversible (edit) or irreversible (delete) | callers should pause and surface to the user |
| `risk_level: 'destructive'` | irreversible state change (deletion, broadcast, payment) | callers should never auto-chain; require explicit human go |
| `mutates_state: true` | any change visible to other users / other sessions of yours | the action queue still serializes, but downstream consumers care |
| `writes_files: true` | any disk write (screenshots, exports) | the dispatcher's path policy applies; restrict `dest_dir` |
| `requires_confirmation: true` | the action should never run without explicit user-side preview | clients should show args and a confirm gate before dispatching |

Mismatched metadata is a footgun — a destructive action flagged `read` will be auto-chained by callers and you'll find out the hard way. Be honest.

---

## Step 8 — adding a mutating action (do this carefully)

If your adapter needs to mutate (post a comment, edit a record, send a message), apply the **duplicate-before-mutate** pattern from `claude-design.ts → tell_canvas_chat` whenever the site supports it:

1. Drive the site's "duplicate" / "fork" / "save copy" affordance.
2. Verify the duplicate has a different identity (URL, ID, etc.) before continuing.
3. Apply the mutation to the duplicate.
4. Return both the original and the duplicate's identity so the user can revert by deleting the duplicate.

When the site doesn't support duplication (and many don't), the alternatives are:

- **Read-then-confirm:** the action returns a *plan* of what it would change, with `requires_confirmation: true`. The user explicitly invokes a follow-up `apply` action to execute. Two-call pattern.
- **Reversible-only verbs:** restrict the action's surface to verbs that have a clear undo path on the site (e.g. you can always edit a Notion block, so editing is fine; deleting requires a different ceremony).
- **Refuse:** if the action has no safe-by-construction shape on this site, don't ship it. Comment it out and document why.

The verb sanity layer in `lib/verbs.ts` is available — use it as a coarse pre-flight filter, not as your safety control. It catches dumb mistakes ("delete everything"), not adversarial input.

---

## Step 9 — write tests

The adapter loader and dispatcher already have unit tests against fakes. The thing your adapter adds is **selector logic**, which can't be unit-tested meaningfully without a live site. Test what you *can* test:

- A `test/<slug>.test.ts` that imports `adapter` and asserts the contract: slug, display_name, allowed_origins shape, all expected action keys exist, each action has the correct risk metadata.
- For pure helpers your adapter introduces (e.g. a custom URL-builder, a date parser): unit-test those directly.
- The live verification stays manual — run the action via Claude Code and check the result.

Example contract test:

```ts
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { adapter } from '../src/adapters/my-site.js';

test('my-site: contract', () => {
  assert.equal(adapter.slug, 'my-site');
  assert.equal(adapter.allowed_origins[0], 'example.com');
  assert.deepEqual(Object.keys(adapter.actions).sort(), ['list_things', 'open_thing', 'screenshot']);
  assert.equal(adapter.actions.list_things!.risk_level, 'read');
});
```

Run `npm test` — your test will run alongside the existing 47.

---

## Step 10 — verify end-to-end

```bash
npm run typecheck && npm run build && npm test
```

Then in Claude Code:

1. Reconnect ai-web-bridge in `/mcp` (cold reload — adapters are loaded at server startup).
2. `web_list_adapters` → confirm your slug shows up with the right actions and metadata.
3. Run each action via `web_run` against the live site.
4. Spot-check screenshots / output for sanity.

If anything misbehaves: the [troubleshooting playbook](ADAPTER_TROUBLESHOOTING.md) is the right next stop. Most issues are selector misses, and the diagnosis loop is the same one you'd run for `claude-design`.

---

## Step 11 — turn off dev mode and ship

Once the adapter works:

1. Remove `AI_WEB_BRIDGE_DEV` from `~/.claude.json` (the env field). Reconnect — `web_eval` should disappear.
2. Commit on a feature branch: `git checkout -b adapters/my-site`.
3. Push and open a PR.
4. Update the README's Adapter section if the new adapter has user-visible behavior worth advertising.

---

## Reference: the AdapterDef contract in full

```ts
export interface AdapterDef {
  slug: string;                              // kebab-case, unique across all loaded adapters
  display_name: string;                      // human-friendly Title Case
  allowed_origins: readonly string[];        // hosts the dispatcher will permit
  default_url: string;                       // initial URL the adapter operates on
  actions: Record<string, ActionDef<any>>;   // action name → definition
}

export interface ActionDef<P = unknown> {
  description: string;                       // shown in web_list_adapters
  params: z.ZodTypeAny;                      // validated by the dispatcher before run()
  risk_level: 'read' | 'navigation' | 'mutation' | 'destructive';
  mutates_state: boolean;
  writes_files: boolean;
  requires_confirmation: boolean;
  run: (context: ActionContext, args: P) => Promise<unknown>;
}

export interface ActionContext {
  page: Page;          // logged-in Playwright Page on default_url (or wherever the adapter navigated)
  context: BrowserContext;  // for opening additional tabs if needed
}
```

The fields are all load-bearing. Don't skip metadata — callers (including future-you) rely on it to make safe decisions about whether to invoke an action.

---

## Resources

- [`src/adapters/claude-design.ts`](../src/adapters/claude-design.ts) — the reference adapter. Read it before writing yours; it shows the duplicate-before-mutate pattern, resilient locators, and the action structure in real use.
- [`docs/ADAPTER_TROUBLESHOOTING.md`](ADAPTER_TROUBLESHOOTING.md) — when something breaks (and it will).
- [`src/server/adapter-types.ts`](../src/server/adapter-types.ts) — the canonical types.
