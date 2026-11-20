// The offline queue: changes are applied to the local cache at once and replayed to Google in order.
// If you're offline, operations wait and retry with backoff; nothing is lost when the app restarts.
import { all, get, run } from '../db';
import { GoogleApiError, ReauthRequired } from '../google/http';
import { isDemo, setStatus } from './accounts';
import { toast } from '../events';

type Handler = (accountId: string, payload: any) => Promise<void>;
const handlers = new Map<string, Handler>();

export function registerOp(kind: string, handler: Handler): void {
  handlers.set(kind, handler);
}

// Called when Google refuses a change for good, so the local copy can be put back in step with Gmail.
type FailureHook = (accountId: string, kind: string, payload: any, notFound: boolean) => Promise<void>;
let onPermanentFailure: FailureHook | null = null;
export function setPermanentFailureHook(fn: FailureHook): void {
  onPermanentFailure = fn;
}

export function enqueue(accountId: string, kind: string, payload: unknown): void {
  if (isDemo(accountId)) return; // the demo account lives only in the local cache
  run('INSERT INTO pending_ops (account_id, kind, payload) VALUES (?, ?, ?)', accountId, kind, JSON.stringify(payload));
  kick();
}

let running = false;
let timer: NodeJS.Timeout | null = null;

export function kick(delay = 50): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => void drain(), delay);
}

export function pendingCount(accountId?: string): number {
  return (accountId
    ? get<{ n: number }>('SELECT COUNT(*) AS n FROM pending_ops WHERE account_id = ?', accountId)
    : get<{ n: number }>('SELECT COUNT(*) AS n FROM pending_ops'))?.n ?? 0;
}

async function drain(): Promise<void> {
  if (running) return;
  running = true;
  try {
    for (;;) {
      const now = Date.now();
      const op = get<{ seq: number; account_id: string; kind: string; payload: string; attempts: number }>(
        'SELECT * FROM pending_ops WHERE next_try <= ? ORDER BY seq LIMIT 1',
        now
      );
      if (!op) break;
      // Operations for one account stay in order: skip accounts whose head op is waiting.
      const head = get<{ seq: number }>('SELECT seq FROM pending_ops WHERE account_id = ? ORDER BY seq LIMIT 1', op.account_id);
      if (head && head.seq !== op.seq) {
        run('UPDATE pending_ops SET next_try = ? WHERE seq = ?', now + 1000, op.seq);
        continue;
      }
      const h = handlers.get(op.kind);
      if (!h) {
        run('DELETE FROM pending_ops WHERE seq = ?', op.seq);
        continue;
      }
      try {
        await h(op.account_id, JSON.parse(op.payload));
        run('DELETE FROM pending_ops WHERE seq = ?', op.seq);
      } catch (e) {
        if (e instanceof ReauthRequired) {
          setStatus(op.account_id, 'reauth', e.message);
          run('UPDATE pending_ops SET next_try = ? WHERE account_id = ?', now + 60_000, op.account_id);
          continue;
        }
        const permanent = e instanceof GoogleApiError && e.status >= 400 && e.status < 500 && e.status !== 429;
        if (permanent || op.attempts >= 8) {
          run('DELETE FROM pending_ops WHERE seq = ?', op.seq);
          const notFound = e instanceof GoogleApiError && e.status === 404;
          // A message that's already gone from Gmail needs no warning; anything else does.
          if (!notFound) toast({ kind: 'error', text: `Couldn't sync a change to Google: ${(e as Error).message}` });
          await onPermanentFailure?.(op.account_id, op.kind, JSON.parse(op.payload), notFound).catch(() => undefined);
        } else {
          const wait = Math.min(5 * 60_000, 2000 * 2 ** op.attempts);
          run('UPDATE pending_ops SET attempts = attempts + 1, next_try = ?, last_error = ? WHERE seq = ?', now + wait, String(e), op.seq);
          setStatus(op.account_id, 'offline', 'Waiting to reconnect');
        }
      }
    }
  } finally {
    running = false;
    const next = get<{ t: number }>('SELECT MIN(next_try) AS t FROM pending_ops');
    if (next?.t) kick(Math.max(200, next.t - Date.now()));
  }
}

export function pendingKinds(accountId: string): string[] {
  return all<{ kind: string }>('SELECT kind FROM pending_ops WHERE account_id = ?', accountId).map((r) => r.kind);
}
