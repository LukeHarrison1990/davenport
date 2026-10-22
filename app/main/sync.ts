// Schedules background syncing for every account: mail every ~45 s, chat every 30 s,
// calendar and tasks every 5 minutes, contacts every 30 minutes.
import { powerMonitor } from 'electron';
import { listAccounts, setStatus } from './services/accounts';
import { checkSnoozes, kickOutbox, syncMail } from './services/mail';
import { checkReminders, syncCalendar } from './services/calendar';
import { syncDirectory, syncPeople } from './services/people';
import { syncTasks } from './services/tasks';
import { syncChat } from './services/chat';
import { getSettings } from './settings';
import { kick } from './services/ops';
import { updateBadge } from './tray';
import { toast } from './events';

const last = new Map<string, number>();
const due = (key: string, everyMs: number) => {
  const t = last.get(key) ?? 0;
  if (Date.now() - t >= everyMs) {
    last.set(key, Date.now());
    return true;
  }
  return false;
};

async function guard(accountId: string, what: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (e) {
    // Mail sync reports its own status; other failures are logged quietly and retried next round.
    if (what !== 'mail') console.warn(`[sync] ${what} failed for ${accountId}:`, (e as Error).message);
  }
}

export async function syncAccount(accountId: string, full = false): Promise<void> {
  const a = listAccounts().find((x) => x.id === accountId);
  if (!a || a.kind !== 'google' || a.status === 'reauth') return;
  if (full) for (const k of ['cal', 'people', 'tasks', 'chat', 'dir']) last.delete(`${k}|${accountId}`);
  await guard(accountId, 'mail', () => syncMail(accountId));
  if (due(`cal|${accountId}`, 5 * 60_000)) await guard(accountId, 'calendar', () => syncCalendar(accountId));
  if (due(`tasks|${accountId}`, 5 * 60_000)) await guard(accountId, 'tasks', () => syncTasks(accountId));
  if (due(`people|${accountId}`, 30 * 60_000)) await guard(accountId, 'people', () => syncPeople(accountId));
  // The organisation directory changes slowly: refresh it every six hours (only changes are downloaded).
  if (a.isWorkspace && due(`dir|${accountId}`, 6 * 3600_000)) await guard(accountId, 'directory', () => syncDirectory(accountId).then(() => undefined));
  if (a.chatEnabled && due(`chat|${accountId}`, 30_000)) await guard(accountId, 'chat', () => syncChat(accountId));
  updateBadge();
}

export async function syncAll(full = false): Promise<void> {
  await Promise.all(listAccounts().map((a) => syncAccount(a.id, full)));
}

export async function manualSync(accountId?: string): Promise<void> {
  const accounts = listAccounts().filter((a) => !accountId || a.id === accountId);
  for (const a of accounts) if (a.status === 'offline' || a.status === 'error') setStatus(a.id, 'syncing');
  kick();
  await Promise.all(accounts.map((a) => syncAccount(a.id, true)));
  const failed = listAccounts().filter((a) => accounts.some((x) => x.id === a.id) && (a.status === 'error' || a.status === 'offline'));
  if (failed.length) toast({ kind: 'error', text: `Couldn't sync ${failed.map((a) => a.email).join(', ')}: ${failed[0].error ?? 'check your connection'}` });
}

let timer: NodeJS.Timeout | null = null;
let chatTimer: NodeJS.Timeout | null = null;

export function startScheduler(): void {
  const loop = async () => {
    await syncAll().catch(() => undefined);
    timer = setTimeout(loop, getSettings().pollSeconds * 1000);
  };
  void loop();
  // Chat polls on its own faster cycle.
  chatTimer = setInterval(() => {
    for (const a of listAccounts()) if (a.kind === 'google' && a.chatEnabled && due(`chat|${a.id}`, 30_000)) void guard(a.id, 'chat', () => syncChat(a.id));
  }, 10_000);
  setInterval(() => {
    checkSnoozes();
    checkReminders();
  }, 30_000);
  checkSnoozes();
  kickOutbox();
  kick();
  // Catch up straight after the computer wakes or comes back online.
  powerMonitor.on('resume', () => void syncAll(true));
}

export function stopScheduler(): void {
  if (timer) clearTimeout(timer);
  if (chatTimer) clearInterval(chatTimer);
}
