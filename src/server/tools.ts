import { z } from 'zod';
import { dispatch, evalInPage, DispatcherError } from './dispatcher.js';
import type { LoadedAdapters } from './adapter-loader.js';

function paramsToShape(schema: z.ZodTypeAny): Record<string, unknown> {
  // We can't fully introspect arbitrary Zod schemas; return a coarse shape.
  // For object schemas with a known shape, expose key names + a "type" hint.
  if (schema instanceof z.ZodObject) {
    const shape: Record<string, unknown> = {};
    const inner = (schema as z.ZodObject<z.ZodRawShape>).shape;
    for (const [key, sub] of Object.entries(inner)) {
      shape[key] = describeSchema(sub as z.ZodTypeAny);
    }
    return shape;
  }
  return { _type: describeSchema(schema) };
}

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

export function buildListAdaptersTool(loaded: LoadedAdapters) {
  return {
    name: 'web_list_adapters',
    description:
      'List available web-tool adapters and their actions, including per-action risk metadata. Call once at the start of a relevant turn to discover what is available.',
    inputSchema: z.object({}).strict(),
    handler: async () => {
      const adapters = loaded.list.map((a) => ({
        slug: a.slug,
        display_name: a.display_name,
        allowed_origins: a.allowed_origins,
        default_url: a.default_url,
        actions: Object.entries(a.actions).map(([name, def]) => ({
          name,
          description: def.description,
          params: paramsToShape(def.params),
          risk_level: def.risk_level,
          mutates_state: def.mutates_state,
          writes_files: def.writes_files,
          requires_confirmation: def.requires_confirmation
        }))
      }));
      return { adapters };
    }
  };
}

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
