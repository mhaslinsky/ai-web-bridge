import { defineConfig } from 'tsup';

export default defineConfig({
  entry: [
    'src/server/index.ts',
    'src/cli/index.ts',
    'src/adapters/*.ts'
  ],
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  splitting: false,
  shims: true,
  banner: { js: '#!/usr/bin/env node' }
});
