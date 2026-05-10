import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { loadAdapters } from './adapter-loader.js';
import { buildEvalTool, buildListAdaptersTool, buildRunTool } from './tools.js';
import { DispatcherError } from './dispatcher.js';

/** True when AI_WEB_BRIDGE_DEV is set to "1" or "true" — gates the web_eval tool. */
function isDevMode(): boolean {
  const flag = process.env.AI_WEB_BRIDGE_DEV;
  return flag === '1' || flag === 'true';
}

/** Wrap a tool handler's payload as an MCP `content: [{ type: 'text', ... }]` result. */
function asMcpResult(payload: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }]
  };
}

/** Wrap any error as an MCP `isError: true` result so the calling LLM sees a structured failure. */
function asMcpError(err: unknown) {
  const message =
    err instanceof DispatcherError
      ? `[${err.code}] ${err.message}`
      : err instanceof Error
      ? err.message
      : String(err);
  return {
    content: [{ type: 'text' as const, text: message }],
    isError: true as const
  };
}

/** Boot the MCP server over stdio: load adapters, register tools, install signal handlers. */
async function main() {
  const loaded = await loadAdapters();
  const server = new McpServer({ name: 'ai-web-bridge', version: '0.1.0' });

  const listAdaptersTool = buildListAdaptersTool(loaded);
  const runTool = buildRunTool(loaded);

  server.registerTool(
    listAdaptersTool.name,
    {
      description: listAdaptersTool.description,
      inputSchema: {}
    },
    async () => {
      try {
        return asMcpResult(await listAdaptersTool.handler());
      } catch (err) {
        return asMcpError(err);
      }
    }
  );

  server.registerTool(
    runTool.name,
    {
      description: runTool.description,
      inputSchema: {
        adapter: z.string().describe('Adapter slug, e.g. "claude-design"'),
        action: z.string().describe('Action name, e.g. "list_designs"'),
        args: z.record(z.unknown()).optional().describe('Action-specific arguments object')
      }
    },
    async (input) => {
      try {
        return asMcpResult(await runTool.handler(input));
      } catch (err) {
        return asMcpError(err);
      }
    }
  );

  if (isDevMode()) {
    const evalTool = buildEvalTool();
    server.registerTool(
      evalTool.name,
      {
        description: evalTool.description,
        inputSchema: {
          js: z.string(),
          target_url: z.string().url().optional()
        }
      },
      async (input) => {
        try {
          return asMcpResult(await evalTool.handler(input));
        } catch (err) {
          return asMcpError(err);
        }
      }
    );
    process.stderr.write('[ai-web-bridge] DEV MODE: web_eval is registered\n');
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);

  const shutdown = async () => {
    try {
      await server.close();
    } finally {
      process.exit(0);
    }
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  process.stderr.write(`[ai-web-bridge] fatal: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
  process.exit(1);
});
