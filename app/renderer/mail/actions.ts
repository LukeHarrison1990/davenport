// Mail commands shared by the ribbon, right-click menus and keyboard shortcuts.
import type { Draft, Folder, MessageSummary, QuickStep } from '../../shared/types';
import { call } from '../api';
import type { MenuEntry } from '../components/Menu';
import { fail, notify, useApp } from '../state';
import { quickTimes } from '../util';

export type Sel = { accountId: string; id: string; threadId: string }[];

/** Groups the selection by account, since every engine call is per account. */
function byAccount(sel: Sel): Map<string, string[]> {
  const m = new Map<string, string[]>();
  for (const s of sel) m.set(s.accountId, [...(m.get(s.accountId) ?? []), s.id]);
  return m;
}

async function each(sel: Sel, fn: (accountId: string, ids: string[]) => Promise<unknown>) {
  try {
    for (const [a, ids] of byAccount(sel)) await fn(a, ids);
  } catch (e) {
    fail(e);
  }
}

const currentFolderId = () => {
  const f = useApp.getState().mail.folder;
  return f.type === 'label' ? f.id : f.type === 'unified' ? (f.label === 'FLAGGED' ? 'STARRED' : f.label) : 'SEARCH';
};

export function openCompose(draft: Draft): void {
  void call('app.openWindow', 'compose', { draft: JSON.stringify(draft) });
}

export async function newMail(accountId?: string, to?: string): Promise<void> {
  const st = useApp.getState();
  const acc = accountId ?? (st.mail.accountId !== 'all' ? st.mail.accountId : st.accounts[0]?.id);
  if (!acc) return notify('Add an account first.');
  try {
    openCompose(await call('mail.newDraft', acc, to));
  } catch (e) {
    fail(e);
  }
}

export async function respond(sel: Sel, mode: 'reply' | 'replyAll' | 'forward', inline?: (d: Draft) => void): Promise<void> {
  const s = sel[sel.length - 1];
  if (!s) return;
  try {
    const d = await call('mail.prepareReply', s.accountId, s.id, mode);
    if (inline && mode !== 'forward') inline(d);
    else openCompose(d);
  } catch (e) {
    fail(e);
  }
}

export const del = (sel: Sel) => {
  const f = currentFolderId();
  if (f === 'TRASH') {
    const n = sel.length;
    if (!window.confirm(`Permanently delete ${n === 1 ? 'this message' : n + ' messages'}? This can't be undone.`)) return;
    return void each(sel, (a, ids) => call('mail.deleteForever', a, ids));
  }
  void each(sel, (a, ids) => call('mail.trash', a, ids));
  notify(sel.length === 1 ? 'Moved to Bin.' : `${sel.length} items moved to Bin.`, 'undo', undoAction(sel, 'restore'));
};

export const archive = (sel: Sel) => {
  void each(sel, (a, ids) => call('mail.archive', a, ids));
  notify(sel.length === 1 ? 'Archived.' : `${sel.length} items archived.`, 'undo', undoAction(sel, 'unarchive'));
};

function undoAction(sel: Sel, kind: 'restore' | 'unarchive') {
  // Undo is a single engine call so the toast can run it directly.
  const first = sel[0];
  const ids = sel.filter((s) => s.accountId === first.accountId).map((s) => s.id);
  return kind === 'restore'
    ? { label: 'Undo', method: 'mail.restore', args: [first.accountId, ids] }
    : { label: 'Undo', method: 'mail.label', args: [first.accountId, ids, ['INBOX'], []] };
}

export const markRead = (sel: Sel, read: boolean) => each(sel, (a, ids) => call('mail.markRead', a, ids, read));
export const flag = (sel: Sel, flagged: boolean, due?: number | null) => each(sel, (a, ids) => call('mail.flag', a, ids, flagged, due));
export const move = (sel: Sel, to: string) => each(sel, (a, ids) => call('mail.move', a, ids, to, currentFolderId()));
export const spam = (sel: Sel, isSpam: boolean) => each(sel, (a, ids) => call('mail.spam', a, ids, isSpam));
export const snooze = async (sel: Sel, until: number) => {
  await each(sel, (a, ids) => call('mail.snooze', a, ids, until));
  notify(`Snoozed until ${new Date(until).toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' })}.`);
};

export function flagMenu(sel: Sel, isFlagged: boolean): MenuEntry[] {
  const day = (n: number) => {
    const d = new Date();
    d.setDate(d.getDate() + n);
    d.setHours(17, 0, 0, 0);
    return d.getTime();
  };
  const nextWeek = () => {
    const d = new Date();
    d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7));
    d.setHours(17, 0, 0, 0);
    return d.getTime();
  };
  return [
    { label: 'Today', icon: 'flag', onClick: () => flag(sel, true, day(0)) },
    { label: 'Tomorrow', icon: 'flag', onClick: () => flag(sel, true, day(1)) },
    { label: 'This week', icon: 'flag', onClick: () => flag(sel, true, day((5 - new Date().getDay() + 7) % 7)) },
    { label: 'Next week', icon: 'flag', onClick: () => flag(sel, true, nextWeek()) },
    { label: 'No date', icon: 'flag', onClick: () => flag(sel, true, null) },
    { sep: true },
    { label: 'Mark complete', icon: 'check', disabled: !isFlagged, onClick: () => flag(sel, false) },
    { label: 'Clear flag', icon: 'close', disabled: !isFlagged, onClick: () => flag(sel, false) }
  ];
}

export function snoozeMenu(sel: Sel): MenuEntry[] {
  return [
    ...quickTimes().map((t) => ({ label: t.label, hint: t.hint, icon: 'clock', onClick: () => void snooze(sel, t.at) })),
    { sep: true as const },
    {
      label: 'Choose a date and time…',
      icon: 'calendar',
      onClick: () => useApp.getState().openDialog('moveTo', { mode: 'snoozeAt', sel })
    }
  ];
}

export function categoryMenu(sel: Sel, folders: Folder[], current: string[]): MenuEntry[] {
  const cats = folders.filter((f) => f.isCategory);
  return [
    ...cats.map((c) => ({
      label: c.path,
      colour: c.color ?? '#5B6472',
      checked: current.includes(c.id),
      onClick: () => {
        const on = current.includes(c.id);
        void each(sel, (a, ids) => call('mail.label', a, ids, on ? [] : [c.id], on ? [c.id] : []));
      }
    })),
    ...(cats.length ? [{ sep: true as const }] : []),
    { label: 'All labels…', icon: 'tag', onClick: () => useApp.getState().openDialog('moveTo', { mode: 'label', sel }) },
    { label: 'Manage categories…', icon: 'settings', onClick: () => useApp.getState().openDialog('settings', 'categories') }
  ];
}

export async function quickStepsMenu(sel: Sel): Promise<MenuEntry[]> {
  const steps = await call('quicksteps.list');
  return [
    ...steps.map((s: QuickStep) => ({ label: s.name, icon: 'bolt', disabled: !sel.length, onClick: () => void runQuickStep(s, sel) })),
    ...(steps.length ? [{ sep: true as const }] : []),
    { label: 'New Quick Step…', icon: 'plus', onClick: () => useApp.getState().openDialog('quicksteps', 'new') },
    { label: 'Manage Quick Steps…', icon: 'settings', onClick: () => useApp.getState().openDialog('quicksteps') }
  ];
}

export async function runQuickStep(s: QuickStep, sel: Sel) {
  await each(sel, (a, ids) => call('quicksteps.run', s.id, a, ids));
  notify(`Quick Step "${s.name}" done.`);
}

export function rowMenu(m: MessageSummary, sel: Sel, folders: Folder[], inFolder: string): MenuEntry[] {
  return [
    { label: 'Reply', icon: 'reply', hint: 'Ctrl+R', onClick: () => void respond(sel, 'reply') },
    { label: 'Reply all', icon: 'replyAll', hint: 'Ctrl+Shift+R', onClick: () => void respond(sel, 'replyAll') },
    { label: 'Forward', icon: 'forward', hint: 'Ctrl+F', onClick: () => void respond(sel, 'forward') },
    { sep: true },
    m.unread
      ? { label: 'Mark as read', icon: 'read', hint: 'Ctrl+Q', onClick: () => void markRead(sel, true) }
      : { label: 'Mark as unread', icon: 'unread', hint: 'Ctrl+U', onClick: () => void markRead(sel, false) },
    { label: 'Categorise', icon: 'tag', submenu: categoryMenu(sel, folders, m.labelIds) },
    { label: 'Follow up', icon: 'flag', submenu: flagMenu(sel, m.flagged) },
    m.snoozedUntil
      ? { label: 'Unsnooze', icon: 'snooze', onClick: () => void each(sel, (a, ids) => call('mail.unsnooze', a, ids)) }
      : { label: 'Snooze', icon: 'snooze', submenu: snoozeMenu(sel) },
    { sep: true },
    { label: 'Move to…', icon: 'move', hint: 'Ctrl+Shift+V', onClick: () => useApp.getState().openDialog('moveTo', { mode: 'move', sel }) },
    ...(inFolder === 'INBOX' && useApp.getState().settings.focusedInbox.startsWith('categories')
      ? [
          useApp.getState().tab === 'other'
            ? { label: 'Move to Primary', icon: 'inbox', onClick: () => void each(sel, (a, ids) => call('mail.moveToTab', a, ids, 'primary')).then(() => notify('Moved to Primary. Gmail will learn from this for similar mail.')) }
            : { label: 'Move to Other', icon: 'inbox', onClick: () => void each(sel, (a, ids) => call('mail.moveToTab', a, ids, 'other')).then(() => notify('Moved to Other.')) }
        ]
      : []),
    { label: 'Archive', icon: 'archive', hint: 'Backspace', onClick: () => archive(sel) },
    inFolder === 'SPAM'
      ? { label: 'Not spam', icon: 'inbox', onClick: () => void spam(sel, false) }
      : { label: 'Report spam', icon: 'spam', onClick: () => void spam(sel, true) },
    ...(inFolder === 'TRASH' ? [{ label: 'Restore', icon: 'inbox', onClick: () => void each(sel, (a, ids) => call('mail.restore', a, ids)) }] : []),
    { label: inFolder === 'TRASH' ? 'Delete permanently' : 'Delete', icon: 'trash', hint: 'Del', danger: true, onClick: () => del(sel) },
    { sep: true },
    { label: 'Create event from email', icon: 'calendar', onClick: () => void createEventFrom(m) },
    { label: 'Create rule…', icon: 'rules', onClick: () => useApp.getState().openDialog('rules', { from: m.from.email, subject: m.subject, accountId: m.accountId }) },
    { label: 'Print', icon: 'print', hint: 'Ctrl+P', onClick: () => void call('mail.print', m.accountId, m.id).catch(fail) },
    { label: 'Save as PDF', icon: 'pdf', onClick: () => void call('mail.savePdf', m.accountId, m.id).then((p) => p && notify('Saved to ' + p)).catch(fail) }
  ];
}

export async function createEventFrom(m: { accountId: string; id: string }): Promise<void> {
  try {
    const draft = await call('calendar.fromMessage', m.accountId, m.id);
    void call('app.openWindow', 'event', { draft: JSON.stringify({ ...draft, accountId: m.accountId, calendarId: 'primary' }) });
  } catch (e) {
    fail(e);
  }
}
