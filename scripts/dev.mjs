// Development: rebuilds the engine on change, serves the interface with hot reload, and starts Electron.
import { spawn } from 'node:child_process';

const run = (cmd, args, env = {}) =>
  spawn(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32', env: { ...process.env, ...env } });

run('node', ['scripts/build-main.mjs', '--watch']);
run('npx', ['vite']);
setTimeout(() => {
  const electron = run('npx', ['electron', '.'], { DAVENPORT_DEV_URL: 'http://localhost:5199' });
  electron.on('exit', () => process.exit(0));
}, 2500);
