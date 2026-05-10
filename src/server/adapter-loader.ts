import { readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { AdapterDef } from './adapter-types.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ADAPTERS_DIR = resolve(HERE, '..', 'adapters');

export interface LoadedAdapters {
  byslug: Map<string, AdapterDef>;
  list: AdapterDef[];
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

export async function loadAdapters(): Promise<LoadedAdapters> {
  const byslug = new Map<string, AdapterDef>();
  const list: AdapterDef[] = [];

  let entries: string[] = [];
  try {
    entries = await readdir(ADAPTERS_DIR);
  } catch {
    return { byslug, list };
  }

  for (const file of entries) {
    if (!file.endsWith('.js') && !file.endsWith('.mjs')) continue;
    const fullPath = join(ADAPTERS_DIR, file);
    const url = pathToFileURL(fullPath).href;
    const mod = (await import(url)) as { adapter?: unknown };
    const candidate = mod.adapter;
    if (!isAdapter(candidate)) {
      // eslint-disable-next-line no-console
      console.error(`[ai-web-bridge] skipping ${file}: missing or invalid \`adapter\` export`);
      continue;
    }
    if (byslug.has(candidate.slug)) {
      // eslint-disable-next-line no-console
      console.error(`[ai-web-bridge] duplicate adapter slug: ${candidate.slug} (skipping ${file})`);
      continue;
    }
    byslug.set(candidate.slug, candidate);
    list.push(candidate);
  }

  return { byslug, list };
}
