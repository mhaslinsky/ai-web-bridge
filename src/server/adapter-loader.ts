import { readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { AdapterDef } from './adapter-types.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ADAPTERS_DIR = resolve(HERE, '..', 'adapters');

export interface LoadedAdapters {
  byslug: Map<string, AdapterDef>;
  list: AdapterDef[];
}

export interface LoadAdaptersOptions {
  /** Directory to scan for adapter modules. Defaults to dist/adapters/. */
  dir?: string;
  /** Sink for non-fatal warnings (invalid shape, duplicate slug). Defaults to console.error. */
  warn?: (message: string) => void;
}

function isAdapter(x: unknown): x is AdapterDef {
  if (!x || typeof x !== 'object') return false;
  const a = x as Record<string, unknown>;
  return (
    typeof a.slug === 'string' &&
    typeof a.display_name === 'string' &&
    Array.isArray(a.allowed_origins) &&
    typeof a.default_url === 'string' &&
    typeof a.actions === 'object' &&
    a.actions !== null
  );
}

export async function loadAdapters(opts: LoadAdaptersOptions = {}): Promise<LoadedAdapters> {
  const dir = opts.dir ?? DEFAULT_ADAPTERS_DIR;
  const warn = opts.warn ?? ((m: string) => console.error(m));

  const byslug = new Map<string, AdapterDef>();
  const list: AdapterDef[] = [];

  let entries: string[] = [];
  try {
    entries = await readdir(dir);
  } catch {
    return { byslug, list };
  }

  for (const file of entries) {
    if (!file.endsWith('.js') && !file.endsWith('.mjs')) continue;
    const fullPath = join(dir, file);
    // Cache-bust so tests can reload mutated adapter files in the same process.
    const url = pathToFileURL(fullPath).href + `?t=${Date.now()}`;
    let mod: { adapter?: unknown };
    try {
      mod = (await import(url)) as { adapter?: unknown };
    } catch (err) {
      warn(`[ai-web-bridge] skipping ${file}: import failed (${err instanceof Error ? err.message : String(err)})`);
      continue;
    }
    const candidate = mod.adapter;
    if (!isAdapter(candidate)) {
      warn(`[ai-web-bridge] skipping ${file}: missing or invalid \`adapter\` export`);
      continue;
    }
    if (byslug.has(candidate.slug)) {
      warn(`[ai-web-bridge] duplicate adapter slug: ${candidate.slug} (skipping ${file})`);
      continue;
    }
    byslug.set(candidate.slug, candidate);
    list.push(candidate);
  }

  return { byslug, list };
}
