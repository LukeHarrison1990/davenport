// Local cache: SQLite built into Electron (node:sqlite), with FTS5 for instant search.
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';

let db: DatabaseSync;

const SCHEMA_VERSION = 2;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);

CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY, email TEXT NOT NULL, name TEXT, kind TEXT NOT NULL, color TEXT,
  is_workspace INTEGER DEFAULT 0, chat_enabled INTEGER DEFAULT 0, tokens TEXT, scopes TEXT,
  history_id TEXT, last_sync INTEGER, status TEXT DEFAULT 'ok', error TEXT, sort INTEGER DEFAULT 0,
  initial_done INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS labels (
  account_id TEXT, id TEXT, name TEXT, path TEXT, type TEXT, color TEXT,
  is_category INTEGER DEFAULT 0, hidden INTEGER DEFAULT 0,
  PRIMARY KEY (account_id, id)
);

CREATE TABLE IF NOT EXISTS messages (
  account_id TEXT, id TEXT, thread_id TEXT, from_name TEXT, from_email TEXT,
  to_json TEXT, cc_json TEXT, bcc_json TEXT, reply_to_json TEXT, subject TEXT, snippet TEXT, date INTEGER,
  labels TEXT, has_attach INTEGER DEFAULT 0, size INTEGER, unread INTEGER DEFAULT 0, starred INTEGER DEFAULT 0,
  body_html TEXT, body_text TEXT, attachments_json TEXT, msgid_header TEXT, references_header TEXT,
  list_unsub TEXT, body_fetched INTEGER DEFAULT 0, snooze_until INTEGER, flag_due INTEGER, task_id TEXT,
  PRIMARY KEY (account_id, id)
);
CREATE INDEX IF NOT EXISTS msg_date ON messages(account_id, date DESC);
CREATE INDEX IF NOT EXISTS msg_thread ON messages(account_id, thread_id);

-- Many-to-many message <-> label for fast folder listing and counts.
CREATE TABLE IF NOT EXISTS message_labels (
  account_id TEXT, message_id TEXT, label_id TEXT,
  PRIMARY KEY (account_id, label_id, message_id)
);
CREATE INDEX IF NOT EXISTS ml_msg ON message_labels(account_id, message_id);

-- Full-text index. Each row's rowid is the rowid of its message, so lookups and updates are instant;
-- prefix indexes keep searches for 2-3 letters fast.
CREATE VIRTUAL TABLE IF NOT EXISTS mail_index USING fts5(
  subject, sender, recipients, body, tokenize = 'unicode61 remove_diacritics 2', prefix = '2 3'
);

CREATE TABLE IF NOT EXISTS outbox (
  id TEXT PRIMARY KEY, account_id TEXT, draft_json TEXT, send_at INTEGER, status TEXT, error TEXT, created INTEGER
);

CREATE TABLE IF NOT EXISTS pending_ops (
  seq INTEGER PRIMARY KEY AUTOINCREMENT, account_id TEXT, kind TEXT, payload TEXT, attempts INTEGER DEFAULT 0,
  next_try INTEGER DEFAULT 0, last_error TEXT
);

CREATE TABLE IF NOT EXISTS kv (scope TEXT, id TEXT, value TEXT, PRIMARY KEY (scope, id));

CREATE TABLE IF NOT EXISTS calendars (
  account_id TEXT, id TEXT, name TEXT, color TEXT, is_primary INTEGER, selected INTEGER, access_role TEXT, kind TEXT,
  PRIMARY KEY (account_id, id)
);
CREATE TABLE IF NOT EXISTS events (
  account_id TEXT, calendar_id TEXT, id TEXT, start INTEGER, end INTEGER, json TEXT,
  PRIMARY KEY (account_id, calendar_id, id)
);
CREATE INDEX IF NOT EXISTS ev_range ON events(start, end);

CREATE TABLE IF NOT EXISTS contacts (
  account_id TEXT, id TEXT, name TEXT, emails TEXT, source TEXT, json TEXT,
  PRIMARY KEY (account_id, id)
);
CREATE INDEX IF NOT EXISTS ct_name ON contacts(name);
CREATE TABLE IF NOT EXISTS contact_groups (account_id TEXT, id TEXT, name TEXT, count INTEGER, PRIMARY KEY (account_id, id));

CREATE TABLE IF NOT EXISTS tasklists (account_id TEXT, id TEXT, title TEXT, PRIMARY KEY (account_id, id));
CREATE TABLE IF NOT EXISTS tasks (account_id TEXT, list_id TEXT, id TEXT, json TEXT, PRIMARY KEY (account_id, list_id, id));

CREATE TABLE IF NOT EXISTS chat_spaces (account_id TEXT, id TEXT, json TEXT, last_active INTEGER, PRIMARY KEY (account_id, id));
CREATE TABLE IF NOT EXISTS chat_messages (
  account_id TEXT, space_id TEXT, id TEXT, create_time INTEGER, thread_id TEXT, json TEXT,
  PRIMARY KEY (account_id, space_id, id)
);
CREATE INDEX IF NOT EXISTS cm_time ON chat_messages(account_id, space_id, create_time);
`;

export function openDatabase(userDataDir: string, file = 'davenport.db'): DatabaseSync {
  if (file !== ':memory:') fs.mkdirSync(userDataDir, { recursive: true });
  db = new DatabaseSync(file === ':memory:' ? ':memory:' : path.join(userDataDir, file));
  db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = OFF;');
  db.exec(SCHEMA);
  const v = get<{ value: string }>('SELECT value FROM meta WHERE key = ?', 'schema');
  const from = v ? Number(v.value) : SCHEMA_VERSION;
  if (from < 2) migrateSearchIndex();
  run('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', 'schema', String(SCHEMA_VERSION));
  return db;
}

/** Version 2 replaced the slow messages_fts table with mail_index; rebuild it once from the cached mail. */
function migrateSearchIndex(): void {
  db.exec('DROP TABLE IF EXISTS messages_fts');
  db.exec('DELETE FROM mail_index');
  const rows = db.prepare('SELECT rowid AS r, subject, from_name, from_email, to_json, cc_json, body_text, body_html, snippet FROM messages').all() as {
    r: number; subject: string; from_name: string | null; from_email: string; to_json: string; cc_json: string; body_text: string | null; body_html: string | null; snippet: string;
  }[];
  const ins = db.prepare('INSERT INTO mail_index (rowid, subject, sender, recipients, body) VALUES (?, ?, ?, ?, ?)');
  db.exec('BEGIN');
  for (const m of rows) {
    const people = [...JSON.parse(m.to_json || '[]'), ...JSON.parse(m.cc_json || '[]')] as { name?: string; email: string }[];
    ins.run(m.r, m.subject ?? '', `${m.from_name ?? ''} ${m.from_email}`, people.map((a) => `${a.name ?? ''} ${a.email}`).join(' '), indexBody(m.body_text, m.body_html, m.snippet));
  }
  db.exec('COMMIT');
}

export function indexBody(text: string | null | undefined, html: string | null | undefined, snippet: string): string {
  const body = text ?? (html ? html.replace(/<(style|script)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ') : snippet);
  return body.slice(0, 20000);
}

export function getDb(): DatabaseSync {
  return db;
}

type Param = SQLInputValue | boolean | undefined;
const norm = (ps: Param[]): SQLInputValue[] =>
  ps.map((p) => (p === undefined ? null : typeof p === 'boolean' ? (p ? 1 : 0) : p));

export function all<T>(sql: string, ...params: Param[]): T[] {
  return db.prepare(sql).all(...norm(params)) as T[];
}
export function get<T>(sql: string, ...params: Param[]): T | undefined {
  return db.prepare(sql).get(...norm(params)) as T | undefined;
}
export function run(sql: string, ...params: Param[]): void {
  db.prepare(sql).run(...norm(params));
}

/** Runs fn inside a transaction; nested calls join the outer transaction. */
let depth = 0;
export function tx<T>(fn: () => T): T {
  if (depth > 0) return fn();
  depth++;
  db.exec('BEGIN');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  } finally {
    depth--;
  }
}

// Simple JSON key/value store for rules, quick steps, templates, settings and more.
export function kvGet<T>(scope: string, id: string): T | undefined {
  const r = get<{ value: string }>('SELECT value FROM kv WHERE scope = ? AND id = ?', scope, id);
  return r ? (JSON.parse(r.value) as T) : undefined;
}
export function kvAll<T>(scope: string): T[] {
  return all<{ value: string }>('SELECT value FROM kv WHERE scope = ? ORDER BY rowid', scope).map((r) => JSON.parse(r.value) as T);
}
export function kvSet(scope: string, id: string, value: unknown): void {
  run('INSERT INTO kv (scope, id, value) VALUES (?, ?, ?) ON CONFLICT(scope, id) DO UPDATE SET value = excluded.value', scope, id, JSON.stringify(value));
}
export function kvDelete(scope: string, id: string): void {
  run('DELETE FROM kv WHERE scope = ? AND id = ?', scope, id);
}

export const uid = (): string =>
  Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
