import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { loadAdapters } from './adapter-loader.js';
import { buildEvalTool, buildListAdaptersTool, buildRunTool } from './tools.js';
import { DispatcherError } from './dispatcher.js';

function isDevMode(): boolean {
  const v = process.env.AI_WEB_BRIDGE_DEV;
  return v === '1' || v === 'true';
}

function asMcpResult(payload: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }]
  };
}

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

async function main() {
  const loaded = await loadAdapters();
  const server = new McpServer({ name: 'ai-web-bridge', version: '0.1.0' });

  const list = buildListAdaptersTool(loaded);
  const run = buildRunTool(loaded);

  server.registerTool(
    list.name,
    {
      description: list.description,
      inputSchema: {}
    },
    async () => {
      try {
        return asMcpResult(await list.handler());
      } catch (err) {
        return asMcpError(err);
      }
    }
  );

  server.registerTool(
    run.name,
    {
      description: run.description,
      inputSchema: {
        adapter: z.string().describe('Adapter slug, e.g. "claude-design"'),
        action: z.string().describe('Action name, e.g. "list_designs"'),
        args: z.record(z.unknown()).optional().describe('Action-specific arguments object')
      }
    },
    async (input) => {
      try {
        return asMcpResult(await run.handler(input));
      } catch (err) {
        return asMcpError(err);
      }
    }
  );

  if (isDevMode()) {
    const ev = buildEvalTool();
    server.registerTool(
      ev.name,
      {
        description: ev.description,
        inputSchema: {
          js: z.string(),
          target_url: z.string().url().optional()
        }
      },
      async (input) => {
        try {
          return asMcpResult(await ev.handler(input));
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
