#!/usr/bin/env bash
# Idempotent installer for ai-web-bridge.
# Safe to re-run; refuses to clobber existing config entries.

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

echo "[ai-web-bridge] installing dependencies..."
npm install

echo "[ai-web-bridge] installing Playwright Chromium..."
npx playwright install chromium

echo "[ai-web-bridge] building..."
npm run build

server_entry="$repo_root/dist/server/index.js"

# Register with Claude Code via the official `claude mcp add` command.
# This writes to ~/.claude.json under mcpServers — that is the file Claude
# Code actually reads. Avoid editing ~/.claude/settings.json directly; that
# file holds permissions/hooks/env, NOT the MCP server registry.
if command -v claude >/dev/null 2>&1; then
  if claude mcp list 2>/dev/null | grep -q '^ai-web-bridge'; then
    echo "[ai-web-bridge] already registered with Claude Code (skipping)"
  else
    echo "[ai-web-bridge] registering with Claude Code (user scope)..."
    claude mcp add --scope user ai-web-bridge node "$server_entry"
  fi
else
  echo "[ai-web-bridge] WARNING: 'claude' CLI not on PATH. Register manually:"
  echo "  claude mcp add --scope user ai-web-bridge node $server_entry"
fi

# Symlink CLI for convenience
local_bin="$HOME/.local/bin"
mkdir -p "$local_bin"
target_link="$local_bin/ai-web-bridge"
cli_dist="$repo_root/dist/cli/index.js"

if [ -L "$target_link" ] || [ -f "$target_link" ]; then
  if [ "$(readlink "$target_link" 2>/dev/null)" != "$cli_dist" ]; then
    echo "[ai-web-bridge] $target_link already exists and points elsewhere; leaving it alone."
    echo "[ai-web-bridge] To use the CLI, run: node $cli_dist"
  else
    echo "[ai-web-bridge] CLI symlink already in place at $target_link"
  fi
else
  ln -s "$cli_dist" "$target_link"
  chmod +x "$cli_dist"
  echo "[ai-web-bridge] symlinked CLI to $target_link"
  echo "[ai-web-bridge] (ensure $local_bin is on your PATH)"
fi

echo
echo "[ai-web-bridge] install complete."
echo "[ai-web-bridge] next steps:"
echo "  1. ai-web-bridge start"
echo "  2. ai-web-bridge login claude-design   # sign in to claude.ai in the automation profile"
echo "  3. restart Claude Code; /mcp should show ai-web-bridge with web_list_adapters and web_run"
