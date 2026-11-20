// Schedules background syncing for every account: mail every ~45 s, chat every 30 s,
// calendar and tasks every 5 minutes, contacts every 30 minutes.
import { powerMonitor } from 'electron';
import { listAccounts, setStatus } from './services/accounts';
import { checkSnoozes, kickOutbox, recoverOutbox, syncMail } from './services/mail';
import { checkReminders, syncCalendar } from './services/calendar';
import { syncDirectory, syncPeople } from './services/people';
import { syncTasks } from './services/tasks';
import { syncChat } from './services/chat';
import { getSettings } from './settings';
import { kick } from './services/ops';
import { updateBadge } from './tray';
import { emit, toast } from './events';
import type { Account, SyncProgress } from '../shared/types';

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

interface Stage {
  label: string;
  run: () => Promise<void>;
}

/** What a sync of this account involves. Background syncs skip work that isn't due yet; Send / Receive does everything. */
function stagesFor(a: Account, full: boolean): Stage[] {
  const id = a.id;
  if (full) for (const k of ['cal', 'people', 'tasks', 'chat', 'dir']) last.delete(`${k}|${id}`);
  const stages: Stage[] = [{ label: 'Mail', run: () => guard(id, 'mail', () => syncMail(id)) }];
  if (due(`cal|${id}`, 5 * 60_000)) stages.push({ label: 'Calendar', run: () => guard(id, 'calendar', () => syncCalendar(id)) });
  if (due(`tasks|${id}`, 5 * 60_000)) stages.push({ label: 'Tasks', run: () => guard(id, 'tasks', () => syncTasks(id)) });
  if (due(`people|${id}`, 30 * 60_000)) stages.push({ label: 'Contacts', run: () => guard(id, 'people', () => syncPeople(id)) });
  // The organisation directory changes slowly: refresh it every six hours (only changes are downloaded).
  if (a.isWorkspace && due(`dir|${id}`, 6 * 3600_000)) stages.push({ label: 'Directory', run: () => guard(id, 'directory', () => syncDirectory(id).then(() => undefined)) });
  if (a.chatEnabled && due(`chat|${id}`, 30_000)) stages.push({ label: 'Chat', run: () => guard(id, 'chat', () => syncChat(id)) });
  return stages;
}

const syncable = (a: Account | undefined): boolean => !!a && a.kind === 'google' && a.status !== 'reauth';

export async function syncAccount(accountId: string, full = false): Promise<void> {
  const a = listAccounts().find((x) => x.id === accountId);
  if (!a || !syncable(a)) return;
  for (const st of stagesFor(a, full)) await st.run();
  updateBadge();
}

export async function syncAll(full = false): Promise<void> {
  await Promise.all(listAccounts().map((a) => syncAccount(a.id, full)));
}

let progress: SyncProgress = { active: false, done: 0, total: 0, label: '' };
export const syncProgress = (): SyncProgress => progress;
function report(p: SyncProgress): void {
  progress = p;
  emit('syncProgress', p);
}

let running: Promise<void> | null = null;

/** Send / Receive (F9): sends anything waiting, then fully syncs every account, reporting progress as it goes. */
export function manualSync(accountId?: string): Promise<void> {
  // A second press while one is running just waits for it.
  if (running) return running;
  running = (async () => {
    const accounts = listAccounts().filter((a) => !accountId || a.id === accountId);
    for (const a of accounts) if (a.status === 'offline' || a.status === 'error') setStatus(a.id, 'syncing');
    kick();
    kickOutbox();
    const plan = accounts.map((a) => ({
      a,
      stages: syncable(a)
        ? stagesFor(a, true)
        : a.kind === 'demo'
          ? // The demo account has nothing to download; walk through the same steps so Send / Receive looks and feels the same.
            ['Mail', 'Calendar', 'Tasks', 'Contacts', 'Chat'].map((label) => ({ label, run: () => new Promise<void>((r) => setTimeout(r, 220)) }))
          : []
    }));
    const total = plan.reduce((n, p) => n + p.stages.length, 0);
    let done = 0;
    const many = accounts.length > 1;
    report({ active: true, done, total, label: 'Sending' });
    await Promise.all(
      plan.map(async ({ a, stages }) => {
        for (const st of stages) {
          report({ active: true, done, total, label: many ? `${st.label} · ${a.email}` : st.label });
          await st.run();
          done++;
          report({ active: true, done, total, label: many ? `${st.label} · ${a.email}` : st.label });
        }
      })
    );
    updateBadge();
    report({ active: false, done: total, total, label: '', finishedAt: Date.now() });
    const failed = listAccounts().filter((a) => accounts.some((x) => x.id === a.id) && (a.status === 'error' || a.status === 'offline'));
    if (failed.length) toast({ kind: 'error', text: `Couldn't sync ${failed.map((a) => a.email).join(', ')}: ${failed[0].error ?? 'check your connection'}` });
  })().finally(() => {
    running = null;
  });
  return running;
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
  recoverOutbox();
  kickOutbox();
  kick();
  // Catch up straight after the computer wakes or comes back online.
  powerMonitor.on('resume', () => void syncAll(true));
}

export function stopScheduler(): void {
  if (timer) clearTimeout(timer);
  if (chatTimer) clearInterval(chatTimer);
}
