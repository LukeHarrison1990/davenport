// Accounts: Google sign-in, the demo account, and per-account API clients.
import type { Account } from '../../shared/types';
import { all, get, run, tx, uid } from '../db';
import { changed, emit } from '../events';
import { GoogleClient, saveTokens } from '../google/http';
import { BASE_SCOPES, CHAT_SCOPES, revoke, signIn } from '../google/oauth';
import { unseal } from '../secure';

const PALETTE = ['#1F3A5F', '#9A7740', '#2E7D5B', '#7A4E9C', '#B3361F', '#24497A', '#5C6B2E'];

interface Row {
  id: string;
  email: string;
  name: string;
  kind: 'google' | 'demo';
  color: string;
  is_workspace: number;
  chat_enabled: number;
  status: Account['status'];
  error: string | null;
  last_sync: number | null;
  sort: number;
}

const toAccount = (r: Row): Account => ({
  id: r.id,
  email: r.email,
  name: r.name,
  kind: r.kind,
  color: r.color,
  isWorkspace: !!r.is_workspace,
  chatEnabled: !!r.chat_enabled,
  status: r.status,
  error: r.error ?? undefined,
  lastSync: r.last_sync ?? undefined,
  order: r.sort
});

export function listAccounts(): Account[] {
  return all<Row>('SELECT * FROM accounts ORDER BY sort, email').map(toAccount);
}

export function getAccount(id: string): Account {
  const r = get<Row>('SELECT * FROM accounts WHERE id = ?', id);
  if (!r) throw new Error('Account not found');
  return toAccount(r);
}

export function isDemo(id: string): boolean {
  return get<{ kind: string }>('SELECT kind FROM accounts WHERE id = ?', id)?.kind === 'demo';
}

const clients = new Map<string, GoogleClient>();
export function client(accountId: string): GoogleClient {
  let c = clients.get(accountId);
  if (!c) {
    c = new GoogleClient(accountId);
    clients.set(accountId, c);
  }
  return c;
}

export function setStatus(accountId: string, status: Account['status'], error?: string): void {
  // Every sync reports its status; only tell the window when it actually changes, or each sync would
  // reload the folder pane, counts and account list for nothing.
  const cur = get<{ status: string; error: string | null }>('SELECT status, error FROM accounts WHERE id = ?', accountId);
  if (cur && cur.status === status && (cur.error ?? undefined) === (error ?? undefined)) return;
  run('UPDATE accounts SET status = ?, error = ? WHERE id = ?', status, error ?? null, accountId);
  emit('syncStatus', { accountId, status, detail: error });
  changed('accounts');
}

function nextColor(): string {
  const used = new Set(listAccounts().map((a) => a.color));
  return PALETTE.find((c) => !used.has(c)) ?? PALETTE[listAccounts().length % PALETTE.length];
}

export async function addGoogleAccount(): Promise<Account> {
  const res = await signIn({ scopes: BASE_SCOPES });
  if (!res.tokens.refresh_token) throw new Error('Google did not return a refresh token. Remove Davenport from your Google account permissions and try again.');
  const existing = get<{ id: string }>('SELECT id FROM accounts WHERE email = ? AND kind = ?', res.email, 'google');
  const id = existing?.id ?? uid();
  tx(() => {
    if (!existing) {
      const sort = (get<{ n: number }>('SELECT COUNT(*) AS n FROM accounts')?.n ?? 0) + 1;
      run(
        'INSERT INTO accounts (id, email, name, kind, color, is_workspace, chat_enabled, status, sort) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)',
        id, res.email, res.name, 'google', nextColor(), !!res.hostedDomain, 'syncing', sort
      );
    } else {
      run("UPDATE accounts SET name = ?, status = 'syncing', error = NULL WHERE id = ?", res.name, id);
    }
    saveTokens(id, res.tokens);
  });
  clients.delete(id);
  changed('accounts');
  return getAccount(id);
}

export async function reauthAccount(accountId: string): Promise<Account> {
  const a = getAccount(accountId);
  const scopes = a.chatEnabled ? [...BASE_SCOPES, ...CHAT_SCOPES] : BASE_SCOPES;
  const res = await signIn({ scopes, loginHint: a.email });
  if (res.email.toLowerCase() !== a.email.toLowerCase()) throw new Error(`You signed in as ${res.email}, but this account is ${a.email}.`);
  saveTokens(accountId, res.tokens);
  clients.delete(accountId);
  setStatus(accountId, 'ok');
  return getAccount(accountId);
}

export async function enableChat(accountId: string): Promise<Account> {
  const a = getAccount(accountId);
  if (a.kind === 'demo') {
    run('UPDATE accounts SET chat_enabled = 1 WHERE id = ?', accountId);
    changed('accounts');
    return getAccount(accountId);
  }
  if (!a.isWorkspace) throw new Error('Google Chat is only available to apps for Google Workspace accounts.');
  const res = await signIn({ scopes: [...BASE_SCOPES, ...CHAT_SCOPES], loginHint: a.email });
  saveTokens(accountId, res.tokens);
  clients.delete(accountId);
  run('UPDATE accounts SET chat_enabled = 1 WHERE id = ?', accountId);
  changed('accounts');
  return getAccount(accountId);
}

export function createDemoAccount(): string {
  const existing = get<{ id: string }>("SELECT id FROM accounts WHERE kind = 'demo'");
  if (existing) return existing.id;
  const id = 'demo';
  const sort = (get<{ n: number }>('SELECT COUNT(*) AS n FROM accounts')?.n ?? 0) + 1;
  run(
    "INSERT INTO accounts (id, email, name, kind, color, is_workspace, chat_enabled, status, sort, initial_done, last_sync) VALUES (?, ?, ?, 'demo', ?, 1, 1, 'ok', ?, 1, ?)",
    id, 'alex@northfield.example', 'Alex Morgan (demo)', nextColor(), sort, Date.now()
  );
  return id;
}

export async function removeAccount(accountId: string): Promise<void> {
  const row = get<{ tokens: string; kind: string }>('SELECT tokens, kind FROM accounts WHERE id = ?', accountId);
  if (row?.kind === 'google') {
    const plain = unseal(row.tokens);
    if (plain) await revoke(JSON.parse(plain).refresh);
  }
  tx(() => {
    run('DELETE FROM mail_index WHERE rowid IN (SELECT rowid FROM messages WHERE account_id = ?)', accountId);
    for (const t of ['labels', 'messages', 'message_labels', 'outbox', 'pending_ops', 'calendars', 'events', 'contacts', 'contact_groups', 'tasklists', 'tasks', 'chat_spaces', 'chat_messages']) {
      run(`DELETE FROM ${t} WHERE account_id = ?`, accountId);
    }
    run('DELETE FROM accounts WHERE id = ?', accountId);
  });
  clients.delete(accountId);
  changed('accounts');
}

export function setAccountColor(accountId: string, color: string): void {
  run('UPDATE accounts SET color = ? WHERE id = ?', color, accountId);
  changed('accounts');
  changed('calendar');
}
