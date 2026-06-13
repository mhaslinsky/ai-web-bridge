# Changelog

## 0.1.0 — initial v1

- 2-tool MCP dispatcher: `web_list_adapters`, `web_run`. `web_eval` is a dev-mode-only third tool gated by `AI_WEB_BRIDGE_DEV=1`.
- `claude-design` adapter with six actions: `list_designs`, `open_design`, `screenshot`, `export_design`, `summarize_design`, `tell_canvas_chat`.
- `tell_canvas_chat` sends an instruction to the canvas chat and modifies the named canvas in place; it is gated by `requires_confirmation`. The verb sanity layer is a coarse pre-flight filter, not a security mitigation.
- Server-enforced origin policy per adapter.
- Per-profile action queue serializes concurrent `web_run` calls.
- Dest-path constraints: writes only under `os.tmpdir()` or `~/Desktop/AIDB/`; refuses overwrites without explicit `force: true`.
- Companion CLI: `ai-web-bridge start | stop | status | login <site> | serve`.
- Dedicated Chromium profile at `~/.ai-web-bridge/profile/` with persistent sessions.
