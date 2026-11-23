// Mail: syncing with Gmail and every action the interface can take on messages.
import { app, BrowserWindow, dialog, session, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { Addr, Draft, Folder, MessageDetail, OutboxItem, Rule, SendAs, Vacation } from '../../shared/types';
import { all, get, kvAll, kvDelete, kvGet, kvSet, run, tx, uid } from '../db';
import { changed, emit, toast } from '../events';
import { Gmail, ruleToQuery, type GFilter, type ParsedMessage } from '../google/gmail';
import { GoogleApiError, QuotaExceeded, ReauthRequired } from '../google/http';
import { buildMime, cleanEmail, htmlToText, type MimeAttachment } from '../google/mime';
import { getSettings } from '../settings';
import { client, getAccount, isDemo, listAccounts, reauthAccount, setStatus } from './accounts';
import { FULL_MAIL_SCOPE } from '../google/oauth';
import { enqueue, registerOp, setPermanentFailureHook } from './ops';
import * as store from './mailStore';
import { notifyNewMail } from './notify';
import { createTaskForMessage, completeTaskForMessage } from './tasks';
import { uploadToDrive } from '../google/drive';
import { isBlockedType, markFromInternet } from './attachmentSafety';

const gmail = (accountId: string) => new Gmail(client(accountId));

const settingsExpand = (accountId: string, ids: string[]): string[] => {
  if (!getSettings().conversationView) return ids;
  const out = new Set<string>();
  for (const id of ids) {
    const row = store.getRow(accountId, id);
    if (!row) continue;
    for (const t of store.threadIds(accountId, row.thread_id)) out.add(t);
  }
  return [...out];
};

// ---------- Remote operations (replayed by the offline queue) ----------

registerOp('modify', async (accountId, p: { ids: string[]; add: string[]; remove: string[] }) => {
  for (let i = 0; i < p.ids.length; i += 1000) await gmail(accountId).batchModify(p.ids.slice(i, i + 1000), p.add, p.remove);
});
registerOp('trash', async (accountId, p: { ids: string[] }) => gmail(accountId).trash(p.ids));
registerOp('untrash', async (accountId, p: { ids: string[] }) => gmail(accountId).untrash(p.ids));
registerOp('deleteForever', async (accountId, p: { ids: string[] }) => {
  for (let i = 0; i < p.ids.length; i += 1000) await gmail(accountId).batchDelete(p.ids.slice(i, i + 1000));
});

function modify(accountId: string, ids: string[], add: string[], remove: string[]): void {
  const changedIds = store.modifyLocal(accountId, ids, add, remove);
  if (changedIds.length) enqueue(accountId, 'modify', { ids: changedIds, add, remove });
  changed('mail', accountId);
  changed('folders', accountId);
}

// ---------- Labels ----------

export async function syncLabels(accountId: string): Promise<void> {
  const labels = await gmail(accountId).labels();
  const existing = new Map(store.labelRows(accountId).map((l) => [l.id, l]));
  tx(() => {
    for (const l of labels) {
      const prev = existing.get(l.id);
      const leaf = l.name.split('/').pop() ?? l.name;
      run(
        `INSERT INTO labels (account_id, id, name, path, type, color, is_category, hidden) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(account_id, id) DO UPDATE SET name = excluded.name, path = excluded.path, type = excluded.type,
         color = COALESCE(labels.color, excluded.color)`,
        accountId, l.id, leaf, l.name, l.type, prev?.color ?? l.color?.backgroundColor ?? null, prev?.is_category ?? 0,
        l.labelListVisibility === 'labelHide' ? 1 : 0
      );
      existing.delete(l.id);
    }
    for (const gone of existing.keys()) run('DELETE FROM labels WHERE account_id = ? AND id = ?', accountId, gone);
  });
  changed('folders', accountId);
}

async function ensureSnoozeLabel(accountId: string): Promise<string> {
  const id = store.snoozeLabelId(accountId);
  if (id) return id;
  if (isDemo(accountId)) {
    run("INSERT INTO labels (account_id, id, name, path, type) VALUES (?, 'Label_snoozed', 'Snoozed', ?, 'user')", accountId, store.SNOOZE_LABEL_NAME);
    return 'Label_snoozed';
  }
  let label;
  try {
    label = await gmail(accountId).createLabel(store.SNOOZE_LABEL_NAME);
  } catch (e) {
    if (e instanceof GoogleApiError && e.status === 409) {
      await syncLabels(accountId);
      return store.snoozeLabelId(accountId)!;
    }
    throw e;
  }
  run("INSERT INTO labels (account_id, id, name, path, type) VALUES (?, ?, 'Snoozed', ?, 'user')", accountId, label.id, store.SNOOZE_LABEL_NAME);
  return label.id;
}

// ---------- Sync ----------

const syncing = new Set<string>();

export async function syncMail(accountId: string): Promise<void> {
  if (isDemo(accountId) || syncing.has(accountId)) return;
  syncing.add(accountId);
  try {
    const acc = get<{ history_id: string | null; initial_done: number }>('SELECT history_id, initial_done FROM accounts WHERE id = ?', accountId);
    if (!acc?.initial_done || !acc.history_id) await initialSync(accountId);
    else await incrementalSync(accountId, acc.history_id);
    run('UPDATE accounts SET last_sync = ? WHERE id = ?', Date.now(), accountId);
    setStatus(accountId, 'ok');
  } catch (e) {
    if (e instanceof ReauthRequired) setStatus(accountId, 'reauth', e.message);
    else if (e instanceof QuotaExceeded) setStatus(accountId, 'syncing', 'Pausing for Google’s rate limit — continuing shortly');
    else if (e instanceof TypeError) setStatus(accountId, 'offline', 'No connection');
    else setStatus(accountId, 'error', (e as Error).message);
    throw e;
  } finally {
    syncing.delete(accountId);
  }
}

/**
 * Downloads the mailbox. With refresh = true (after being offline so long that Gmail's change history has
 * expired, or after more changes than can be read at once) it also updates every cached message and removes
 * the ones that were deleted, instead of only adding what's new.
 */
async function initialSync(accountId: string, refresh = false): Promise<void> {
  setStatus(accountId, 'syncing', refresh ? 'Catching up with changes' : 'Downloading mail');
  const g = gmail(accountId);
  const profile = await g.profile();
  await syncLabels(accountId);
  const days = getSettings().syncDays;

  // Inbox first so the window is useful within seconds, then everything else in the sync window.
  // Anything already downloaded by an earlier, interrupted attempt is skipped, so a restart resumes.
  const cached = all<{ id: string; date: number }>('SELECT id, date FROM messages WHERE account_id = ?', accountId);
  const have = new Set(refresh ? [] : cached.map((r) => r.id));
  const inboxIds = await g.listIds(undefined, ['INBOX'], 300);
  const inbox = inboxIds.map((m) => m.id).filter((id) => !have.has(id));
  for (let i = 0; i < inbox.length; i += 50) {
    await fetchAndStore(accountId, inbox.slice(i, i + 50));
    inbox.slice(i, i + 50).forEach((id) => have.add(id));
    changed('mail', accountId);
  }

  const rest = await g.listIds(`newer_than:${days}d`, undefined, 20000, true);
  const drafts = await g.listIds(undefined, ['DRAFT'], 500);
  const todo = [...new Set([...rest, ...drafts].map((m) => m.id))].filter((id) => !have.has(id));
  for (let i = 0; i < todo.length; i += 100) {
    await fetchAndStore(accountId, todo.slice(i, i + 100));
    setStatus(accountId, 'syncing', `${refresh ? 'Catching up' : 'Downloading mail'} (${Math.min(i + 100, todo.length).toLocaleString()} of ${todo.length.toLocaleString()})`);
    changed('mail', accountId);
  }
  if (refresh) {
    // Cached messages from inside the sync window that Gmail no longer lists were deleted while we were away.
    const onServer = new Set([...inboxIds, ...rest, ...drafts].map((m) => m.id));
    const windowStart = Date.now() - days * 864e5;
    const queued = new Set(
      all<{ payload: string }>('SELECT payload FROM pending_ops WHERE account_id = ?', accountId).flatMap((r) => (JSON.parse(r.payload).ids as string[] | undefined) ?? [])
    );
    const gone = cached.filter((m) => m.date >= windowStart && !onServer.has(m.id) && !queued.has(m.id)).map((m) => m.id);
    if (gone.length) store.deleteLocal(accountId, gone);
  }
  run('UPDATE accounts SET history_id = ?, initial_done = 1 WHERE id = ?', profile.historyId, accountId);
  changed('mail', accountId);
  changed('folders', accountId);
}

async function fetchAndStore(accountId: string, ids: string[]): Promise<ParsedMessage[]> {
  if (!ids.length) return [];
  const msgs = await gmail(accountId).metadata(ids);
  tx(() => msgs.forEach((m) => store.upsertMessage(accountId, m)));
  return msgs;
}

async function incrementalSync(accountId: string, historyId: string): Promise<void> {
  const g = gmail(accountId);
  let res;
  try {
    res = await g.history(historyId);
  } catch (e) {
    if (e instanceof GoogleApiError && e.status === 404) {
      // History has expired (about a week offline): refresh everything, including what changed while away.
      return initialSync(accountId, true);
    }
    throw e;
  }
  if (res.truncated) return initialSync(accountId, true);
  if (!res.changes.length) {
    run('UPDATE accounts SET history_id = ? WHERE id = ?', res.historyId, accountId);
    return;
  }
  const added = new Set<string>();
  const deleted = new Set<string>();
  const relabel = new Map<string, string[] | null>();
  let labelsChanged = false;
  for (const h of res.changes) {
    for (const a of h.messagesAdded ?? []) added.add(a.message.id);
    for (const d of h.messagesDeleted ?? []) deleted.add(d.message.id);
    for (const l of [...(h.labelsAdded ?? []), ...(h.labelsRemoved ?? [])]) {
      relabel.set(l.message.id, l.message.labelIds ?? null);
      if (l.labelIds.some((x) => x.startsWith('Label_'))) labelsChanged = true;
    }
  }
  for (const d of deleted) {
    added.delete(d);
    relabel.delete(d);
  }
  if (labelsChanged) await syncLabels(accountId);
  store.deleteLocal(accountId, [...deleted]);

  const pendingIds = new Set(
    all<{ payload: string }>("SELECT payload FROM pending_ops WHERE account_id = ? AND kind IN ('modify','trash','untrash')", accountId)
      .flatMap((r) => (JSON.parse(r.payload).ids as string[]))
  );
  const needFetch: string[] = [...added];
  tx(() => {
    for (const [id, labels] of relabel) {
      if (added.has(id) || pendingIds.has(id)) continue; // our own queued change wins until it reaches Google
      if (labels && store.getRow(accountId, id)) store.setLabels(accountId, id, labels);
      else needFetch.push(id);
    }
  });
  const before = new Set(all<{ id: string }>('SELECT id FROM messages WHERE account_id = ?', accountId).map((r) => r.id));
  const fetched = await fetchAndStore(accountId, needFetch);
  run('UPDATE accounts SET history_id = ? WHERE id = ?', res.historyId, accountId);

  const fresh = fetched.filter((m) => !before.has(m.id) && m.labelIds.includes('INBOX') && m.labelIds.includes('UNREAD'));
  if (fresh.length) {
    await applyLocalRules(accountId, fresh);
    const stillInbox = fresh.filter((m) => store.getLabels(accountId, m.id).includes('INBOX'));
    try {
      notifyNewMail(accountId, stillInbox);
    } catch (e) {
      console.warn('[mail] notification failed', e);
    }
  }
  changed('mail', accountId);
  changed('folders', accountId);
}

// When Google refuses a queued change for good, re-read those messages so the local copy matches Gmail again.
setPermanentFailureHook(async (accountId, _kind, payload: { ids?: string[] }) => {
  const ids = (payload?.ids ?? []).filter((id) => store.getRow(accountId, id));
  if (!ids.length || isDemo(accountId)) return;
  let found: ParsedMessage[];
  try {
    found = await fetchAndStore(accountId, ids);
  } catch {
    return; // offline or similar: the next sync will catch up
  }
  // Gmail only leaves out messages that no longer exist.
  const gone = ids.filter((id) => !found.some((m) => m.id === id));
  if (gone.length) store.deleteLocal(accountId, gone);
  changed('mail', accountId);
  changed('folders', accountId);
});

// ---------- Reading ----------

export async function getMessage(accountId: string, id: string): Promise<MessageDetail> {
  if (!store.bodyFetched(accountId, id) && !isDemo(accountId)) {
    const full = await gmail(accountId).full(id);
    full.html = await resolveInlineImages(accountId, id, full);
    store.upsertMessage(accountId, full);
  }
  const d = store.getDetail(accountId, id);
  if (!d) throw new Error('Message not found');
  return { ...d, remoteImagesAllowed: remoteImagesAllowed(d.from.email) };
}

async function resolveInlineImages(accountId: string, id: string, p: ParsedMessage): Promise<string | undefined> {
  if (!p.html || !/cid:/i.test(p.html)) return p.html;
  let html = p.html;
  let budget = 8 * 1024 * 1024;
  for (const a of p.attachments) {
    if (!a.contentId || !html.includes('cid:' + a.contentId) || a.size > budget) continue;
    try {
      const inline = (a as typeof a & { inlineData?: string }).inlineData;
      const buf = inline ? Buffer.from(inline.replace(/-/g, '+').replace(/_/g, '/'), 'base64') : await gmail(accountId).attachment(id, a.id);
      budget -= buf.length;
      html = html.split('cid:' + a.contentId).join(`data:${a.mimeType};base64,${buf.toString('base64')}`);
    } catch {
      /* leave the image missing */
    }
  }
  return html;
}

export async function getThread(accountId: string, threadId: string): Promise<MessageDetail[]> {
  const ids = store.threadMessages(accountId, threadId);
  const out: MessageDetail[] = [];
  for (const id of ids) out.push(await getMessage(accountId, id));
  return out;
}

export function trustSender(email: string): void {
  const list = kvGet<string[]>('mail', 'trustedSenders') ?? [];
  if (!list.includes(email.toLowerCase())) kvSet('mail', 'trustedSenders', [...list, email.toLowerCase()]);
}
export function trustedSenders(): string[] {
  return kvGet<string[]>('mail', 'trustedSenders') ?? [];
}

// ---------- Actions ----------

export function markRead(accountId: string, ids: string[], read: boolean): void {
  const all = settingsExpand(accountId, ids);
  read ? modify(accountId, all, [], ['UNREAD']) : modify(accountId, ids, ['UNREAD'], []);
}

export async function flag(accountId: string, ids: string[], flagged: boolean, due?: number | null): Promise<void> {
  if (flagged) {
    modify(accountId, ids, ['STARRED'], []);
    for (const id of ids) {
      run('UPDATE messages SET flag_due = ? WHERE account_id = ? AND id = ?', due ?? null, accountId, id);
      try {
        await createTaskForMessage(accountId, id, due ?? undefined);
      } catch (e) {
        toast({ kind: 'error', text: 'Flagged, but the follow-up task could not be created: ' + (e as Error).message });
      }
    }
  } else {
    const expanded = settingsExpand(accountId, ids);
    modify(accountId, expanded, [], ['STARRED']);
    for (const id of expanded) {
      run('UPDATE messages SET flag_due = NULL WHERE account_id = ? AND id = ?', accountId, id);
      await completeTaskForMessage(accountId, id).catch(() => undefined);
    }
  }
}

export function label(accountId: string, ids: string[], add: string[], remove: string[]): void {
  modify(accountId, settingsExpand(accountId, ids), add, remove);
}

export function move(accountId: string, ids: string[], to: string, from?: string): void {
  const expanded = settingsExpand(accountId, ids);
  if (to === 'TRASH') return trash(accountId, expanded);
  if (to === 'SPAM') return modify(accountId, expanded, ['SPAM'], ['INBOX']);
  const remove = from && !['ALL', 'STARRED', 'SNOOZED', 'SENT', 'DRAFT', 'SEARCH'].includes(from) ? [from] : ['INBOX'];
  if (from === 'TRASH') {
    store.modifyLocal(accountId, expanded, [], ['TRASH']);
    enqueue(accountId, 'untrash', { ids: expanded });
  }
  if (to === 'INBOX') {
    // Into the Inbox means where the user will see it: Primary, not the Other tab.
    modify(accountId, expanded, ['INBOX', 'CATEGORY_PERSONAL'], [...remove.filter((r) => r !== to), ...store.OTHER_CATEGORIES_ALL]);
    return;
  }
  modify(accountId, expanded, to === 'ALL' ? [] : [to], remove.filter((r) => r !== to));
}

/** The Inbox's Primary and Other tabs: Gmail's categories, which also teach Gmail where similar mail should go. */
export function moveToTab(accountId: string, ids: string[], tab: 'primary' | 'other'): void {
  const expanded = settingsExpand(accountId, ids);
  if (tab === 'primary') modify(accountId, expanded, ['CATEGORY_PERSONAL'], store.OTHER_CATEGORIES_ALL);
  else modify(accountId, expanded, ['CATEGORY_PROMOTIONS'], ['CATEGORY_PERSONAL', 'CATEGORY_SOCIAL', 'CATEGORY_UPDATES', 'CATEGORY_FORUMS']);
}

export function archive(accountId: string, ids: string[]): void {
  modify(accountId, settingsExpand(accountId, ids), [], ['INBOX']);
}

export function trash(accountId: string, ids: string[]): void {
  const expanded = settingsExpand(accountId, ids);
  store.modifyLocal(accountId, expanded, ['TRASH'], ['INBOX', 'UNREAD']);
  enqueue(accountId, 'trash', { ids: expanded });
  changed('mail', accountId);
  changed('folders', accountId);
}

/**
 * Accounts signed in before 1.0.19 only granted gmail.modify, which can't permanently delete. Ask them to sign in
 * again once to grant full mailbox access; returns false if they'd rather not (nothing is deleted).
 */
async function ensureFullAccess(accountId: string): Promise<boolean> {
  if (isDemo(accountId) || client(accountId).hasScope(FULL_MAIL_SCOPE)) return true;
  const opts = {
    type: 'info' as const,
    title: 'Davenport',
    message: 'Sign in again to permanently delete mail',
    detail:
      `To permanently delete messages, Davenport needs full access to the mailbox for ${getAccount(accountId).email}. ` +
      'Sign in again and allow it; you only need to do this once.\n\nUntil then, messages stay in the Bin, and Gmail removes them after 30 days.',
    buttons: ['Sign in', 'Cancel'],
    defaultId: 0,
    cancelId: 1,
    noLink: true
  };
  const win = BrowserWindow.getFocusedWindow();
  const { response } = win ? await dialog.showMessageBox(win, opts) : await dialog.showMessageBox(opts);
  if (response !== 0) return false;
  await reauthAccount(accountId);
  if (client(accountId).hasScope(FULL_MAIL_SCOPE)) return true;
  throw new Error('Full mailbox access wasn\'t allowed, so nothing was deleted. Tick every box on Google\'s sign-in page and try again.');
}

/** Permanently deletes messages (Delete inside the Bin). */
export async function deleteForever(accountId: string, ids: string[]): Promise<void> {
  if (!(await ensureFullAccess(accountId))) return;
  const expanded = settingsExpand(accountId, ids).filter((id) => store.getLabels(accountId, id).includes('TRASH'));
  const target = expanded.length ? expanded : ids;
  store.deleteLocal(accountId, target);
  enqueue(accountId, 'deleteForever', { ids: target });
  changed('mail', accountId);
  changed('folders', accountId);
}

export function restore(accountId: string, ids: string[]): void {
  const expanded = settingsExpand(accountId, ids);
  const userLabels = new Set(store.labelRows(accountId).filter((l) => l.type === 'user').map((l) => l.id));
  const backToInbox = expanded.filter((id) => !store.getLabels(accountId, id).some((l) => userLabels.has(l) || l === 'SENT' || l === 'DRAFT'));
  store.modifyLocal(accountId, expanded, [], ['TRASH']);
  store.modifyLocal(accountId, backToInbox, ['INBOX'], []);
  enqueue(accountId, 'untrash', { ids: expanded });
  if (backToInbox.length) enqueue(accountId, 'modify', { ids: backToInbox, add: ['INBOX'], remove: [] });
  changed('mail', accountId);
  changed('folders', accountId);
}

export function spam(accountId: string, ids: string[], isSpam: boolean): void {
  const expanded = settingsExpand(accountId, ids);
  isSpam ? modify(accountId, expanded, ['SPAM'], ['INBOX']) : modify(accountId, expanded, ['INBOX'], ['SPAM']);
}

export async function emptyFolder(accountId: string, labelId: 'TRASH' | 'SPAM'): Promise<void> {
  if (!(await ensureFullAccess(accountId))) return;
  const ids = all<{ message_id: string }>('SELECT message_id FROM message_labels WHERE account_id = ? AND label_id = ?', accountId, labelId).map(
    (r) => r.message_id
  );
  store.deleteLocal(accountId, ids);
  if (ids.length) enqueue(accountId, 'deleteForever', { ids });
  changed('mail', accountId);
  changed('folders', accountId);
}

export async function snooze(accountId: string, ids: string[], until: number): Promise<void> {
  const labelId = await ensureSnoozeLabel(accountId);
  const expanded = settingsExpand(accountId, ids);
  for (const id of expanded) run('UPDATE messages SET snooze_until = ? WHERE account_id = ? AND id = ?', until, accountId, id);
  modify(accountId, expanded, [labelId], ['INBOX']);
}

export function unsnooze(accountId: string, ids: string[], notify = false): void {
  const labelId = store.snoozeLabelId(accountId);
  const expanded = settingsExpand(accountId, ids);
  for (const id of expanded) run('UPDATE messages SET snooze_until = NULL, date = MAX(date, ?) WHERE account_id = ? AND id = ?', notify ? Date.now() : 0, accountId, id);
  modify(accountId, expanded, ['INBOX', ...(notify ? ['UNREAD'] : [])], labelId ? [labelId] : []);
  if (notify) {
    const msgs = expanded.map((id) => store.getSummary(accountId, id)).filter(Boolean);
    if (msgs.length) notifyNewMail(accountId, msgs.map((m) => ({ id: m!.id, threadId: m!.threadId, from: m!.from, subject: m!.subject, snippet: 'Snoozed message is back' })), 'Back from snooze');
  }
}

export function checkSnoozes(): void {
  const due = all<{ account_id: string; id: string }>('SELECT account_id, id FROM messages WHERE snooze_until IS NOT NULL AND snooze_until <= ?', Date.now());
  const byAccount = new Map<string, string[]>();
  for (const d of due) byAccount.set(d.account_id, [...(byAccount.get(d.account_id) ?? []), d.id]);
  for (const [acc, ids] of byAccount) unsnooze(acc, ids, true);
}

// ---------- Folders ----------

export async function createFolder(accountId: string, pathName: string): Promise<Folder> {
  const clean = pathName.split('/').map((s) => s.trim()).filter(Boolean).join('/');
  let id = 'Label_' + uid();
  if (!isDemo(accountId)) id = (await gmail(accountId).createLabel(clean)).id;
  run("INSERT OR REPLACE INTO labels (account_id, id, name, path, type) VALUES (?, ?, ?, ?, 'user')", accountId, id, clean.split('/').pop(), clean);
  changed('folders', accountId);
  return store.folders(accountId).find((f) => f.id === id)!;
}

export async function renameFolder(accountId: string, labelId: string, newPath: string): Promise<void> {
  const row = store.labelRows(accountId).find((l) => l.id === labelId);
  if (!row) return;
  const oldPath = row.path;
  const affected = store.labelRows(accountId).filter((l) => l.path === oldPath || l.path.startsWith(oldPath + '/'));
  for (const l of affected) {
    const p = newPath + l.path.slice(oldPath.length);
    if (!isDemo(accountId)) await gmail(accountId).updateLabel(l.id, { name: p });
    run('UPDATE labels SET path = ?, name = ? WHERE account_id = ? AND id = ?', p, p.split('/').pop(), accountId, l.id);
  }
  changed('folders', accountId);
  changed('mail', accountId);
}

export async function deleteFolder(accountId: string, labelId: string): Promise<void> {
  const row = store.labelRows(accountId).find((l) => l.id === labelId);
  if (!row) return;
  const affected = store.labelRows(accountId).filter((l) => l.path === row.path || l.path.startsWith(row.path + '/'));
  for (const l of affected) {
    if (!isDemo(accountId)) {
      // Already gone from Gmail is fine; any other failure stops here so the folder doesn't vanish and come back.
      await gmail(accountId).deleteLabel(l.id).catch((e) => {
        if (!(e instanceof GoogleApiError && e.status === 404)) throw e;
      });
    }
    run('DELETE FROM labels WHERE account_id = ? AND id = ?', accountId, l.id);
    run('DELETE FROM message_labels WHERE account_id = ? AND label_id = ?', accountId, l.id);
    for (const m of all<{ id: string; labels: string }>('SELECT id, labels FROM messages WHERE account_id = ? AND labels LIKE ?', accountId, `%"${l.id}"%`)) {
      run('UPDATE messages SET labels = ? WHERE account_id = ? AND id = ?', JSON.stringify((JSON.parse(m.labels) as string[]).filter((x) => x !== l.id)), accountId, m.id);
    }
  }
  changed('folders', accountId);
  changed('mail', accountId);
}

export function setCategory(accountId: string, labelId: string, isCategory: boolean, color?: string): void {
  run('UPDATE labels SET is_category = ?, color = COALESCE(?, color) WHERE account_id = ? AND id = ?', isCategory, color ?? null, accountId, labelId);
  changed('folders', accountId);
  changed('mail', accountId);
}

export async function serverSearch(accountId: string, q: string) {
  if (isDemo(accountId)) return store.list({ accountId, folder: { type: 'search', q }, limit: 200 });
  const ids = await gmail(accountId).listIds(q, undefined, 200, /in:(trash|spam)/.test(q));
  const missing = ids.map((m) => m.id).filter((id) => !store.getRow(accountId, id));
  await fetchAndStore(accountId, missing);
  return ids.map((m) => store.getSummary(accountId, m.id)).filter((x): x is NonNullable<typeof x> => !!x);
}

// ---------- Composing and sending ----------

export function myAddresses(): Set<string> {
  const set = new Set(listAccounts().map((a) => a.email.toLowerCase()));
  for (const a of listAccounts()) for (const s of kvGet<SendAs[]>('sendAs', a.id) ?? []) set.add(s.email.toLowerCase());
  return set;
}

async function sendAsList(accountId: string): Promise<SendAs[]> {
  if (isDemo(accountId)) {
    const a = getAccount(accountId);
    const saved = kvGet<SendAs[]>('sendAs', accountId);
    return saved ?? [{ email: a.email, displayName: 'Alex Morgan', signature: '<div>Alex Morgan<br>Operations Manager · Northfield</div>', isDefault: true, isPrimary: true }];
  }
  try {
    const list = await gmail(accountId).sendAs();
    kvSet('sendAs', accountId, list);
    return list;
  } catch {
    return kvGet<SendAs[]>('sendAs', accountId) ?? [];
  }
}
export { sendAsList };

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const fmtAddr = (a: Addr) => (a.name ? `${esc(a.name)} &lt;${esc(a.email)}&gt;` : esc(a.email));

export async function newDraft(accountId: string, to?: string): Promise<Draft> {
  const list = await sendAsList(accountId);
  const def = list.find((s) => s.isDefault) ?? list[0];
  return {
    localId: uid(),
    accountId,
    from: def?.email ?? getAccount(accountId).email,
    to: to ? [{ email: to }] : [],
    cc: [],
    bcc: [],
    subject: '',
    html: def?.signature ? `<p><br></p><p><br></p><div class="dav-signature">${def.signature}</div>` : '<p><br></p>',
    attachments: [],
    mode: 'new'
  };
}

export async function prepareReply(accountId: string, messageId: string, mode: 'reply' | 'replyAll' | 'forward'): Promise<Draft> {
  const m = await getMessage(accountId, messageId);
  const draft = await newDraft(accountId);
  const mine = myAddresses();
  const subjectBase = m.subject.replace(/^((re|fw|fwd|aw|sv)\s*:\s*)+/i, '');
  const date = new Date(m.date).toLocaleString('en-GB', { dateStyle: 'full', timeStyle: 'short' });
  const header =
    mode === 'forward'
      ? `<p>---------- Forwarded message ----------<br>From: ${fmtAddr(m.from)}<br>Date: ${esc(date)}<br>Subject: ${esc(m.subject)}<br>To: ${m.to.map(fmtAddr).join(', ')}${m.cc.length ? '<br>Cc: ' + m.cc.map(fmtAddr).join(', ') : ''}</p>`
      : `<p>On ${esc(date)}, ${fmtAddr(m.from)} wrote:</p>`;
  const original = m.html ?? `<pre style="white-space:pre-wrap;font-family:inherit">${esc(m.text ?? m.snippet)}</pre>`;
  const quoted = `<div class="dav-quote">${header}<blockquote style="margin:0 0 0 .8ex;border-left:1px solid #ccc;padding-left:1ex">${original}</blockquote></div>`;
  draft.html = draft.html + quoted;
  draft.mode = mode;
  draft.subject = (mode === 'forward' ? 'Fw: ' : 'Re: ') + subjectBase;
  // Reply from the address the message was sent to, when it is one of ours.
  const toUs = [...m.to, ...m.cc].find((a) => mine.has(a.email.toLowerCase()));
  if (toUs) draft.from = toUs.email;
  if (mode !== 'forward') {
    const sentByMe = mine.has(m.from.email.toLowerCase());
    const primary = sentByMe ? m.to : m.replyTo.length ? m.replyTo : [m.from];
    draft.to = primary;
    if (mode === 'replyAll') {
      const seen = new Set(primary.map((a) => a.email.toLowerCase()));
      draft.cc = [...m.to, ...m.cc].filter((a) => {
        const e = a.email.toLowerCase();
        if (seen.has(e) || mine.has(e)) return false;
        seen.add(e);
        return true;
      });
    }
    draft.inReplyTo = { messageId: m.id, threadId: m.threadId, messageIdHeader: m.messageIdHeader, references: m.references };
  } else {
    draft.attachments = m.attachments
      .filter((a) => !a.contentId && !a.role)
      .map((a) => ({ filename: a.filename, mimeType: a.mimeType, size: a.size, fromMessage: { accountId, messageId: m.id, attachmentId: a.id } }));
  }
  return draft;
}

export async function openDraft(accountId: string, messageId: string): Promise<Draft> {
  const m = await getMessage(accountId, messageId);
  const gmailDraftId = isDemo(accountId) ? messageId : await gmail(accountId).draftIdForMessage(messageId);
  // A saved reply: keep it in its conversation. Its References header ends with the message it replies to.
  const parent = m.references?.trim().split(/\s+/).pop();
  return {
    localId: uid(),
    accountId,
    from: m.from.email,
    to: m.to,
    cc: m.cc,
    bcc: m.bcc,
    subject: m.subject === '(no subject)' ? '' : m.subject,
    html: m.html ?? esc(m.text ?? ''),
    attachments: m.attachments
      .filter((a) => !a.contentId && !a.role)
      .map((a) => ({ filename: a.filename, mimeType: a.mimeType, size: a.size, fromMessage: { accountId, messageId, attachmentId: a.id } })),
    mode: parent ? 'reply' : 'new',
    inReplyTo: parent ? { messageId: m.id, threadId: m.threadId, messageIdHeader: parent, references: m.references } : undefined,
    gmailDraftId,
    gmailMessageId: messageId
  };
}

async function draftToMime(d: Draft): Promise<{ mime: string; threadId?: string }> {
  const list = await sendAsList(d.accountId);
  const fromInfo = list.find((s) => s.email.toLowerCase() === d.from.toLowerCase());
  const acc = getAccount(d.accountId);
  const attachments: MimeAttachment[] = [];
  let html = d.html;
  const limit = getSettings().attachAsDriveLinkOverMB * 1024 * 1024;
  const total = d.attachments.reduce((n, a) => n + a.size, 0);
  const driveLinks: string[] = [];
  for (const a of d.attachments) {
    let data: Buffer;
    if (a.dataBase64) data = Buffer.from(a.dataBase64, 'base64');
    else if (a.path) data = fs.readFileSync(a.path);
    else if (a.fromMessage) data = isDemo(a.fromMessage.accountId) ? demoAttachment(a.filename) : await gmail(a.fromMessage.accountId).attachment(a.fromMessage.messageId, a.fromMessage.attachmentId);
    else continue;
    if (total > limit && !isDemo(d.accountId)) {
      const recipients = [...d.to, ...d.cc, ...d.bcc].map((r) => r.email);
      const link = await uploadToDrive(client(d.accountId), a.filename, a.mimeType, data, recipients);
      driveLinks.push(`<li><a href="${link}">${esc(a.filename)}</a></li>`);
    } else {
      attachments.push({ filename: a.filename, mimeType: a.mimeType, data });
    }
  }
  if (driveLinks.length) html = `<div><p>Shared from Google Drive:</p><ul>${driveLinks.join('')}</ul></div>` + html;
  const mime = buildMime({
    from: { email: d.from, name: fromInfo?.displayName || (d.from === acc.email ? acc.name.replace(/ \(demo\)$/, '') : undefined) },
    to: d.to,
    cc: d.cc,
    bcc: d.bcc,
    subject: d.subject,
    html,
    attachments,
    inReplyTo: d.inReplyTo?.messageIdHeader,
    references: d.inReplyTo?.references,
    importance: d.importance
  });
  return { mime, threadId: d.inReplyTo?.threadId };
}

function demoAttachment(filename: string): Buffer {
  return Buffer.from(`This is a sample attachment (${filename}) from the Davenport demo account.\n`, 'utf8');
}

export function send(d: Draft): { outboxId: string; sendAt: number } {
  if (!d.to.length && !d.cc.length && !d.bcc.length) throw new Error('Add at least one recipient.');
  // Catch typos now, while the message is still open, rather than when it fails in the outbox.
  for (const a of [...d.to, ...d.cc, ...d.bcc]) cleanEmail(a.email);
  const sendAt = d.sendAt && d.sendAt > Date.now() ? d.sendAt : Date.now() + getSettings().undoSendSeconds * 1000;
  const id = uid();
  run("INSERT INTO outbox (id, account_id, draft_json, send_at, status, created) VALUES (?, ?, ?, ?, 'waiting', ?)", id, d.accountId, JSON.stringify(d), sendAt, Date.now());
  // The saved draft is deleted from Gmail once the message goes; hide its cached copy now so it doesn't linger
  // in Drafts and in the conversation meanwhile. (Undo send reopens the message, which saves it again.)
  if (d.gmailMessageId) {
    store.deleteLocal(d.accountId, [d.gmailMessageId]);
    changed('mail', d.accountId);
  }
  changed('outbox', d.accountId);
  changed('folders', d.accountId);
  kickOutbox();
  return { outboxId: id, sendAt };
}

export function cancelSend(outboxId: string): Draft | null {
  const row = get<{ draft_json: string; status: string; account_id: string }>('SELECT * FROM outbox WHERE id = ?', outboxId);
  if (!row || row.status === 'sending') return null;
  run('DELETE FROM outbox WHERE id = ?', outboxId);
  changed('outbox', row.account_id);
  changed('folders', row.account_id);
  return JSON.parse(row.draft_json) as Draft;
}

export function outbox(): OutboxItem[] {
  const undoMs = getSettings().undoSendSeconds * 1000;
  return all<{ id: string; account_id: string; draft_json: string; send_at: number; status: OutboxItem['status']; error: string | null; created: number }>(
    'SELECT * FROM outbox ORDER BY send_at'
  ).map((r) => {
    const d = JSON.parse(r.draft_json) as Draft;
    return {
      id: r.id,
      accountId: r.account_id,
      subject: d.subject || '(no subject)',
      to: [...d.to, ...d.cc].map((a) => a.name || a.email).join(', '),
      sendAt: r.send_at,
      status: r.status,
      error: r.error ?? undefined,
      undoable: r.send_at - r.created <= undoMs + 1000
    };
  });
}

/**
 * Messages left "sending" when Davenport closed or crashed mid-send. Whether Gmail got them is unknown,
 * so they're marked failed with a note to check Sent first, rather than risk sending them twice.
 */
export function recoverOutbox(): void {
  const stuck = all<{ id: string }>("SELECT id FROM outbox WHERE status = 'sending'");
  for (const r of stuck) {
    run("UPDATE outbox SET status = 'failed', error = ? WHERE id = ?", 'Davenport closed while this was sending. Check Sent: if it isn’t there, choose Send again.', r.id);
  }
}

/** Sends a failed or scheduled message now. */
export function sendNow(outboxId: string): void {
  run("UPDATE outbox SET status = 'waiting', error = NULL, send_at = ? WHERE id = ? AND status != 'sending'", Date.now(), outboxId);
  const acc = get<{ account_id: string }>('SELECT account_id FROM outbox WHERE id = ?', outboxId)?.account_id;
  if (acc) changed('outbox', acc);
  kickOutbox();
}

let outboxTimer: NodeJS.Timeout | null = null;
let outboxBusy = false;
export function kickOutbox(): void {
  if (outboxTimer) clearTimeout(outboxTimer);
  const next = get<{ t: number }>("SELECT MIN(send_at) AS t FROM outbox WHERE status = 'waiting'")?.t;
  if (!next) return;
  outboxTimer = setTimeout(() => void processOutbox(), Math.max(0, Math.min(next - Date.now(), 60_000)));
}

async function processOutbox(): Promise<void> {
  if (outboxBusy) return;
  outboxBusy = true;
  try {
    const due = all<{ id: string; account_id: string; draft_json: string }>("SELECT * FROM outbox WHERE status = 'waiting' AND send_at <= ?", Date.now());
    for (const row of due) {
      run("UPDATE outbox SET status = 'sending' WHERE id = ?", row.id);
      changed('outbox', row.account_id);
      const d = JSON.parse(row.draft_json) as Draft;
      try {
        if (isDemo(d.accountId)) {
          demoSend(d);
          run('DELETE FROM outbox WHERE id = ?', row.id);
        } else {
          const { mime, threadId } = await draftToMime(d);
          const sent = await gmail(d.accountId).send(mime, threadId);
          // Gmail has it: take it out of the outbox before anything else, so a hiccup in the tidy-up below
          // can never make a sent message look failed (and get sent twice).
          run('DELETE FROM outbox WHERE id = ?', row.id);
          if (d.gmailDraftId) await gmail(d.accountId).deleteDraft(d.gmailDraftId).catch(() => undefined);
          await fetchAndStore(d.accountId, [sent.id]).catch(() => undefined);
        }
        toast({ kind: 'success', text: `Sent: ${d.subject || '(no subject)'}` });
      } catch (e) {
        const offline = e instanceof TypeError || e instanceof QuotaExceeded;
        run("UPDATE outbox SET status = ?, error = ?, send_at = ? WHERE id = ?", offline ? 'waiting' : 'failed', (e as Error).message, Date.now() + 60_000, row.id);
        if (!offline) toast({ kind: 'error', text: `Couldn't send "${d.subject}": ${(e as Error).message}` });
      }
      changed('outbox', d.accountId);
      changed('mail', d.accountId);
      changed('folders', d.accountId);
    }
  } finally {
    outboxBusy = false;
    kickOutbox();
  }
}

function demoSend(d: Draft): void {
  const id = 'sent-' + uid();
  store.upsertMessage(d.accountId, {
    id,
    threadId: d.inReplyTo?.threadId ?? id,
    labelIds: ['SENT'],
    snippet: htmlToText(d.html).slice(0, 140),
    date: Date.now(),
    size: d.html.length,
    from: { email: d.from, name: 'Alex Morgan' },
    to: d.to,
    cc: d.cc,
    bcc: d.bcc,
    replyTo: [],
    subject: d.subject,
    hasAttachments: d.attachments.length > 0,
    html: d.html,
    text: htmlToText(d.html),
    attachments: d.attachments.map((a, i) => ({ id: 'att' + i, filename: a.filename, mimeType: a.mimeType, size: a.size })),
    full: true
  });
}

export async function saveDraft(d: Draft): Promise<{ gmailDraftId?: string; gmailMessageId?: string }> {
  if (isDemo(d.accountId)) {
    const id = d.gmailDraftId ?? 'draft-' + d.localId;
    store.upsertMessage(d.accountId, {
      id, threadId: d.inReplyTo?.threadId ?? id, labelIds: ['DRAFT'], snippet: htmlToText(d.html).slice(0, 140), date: Date.now(), size: 0,
      from: { email: d.from }, to: d.to, cc: d.cc, bcc: d.bcc, replyTo: [], subject: d.subject, hasAttachments: d.attachments.length > 0,
      html: d.html, text: htmlToText(d.html), attachments: [], full: true
    });
    changed('mail', d.accountId);
    changed('folders', d.accountId);
    return { gmailDraftId: id, gmailMessageId: id };
  }
  const { mime, threadId } = await draftToMime(d);
  const r = await gmail(d.accountId).saveDraft(mime, threadId, d.gmailDraftId);
  await fetchAndStore(d.accountId, [r.message.id]);
  // Each save gives the draft a new message id: remove the cached copy of the previous version, by its id when we
  // know it (the subject may have changed since), otherwise by thread and subject.
  if (d.gmailMessageId && d.gmailMessageId !== r.message.id) store.deleteLocal(d.accountId, [d.gmailMessageId]);
  else if (!d.gmailMessageId)
    run(
      "DELETE FROM messages WHERE account_id = ? AND id != ? AND thread_id = ? AND labels LIKE '%\"DRAFT\"%' AND labels NOT LIKE '%\"SENT\"%' AND subject = ?",
      d.accountId, r.message.id, r.message.threadId, d.subject
    );
  changed('mail', d.accountId);
  changed('folders', d.accountId);
  return { gmailDraftId: r.id, gmailMessageId: r.message.id };
}

export async function discardDraft(d: Draft): Promise<void> {
  if (!d.gmailDraftId) return;
  if (isDemo(d.accountId)) {
    store.deleteLocal(d.accountId, [d.gmailDraftId]);
  } else {
    // Remove exactly this draft's cached copy (not every draft that happens to share its subject), straight away.
    if (d.gmailMessageId) {
      store.deleteLocal(d.accountId, [d.gmailMessageId]);
      changed('mail', d.accountId);
    }
    const g = gmail(d.accountId);
    const messageId = d.gmailMessageId ?? (await g.draftMessageId(d.gmailDraftId).catch(() => undefined));
    await g.deleteDraft(d.gmailDraftId).catch(() => undefined);
    if (messageId) store.deleteLocal(d.accountId, [messageId]);
  }
  changed('mail', d.accountId);
  changed('folders', d.accountId);
}

// ---------- Attachments, printing ----------

/** Sends a ready-made message straight away (no undo-send delay), e.g. a reply to a meeting invitation. */
export async function sendRawNow(accountId: string, mime: string, threadId?: string): Promise<void> {
  if (isDemo(accountId)) return;
  const sent = await gmail(accountId).send(mime, threadId);
  await fetchAndStore(accountId, [sent.id]).catch(() => undefined);
  changed('mail', accountId);
}

export async function attachmentData(accountId: string, messageId: string, attachmentId: string, filename: string): Promise<Buffer> {
  const inline = (store.getDetail(accountId, messageId)?.attachments.find((a) => a.id === attachmentId) as { inlineData?: string } | undefined)?.inlineData;
  if (inline) return Buffer.from(inline.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  if (isDemo(accountId)) return demoAttachment(filename);
  return gmail(accountId).attachment(messageId, attachmentId);
}

// Windows-safe file name: no path separators or reserved characters, no trailing dots or spaces, no reserved device names.
const safeName = (n: string) => {
  let s = n.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').replace(/[.\s]+$/, '').slice(0, 180);
  if (/^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(s)) s = '_' + s;
  return s || 'attachment';
};

export async function openAttachment(accountId: string, messageId: string, attachmentId: string, filename: string): Promise<void> {
  if (isBlockedType(filename)) {
    throw new Error(`To keep your computer safe, Davenport doesn't open programs, scripts or shortcuts straight from email (${path.extname(filename) || filename}). If you trust the sender, use Save as… and check the file before opening it.`);
  }
  const data = await attachmentData(accountId, messageId, attachmentId, filename);
  const dir = path.join(os.tmpdir(), 'Davenport', uid());
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, safeName(filename));
  fs.writeFileSync(file, data);
  markFromInternet(file);
  const err = await shell.openPath(file);
  if (err) throw new Error(err);
}

export async function saveAttachment(accountId: string, messageId: string, attachmentId: string, filename: string): Promise<string | null> {
  const win = BrowserWindow.getFocusedWindow();
  const opts = { defaultPath: path.join(app.getPath('downloads'), safeName(filename)) };
  const r = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts);
  if (r.canceled || !r.filePath) return null;
  fs.writeFileSync(r.filePath, await attachmentData(accountId, messageId, attachmentId, filename));
  markFromInternet(r.filePath);
  return r.filePath;
}

/** Removes anything that could navigate, run or embed other content when an email is printed. */
function stripActiveContent(html: string): string {
  return html
    .replace(/<(script|iframe|object|embed|form|noscript|template)\b[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<(meta|base|link|iframe|object|embed|frame|frameset|applet)\b[^>]*>/gi, '')
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/(href|src|action|formaction)\s*=\s*(["']?)\s*javascript:[^"'\s>]*\2/gi, '$1="#"');
}

/** Pictures from the internet are shown when they aren't blocked in Settings, or the sender is on the "always show" list. */
export function remoteImagesAllowed(fromEmail: string): boolean {
  return !getSettings().blockRemoteImages || trustedSenders().includes(fromEmail.toLowerCase());
}

function printableHtml(m: MessageDetail): string {
  const list = (l: Addr[]) => l.map(fmtAddr).join(', ');
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(m.subject)}</title>
  <style>body{font-family:'Segoe UI',Arial,sans-serif;font-size:11pt;color:#111;margin:24px}h1{font-size:15pt;margin:0 0 10px}
  table{font-size:10pt;color:#333;margin-bottom:14px;border-bottom:1px solid #999;padding-bottom:8px;width:100%}td:first-child{width:70px;font-weight:600;vertical-align:top}</style></head>
  <body><h1>${esc(m.subject)}</h1><table><tr><td>From</td><td>${fmtAddr(m.from)}</td></tr><tr><td>Sent</td><td>${esc(new Date(m.date).toLocaleString('en-GB', { dateStyle: 'full', timeStyle: 'short' }))}</td></tr>
  <tr><td>To</td><td>${list(m.to)}</td></tr>${m.cc.length ? `<tr><td>Cc</td><td>${list(m.cc)}</td></tr>` : ''}
  ${m.attachments.filter((a) => !a.contentId && !a.role).length ? `<tr><td>Attached</td><td>${m.attachments.filter((a) => !a.contentId && !a.role).map((a) => esc(a.filename)).join('; ')}</td></tr>` : ''}</table>
  ${m.html ? stripActiveContent(m.html) : `<pre style="white-space:pre-wrap;font-family:inherit">${esc(m.text ?? '')}</pre>`}</body></html>`;
}

/**
 * Print and PDF render the email in a hidden window with no scripts, in a session of its own that can't
 * navigate anywhere and only loads pictures from the internet when they're allowed for this sender
 * (so printing never tells a sender you've opened their email when you've blocked their pictures).
 */
function printSession(allowImages: boolean): Electron.Session {
  const name = allowImages ? 'davenport-print-images' : 'davenport-print';
  const s = session.fromPartition(name);
  if (!configuredPrintSessions.has(name)) {
    configuredPrintSessions.add(name);
    s.setPermissionRequestHandler((_wc, _p, done) => done(false));
    s.webRequest.onBeforeRequest((details, done) => {
      const local = /^(data|blob):/i.test(details.url);
      const isPage = details.resourceType === 'mainFrame' || details.resourceType === 'subFrame';
      const remoteImage = allowImages && details.resourceType === 'image' && /^https?:/i.test(details.url);
      done({ cancel: !(local && (!isPage || details.resourceType === 'mainFrame')) && !remoteImage });
    });
  }
  return s;
}
const configuredPrintSessions = new Set<string>();

async function renderOffscreen(m: MessageDetail): Promise<BrowserWindow> {
  const win = new BrowserWindow({ show: false, webPreferences: { javascript: false, sandbox: true, session: printSession(remoteImagesAllowed(m.from.email)) } });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  await win.loadURL('data:text/html;charset=utf-8;base64,' + Buffer.from(printableHtml(m)).toString('base64'));
  return win;
}

export async function print(accountId: string, id: string): Promise<void> {
  const win = await renderOffscreen(await getMessage(accountId, id));
  win.webContents.print({}, () => win.destroy());
}

export async function savePdf(accountId: string, id: string): Promise<string | null> {
  const m = await getMessage(accountId, id);
  const parent = BrowserWindow.getFocusedWindow();
  const opts = { defaultPath: path.join(app.getPath('documents'), safeName(m.subject || 'message') + '.pdf'), filters: [{ name: 'PDF', extensions: ['pdf'] }] };
  const r = parent ? await dialog.showSaveDialog(parent, opts) : await dialog.showSaveDialog(opts);
  if (r.canceled || !r.filePath) return null;
  const win = await renderOffscreen(m);
  const pdf = await win.webContents.printToPDF({ pageSize: 'A4', printBackground: true });
  win.destroy();
  fs.writeFileSync(r.filePath, pdf);
  return r.filePath;
}

// ---------- Rules (Gmail filters plus local rules) ----------

const filterToRule = (accountId: string, raw: GFilter, labels: Map<string, string>): Rule => {
  // Gmail leaves out empty parts of a filter (no criteria it doesn't use, no actions), so fill them in.
  const f = { ...raw, criteria: raw.criteria ?? {}, action: raw.action ?? {} };
  return {
  id: 'f:' + f.id,
  accountId,
  name: [f.criteria.from && `From ${f.criteria.from}`, f.criteria.to && `To ${f.criteria.to}`, f.criteria.subject && `Subject "${f.criteria.subject}"`, f.criteria.query]
    .filter(Boolean)
    .join(', ') || 'Gmail filter',
  enabled: true,
  conditions: { from: f.criteria.from, to: f.criteria.to, subject: f.criteria.subject, hasWords: f.criteria.query, hasAttachment: f.criteria.hasAttachment },
  actions: {
    addLabelId: f.action.addLabelIds?.find((l) => labels.has(l)),
    flag: f.action.addLabelIds?.includes('STARRED'),
    trash: f.action.addLabelIds?.includes('TRASH'),
    markImportant: f.action.addLabelIds?.includes('IMPORTANT'),
    archive: f.action.removeLabelIds?.includes('INBOX'),
    markRead: f.action.removeLabelIds?.includes('UNREAD'),
    neverSpam: f.action.removeLabelIds?.includes('SPAM'),
    forwardTo: f.action.forward
  },
  serverFilterId: f.id,
  where: 'server'
  };
};

export async function listRules(accountId: string): Promise<Rule[]> {
  const local = kvAll<Rule>('rules').filter((r) => r.accountId === accountId);
  if (isDemo(accountId)) return local;
  const labels = new Map(store.labelRows(accountId).filter((l) => l.type === 'user').map((l) => [l.id, l.path]));
  const toRules = (filters: GFilter[]) =>
    filters.flatMap((f) => {
      try {
        return [filterToRule(accountId, f, labels)];
      } catch (e) {
        console.error('[rules] skipped a Gmail filter Davenport could not read:', JSON.stringify(f), e);
        return [];
      }
    });
  let filters: GFilter[];
  try {
    filters = await gmail(accountId).filters();
    kvSet('filters', accountId, filters);
  } catch (e) {
    console.error('[rules] could not load Gmail filters:', e);
    const cached = kvGet<GFilter[]>('filters', accountId);
    // With nothing saved from before, say why the list is empty rather than showing "No rules yet".
    if (!cached) throw new Error(`Davenport couldn't load your Gmail filters: ${(e as Error).message}`);
    filters = cached;
  }
  return [...toRules(filters), ...local];
}

export async function saveRule(rule: Rule): Promise<Rule> {
  if (rule.where === 'server' && !isDemo(rule.accountId)) {
    if (rule.serverFilterId) await gmail(rule.accountId).deleteFilter(rule.serverFilterId).catch(() => undefined);
    if (rule.actions.forwardTo) await gmail(rule.accountId).addForwardingAddress(rule.actions.forwardTo).catch(() => undefined);
    const f = await gmail(rule.accountId).createFilter(rule);
    kvDelete('rules', rule.id);
    // Apply the new filter to mail already in the inbox, as Outlook's "run now" does.
    const q = ruleToQuery(rule);
    if (q) {
      const matches = await gmail(rule.accountId).listIds(q + ' in:inbox', undefined, 500);
      if (matches.length) {
        const local: Rule = { ...rule, where: 'local' };
        await runRuleActions(rule.accountId, local, matches.map((m) => m.id));
      }
    }
    changed('rules', rule.accountId);
    return { ...rule, id: 'f:' + f.id, serverFilterId: f.id };
  }
  const r = { ...rule, id: rule.id || uid(), where: 'local' as const };
  kvSet('rules', r.id, r);
  changed('rules', r.accountId);
  return r;
}

export async function deleteRule(accountId: string, ruleId: string): Promise<void> {
  if (ruleId.startsWith('f:')) await gmail(accountId).deleteFilter(ruleId.slice(2));
  else kvDelete('rules', ruleId);
  changed('rules', accountId);
}

const matches = (rule: Rule, m: ParsedMessage): boolean => {
  const c = rule.conditions;
  const has = (hay: string, needle?: string) => !needle || needle.split(/\s+OR\s+|,/).some((n) => hay.toLowerCase().includes(n.trim().toLowerCase()));
  return (
    has(`${m.from.name ?? ''} ${m.from.email}`, c.from) &&
    has([...m.to, ...m.cc].map((a) => `${a.name ?? ''} ${a.email}`).join(' '), c.to) &&
    has(m.subject, c.subject) &&
    has(`${m.subject} ${m.snippet}`, c.hasWords) &&
    (!c.hasAttachment || m.hasAttachments)
  );
};

async function runRuleActions(accountId: string, rule: Rule, ids: string[]): Promise<void> {
  const a = rule.actions;
  const add: string[] = [];
  const remove: string[] = [];
  if (a.addLabelId) add.push(a.addLabelId);
  if (a.flag) add.push('STARRED');
  if (a.markImportant) add.push('IMPORTANT');
  if (a.archive) remove.push('INBOX');
  if (a.markRead) remove.push('UNREAD');
  if (add.length || remove.length) modify(accountId, ids, add, remove);
  if (a.trash) trash(accountId, ids);
}

async function applyLocalRules(accountId: string, msgs: ParsedMessage[]): Promise<void> {
  const rules = kvAll<Rule>('rules').filter((r) => r.accountId === accountId && r.enabled && r.where === 'local');
  for (const rule of rules) {
    const hit = msgs.filter((m) => matches(rule, m)).map((m) => m.id);
    if (hit.length) await runRuleActions(accountId, rule, hit);
  }
}

// ---------- Gmail settings ----------

export async function setSignature(accountId: string, email: string, html: string): Promise<void> {
  if (!isDemo(accountId)) await gmail(accountId).setSignature(email, html);
  const list = (kvGet<SendAs[]>('sendAs', accountId) ?? (await sendAsList(accountId))).map((s) => (s.email === email ? { ...s, signature: html } : s));
  kvSet('sendAs', accountId, list);
}

export async function vacation(accountId: string): Promise<Vacation> {
  if (isDemo(accountId)) return kvGet<Vacation>('vacation', accountId) ?? { enabled: false, subject: '', html: '', restrictToContacts: false, restrictToDomain: false };
  return gmail(accountId).vacation();
}
export async function setVacation(accountId: string, v: Vacation, quiet = false): Promise<void> {
  const { blockCalendar: _ignored, ...plain } = v;
  void _ignored;
  if (isDemo(accountId)) kvSet('vacation', accountId, plain);
  else {
    await gmail(accountId).setVacation(plain);
    // Read it back, so a change Gmail didn't accept is reported rather than silently lost.
    const saved = await gmail(accountId).vacation();
    if (saved.enabled !== plain.enabled) {
      throw new Error("Gmail didn't accept the automatic reply change. Check that Davenport has permission to manage Gmail settings (Settings › Accounts › sign in again).");
    }
  }
  if (quiet) return;
  toast({ kind: 'success', text: v.enabled ? 'Automatic replies are on.' : 'Automatic replies are off.' });
}

export { emit };
