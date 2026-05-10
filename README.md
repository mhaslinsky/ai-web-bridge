# ai-web-bridge

A small MCP server that lets Claude Code (and other MCP-aware AI CLIs) operate auth-walled web tools by attaching to a dedicated Chromium profile via Playwright CDP.

v1 ships a single adapter for [claude.ai/design](https://claude.ai/design): list / open / screenshot / export / summarize / drive-the-canvas-chat. Adding a new web tool is one TypeScript file under `src/adapters/`.

## Why

Some web tools have no MCP, no CLI, and no public API — Claude Design among them. Driving them from Claude Code today means alt-tabbing into a browser and clicking. ai-web-bridge replaces that loop with a 2-tool MCP surface (`web_list_adapters`, `web_run`) backed by per-site adapter modules.

## Architecture

```
Claude Code  /  any MCP client
      ↓ stdio
ai-web-bridge MCP server
      ↓ Playwright CDP
Automation Chromium (user-data-dir: ~/.ai-web-bridge/profile)
      ↓ logged-in HTTPS
claude.ai/design  (and future adapters)
```

- **Dedicated profile.** Chromium runs with `--user-data-dir=~/.ai-web-bridge/profile`, separate from your daily-driver browser. You sign in once per site; the profile keeps the cookies. Blast radius is bounded to what you've explicitly logged into.
- **2-tool dispatcher surface.** Adding 10 sites with 6 actions each adds **zero tools** to the MCP global surface — they're discovered via `web_list_adapters` and dispatched via `web_run`.
- **Server-enforced origin policy.** Each adapter declares allowed hosts; the dispatcher refuses to operate when the page has navigated elsewhere.
- **Per-profile action queue.** Concurrent calls are serialized to prevent races on a stateful browser.
- **Path constraints.** Actions that emit files are restricted to `os.tmpdir()` and `~/Desktop/AIDB/` by default; path traversal and silent overwrites are rejected.

## Install

Requires Node 20+.

```bash
git clone <this repo> ~/Developer/ai-web-bridge
cd ~/Developer/ai-web-bridge
./scripts/install.sh
```

The installer runs `npm install`, downloads Playwright's Chromium, builds the project, registers an `ai-web-bridge` entry in `~/.claude/settings.json` (or prints the snippet to add manually if the file already exists), and symlinks `ai-web-bridge` to `~/.local/bin`.

## First-time setup

```bash
ai-web-bridge start                 # launch the dedicated Chromium
ai-web-bridge login claude-design   # opens claude.ai in the automation profile; sign in
ai-web-bridge status                # confirm Chromium is up and tabs are visible
```

Restart Claude Code. `/mcp` should show `ai-web-bridge` connected with two tools.

## Usage from Claude Code

```
> use web_list_adapters
> using web_run, call claude-design.list_designs
> using web_run, call claude-design.export_design with name="my canvas" and dest_dir="~/Desktop/AIDB/_global/personal/my-project/design"
```

## Adding a new adapter

Drop a TypeScript file at `src/adapters/<slug>.ts` exporting `adapter: AdapterDef`:

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
  run: async (ctx) => {
    return await ctx.page.evaluate(() => /* extract from DOM */);
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

Then `npm run build && ai-web-bridge stop && ai-web-bridge start` (cold reload) and add a login session: `ai-web-bridge login my-site`.

### Action metadata fields

Every action declares its risk profile so callers can see what they're invoking:

| Field | Meaning |
|---|---|
| `risk_level` | `read` / `navigation` / `mutation` / `destructive` |
| `mutates_state` | True if the action changes remote state |
| `writes_files` | True if it emits files to disk (path constraints apply) |
| `requires_confirmation` | True if callers should pause and surface to the user before invoking |

## Development mode (`web_eval`)

`web_eval` (arbitrary JS in the page) is **not registered by default** because it bypasses every adapter-level safety boundary. To enable it for prototyping a new adapter:

```bash
AI_WEB_BRIDGE_DEV=1 ai-web-bridge serve
```

Or, in your MCP client config, set `env: { "AI_WEB_BRIDGE_DEV": "1" }` for the `ai-web-bridge` server. Disable in production use.

## Limitations

- **Selectors will break when claude.ai changes their DOM.** Mitigated by Playwright's role/text locators, not eliminated. When an action breaks, fix the locator in `src/adapters/claude-design.ts` and rebuild.
- **`tell_canvas_chat` operates on a fresh duplicate** of the named canvas — the original is never modified. To revert, manually delete the duplicate. The verb sanity layer is *not* a security mitigation; the duplication is.
- **Single-file export fidelity is not guaranteed** for every canvas. Manually verify against ≥3 real canvases before treating the output as canonical.
- **Codex compatibility is untested.** The MCP surface is generic, but v1 is verified with Claude Code only.

## License

MIT
