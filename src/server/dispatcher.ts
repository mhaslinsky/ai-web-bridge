import { z } from 'zod';
import { ActionQueue } from '../lib/action-queue.js';
import { assertAllowedOrigin, OriginPolicyError } from '../lib/origin-policy.js';
import { getContext, getPage } from './browser.js';
import type { AdapterDef, ActionDef } from './adapter-types.js';

const queue = new ActionQueue();

export interface RunResult {
  result: unknown;
  /** Echo of the action's metadata so the caller sees risk/state info alongside the result. */
  meta: {
    adapter: string;
    action: string;
    risk_level: string;
    mutates_state: boolean;
    writes_files: boolean;
  };
}

export class DispatcherError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'DispatcherError';
  }
}

export async function dispatch(
  adapter: AdapterDef,
  actionName: string,
  args: unknown
): Promise<RunResult> {
  const action = adapter.actions[actionName] as ActionDef | undefined;
  if (!action) {
    throw new DispatcherError(
      'unknown_action',
      `Adapter "${adapter.slug}" has no action "${actionName}". Available: ${Object.keys(adapter.actions).join(', ')}`
    );
  }

  const parsed = action.params.safeParse(args ?? {});
  if (!parsed.success) {
    throw new DispatcherError(
      'invalid_args',
      `Args for ${adapter.slug}.${actionName} failed validation: ${parsed.error.message}`
    );
  }

  return queue.run(async () => {
    const ctx = await getContext();
    const page = await getPage(adapter.default_url);

    try {
      assertAllowedOrigin(page, adapter.allowed_origins);
    } catch (err) {
      if (err instanceof OriginPolicyError) {
        throw new DispatcherError('origin_violation', err.message);
      }
      throw err;
    }

    const result = await action.run({ page, context: ctx }, parsed.data);

    return {
      result,
      meta: {
        adapter: adapter.slug,
        action: actionName,
        risk_level: action.risk_level,
        mutates_state: action.mutates_state,
        writes_files: action.writes_files
      }
    };
  });
}

export async function evalInPage(js: string, targetUrl?: string): Promise<unknown> {
  return queue.run(async () => {
    const page = await getPage(targetUrl);
    return page.evaluate(`(async () => { ${js} })()`);
  });
}

export const SessionExpiredHints = {
  /**
   * Wrap an action error and return a friendlier message if it looks like a
   * session-expiry symptom (URL bounced to a known login path, etc.).
   */
  remediation(adapterSlug: string, currentUrl: string): string {
    return (
      `Session for ${adapterSlug} appears expired (current URL: ${currentUrl}). ` +
      `Run \`ai-web-bridge login ${adapterSlug}\` (or open the automation profile and sign in), then retry.`
    );
  }
};
