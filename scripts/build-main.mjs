// Bundles the background engine (main process) and the preload bridge with esbuild.
import { build } from 'esbuild';
import fs from 'node:fs';

// Davenport's own Google OAuth client (a Desktop app client), built into release builds. It comes from
// oauth-client.json in the project folder (git ignores it) or from DAVENPORT_CLIENT_ID / DAVENPORT_CLIENT_SECRET,
// as in the release workflow. Without either, the app asks each user to connect their own Google Cloud project.
function builtInClient() {
  if (process.env.DAVENPORT_CLIENT_ID) return { id: process.env.DAVENPORT_CLIENT_ID, secret: process.env.DAVENPORT_CLIENT_SECRET ?? '' };
  try {
    const json = JSON.parse(fs.readFileSync('oauth-client.json', 'utf8'));
    const c = json.installed ?? json;
    if (c.client_id) return { id: c.client_id, secret: c.client_secret ?? '' };
  } catch {
    /* none */
  }
  return { id: '', secret: '' };
}
const client = builtInClient();
console.log(client.id ? `Built-in Google client: ${client.id.slice(0, 12)}…` : 'No built-in Google client (users connect their own).');

const watch = process.argv.includes('--watch');
const common = {
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  sourcemap: false,
  external: ['electron'],
  define: { __DAVENPORT_CLIENT_ID__: JSON.stringify(client.id), __DAVENPORT_CLIENT_SECRET__: JSON.stringify(client.secret) },
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
