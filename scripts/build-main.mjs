// Bundles the background engine (main process) and the preload bridge with esbuild.
import { build } from 'esbuild';

const watch = process.argv.includes('--watch');
const common = {
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  sourcemap: false,
  external: ['electron'],
  logLevel: 'info'
};

const entries = [
  { entryPoints: ['app/main/index.ts'], outfile: 'dist/main/index.js' },
  { entryPoints: ['app/preload/index.ts'], outfile: 'dist/preload/index.js' }
];

if (watch) {
  const { context } = await import('esbuild');
  for (const e of entries) {
    const ctx = await context({ ...common, ...e });
    await ctx.watch();
  }
} else {
  await Promise.all(entries.map((e) => build({ ...common, ...e })));
}
