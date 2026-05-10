# Adapter troubleshooting playbook

When an adapter breaks, the failure mode is almost always **a selector that no longer matches the page** — Anthropic ships a UI change, a class name shifts, a button moves into a menu, etc. This guide walks you through diagnosing what broke and fixing it. It's written for a future agent (Claude Code, Codex, or another tool) who picks up the repo cold; everything you need is here.

> **Audience:** AI agents and humans tuning `src/adapters/<slug>.ts` after the underlying site's DOM has shifted. Especially `claude-design.ts`.

---

## TL;DR — the loop

```
1. Run the broken action. Capture the exact error message.
2. Enable dev mode (AI_WEB_BRIDGE_DEV=1) so web_eval is registered.
3. Use web_eval to probe the live DOM and find the new locator.
4. Update src/adapters/<slug>.ts. Run typecheck + build + tests.
5. Re-run the action. If clean, disable dev mode and commit.
```

The whole loop is usually 30 minutes. The longest step is usually probing the DOM.

---

## Step 1 — diagnose: what broke?

Run the failing action through Claude Code (`web_run`) or the CLI smoke and capture the exact error. Match against this table:

| Symptom | Likely cause | First-look file |
|---|---|---|
| `list_designs` returns `count: 0` | Sidebar anchor/heading selector broke | `claude-design.ts → readSidebar` |
| `list_designs` returns names like `"obsidianYour design · Today"` (concatenated) | The text-split marker (`"Your design"`) changed or moved | `claude-design.ts → readSidebar`, the `MARKER` const |
| `No canvas named "X" found in the sidebar` (for a name you can see) | `findDesignByName` matchers (exact / case-insensitive / prefix) all missed; sidebar likely returns a transformed form | `claude-design.ts → findDesignByName` + `readSidebar` |
| `Could not find a "Duplicate" affordance...` or `getByRole(...) timeout` | Share-menu structure changed; menu items renamed; or Share button label changed | `claude-design.ts → openShareMenu` + `shareMenuItem` |
| `getByPlaceholder('Describe what you want to create...').waitFor` times out | Chat input placeholder changed | `claude-design.ts → sendCanvasChatInstruction` |
| `tell_canvas_chat` runs but instruction never sends | Cmd+Enter shortcut changed, or the Send button locator missed | `claude-design.ts → sendCanvasChatInstruction` |
| Export bytes are unusually small (e.g. 50 KB instead of ~3 MB) | The page was navigated/degraded between actions; or CDP MHTML is now incomplete | `claude-design.ts → export_design` + `lib/snapshot.ts` |
| `summarize_design` returns the wrong region's text | `[role="main"]` or canvas root selector changed | `claude-design.ts → extractCanvasText` |
| Origin policy refusal | The page got navigated to a non-allowlisted host (rare; usually OAuth redirect or bug in adapter navigation) | `claude-design.ts → ensureOnDesignHome` + the page state |

If the symptom is **none of the above**, the next step is "probe the DOM via `web_eval`" (Step 2). The error message will tell you which locator missed; that's the one to investigate.

---

## Step 2 — enable dev mode and probe

`web_eval` (arbitrary JS in the page) is gated behind `AI_WEB_BRIDGE_DEV=1`. Turn it on **temporarily**:

### Toggle on

Edit `~/.claude.json`, find the `ai-web-bridge` entry under `mcpServers`, add an `env` field:

```jsonc
{
  "mcpServers": {
    "ai-web-bridge": {
      "command": "node",
      "args": [".../dist/server/index.js"],
      "env": { "AI_WEB_BRIDGE_DEV": "1" }
    }
  }
}
```

Or via Node one-liner (idempotent):

```bash
node -e '
const fs = require("fs");
const path = require("os").homedir() + "/.claude.json";
const config = JSON.parse(fs.readFileSync(path, "utf8"));
const entry = config.mcpServers["ai-web-bridge"];
entry.env = { ...(entry.env || {}), AI_WEB_BRIDGE_DEV: "1" };
fs.writeFileSync(path, JSON.stringify(config, null, 2));
console.log("dev mode ON");
'
```

**Reconnect ai-web-bridge in `/mcp`** in Claude Code. You should see `web_eval` appear as a third tool.

### Toggle off (do this when you're done!)

Same script, `delete entry.env;` instead of setting it. Reconnect again.

---

## Step 3 — useful probe snippets

These are JS-in-page snippets you can pass to `web_eval` to find new locators. Each is self-contained.

### A. List every visible button on the page (with text + title + aria-label)

Use this when you need to find what label a button currently has, or whether it's been renamed.

```js
return Array.from(document.querySelectorAll('button'))
  .filter(button => !!(button.offsetParent || button.getClientRects().length))
  .map(button => ({
    text: (button.textContent || '').trim().slice(0, 40),
    title: button.getAttribute('title'),
    ariaLabel: button.getAttribute('aria-label'),
    classSnippet: (button.className || '').toString().slice(0, 40)
  }))
  .filter(b => b.text || b.title || b.ariaLabel);
```

### B. Inspect a specific button's DOM structure

When you know the text but `getByRole({ name })` doesn't match, this tells you whether icons or pseudo-elements are polluting the accessible name.

```js
const target = Array.from(document.querySelectorAll('button')).find(b => (b.textContent||'').trim() === 'TARGET TEXT');
if (!target) return { error: 'not found' };
return {
  outerHtml: target.outerHTML.slice(0, 400),
  textContent: target.textContent,
  ariaLabel: target.getAttribute('aria-label'),
  ariaLabelledBy: target.getAttribute('aria-labelledby'),
  role: target.getAttribute('role'),
  hasIcon: !!target.querySelector('svg, i, [class*="icon" i]'),
  childCount: target.childNodes.length
};
```

### C. Find inputs by placeholder

Useful for chat / search / comment inputs.

```js
return Array.from(document.querySelectorAll('textarea, input[type="text"], [contenteditable="true"]'))
  .filter(element => !!(element.offsetParent || element.getClientRects().length))
  .map(element => ({
    tag: element.tagName.toLowerCase(),
    placeholder: element.getAttribute('placeholder'),
    ariaLabel: element.getAttribute('aria-label'),
    role: element.getAttribute('role'),
    classSnippet: (element.className || '').toString().slice(0, 40),
    rect: { x: element.getBoundingClientRect().x | 0, y: element.getBoundingClientRect().y | 0 }
  }));
```

### D. Open a menu, list its items

Use when the affordance you need lives behind a click (Share menu, overflow `…`, profile dropdown, etc.).

```js
// Replace 'Share' with the trigger you need to click
const trigger = Array.from(document.querySelectorAll('button')).find(b => (b.textContent||'').trim() === 'Share');
if (!trigger) return { error: 'no trigger' };
trigger.click();
await new Promise(r => setTimeout(r, 600));
return Array.from(document.querySelectorAll('button'))
  .filter(b => !!(b.offsetParent || b.getClientRects().length))
  .map(b => (b.textContent || '').trim())
  .filter(Boolean);
```

### E. Find the sidebar / list container around a known anchor

When `list_designs` returns weird names — find the parent container and inspect its structure.

```js
const sampleAnchor = document.querySelector('a[href*="/design/p/"]');
if (!sampleAnchor) return { error: 'no design anchors on page' };
let parent = sampleAnchor;
for (let i = 0; i < 6; i++) parent = parent.parentElement;
return {
  parentTag: parent?.tagName,
  parentClass: (parent?.className || '').toString().slice(0, 60),
  anchorOuterHtml: sampleAnchor.outerHTML.slice(0, 400)
};
```

### F. Check `document.title`

Several flows depend on `document.title` updating to the canvas name. Verify what it currently says.

```js
return { title: document.title, url: location.href };
```

### G. Force-navigate (when `target_url` doesn't fire)

`web_eval`'s `target_url` parameter is best-effort — if you're on a sub-route of the same host, the dispatcher might decide you don't need to navigate. If you really need to land on `/design`, do it inside the script:

```js
location.href = 'https://claude.ai/design';
return 'navigating';
```

Then issue a separate `web_eval` to probe (the page reload destroys the previous eval context).

---

## Step 4 — common breakage patterns we've seen

These are real fixes from this repo's history. Match against them before reinventing.

### Pattern 1: "Title and metadata are mashed in `textContent`"

**Symptom:** `list_designs` returns `"obsidianYour design · Today"` instead of `"obsidian"`.

**Root cause:** the sidebar anchor concatenates the canvas title and a metadata span. `innerText` on the anchor returns both.

**Fix pattern:** prefer a child heading element if present, then split on a known marker substring (`"Your design"`), then fall back to full text.

**Where:** `readSidebar` in `claude-design.ts`. The `MARKER` constant.

---

### Pattern 2: "Sidebar is empty after navigating to a specific canvas"

**Symptom:** `list_designs` works on first call, but after `open_design` lands on `/design/p/<id>`, the next sidebar read returns `[]`.

**Root cause:** Claude Design's per-canvas route doesn't always render the full sidebar list.

**Fix pattern:** any helper that needs to read the sidebar must first navigate to `/design` home. See `ensureOnDesignHome`.

---

### Pattern 3: "`getByRole('button', { name: 'X' })` fails even though a button with text X exists"

**Symptom:** Playwright timeout on a locator that obviously matches by `textContent`.

**Root cause:** the button has a child `<i>` or `<svg>` icon. Playwright's accessible-name computation can include CSS-generated content from the icon, breaking exact-match.

**Fix pattern:** use a CSS+text locator instead. The `shareMenuItem` helper in `claude-design.ts` is the canonical example:

```ts
function shareMenuItem(page: Page, label: string) {
  return page.locator('button', { hasText: new RegExp(`^\\s*${label.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}\\s*$`) });
}
```

---

### Pattern 4: "Chat input filled but instruction never sends"

**Symptom:** `tell_canvas_chat` runs end-to-end but the message stays in the input field. After-screenshot shows the text un-submitted.

**Root cause:** Enter alone inserts a newline in this textarea. The send shortcut is **Cmd+Enter** (macOS) or **Ctrl+Enter** (Win/Linux). The Send button is also there, but its locator is fragile.

**Fix pattern:** focus the input, press platform-modifier+Enter, verify the input cleared, fall back to clicking a Send button if not.

**Where:** `sendCanvasChatInstruction` in `claude-design.ts`.

---

### Pattern 5: "Download triggered but `waitForEvent('download')` times out"

**Symptom:** `export_design` falls through to MHTML fallback because the native HTML export's download never surfaced through Playwright.

**Root cause:** when Playwright connects via `chromium.connectOverCDP` (which we always do — we attach to the user's running browser, never spawn our own), download events from the underlying Chrome don't propagate reliably to the Playwright event system.

**Status:** **known limitation, MHTML is the working fallback.** Not worth re-fighting unless Playwright fixes the underlying CDP download wiring. Documented in the adapter source above `export_design`.

---

### Pattern 6: "Sidebar lookup case differs from what I typed"

**Symptom:** `findDesignByName('Obsidian')` returns null but you can see "obsidian" in the sidebar.

**Root cause:** the matcher tries exact → case-insensitive → prefix in that order. If exact fails, case-insensitive should hit. If both fail, prefix tries. If all three miss, the name in the sidebar has been transformed somehow (e.g. trailing whitespace, unicode normalization, the "(Remix)" suffix on duplicates).

**Fix pattern:** add a `console.log` (or return) inside the action temporarily to dump the entries you got back from `readSidebar`. Compare to your input. Update the matcher chain to handle the transform.

---

## Step 5 — fix and verify

After locating the broken thing in `src/adapters/claude-design.ts`:

1. Edit the file. Use Playwright's resilient locators in this order of preference:
   - `getByPlaceholder('exact text')` for inputs (very stable — placeholder text rarely changes)
   - `page.locator('button', { hasText: /^\s*Label\s*$/ })` for buttons with icons (the `shareMenuItem` pattern)
   - `getByRole('button', { name: 'X', exact: true })` only when there are no icon children
   - CSS class selectors **only as a last resort** — class names are hashed and rotate
   - Mark any new speculative selector with `// TODO(verify):` so future-you knows where to look first

2. Build and test:
   ```bash
   npm run typecheck && npm run build && npm test
   ```

3. Reconnect `ai-web-bridge` in `/mcp` to pick up the rebuilt adapter (cold-reload only).

4. Re-run the failing action via `web_run`. Confirm it succeeds.

5. **Disable dev mode** (Step 2 reverse). Reconnect once more. Verify `web_eval` is gone.

6. Commit on a feature branch, push, open a PR.

---

## Step 6 — things NOT to do

- **Don't** add CSS class selectors like `.sc-fHCFEa` to the adapter. They're build-hash artifacts that change on every Claude.ai deploy. They will break within a week.
- **Don't** leave dev mode on. `web_eval` runs arbitrary JS in your authenticated browser session — Codex's specific concern when we shipped this. It exists for the loop in Step 2; turn it off when you're done.
- **Don't** widen `allowed_origins` to make a refusal go away. If the page bounced to a host outside the allowlist, that's the bug to fix (probably the action navigated wrong); don't paper over it.
- **Don't** suppress errors with `.catch(() => undefined)` indiscriminately. We do use that pattern in a few places (after-screenshots, `bringToFront`, `networkidle` waits) where the failure is genuinely informational. New uses need a comment explaining why the error is OK to swallow.
- **Don't** change `allowed_origins`, `default_url`, or the action signature without bumping the adapter contract — these are the parts callers depend on. Add new actions instead of repurposing old ones.

---

## Diagnostic shortcuts (paste these as-is)

A few prompt fragments that have worked well when handing the diagnosis to a fresh agent:

> "ai-web-bridge's `claude-design` adapter is broken on `<action>`. The error is `<paste exact error>`. Read `docs/ADAPTER_TROUBLESHOOTING.md`, enable dev mode, use `web_eval` to find the new locator, fix it in `src/adapters/claude-design.ts`, then disable dev mode. Don't add CSS class selectors."

> "claude.ai/design changed their UI. Walk through the troubleshooting playbook at `docs/ADAPTER_TROUBLESHOOTING.md` step by step and report what you find at each stage before making any code changes."

---

## When the playbook isn't enough

If the breakage isn't covered by any of the patterns above and probing doesn't yield an obvious new locator, the page may have changed structurally (e.g. moved to a new component model, gated content behind a new flow, etc.). Options:

1. **Open an issue** describing the symptom + what you tried. The next refresh attempt benefits from context.
2. **Bisect against site history**: open the page in a non-automation Chrome session. Does the action *manually* still work the same way? If the user-facing flow itself changed, the adapter needs a redesign, not a selector tweak.
3. **Disable the broken action** rather than ship a half-working version. Comment it out in the `actions` object on the adapter; callers will see it disappear from `web_list_adapters`. Better than mystery failures.
