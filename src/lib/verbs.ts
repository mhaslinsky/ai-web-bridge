/**
 * Coarse sanity layer for free-text instructions passed to an in-page AI
 * (e.g. Claude Design's canvas chat). NOT a security mitigation — the
 * load-bearing safety control for tell_canvas_chat is duplicate-before-mutate.
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

export function checkInstruction(instruction: string): VerbCheckResult {
  const trimmed = instruction.trim().toLowerCase();
  if (!trimmed) return { ok: false, reason: 'instruction is empty' };

  const tokens = trimmed.split(/\s+/);
  const firstVerb = tokens[0] ?? '';

  if (DENYLIST.includes(firstVerb)) {
    return {
      ok: false,
      reason: `instruction starts with denylisted verb "${firstVerb}". Refused as a sanity check; if you meant to do this, run the action manually.`
    };
  }

  // Catch broad-scope variants like "destroy all elements" or
  // "remove everything" even when split across the first few words.
  const firstFour = tokens.slice(0, 4);
  const hasDenyVerb = firstFour.some((t) => DENYLIST.includes(t));
  const hasBroadScope = firstFour.some((t) => SCOPE_QUALIFIERS.includes(t));
  if (hasDenyVerb && hasBroadScope) {
    return {
      ok: false,
      reason: `instruction combines a destructive verb with a broad-scope qualifier ("${tokens.slice(0, 4).join(' ')}..."). Refused as a sanity check.`
    };
  }

  return { ok: true };
}
