// Implements every method of the shared Api contract for the window.
import { app, BrowserWindow, dialog, ipcMain, shell, type IpcMainInvokeEvent } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import type { Api } from '../shared/api';
import type { QuickStep, SearchFolder, Template } from '../shared/types';
import { kvAll, kvDelete, kvSet, uid } from './db';
import { changed } from './events';
import { getOAuthClient, readClientFile, setOAuthClient } from './google/oauth';
import { getSettings, setSettings } from './settings';
import * as accounts from './services/accounts';
import * as mail from './services/mail';
import * as mailStore from './services/mailStore';
import * as calendar from './services/calendar';
import * as people from './services/people';
import * as tasks from './services/tasks';
import * as chat from './services/chat';
import * as ooo from './services/outOfOffice';
import { seedDemo } from './demo';
import { manualSync, syncAccount } from './sync';
import { openChildWindow, paramsFor, setTitleBarColour } from './windows';
import { updateBadge } from './tray';

const MIME: Record<string, string> = {
  pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', txt: 'text/plain', csv: 'text/csv',
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  zip: 'application/zip', ics: 'text/calendar', html: 'text/html', json: 'application/json'
};

type Ctx = { sender: Electron.WebContents };
type Impl = { [K in keyof Api]: (ctx: Ctx, ...args: Parameters<Api[K]>) => ReturnType<Api[K]> | Promise<Awaited<ReturnType<Api[K]>>> };

async function runQuickStep(stepId: string, accountId: string, ids: string[]): Promise<void> {
  const step = kvAll<QuickStep>('quicksteps').find((s) => s.id === stepId);
  if (!step) return;
  for (const a of step.actions) {
    switch (a.type) {
      case 'move': mail.move(accountId, ids, a.labelId, 'INBOX'); break;
      case 'label': mail.label(accountId, ids, [a.labelId], []); break;
      case 'markRead': mail.markRead(accountId, ids, true); break;
      case 'markUnread': mail.markRead(accountId, ids, false); break;
      case 'flag': await mail.flag(accountId, ids, true); break;
      case 'clearFlag': await mail.flag(accountId, ids, false); break;
      case 'archive': mail.archive(accountId, ids); break;
      case 'trash': mail.trash(accountId, ids); break;
      case 'task': for (const id of ids) await tasks.createTaskForMessage(accountId, id); break;
      case 'forward':
        for (const id of ids) {
          const d = await mail.prepareReply(accountId, id, 'forward');
          d.to = a.to.split(/[;,]/).map((e) => ({ email: e.trim() })).filter((x) => x.email);
          mail.send(d);
        }
        break;
      case 'reply':
        for (const id of ids) {
          const d = await mail.prepareReply(accountId, id, 'reply');
          const t = a.templateId ? kvAll<Template>('templates').find((x) => x.id === a.templateId) : undefined;
          if (t) {
            d.html = t.html + d.html;
            mail.send(d);
          } else openChildWindow('compose', { draft: JSON.stringify(d) });
        }
        break;
    }
  }
}

const impl: Impl = {
  'app.info': () => ({
    version: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    userDataPath: app.getPath('userData'),
    hasOAuthClient: !!getOAuthClient()
  }),
  'app.openExternal': (_c, url) => {
    if (/^(https?|mailto):/i.test(url)) void shell.openExternal(url);
  },
  'app.openWindow': (_c, kind, params) => openChildWindow(kind, params),
  'app.closeWindow': (c) => BrowserWindow.fromWebContents(c.sender)?.close(),
  'app.minimise': (c) => BrowserWindow.fromWebContents(c.sender)?.minimize(),
  'app.maximise': (c) => {
    const w = BrowserWindow.fromWebContents(c.sender);
    if (w) w.isMaximized() ? w.unmaximize() : w.maximize();
  },
  'app.windowParams': (c) => paramsFor(c.sender.id),
  'app.pickFiles': async (c) => {
    const win = BrowserWindow.fromWebContents(c.sender);
    const r = win ? await dialog.showOpenDialog(win, { properties: ['openFile', 'multiSelections'] }) : await dialog.showOpenDialog({ properties: ['openFile', 'multiSelections'] });
    if (r.canceled) return [];
    return r.filePaths.map((p) => ({
      filename: path.basename(p),
      path: p,
      size: fs.statSync(p).size,
      mimeType: MIME[path.extname(p).slice(1).toLowerCase()] ?? 'application/octet-stream'
    }));
  },

  'auth.getClient': () => {
    const c = getOAuthClient();
    return { clientId: c?.clientId ?? '', hasSecret: !!c?.clientSecret, source: c?.source ?? 'none' };
  },
  'auth.setClient': (_c, id, secret) => setOAuthClient(id, secret),
  'auth.loadClientFile': async (c) => {
    const win = BrowserWindow.fromWebContents(c.sender);
    const opts = { properties: ['openFile' as const], filters: [{ name: 'Google OAuth client', extensions: ['json'] }] };
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
    if (r.canceled || !r.filePaths[0]) return null;
    const parsed = readClientFile(r.filePaths[0]);
    if (!parsed) throw new Error("That file doesn't look like a Google OAuth client. Download it from Google Cloud › Credentials.");
    setOAuthClient(parsed.clientId, parsed.clientSecret);
    return { clientId: parsed.clientId };
  },
  'accounts.list': () => accounts.listAccounts(),
  'accounts.addGoogle': async () => {
    const a = await accounts.addGoogleAccount();
    void syncAccount(a.id, true);
    return a;
  },
  'accounts.addDemo': () => {
    const id = seedDemo();
    changed('accounts');
    changed('mail', id);
    changed('folders', id);
    updateBadge();
    return accounts.getAccount(id);
  },
  'accounts.remove': async (_c, id) => {
    await accounts.removeAccount(id);
    updateBadge();
  },
  'accounts.reauth': async (_c, id) => {
    const a = await accounts.reauthAccount(id);
    void syncAccount(id, true);
    return a;
  },
  'accounts.enableChat': async (_c, id) => {
    const a = await accounts.enableChat(id);
    void chat.syncChat(id, false).catch(() => undefined);
    return a;
  },
  'accounts.setColor': (_c, id, color) => accounts.setAccountColor(id, color),
  'sync.now': (_c, id) => {
    void manualSync(id);
  },

  'settings.get': () => getSettings(),
  'settings.set': (_c, patch) => {
    const s = setSettings(patch);
    if (patch.accent || patch.theme) setTitleBarColour(s.accent, s.theme === 'dark');
    if (patch.startWithWindows !== undefined && (process.platform === 'win32' || process.platform === 'darwin')) {
      app.setLoginItemSettings({ openAtLogin: patch.startWithWindows, args: ['--hidden'] });
    }
    if (patch.conversationView !== undefined || patch.focusedInbox !== undefined) changed('mail');
    return s;
  },

  'mail.folders': (_c, id) => mailStore.folders(id),
  'mail.list': (_c, q) => mailStore.list(q),
  'mail.count': (_c, q) => {
    const items = mailStore.list({ ...q, limit: 5000, offset: 0 });
    return { total: items.length, unread: items.filter((m) => m.unread).length };
  },
  'mail.get': (_c, a, id) => mail.getMessage(a, id),
  'mail.thread': (_c, a, t) => mail.getThread(a, t),
  'mail.loadRemoteImages': (_c, a, id, always) => {
    if (always) {
      const m = mailStore.getSummary(a, id);
      if (m) mail.trustSender(m.from.email);
    }
  },
  'mail.markRead': (_c, a, ids, read) => {
    mail.markRead(a, ids, read);
    updateBadge();
  },
  'mail.flag': (_c, a, ids, f, due) => mail.flag(a, ids, f, due),
  'mail.label': (_c, a, ids, add, remove) => mail.label(a, ids, add, remove),
  'mail.move': (_c, a, ids, to, from) => mail.move(a, ids, to, from),
  'mail.archive': (_c, a, ids) => mail.archive(a, ids),
  'mail.trash': (_c, a, ids) => mail.trash(a, ids),
  'mail.restore': (_c, a, ids) => mail.restore(a, ids),
  'mail.deleteForever': (_c, a, ids) => mail.deleteForever(a, ids),
  'mail.spam': (_c, a, ids, s) => mail.spam(a, ids, s),
  'mail.snooze': (_c, a, ids, until) => mail.snooze(a, ids, until),
  'mail.unsnooze': (_c, a, ids) => mail.unsnooze(a, ids),
  'mail.send': (_c, d) => mail.send(d),
  'mail.cancelSend': (_c, id) => mail.cancelSend(id),
  'mail.outbox': () => mail.outbox(),
  'mail.saveDraft': (_c, d) => mail.saveDraft(d),
  'mail.discardDraft': (_c, d) => mail.discardDraft(d),
  'mail.openDraft': (_c, a, id) => mail.openDraft(a, id),
  'mail.prepareReply': (_c, a, id, mode) => mail.prepareReply(a, id, mode),
  'mail.newDraft': (_c, a, to) => mail.newDraft(a, to),
  'mail.openAttachment': (_c, a, m, att, f) => mail.openAttachment(a, m, att, f),
  'mail.saveAttachment': (_c, a, m, att, f) => mail.saveAttachment(a, m, att, f),
  'mail.createFolder': (_c, a, p) => mail.createFolder(a, p),
  'mail.renameFolder': (_c, a, id, p) => mail.renameFolder(a, id, p),
  'mail.deleteFolder': (_c, a, id) => mail.deleteFolder(a, id),
  'mail.setCategory': (_c, a, id, is, color) => mail.setCategory(a, id, is, color),
  'mail.serverSearch': (_c, a, q) => mail.serverSearch(a, q),
  'mail.print': (_c, a, id) => mail.print(a, id),
  'mail.savePdf': (_c, a, id) => mail.savePdf(a, id),
  'mail.emptyFolder': (_c, a, l) => mail.emptyFolder(a, l),

  'rules.list': (_c, a) => mail.listRules(a),
  'rules.save': (_c, r) => mail.saveRule(r),
  'rules.delete': (_c, a, id) => mail.deleteRule(a, id),
  'quicksteps.list': () => kvAll<QuickStep>('quicksteps'),
  'quicksteps.save': (_c, s) => {
    const step = { ...s, id: s.id || uid() };
    kvSet('quicksteps', step.id, step);
    changed('settings');
    return step;
  },
  'quicksteps.delete': (_c, id) => {
    kvDelete('quicksteps', id);
    changed('settings');
  },
  'quicksteps.run': (_c, id, a, ids) => runQuickStep(id, a, ids),
  'templates.list': () => kvAll<Template>('templates'),
  'templates.save': (_c, t) => {
    const tpl = { ...t, id: t.id || uid() };
    kvSet('templates', tpl.id, tpl);
    changed('settings');
    return tpl;
  },
  'templates.delete': (_c, id) => {
    kvDelete('templates', id);
    changed('settings');
  },
  'searchFolders.list': () => kvAll<SearchFolder>('searchFolders'),
  'searchFolders.save': (_c, f) => {
    const sf = { ...f, id: f.id || uid() };
    kvSet('searchFolders', sf.id, sf);
    changed('folders');
    return sf;
  },
  'searchFolders.delete': (_c, id) => {
    kvDelete('searchFolders', id);
    changed('folders');
  },
  'gmail.sendAs': (_c, a) => mail.sendAsList(a),
  'gmail.setSignature': (_c, a, e, h) => mail.setSignature(a, e, h),
  'gmail.vacation': (_c, a) => ooo.get(a),
  'gmail.setVacation': (_c, a, v) => ooo.set(a, v),

  'calendar.calendars': () => calendar.calendars(),
  'calendar.setSelected': (_c, a, id, s) => calendar.setSelected(a, id, s),
  'calendar.subscribe': (_c, a, e) => calendar.subscribe(a, e),
  'calendar.events': (_c, s, e) => calendar.events(s, e),
  'calendar.get': (_c, a, c, id) => calendar.getEvent(a, c, id),
  'calendar.save': (_c, s) => ooo.saveEvent(s),
  'calendar.delete': (_c, a, c, id, scope) => ooo.deleteEvent(a, c, id, scope),
  'calendar.isAutoReplyLinked': (_c, a, c, id) => ooo.isLinked(a, c, id),
  'calendar.respond': (_c, a, c, id, r) => calendar.respond(a, c, id, r),
  'calendar.freeBusy': (_c, a, emails, s, e) => calendar.freeBusy(a, emails, s, e),
  'calendar.rooms': (_c, a) => calendar.rooms(a),
  'calendar.fromMessage': (_c, a, id) => calendar.fromMessage(a, id),

  'people.list': (_c, a, g) => people.list(a, g),
  'people.search': (_c, q, l) => people.search(q, l),
  'people.directory': (_c, a, q) => people.directory(a, q),
  'people.directoryList': (_c, a) => people.directoryList(a),
  'people.directoryStatus': (_c, a) => people.directoryStatus(a),
  'people.syncDirectory': (_c, a) => people.syncDirectory(a, true),
  'people.groups': (_c, a) => people.groups(a),
  'people.save': (_c, c) => people.save(c),
  'people.delete': (_c, a, id) => people.remove(a, id),
  'people.createGroup': (_c, a, n) => people.createGroup(a, n),

  'tasks.lists': () => tasks.lists(),
  'tasks.list': (_c, a, l, s) => tasks.list(a, l, s),
  'tasks.myDay': () => tasks.myDay(),
  'tasks.save': (_c, t) => tasks.save(t),
  'tasks.delete': (_c, a, l, id) => tasks.remove(a, l, id),
  'tasks.createList': (_c, a, t) => tasks.createList(a, t),

  'chat.spaces': (_c, a) => chat.spaces(a),
  'chat.messages': (_c, a, s) => chat.messages(a, s),
  'chat.thread': (_c, a, s, t) => chat.thread(a, s, t),
  'chat.send': (_c, a, s, text, t) => chat.send(a, s, text, t),
  'chat.react': (_c, a, s, m, e) => chat.react(a, s, m, e),
  'chat.markRead': (_c, a, s) => chat.markRead(a, s),
  'chat.refresh': (_c, a, s) => chat.refresh(a, s),
  'chat.openInBrowser': (_c, a, s) => chat.openInBrowser(a, s)
};

export function registerIpc(): void {
  ipcMain.handle('api', async (event: IpcMainInvokeEvent, method: keyof Api, args: unknown[]) => {
    const fn = impl[method] as ((ctx: Ctx, ...a: unknown[]) => unknown) | undefined;
    if (!fn) throw new Error('Unknown method ' + method);
    try {
      return { ok: true, value: await fn({ sender: event.sender }, ...args) };
    } catch (e) {
      console.error(`[ipc] ${method} failed:`, e);
      return { ok: false, error: (e as Error).message || String(e) };
    }
  });
}
