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

/** Type guard: does `value` have the minimum AdapterDef fields with the right types? */
function isAdapter(value: unknown): value is AdapterDef {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.slug === 'string' &&
    typeof candidate.display_name === 'string' &&
    Array.isArray(candidate.allowed_origins) &&
    typeof candidate.default_url === 'string' &&
    typeof candidate.actions === 'object' &&
    candidate.actions !== null
  );
}

/** Discover and dynamically import every valid adapter module in `options.dir` (defaults to dist/adapters/). */
export async function loadAdapters(options: LoadAdaptersOptions = {}): Promise<LoadedAdapters> {
  const directory = options.dir ?? DEFAULT_ADAPTERS_DIR;
  const warn = options.warn ?? ((message: string) => console.error(message));

  const bySlug = new Map<string, AdapterDef>();
  const list: AdapterDef[] = [];

  let entries: string[] = [];
  try {
    entries = await readdir(directory);
  } catch {
    return { byslug: bySlug, list };
  }

  for (const file of entries) {
    if (!file.endsWith('.js') && !file.endsWith('.mjs')) continue;
    const fullPath = join(directory, file);
    // Cache-bust so tests can reload mutated adapter files in the same process.
    const moduleUrl = pathToFileURL(fullPath).href + `?t=${Date.now()}`;
    let importedModule: { adapter?: unknown };
    try {
      importedModule = (await import(moduleUrl)) as { adapter?: unknown };
    } catch (importError) {
      warn(
        `[ai-web-bridge] skipping ${file}: import failed (${
          importError instanceof Error ? importError.message : String(importError)
        })`
      );
      continue;
    }
    const adapterCandidate = importedModule.adapter;
    if (!isAdapter(adapterCandidate)) {
      warn(`[ai-web-bridge] skipping ${file}: missing or invalid \`adapter\` export`);
      continue;
    }
    if (bySlug.has(adapterCandidate.slug)) {
      warn(`[ai-web-bridge] duplicate adapter slug: ${adapterCandidate.slug} (skipping ${file})`);
      continue;
    }
    bySlug.set(adapterCandidate.slug, adapterCandidate);
    list.push(adapterCandidate);
  }

  return { byslug: bySlug, list };
}
