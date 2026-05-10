import type { Page, BrowserContext } from 'playwright';
import type { z } from 'zod';

export type RiskLevel = 'read' | 'navigation' | 'mutation' | 'destructive';

export interface ActionMetadata {
  /** Short human-friendly description shown in web_list_adapters output. */
  description: string;
  /** Zod schema for validating args. Empty object schema => no args. */
  params: z.ZodTypeAny;
  /** read = safe; navigation = side-effect-free nav; mutation = changes remote state; destructive = irreversible. */
  risk_level: RiskLevel;
  /** True if the action changes remote state in any way. */
  mutates_state: boolean;
  /** True if the action emits files to disk; the dispatcher checks dest paths. */
  writes_files: boolean;
  /** True if the calling LLM should pause and surface the action to the user before executing. */
  requires_confirmation: boolean;
}

export interface ActionContext {
  /** A logged-in Page targeting the adapter's preferred URL. */
  page: Page;
  /** Underlying context, in case the action needs to open additional pages. */
  context: BrowserContext;
}

export interface ActionDef<P = unknown> extends ActionMetadata {
  run: (ctx: ActionContext, args: P) => Promise<unknown>;
}

export interface AdapterDef {
  slug: string;
  display_name: string;
  /** Origins the dispatcher will permit pages to be on while running this adapter. */
  allowed_origins: readonly string[];
  /** Initial URL to navigate to when invoking actions. */
  default_url: string;
  actions: Record<string, ActionDef<any>>;
}
