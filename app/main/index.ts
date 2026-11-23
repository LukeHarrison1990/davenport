// Davenport — background engine entry point.
import { app, BrowserWindow, session, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { openDatabase } from './db';
import { registerIpc } from './ipc';
import { buildMenu, createMainWindow, focusMain, getMainWindow, openChildWindow, setQuitting, setTitleBarColour } from './windows';
import { createTray } from './tray';
import { manualSync, startScheduler, stopScheduler } from './sync';
import { getSettings } from './settings';
import { listAccounts } from './services/accounts';
import { newDraft } from './services/mail';
import { emit } from './events';
import { parseMailto, type MailtoParts } from './mailto';
import { startUpdateChecks } from './updater';

// Test-only switches (used by the automated checks); the installed app ignores them.
if (!app.isPackaged) {
  if (process.env.DAVENPORT_NO_SANDBOX) app.commandLine.appendSwitch('no-sandbox');
  if (process.env.DAVENPORT_USER_DATA) app.setPath('userData', process.env.DAVENPORT_USER_DATA);
}

// Defence in depth for every web page Davenport ever creates.
app.on('web-contents-created', (_e, contents) => {
  contents.on('will-attach-webview', (ev) => ev.preventDefault());
  contents.setWindowOpenHandler(({ url }) => {
    if (/^(https?|mailto):/i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
});

app.setAppUserModelId('app.davenport.desktop');

// Log unexpected engine errors instead of letting Electron show a blocking error dialog.
const logError = (kind: string, e: unknown) => {
  try {
    const line = `[${new Date().toISOString()}] ${kind}: ${(e as Error)?.stack ?? String(e)}\n`;
    fs.appendFileSync(path.join(app.getPath('userData'), 'davenport-errors.log'), line);
  } catch {
    /* nowhere to log */
  }
  console.error(kind, e);
};
process.on('uncaughtException', (e) => logError('uncaughtException', e));
process.on('unhandledRejection', (e) => logError('unhandledRejection', e));

// One Davenport at a time; a second launch (or a mailto: link) focuses the first.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    focusMain();
    const mailto = argv.find((a) => a.startsWith('mailto:'));
    if (mailto) void openMailto(mailto);
  });

  app.whenReady().then(async () => {
    // Pages get no camera, microphone, location or similar access; notifications and copying to the clipboard only.
    const allowed = new Set(['notifications', 'clipboard-sanitized-write']);
    session.defaultSession.setPermissionRequestHandler((_wc, permission, done) => done(allowed.has(permission)));
    session.defaultSession.setPermissionCheckHandler((_wc, permission) => allowed.has(permission));
    openDatabase(app.getPath('userData'));
    registerIpc();
    buildMenu();
    createMainWindow();
    const s = getSettings();
    setTitleBarColour(s.accent, s.theme === 'dark');
    createTray(
      () => void manualSync(),
      () => void openNewMail()
    );
    startScheduler();
    startUpdateChecks();
    if (process.platform === 'win32') app.setAsDefaultProtocolClient('mailto');
    const mailto = process.argv.find((a) => a.startsWith('mailto:'));
    if (mailto) void openMailto(mailto);
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
    else focusMain();
  });
  app.on('open-url', (e, url) => {
    e.preventDefault();
    if (url.startsWith('mailto:')) void openMailto(url);
  });
  app.on('before-quit', () => {
    setQuitting();
    stopScheduler();
  });
  app.on('window-all-closed', () => {
    if (process.platform === 'darwin') return;
    if (!getSettings().closeToTray) app.quit();
  });
}

async function openNewMail(m: MailtoParts = { to: [], cc: [], bcc: [] }): Promise<void> {
  const acc = listAccounts()[0];
  if (!acc) {
    focusMain();
    return;
  }
  const d = await newDraft(acc.id);
  d.to = m.to.map((email) => ({ email }));
  d.cc = m.cc.map((email) => ({ email }));
  d.bcc = m.bcc.map((email) => ({ email }));
  if (m.subject) d.subject = m.subject;
  if (m.body) d.html = `<p>${m.body.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\r?\n/g, '<br>')}</p>` + d.html;
  openChildWindow('compose', { draft: JSON.stringify(d) });
}

async function openMailto(url: string): Promise<void> {
  try {
    await openNewMail(parseMailto(url));
  } catch {
    focusMain();
  }
}

export { emit, getMainWindow };
