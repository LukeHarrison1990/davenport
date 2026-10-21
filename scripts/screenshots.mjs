// Launches Davenport with a fresh profile and the demo account, and screenshots every screen.
// Usage: node scripts/screenshots.mjs [outDir]
import { _electron as electron } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const out = process.argv[2] ?? 'docs/screenshots';
fs.mkdirSync(out, { recursive: true });
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'davenport-shots-'));
const app = await electron.launch({
  args: ['.'],
  env: { ...process.env, DAVENPORT_USER_DATA: profile, DAVENPORT_NO_SANDBOX: '1', TZ: process.env.TZ ?? 'Europe/London' }
});
app.process().stderr?.on('data', (d) => process.stderr.write('[electron] ' + d));
const win = await app.firstWindow();
win.on('console', (m) => { if (m.type() === 'error') console.log('[console]', m.text()); });
win.on('pageerror', (e) => console.log('[pageerror]', e.message));
await win.setViewportSize({ width: 1440, height: 900 });
await win.waitForLoadState('domcontentloaded');
await win.waitForTimeout(800);
const shot = async (name) => {
  await win.waitForTimeout(700);
  await win.screenshot({ path: path.join(out, name + '.png') });
  console.log('saved', name);
};
await shot('00-welcome');
await win.evaluate(() => window.davenport.invoke('accounts.addDemo'));
await win.waitForTimeout(1200);
// Select the first message in the list.
await win.locator('#message-list .row').first().click();
await shot('01-mail');
const only = process.argv[3];
if (only !== 'mail') {
  await win.keyboard.press('Control+2');
  await shot('02-calendar');
  await win.keyboard.press('Control+3');
  await win.locator('.person').first().click();
  await shot('03-people');
  await win.keyboard.press('Control+4');
  await shot('04-chat');
  await win.keyboard.press('Control+5');
  await shot('05-tasks');
  await win.keyboard.press('Control+1');
  await win.evaluate(() => window.davenport.invoke('settings.set', { theme: 'dark' }));
  await win.locator('#message-list .row').nth(1).click();
  await shot('06-mail-dark');
  await win.evaluate(() => window.davenport.invoke('settings.set', { theme: 'light' }));
}
app.process().kill();
process.exit(0);
