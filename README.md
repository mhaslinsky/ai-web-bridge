# ai-web-bridge

[![CI](https://github.com/mhaslinsky/ai-web-bridge/actions/workflows/ci.yml/badge.svg)](https://github.com/mhaslinsky/ai-web-bridge/actions/workflows/ci.yml)

An MCP server that lets Claude Code (and other MCP-aware AI clients) drive auth-walled web tools through a dedicated Chromium profile via Playwright CDP. **v1 ships an adapter for [claude.ai/design](https://claude.ai/design)**; adding a new web tool is one TypeScript file under `src/adapters/`.

> **Status: v1, personal-tool maturity.** Verified end-to-end against the live claude.ai/design UI as of this commit. Selectors are inherently DOM-fragile — when Anthropic ships UI changes, expect to tune locators in `src/adapters/claude-design.ts`. PRs welcome if you fix yours.

## Why

Some web tools have no MCP, no CLI, and no public API — Claude Design among them. Driving them from Claude Code today means alt-tabbing into a browser and clicking. ai-web-bridge replaces that loop with a 2-tool MCP surface (`web_list_adapters`, `web_run`) backed by per-site adapter modules.

## Architecture

```
Claude Code  /  any MCP-aware client
      ↓ stdio
ai-web-bridge MCP server
      ↓ Playwright CDP (chromium.connectOverCDP)
Automation Chromium  (--user-data-dir=~/.ai-web-bridge/profile-<active>)
      ↓ logged-in HTTPS, persistent session
claude.ai/design   (and future adapters)
```

- **Named profiles.** You can register multiple profiles (e.g. `personal` and `enterprise`) and switch between them with `ai-web-bridge profiles use <name>`. Each profile is its own Chromium user-data-dir, so cookies for the same site can coexist for different accounts. Only one profile is active at a time; subsequent `login` / `start` / `web_run` calls target the active one.
- **Dedicated profile.** Chromium runs separate from your daily-driver browser. You sign in once per site per profile; the profile keeps the cookies. Blast radius is bounded to what you've explicitly logged into.
- **2-tool dispatcher surface.** Adding 10 sites with 6 actions each adds **zero tools** to the MCP global surface — they're discovered via `web_list_adapters` and dispatched via `web_run`. Action metadata (risk level, mutates state, writes files, requires confirmation) is returned on discovery so callers know what they're invoking.
- **Server-enforced origin policy.** Each adapter declares allowed hosts; the dispatcher refuses to operate when the page has navigated elsewhere.
- **Per-profile action queue.** Concurrent calls are serialized to prevent races on a stateful browser.
- **Path constraints.** Actions that emit files write only to `os.tmpdir()` or `~/Desktop/AIDB/` by default; path traversal and silent overwrites are rejected.
- **`tell_canvas_chat` safety contract.** AI-instruction edits modify the named canvas **in place** — there is no automatic duplicate. The action is flagged `requires_confirmation: true`, so callers must confirm before it runs, and a coarse verb sanity layer rejects obviously-destructive instructions pre-flight. If you need to preserve the original, duplicate it yourself first.

## Install

Requires Node 20+ and the `claude` CLI on your PATH (so the installer can register the MCP server via `claude mcp add`).

```bash
git clone https://github.com/mhaslinsky/ai-web-bridge.git
cd ai-web-bridge
./scripts/install.sh
```

The installer runs `npm install`, downloads Playwright's Chromium, builds the project, registers an `ai-web-bridge` entry at the user scope via `claude mcp add` (writes to `~/.claude.json`), and symlinks the `ai-web-bridge` CLI to `~/.local/bin`.

If you don't have `claude` on PATH the script will print the exact command to run manually.

## First-time setup

```bash
ai-web-bridge start                 # launch Chromium for the default (personal) profile
ai-web-bridge login claude-design   # sign in to the active profile's Chromium
ai-web-bridge status                # confirm Chromium is up and tabs are visible
```

Restart Claude Code (or reconnect via `/mcp`). `/mcp` should show `ai-web-bridge` connected with two tools.

## Profiles (multi-account)

Each profile is a separate Chromium user-data-dir under `~/.ai-web-bridge/profile-<name>/`. The default profile is `personal`. To add an additional account (e.g. an enterprise Claude account):

```bash
ai-web-bridge profiles add enterprise          # create the empty profile
ai-web-bridge profiles use enterprise          # switch active profile
ai-web-bridge login claude-design              # sign in as the enterprise account
ai-web-bridge profiles use personal            # switch back to personal
```

Other commands:

```bash
ai-web-bridge profiles list                    # list profiles; * marks the active one
ai-web-bridge profiles remove <name>           # delete a profile (refuses active or last-remaining)
```

Migration note: if you installed before named-profile support, the legacy `~/.ai-web-bridge/profile/` directory is removed on first run and replaced with empty `personal` and `enterprise` profiles. **You will need to re-login.**

## Usage from Claude Code

```
> use web_list_adapters
> using web_run, call claude-design.list_designs
> using web_run, call claude-design.export_design with name="my canvas" and dest_dir="/tmp/exports"
> using web_run, call claude-design.tell_canvas_chat with name="my canvas" and instruction="add a small label"
```

## claude-design actions

| Action | Risk | What it does |
|---|---|---|
| `list_designs` | read | Sidebar enumeration: `[{name, url, last_modified}, ...]` |
| `open_design` | navigation | Navigate to a specific canvas |
| `screenshot` | read | PNG capture of current canvas |
| `export_design` | read | MHTML snapshot via CDP `Page.captureSnapshot`. Output: `<dest>/<name>.mhtml`. Opens in Chromium-based browsers. |
| `summarize_design` | read | Extract canvas text content, wrap in `<untrusted-content>` markers |
| `tell_canvas_chat` | mutation | Send an instruction to the canvas chat via Cmd+Enter. Modifies the named canvas **in place**; `requires_confirmation`. |

`tell_canvas_chat` returns `{canvas, generation_status, before_screenshot, after_screenshot}` — surface both screenshots to the user before chaining further actions.

## Adding a new adapter

For a step-by-step walkthrough — site discovery via dev-mode `web_eval`, picking resilient locators, safe-mutation patterns (confirm-before-mutate, duplicate-before-mutate), contract tests, and verification — read [`docs/NEW_ADAPTER_GUIDE.md`](docs/NEW_ADAPTER_GUIDE.md).

The minimum-viable adapter is one TypeScript file at `src/adapters/<slug>.ts` exporting `adapter: AdapterDef`:

```ts
import { z } from 'zod';
import type { AdapterDef, ActionDef } from '../server/adapter-types.js';

const list_things: ActionDef<{}> = {
  description: 'List things on the site.',
  params: z.object({}).strict(),
  risk_level: 'read',
  mutates_state: false,
  writes_files: false,
  requires_confirmation: false,
  run: async ({ page }) => {
    return await page.evaluate(() => /* extract from DOM */);
  }
};

export const adapter: AdapterDef = {
  slug: 'my-site',
  display_name: 'My Site',
  allowed_origins: ['my-site.com'],
  default_url: 'https://my-site.com',
  actions: { list_things }
};
```

Then `npm run build && ai-web-bridge stop && ai-web-bridge start` (cold reload) and create a session: `ai-web-bridge login my-site`. See the [new-adapter guide](docs/NEW_ADAPTER_GUIDE.md) for the full walkthrough.

### Action metadata fields

| Field | Meaning |
|---|---|
| `risk_level` | `read` / `navigation` / `mutation` / `destructive` |
| `mutates_state` | True if the action changes remote state |
| `writes_files` | True if it emits files to disk (path constraints apply) |
| `requires_confirmation` | True if callers should pause and surface to the user before invoking |

## Development mode (`web_eval`)

`web_eval` (arbitrary JS in the page) is **not registered by default** because it bypasses every adapter-level safety boundary. To enable it for prototyping a new adapter, set `AI_WEB_BRIDGE_DEV=1` in the MCP server's environment:

```jsonc
// ~/.claude.json (excerpt)
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

Disable when done. Reconnect ai-web-bridge in `/mcp` after toggling.

## When something breaks

Selectors against a site you don't own are inherently fragile. When an action stops working — see [`docs/ADAPTER_TROUBLESHOOTING.md`](docs/ADAPTER_TROUBLESHOOTING.md). It's a step-by-step playbook (diagnose → probe DOM via dev-mode `web_eval` → fix → verify) with reusable JS snippets and a catalog of breakage patterns we've already seen and resolved. Hand it to an AI agent or work through it yourself.

## Known limitations

- **Selectors break when claude.ai changes their DOM.** Mitigated by Playwright's role/text locators (and a discoverable Share menu, which has been stable so far) but not eliminated. When an action breaks, follow `docs/ADAPTER_TROUBLESHOOTING.md`.
- **Export is MHTML, not standalone HTML.** Claude Design has a built-in "Export as standalone HTML" item in the Share menu, but Playwright via `connectOverCDP` does not reliably surface those downloads. CDP `Page.captureSnapshot` produces a faithful MHTML snapshot that opens in any Chromium-based browser. Fidelity verified offline. Native HTML support remains an open question for a future revision.
- **`tell_canvas_chat` modifies the canvas in place.** There is no automatic duplicate and no built-in undo — the named canvas is edited directly. Duplicate it yourself first if you need to keep the original.
- **Cold reload only.** Adding or editing an adapter requires `ai-web-bridge stop && start` and an MCP client reconnect. No hot-reload.
- **Codex compatibility is untested.** The MCP surface is generic and should work with any stdio-capable MCP client, but v1 is verified with Claude Code only.

## License

MIT — see `LICENSE`.
