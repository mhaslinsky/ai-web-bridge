/**
 * Coarse sanity layer for free-text instructions passed to an in-page AI
 * (e.g. Claude Design's canvas chat). NOT a security mitigation — for
 * tell_canvas_chat the real guard is requires_confirmation (the caller must
 * confirm before the canvas is mutated in place); this list is only a coarse
 * pre-flight filter layered on top of that.
 *
 * This list catches obviously-broad/destructive instructions that a careful
 * caller would never issue. It is intentionally conservative; it does not
 * constrain scope, target, or intent.
 */

const DENYLIST = [
  'delete',
  'remove',
  'clear',
  'wipe',
  'destroy',
  'drop',
  'erase',
  'reset',
  'purge',
  'nuke'
];

const SCOPE_QUALIFIERS = ['everything', 'all', 'every', 'entire', 'whole'];

export interface VerbCheckResult {
  ok: boolean;
  reason?: string;
}

/** Check a free-text instruction against the denylist + broad-scope combo guard. */
export function checkInstruction(instruction: string): VerbCheckResult {
  const normalized = instruction.trim().toLowerCase();
  if (!normalized) return { ok: false, reason: 'instruction is empty' };

  const tokens = normalized.split(/\s+/);
  const firstVerb = tokens[0] ?? '';

  if (DENYLIST.includes(firstVerb)) {
    return {
      ok: false,
      reason: `instruction starts with denylisted verb "${firstVerb}". Refused as a sanity check; if you meant to do this, run the action manually.`
    };
  }

  // Catch broad-scope variants like "destroy all elements" or
  // "remove everything" even when split across the first few words.
  const firstFourTokens = tokens.slice(0, 4);
  const hasDestructiveVerb = firstFourTokens.some((token) => DENYLIST.includes(token));
  const hasBroadScopeQualifier = firstFourTokens.some((token) => SCOPE_QUALIFIERS.includes(token));
  if (hasDestructiveVerb && hasBroadScopeQualifier) {
    return {
      ok: false,
      reason: `instruction combines a destructive verb with a broad-scope qualifier ("${firstFourTokens.join(' ')}..."). Refused as a sanity check.`
    };
  }

  return { ok: true };
}
