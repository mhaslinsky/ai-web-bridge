import { z } from 'zod';
import { dispatch, evalInPage, DispatcherError } from './dispatcher.js';
import type { LoadedAdapters } from './adapter-loader.js';

/** Project a Zod schema into a coarse `{ field: type-string }` shape for web_list_adapters output. */
function paramsToShape(schema: z.ZodTypeAny): Record<string, unknown> {
  if (schema instanceof z.ZodObject) {
    const shape: Record<string, unknown> = {};
    const innerShape = (schema as z.ZodObject<z.ZodRawShape>).shape;
    for (const [fieldName, fieldSchema] of Object.entries(innerShape)) {
      shape[fieldName] = describeSchema(fieldSchema as z.ZodTypeAny);
    }
    return shape;
  }
  return { _type: describeSchema(schema) };
}

/** One-word type label for a Zod schema (string / number / object / etc.) — used by paramsToShape. */
function describeSchema(schema: z.ZodTypeAny): string {
  if (schema instanceof z.ZodString) return 'string';
  if (schema instanceof z.ZodNumber) return 'number';
  if (schema instanceof z.ZodBoolean) return 'boolean';
  if (schema instanceof z.ZodOptional) return `${describeSchema((schema as z.ZodOptional<z.ZodTypeAny>).unwrap())}?`;
  if (schema instanceof z.ZodDefault) return `${describeSchema((schema as z.ZodDefault<z.ZodTypeAny>)._def.innerType)}? (default)`;
  if (schema instanceof z.ZodObject) return 'object';
  if (schema instanceof z.ZodArray) return 'array';
  return 'unknown';
}

/** Build the `web_list_adapters` MCP tool: enumerates loaded adapters and their action metadata. */
export function buildListAdaptersTool(loaded: LoadedAdapters) {
  return {
    name: 'web_list_adapters',
    description:
      'List available web-tool adapters and their actions, including per-action risk metadata. Call once at the start of a relevant turn to discover what is available.',
    inputSchema: z.object({}).strict(),
    handler: async () => {
      const adapters = loaded.list.map((adapter) => ({
        slug: adapter.slug,
        display_name: adapter.display_name,
        allowed_origins: adapter.allowed_origins,
        default_url: adapter.default_url,
        actions: Object.entries(adapter.actions).map(([actionName, action]) => ({
          name: actionName,
          description: action.description,
          params: paramsToShape(action.params),
          risk_level: action.risk_level,
          mutates_state: action.mutates_state,
          writes_files: action.writes_files,
          requires_confirmation: action.requires_confirmation
        }))
      }));
      return { adapters };
    }
  };
}

/** Build the `web_run` MCP tool: executes adapter.action(args) through the dispatcher. */
export function buildRunTool(loaded: LoadedAdapters) {
  return {
    name: 'web_run',
    description:
      'Execute a named action from a named adapter against the automation browser profile. Args are validated per-action; results include action metadata.',
    inputSchema: z
      .object({
        adapter: z.string().describe('Adapter slug, e.g. "claude-design"'),
        action: z.string().describe('Action name, e.g. "list_designs"'),
        args: z.record(z.unknown()).optional().describe('Action-specific arguments object')
      })
      .strict(),
    handler: async (input: { adapter: string; action: string; args?: Record<string, unknown> }) => {
      const adapter = loaded.byslug.get(input.adapter);
      if (!adapter) {
        throw new DispatcherError(
          'unknown_adapter',
          `No adapter named "${input.adapter}". Available: ${[...loaded.byslug.keys()].join(', ')}`
        );
      }
      return dispatch(adapter, input.action, input.args ?? {});
    }
  };
}

/** Build the `web_eval` MCP tool — dev-only, registered only when AI_WEB_BRIDGE_DEV=1. */
export function buildEvalTool() {
  return {
    name: 'web_eval',
    description:
      'DEV-ONLY: evaluate arbitrary JavaScript in the automation browser. Bypasses adapter origin policy. Only registered when AI_WEB_BRIDGE_DEV=1.',
    inputSchema: z
      .object({
        js: z.string().describe('JavaScript source to evaluate inside the page (wrapped in an async IIFE)'),
        target_url: z.string().url().optional().describe('Optional URL to navigate to before evaluating')
      })
      .strict(),
    handler: async (input: { js: string; target_url?: string }) => {
      const value = await evalInPage(input.js, input.target_url);
      return { value };
    }
  };
}
