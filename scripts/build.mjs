import { build } from 'esbuild';
await build({
  entryPoints: ['src/main.ts', 'src/playwright.ts', 'src/storybook.ts'],
  outdir: '.',
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  sourcemap: false,
  banner: { js: '#!/usr/bin/env node' },
});
