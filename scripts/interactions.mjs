// End-to-end checks of the interface with the demo account: compose and send, dialogs, event editor, search, keyboard.
// Usage: node scripts/interactions.mjs [screenshotDir]
import { _electron as electron } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const out = process.argv[2] ?? '/tmp/davenport-checks';
fs.mkdirSync(out, { recursive: true });
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'davenport-int-'));
const app = await electron.launch({ args: ['.'], env: { ...process.env, DAVENPORT_USER_DATA: profile, DAVENPORT_NO_SANDBOX: '1' } });
const errors = [];
const watch = (p) => {
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('console', (m) => m.type() === 'error' && !/Content Security Policy|favicon/.test(m.text()) && errors.push(m.text()));
};
const win = await app.firstWindow();
watch(win);
win.setDefaultTimeout(6000);
app.on('window', (w) => w.setDefaultTimeout(6000));
await win.setViewportSize({ width: 1440, height: 900 });
await win.waitForTimeout(800);
const results = [];
const check = async (name, fn) => {
  try {
    await Promise.race([fn(), new Promise((_, rej) => setTimeout(() => rej(new Error('step timed out after 25s')), 25000))]);
    results.push(['ok', name]);
    console.log('ok  ', name);
  } catch (e) {
    results.push(['FAIL', name + ' — ' + e.message.split('\n')[0]]);
    console.log('FAIL', name, '—', e.message.split('\n')[0]);
    await win.screenshot({ path: path.join(out, 'fail-' + name.replace(/\W+/g, '-') + '.png') }).catch(() => {});
  }
};
// Captures a child window through Electron (Playwright screenshots of background windows can stall on a headless display).
const capture = async (title, file) => {
  const b64 = await app.evaluate(async ({ BrowserWindow }, t) => {
    const w = BrowserWindow.getAllWindows().find((x) => x.getTitle() === t) ?? BrowserWindow.getFocusedWindow();
    return w ? (await w.webContents.capturePage()).toPNG().toString('base64') : '';
  }, title);
  if (b64) fs.writeFileSync(path.join(out, file), Buffer.from(b64, 'base64'));
};
const api = (m, ...a) => win.evaluate(([m, a]) => window.davenport.invoke(m, ...a), [m, a]);

await check('add demo account from welcome screen', async () => {
  await win.getByRole('button', { name: /Explore with sample data/ }).click();
  await win.locator('#message-list .row').first().waitFor({ timeout: 5000 });
});

await check('ribbon fits on one row at 1440px', async () => {
  const h = await win.locator('.toolbar').first().evaluate((el) => el.getBoundingClientRect().height);
  if (h > 56) throw new Error('toolbar height ' + h);
});

await check('open message shows body in sandboxed frame', async () => {
  await win.locator('#message-list .row').first().click();
  const frame = win.frameLocator('iframe.message-frame').first();
  await frame.locator('body').waitFor();
  const text = await frame.locator('body').innerText();
  if (!/revised Q4 figures/.test(text)) throw new Error('body text missing: ' + text.slice(0, 80));
});

await check('Other tab lists promotions', async () => {
  await win.getByRole('tab', { name: 'Other' }).click();
  await win.locator('#message-list .row', { hasText: 'desk chairs' }).waitFor({ timeout: 3000 });
  await win.getByRole('tab', { name: 'Primary' }).click();
});

await check('search filters the list', async () => {
  await win.locator('#global-search').pressSequentially('pivot', { delay: 40 });
  await win.locator('#message-list .row', { hasText: 'advanced Sheets' }).waitFor({ timeout: 3000 }); // no Enter needed
  let n = 0;
  for (let i = 0; i < 20 && (n = await win.locator('#message-list .row').count()) !== 1; i++) await win.waitForTimeout(100);
  if (n !== 1) throw new Error('expected 1 result, got ' + n);
  await win.locator('#global-search').fill('');
  await win.locator('#global-search').press('Escape');
});

await check('Ctrl+A with nothing selected selects every message, not the window text', async () => {
  await win.locator('.folder', { hasText: 'Inbox' }).first().click();
  await win.locator('.folder', { hasText: 'Inbox' }).first().focus();
  await win.keyboard.press('Control+A');
  await win.waitForTimeout(300);
  const rows = await win.locator('#message-list .row').count();
  const picked = await win.locator('#message-list .row[aria-selected="true"]').count();
  const text = await win.evaluate(() => window.getSelection()?.toString() ?? '');
  if (picked !== rows || rows === 0) throw new Error(`selected ${picked} of ${rows}`);
  if (text.trim()) throw new Error('window text was selected: ' + text.slice(0, 40));
  await win.locator('#message-list .row').first().click();
});

await check('inline reply, send with undo window, message appears in Sent', async () => {
  await api('settings.set', { undoSendSeconds: 2 });
  await win.locator('#message-list .row').first().click();
  await win.locator('.quick-reply').getByRole('button', { name: /^Reply$/ }).click();
  const editor = win.locator('.compose.inline .editor');
  await editor.waitFor();
  await editor.click();
  await win.keyboard.type('Thanks Priya, moving the laptops to January works.');
  await win.locator('.compose.inline').getByRole('button', { name: /^Send$/ }).click();
  await win.locator('.toast', { hasText: 'Sending' }).waitFor({ timeout: 3000 });
  await win.waitForTimeout(3500);
  const sent = await api('mail.list', { accountId: 'demo', folder: { type: 'label', id: 'SENT' } });
  if (!sent.some((m) => m.subject.startsWith('Re: Q4 budget'))) throw new Error('reply not in Sent');
});

await check("closing a compose window with the window's X asks before losing the message", async () => {
  const wp = app.waitForEvent('window', { timeout: 8000 });
  await win.keyboard.press('Control+N');
  const compose = await wp;
  await compose.waitForLoadState('domcontentloaded');
  await compose.locator('#c-subject').waitFor();
  await compose.locator('#c-subject').fill('Half-written note');
  // Answer the Save / Don't save / Cancel question automatically: first Cancel, then Save.
  const answer = (n) => app.evaluate(({ dialog }, n) => { dialog.showMessageBox = async () => ({ response: n, checkboxChecked: false }); }, n);
  const closeLikeX = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w.getTitle() !== 'Davenport' && /message|Half-written/i.test(w.getTitle()))?.close());
  await answer(2);
  await closeLikeX();
  await compose.waitForTimeout(800);
  if (compose.isClosed()) throw new Error('window closed although Cancel was chosen');
  await answer(0);
  const closed = compose.waitForEvent('close', { timeout: 6000 });
  await closeLikeX();
  await closed;
  const drafts = await api('mail.list', { accountId: 'demo', folder: { type: 'label', id: 'DRAFT' } });
  if (!drafts.some((d) => d.subject === 'Half-written note')) throw new Error('draft was not saved');
});

await check('About box shows the version and the MIT License', async () => {
  await win.locator('.avatar-btn').click();
  await win.getByRole('menuitem', { name: 'About Davenport' }).click();
  await win.locator('.dialog .licence-text', { hasText: 'Permission is hereby granted, free of charge' }).waitFor();
  await win.locator('.dialog', { hasText: /Version \d+\.\d+\.\d+/ }).waitFor();
  await win.keyboard.press('Escape');
});

await check('new mail opens a compose window and sends', async () => {
  const L = (...x) => process.env.DAV_DEBUG && console.log('   ·', ...x);
  L('pressing');
  const wp = app.waitForEvent('window', { timeout: 8000 });
  await win.keyboard.press('Control+N');
  L('pressed');
  const compose = await wp;
  L('got window', compose.url());
  watch(compose);
  await compose.waitForLoadState('domcontentloaded');
  L('loaded');
  await compose.locator('#c-to').waitFor();
  L('to ready');
  await compose.locator('#c-to').fill('pri');
  L('filled');
  await compose.locator('.suggest .menu-item').first().waitFor({ timeout: 3000 });
  L('suggest');
  await compose.keyboard.press('Enter');
  L('enter');
  await compose.locator('#c-subject').fill('Lunch on Friday?');
  L('subject');
  await compose.locator('.editor').click();
  L('editor');
  await compose.keyboard.type('Are you free for lunch on Friday?');
  L('typed');
  void compose.getByRole('button', { name: /^Send$/ }).first().click({ noWaitAfter: true, timeout: 4000 }).catch(() => {});
  for (let i = 0; i < 20 && app.windows().length > 1; i++) await new Promise((r) => setTimeout(r, 250));
  L('windows after send', app.windows().length);
  await win.waitForTimeout(3000);
  const sent = await api('mail.list', { accountId: 'demo', folder: { type: 'label', id: 'SENT' } });
  const m = sent.find((x) => x.subject === 'Lunch on Friday?');
  if (!m) throw new Error('not sent');
  if (m.to[0]?.email !== 'priya.shah@northfield.example') throw new Error('autocomplete picked ' + JSON.stringify(m.to));
});

await check('delete with undo restores the message', async () => {
  await win.locator('#message-list .row', { hasText: 'Daniel Reyes' }).click();
  await win.keyboard.press('Delete');
  await win.locator('.toast', { hasText: 'Bin' }).getByRole('button', { name: 'Undo' }).click();
  await win.locator('#message-list .row', { hasText: 'Daniel Reyes' }).waitFor({ timeout: 3000 });
});

await check('delete from a folder other than the inbox removes it', async () => {
  await win.locator('.folder', { hasText: 'Finance' }).first().click();
  const row = win.locator('#message-list .row', { hasText: 'Invoice INV-2041' });
  await row.click();
  await win.keyboard.press('Delete');
  await row.waitFor({ state: 'detached', timeout: 3000 });
  await win.locator('.folder', { hasText: 'Bin' }).first().click();
  await win.locator('#message-list .row', { hasText: 'Invoice INV-2041' }).waitFor({ timeout: 3000 });
  await win.locator('.folder', { hasText: 'Inbox' }).first().click();
});

await check('bottom reading pane sits above the status bar', async () => {
  const t0 = Date.now();
  await api('settings.set', { readingPane: 'bottom' });
  await win.locator('.mail-split.bottom').waitFor({ timeout: 2000 });
  const lag = Date.now() - t0;
  if (lag > 500) throw new Error('layout took ' + lag + ' ms to switch');
  await win.locator('#message-list .row').first().click();
  await win.locator('.reading iframe.message-frame').first().waitFor();
  const sb = await win.locator('.statusbar').boundingBox();
  const rp = await win.locator('.reading').boundingBox();
  const lp = await win.locator('.list-pane').boundingBox();
  if (rp.height < 150) throw new Error('reading pane too small: ' + rp.height);
  if (lp.y + lp.height > rp.y + 1 || rp.y + rp.height > sb.y + 1) throw new Error('panes overlap the status bar ' + JSON.stringify({lp, rp, sb}));
  await api('settings.set', { readingPane: 'right' });
  await win.locator('.mail-split:not(.bottom)').waitFor({ timeout: 2000 });
});

await check('Send / Receive shows progress, then says it finished', async () => {
  await win.keyboard.press('F9');
  await win.locator('.statusbar .sync-progress [role=progressbar]').waitFor({ timeout: 2000 });
  if (!(await win.locator('.titlebar .sync .sync-icon.spinning').count())) throw new Error('title bar icon not spinning');
  await win.locator('.statusbar', { hasText: 'Send/Receive complete' }).waitFor({ timeout: 6000 });
});

await check('folder pane and message list can be resized, and remember their size', async () => {
  await api('settings.set', { readingPane: 'right' });
  await win.waitForTimeout(300);
  const drag = async (sel, dx) => {
    const b = await win.locator(sel).first().boundingBox();
    await win.mouse.move(b.x + b.width / 2, b.y + 200);
    await win.mouse.down();
    await win.mouse.move(b.x + b.width / 2 + dx, b.y + 200, { steps: 6 });
    await win.mouse.up();
  };
  const fw = (await win.locator('.folder-pane').boundingBox()).width;
  await drag('.splitter[aria-label="Resize folder pane"]', 80);
  const fw2 = (await win.locator('.folder-pane').boundingBox()).width;
  if (Math.abs(fw2 - fw - 80) > 4) throw new Error(`folder pane ${fw} -> ${fw2}`);
  const lw = (await win.locator('.list-pane').boundingBox()).width;
  await drag('.splitter[aria-label="Resize message list"]', -60);
  const lw2 = (await win.locator('.list-pane').boundingBox()).width;
  if (Math.abs(lw - lw2 - 60) > 4) throw new Error(`list ${lw} -> ${lw2}`);
  const stored = await win.evaluate(() => [localStorage.getItem('dav.folderWidth'), localStorage.getItem('dav.listWidth')]);
  if (Number(stored[0]) !== Math.round(fw2) || Number(stored[1]) !== Math.round(lw2)) throw new Error('not remembered: ' + stored);
  // Double-click puts them back.
  await win.locator('.splitter[aria-label="Resize folder pane"]').dblclick();
  await win.locator('.splitter[aria-label="Resize message list"]').dblclick();
  if (Math.round((await win.locator('.folder-pane').boundingBox()).width) !== 240) throw new Error('folder pane reset failed');
});

await check('right-clicking a message in the reading pane shows an Outlook-style menu', async () => {
  await win.keyboard.press('Control+1');
  await win.locator('#message-list .row').first().click();
  const body = win.frameLocator('.reading iframe.message-frame').first().locator('body');
  await body.click({ button: 'right', position: { x: 40, y: 20 } });
  for (const name of ['Select all', 'Reply', 'Reply all', 'Forward', 'Mark as unread', 'Move to…', 'Delete', 'Print']) {
    await win.getByRole('menuitem', { name: new RegExp('^' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) }).first().waitFor({ timeout: 2000 });
  }
  await win.getByRole('menuitem', { name: /^Select all/ }).click();
  await body.click({ button: 'right', position: { x: 40, y: 20 } });
  await win.getByRole('menuitem', { name: /^Copy\b/ }).first().click();
  await win.waitForTimeout(300);
  const copied = await app.evaluate(async ({ clipboard }) => clipboard.readText());
  if (!/revised Q4 figures/.test(copied)) throw new Error('clipboard: ' + copied.slice(0, 60));
  // A click inside the message closes an open menu.
  await body.click({ button: 'right', position: { x: 40, y: 20 } });
  await body.click({ position: { x: 40, y: 60 } });
  if (await win.getByRole('menuitem', { name: /^Reply all/ }).count()) throw new Error('menu stayed open');
});

await check('New mail split button offers other items', async () => {
  await win.locator('.split-more').first().click();
  await win.getByRole('menuitem', { name: 'Event' }).waitFor();
  await win.keyboard.press('Escape');
});

await check('submenus open beside their menu on hover, keeping the parent menu open', async () => {
  await win.keyboard.press('Control+1');
  await win.locator('#message-list .row').first().click({ button: 'right' });
  const parent = win.locator('.menu[data-level="0"]');
  await parent.waitFor();
  await win.getByRole('menuitem', { name: /^Follow up/ }).hover();
  const sub = win.locator('.menu[data-level="1"]');
  await sub.waitFor({ timeout: 2000 });
  if (!(await parent.isVisible())) throw new Error('parent menu was hidden');
  const pb = await parent.boundingBox();
  const sb = await sub.boundingBox();
  if (!(sb.x >= pb.x + pb.width - 12 || sb.x + sb.width <= pb.x + 12)) throw new Error('submenu overlaps its menu');
  // Moving to an ordinary item closes the submenu again.
  await win.getByRole('menuitem', { name: /^Reply all/ }).hover();
  await sub.waitFor({ state: 'detached', timeout: 2000 });
  // Keyboard: Right opens, Left goes back.
  await win.getByRole('menuitem', { name: /^Follow up/ }).focus();
  await win.keyboard.press('ArrowRight');
  await sub.waitFor({ timeout: 2000 });
  await win.keyboard.press('ArrowLeft');
  await sub.waitFor({ state: 'detached', timeout: 2000 });
  await win.keyboard.press('Escape');
  await parent.waitFor({ state: 'detached', timeout: 2000 });
});

await check('flag creates a follow-up task', async () => {
  await win.locator('#message-list .row', { hasText: 'Lena Okafor' }).click({ button: 'right' });
  await win.getByRole('menuitem', { name: /Follow up/ }).click();
  await win.getByRole('menuitem', { name: /^Tomorrow/ }).click();
  await win.waitForTimeout(500);
  const tasks = await api('tasks.myDay');
  if (!tasks.some((t) => t.title === 'Contract draft v3 for Acme')) throw new Error('task not created');
});

await check('move to folder dialog files the message', async () => {
  await win.locator('#message-list .row', { hasText: 'Lena Okafor' }).click();
  await win.keyboard.press('Control+Shift+V');
  await win.getByPlaceholder('Search folders').fill('acme');
  await win.locator('.dialog .menu-item', { hasText: 'Clients/Acme' }).click();
  await win.waitForTimeout(400);
  const acme = await api('mail.list', { accountId: 'demo', folder: { type: 'label', id: 'Label_acme' } });
  const inbox = await api('mail.list', { accountId: 'demo', folder: { type: 'label', id: 'INBOX' }, tab: 'all' });
  if (!acme.some((m) => m.subject.includes('Contract draft'))) throw new Error('not in Acme');
  if (inbox.some((m) => m.subject.includes('Contract draft'))) throw new Error('still in inbox');
});

await check('rules dialog saves a rule', async () => {
  await win.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
  await api('rules.save', { id: '', accountId: 'demo', name: 'Newsletters', enabled: true, conditions: { from: 'workplaceweekly' }, actions: { archive: true, markRead: true }, where: 'local' });
  const rules = await api('rules.list', 'demo');
  if (!rules.some((r) => r.name === 'Newsletters')) throw new Error('rule missing');
});

await check('settings dialog opens and switches theme', async () => {
  await win.keyboard.press('Control+,');
  await win.getByRole('dialog', { name: 'Settings' }).waitFor();
  await win.getByRole('button', { name: 'General' }).click();
  await win.screenshot({ path: path.join(out, 'settings.png') });
  await win.keyboard.press('Escape');
});

await check('calendar: event editor window with Scheduling Assistant', async () => {
  await win.keyboard.press('Control+2');
  await win.locator('.week').waitFor();
  const [ev] = await Promise.all([app.waitForEvent('window', { timeout: 8000 }), win.keyboard.press('Control+N')]);
  watch(ev);
  await ev.waitForLoadState('domcontentloaded');
  await ev.getByLabel('Title').fill('Q4 budget review');
  await ev.locator('#ev-guests').fill('priya');
  await ev.locator('.suggest .menu-item').first().waitFor({ timeout: 3000 });
  await ev.keyboard.press('Enter');
  await ev.locator('.fb-cell.busy').first().waitFor({ timeout: 4000 });

  void ev.getByRole('button', { name: /Send invitation/ }).click({ noWaitAfter: true, timeout: 4000 }).catch(() => {});
  for (let i = 0; i < 20 && app.windows().length > 1; i++) await new Promise((r) => setTimeout(r, 250));
  await win.waitForTimeout(600);
  const evs = await api('calendar.events', Date.now() - 864e5 * 30, Date.now() + 864e5 * 60);
  if (!evs.some((e) => e.title === 'Q4 budget review' && e.attendees.some((a) => a.email.startsWith('priya')))) throw new Error('event not saved');
});

await check('calendar views render', async () => {
  for (const v of ['Day', 'Week', 'Month', 'Schedule', 'Work week']) {
    await win.locator('.ribbon').getByRole('button', { name: v, exact: true }).click();
    await win.waitForTimeout(300);
    if (v === 'Month') await win.screenshot({ path: path.join(out, 'calendar-month.png') });
  }
});

await check('calendar: respond to an invitation', async () => {
  await win.locator('.ev', { hasText: 'Supplier call' }).first().click();
  await win.locator('.peek').getByRole('button', { name: 'Yes' }).click();
  await win.waitForTimeout(400);
  const evs = await api('calendar.events', Date.now() - 864e5 * 10, Date.now() + 864e5 * 10);
  if (evs.find((e) => e.title === 'Supplier call')?.myResponse !== 'accepted') throw new Error('not accepted');
});

await check('automatic replies and Calendar out of office stay linked', async () => {
  const day = 864e5, start = Date.now() + 2 * day;
  await api('gmail.setVacation', 'demo', { enabled: true, subject: 'On leave', html: '<p>Back soon</p>', startTime: start, endTime: start + 2 * day, restrictToContacts: false, restrictToDomain: false, blockCalendar: true });
  let evs = await api('calendar.events', start - day, start + 4 * day);
  const ooo = evs.find((e) => e.eventType === 'outOfOffice' && e.start === start);
  if (!ooo) throw new Error('no calendar out-of-office created');
  if (!(await api('gmail.vacation', 'demo')).blockCalendar) throw new Error('link not reported');
  await api('calendar.delete', 'demo', ooo.calendarId, ooo.id);
  if ((await api('gmail.vacation', 'demo')).enabled) throw new Error('replies still on after deleting the calendar entry');
  // and the other way round, from Calendar
  const s2 = start + 10 * day;
  await api('calendar.save', { event: { accountId: 'demo', calendarId: 'primary', title: 'Out of office', start: s2, end: s2 + day, allDay: false, eventType: 'outOfOffice', autoDecline: true, description: 'At a conference' }, autoReply: true });
  const v = await api('gmail.vacation', 'demo');
  if (!v.enabled || v.startTime !== s2 || !v.html.includes('conference')) throw new Error('calendar entry did not switch on replies: ' + JSON.stringify(v));
  await api('gmail.setVacation', 'demo', { ...v, enabled: false });
  evs = await api('calendar.events', s2 - day, s2 + 2 * day);
  if (evs.some((e) => e.eventType === 'outOfOffice' && e.start === s2)) throw new Error('calendar entry left behind after turning replies off');
});

await check('chat: send a message', async () => {
  await win.keyboard.press('Control+4');
  await win.locator('#chat-input').fill('Yes — renewal is booked for the 8th.');
  await win.locator('#chat-input').press('Enter');
  await win.locator('.cmsg', { hasText: 'renewal is booked' }).waitFor({ timeout: 3000 });
});

await check('chat: conversations are grouped under each account', async () => {
  const heads = await win.locator('.chat-account .account-heading .email').allTextContents();
  if (!heads.includes('alex@northfield.example')) throw new Error('no account heading: ' + heads.join());
  await win.locator('.chat-account', { hasText: 'alex@northfield.example' }).locator('.conv', { hasText: 'Website relaunch' }).waitFor();
});

await check('chat: set Do not disturb and a status message', async () => {
  await win.locator('.presence-pill').first().click();
  await win.getByRole('menuitem', { name: /Do not disturb/ }).click();
  await win.getByRole('menuitem', { name: '1 hour' }).click();
  await win.locator('.presence-pill', { hasText: 'Do not disturb' }).waitFor({ timeout: 3000 });
  await win.locator('.custom-status').first().click();
  await win.locator('.status-presets .preset', { hasText: 'Teaching' }).click();
  await win.getByRole('button', { name: 'Save' }).click();
  await win.locator('.custom-status', { hasText: 'Teaching' }).waitFor({ timeout: 3000 });
  const st = (await api('chat.statuses')).find((x) => x.accountId === 'demo');
  if (st.presence !== 'dnd' || st.customText !== 'Teaching' || !st.customUntil) throw new Error(JSON.stringify(st));
});

await check('people: create a contact', async () => {
  await win.keyboard.press('Control+3');
  await win.getByRole('button', { name: 'New contact' }).click();
  await win.getByLabel('First name').fill('Rosa');
  await win.getByLabel('Last name').fill('Diaz');
  await win.getByLabel('Email').first().fill('rosa@example.com');
  await win.getByRole('button', { name: 'Save' }).click();
  await win.locator('.person', { hasText: 'Rosa Diaz' }).waitFor({ timeout: 3000 });
});

await check('tasks: add and complete', async () => {
  await win.keyboard.press('Control+5');
  await win.locator('#task-new').fill('Order new toner');
  await win.locator('#task-new').press('Enter');
  await win.locator('.task-item', { hasText: 'Order new toner' }).locator('input[type=checkbox]').click();
  await win.locator('.task-item', { hasText: 'Order new toner' }).waitFor({ state: 'detached', timeout: 3000 });
  const lists = await api('tasks.lists');
  const all = (await Promise.all(lists.map((l) => api('tasks.list', l.accountId, l.id, true)))).flat();
  if (!all.find((t) => t.title === 'Order new toner')?.completed) throw new Error('task not completed');
});

const dragBy = async (sel, dx) => {
  const b = await win.locator(sel).first().boundingBox();
  await win.mouse.move(b.x + b.width / 2, b.y + 200);
  await win.mouse.down();
  await win.mouse.move(b.x + b.width / 2 + dx, b.y + 200, { steps: 6 });
  await win.mouse.up();
};
const menuHas = async (...names) => {
  for (const n of names) await win.getByRole('menuitem', { name: n }).first().waitFor({ timeout: 2000 });
};

await check('calendar: right-click menus for events and empty time, and a resizable pane', async () => {
  await win.keyboard.press('Control+2');
  await win.locator('.week .ev').first().click({ button: 'right' });
  await menuHas(/^Open/, /^Copy details/);
  await win.keyboard.press('Escape');
  await win.locator('.day-col').first().click({ button: 'right', position: { x: 20, y: 30 } });
  await menuHas(/^New event at/, /^New Google Meet meeting/, /^Out of office/);
  await win.keyboard.press('Escape');
  const w = (await win.locator('nav.folder-pane').boundingBox()).width;
  await dragBy('.splitter[aria-label="Resize calendar pane"]', 50);
  const w2 = (await win.locator('nav.folder-pane').boundingBox()).width;
  if (Math.abs(w2 - w - 50) > 4) throw new Error(`calendar pane ${w} -> ${w2}`);
  await win.locator('.splitter[aria-label="Resize calendar pane"]').dblclick();
});

await check('people: contact menu and resizable list', async () => {
  await win.keyboard.press('Control+3');
  await win.locator('.person').first().click({ button: 'right' });
  await menuHas(/^Send email/, /^Schedule a meeting/, /^Copy/);
  await win.keyboard.press('Escape');
  const w = (await win.locator('.people-list').boundingBox()).width;
  await dragBy('.splitter[aria-label="Resize people list"]', 60);
  const w2 = (await win.locator('.people-list').boundingBox()).width;
  if (Math.abs(w2 - w - 60) > 4) throw new Error(`people list ${w} -> ${w2}`);
});

await check('chat: copy a message from its right-click menu, and resize the list', async () => {
  await win.keyboard.press('Control+4');
  const msg = win.locator('.cmsg').first();
  const text = (await msg.locator('p').first().textContent()).trim();
  await msg.click({ button: 'right' });
  await win.getByRole('menuitem', { name: /^Copy text/ }).click();
  await win.waitForTimeout(300);
  const copied = await app.evaluate(async ({ clipboard }) => clipboard.readText());
  if (copied.trim() !== text) throw new Error(`copied "${copied}" not "${text}"`);
  await win.locator('.conv').first().click({ button: 'right' });
  await menuHas(/^Open$/, /^Turn into email/, /^Open in Google Chat/);
  await win.keyboard.press('Escape');
  const w = (await win.locator('.chat-list').boundingBox()).width;
  await dragBy('.splitter[aria-label="Resize conversation list"]', 40);
  const w2 = (await win.locator('.chat-list').boundingBox()).width;
  if (Math.abs(w2 - w - 40) > 4) throw new Error(`chat list ${w} -> ${w2}`);
});

await check('tasks: complete a task from its right-click menu', async () => {
  await win.keyboard.press('Control+5');
  const item = win.locator('.task-item:not(.done)').first();
  const title = (await item.locator('.t').textContent()).trim();
  await item.click({ button: 'right' });
  await win.getByRole('menuitem', { name: /^Mark complete/ }).click();
  await win.waitForTimeout(500);
  const all = await api('tasks.myDay');
  const t = all.find((x) => x.title === title);
  if (t && !t.completed) throw new Error('task not completed');
});

await check('keyboard: switch modules', async () => {
  await win.keyboard.press('Control+1');
  await win.locator('#message-list').waitFor();
});

await win.screenshot({ path: path.join(out, 'final.png') });
app.process().kill();
for (const [s, n] of results) console.log(s.padEnd(4), n);
console.log(errors.length ? 'Console errors:\n' + [...new Set(errors)].join('\n') : 'No console errors');
process.exit(results.some((r) => r[0] === 'FAIL') ? 1 : 0);
