// Mail in the local cache: storing, listing, counting and searching messages.
import type { Addr, Folder, ListQuery, MessageDetail, MessageSummary } from '../../shared/types';
import { all, get, indexBody, kvAll, run, tx } from '../db';
import type { ParsedMessage } from '../google/gmail';
import { getSettings } from '../settings';

export const SYSTEM_FOLDERS: { id: string; name: string }[] = [
  { id: 'INBOX', name: 'Inbox' },
  { id: 'DRAFT', name: 'Drafts' },
  { id: 'SENT', name: 'Sent' },
  { id: 'SCHEDULED', name: 'Scheduled' },
  { id: 'SNOOZED', name: 'Snoozed' },
  { id: 'STARRED', name: 'Flagged' },
  { id: 'ALL', name: 'All Mail' },
  { id: 'SPAM', name: 'Spam' },
  { id: 'TRASH', name: 'Bin' }
];
const HIDDEN_SYSTEM = new Set([
  'UNREAD', 'IMPORTANT', 'CHAT', 'CATEGORY_PERSONAL', 'CATEGORY_SOCIAL', 'CATEGORY_PROMOTIONS', 'CATEGORY_UPDATES', 'CATEGORY_FORUMS', 'YELLOW_STAR'
]);
export const SNOOZE_LABEL_NAME = 'Davenport/Snoozed';
const OTHER_CATEGORIES = ['CATEGORY_SOCIAL', 'CATEGORY_PROMOTIONS', 'CATEGORY_UPDATES', 'CATEGORY_FORUMS'];

interface MsgRow {
  account_id: string;
  id: string;
  thread_id: string;
  from_name: string | null;
  from_email: string;
  to_json: string;
  cc_json: string;
  bcc_json: string | null;
  reply_to_json: string | null;
  subject: string;
  snippet: string;
  date: number;
  labels: string;
  has_attach: number;
  unread: number;
  starred: number;
  body_html: string | null;
  body_text: string | null;
  attachments_json: string | null;
  msgid_header: string | null;
  references_header: string | null;
  list_unsub: string | null;
  body_fetched: number;
  snooze_until: number | null;
  last_date?: number;
  flag_due: number | null;
  task_id?: string | null;
  cnt?: number;
  any_unread?: number;
}

const parseJson = <T>(s: string | null | undefined, d: T): T => {
  if (!s) return d;
  try {
    return JSON.parse(s) as T;
  } catch {
    return d;
  }
};

// ---------- Writing ----------

export function upsertMessage(accountId: string, p: ParsedMessage): void {
  tx(() => {
    const existing = get<{ body_fetched: number; snooze_until: number | null; flag_due: number | null; task_id: string | null }>(
      'SELECT body_fetched, snooze_until, flag_due, task_id FROM messages WHERE account_id = ? AND id = ?',
      accountId,
      p.id
    );
    const keepBody = existing?.body_fetched && !p.full;
    run(
      `INSERT INTO messages (account_id, id, thread_id, from_name, from_email, to_json, cc_json, bcc_json, reply_to_json, subject, snippet,
        date, labels, has_attach, size, unread, starred, body_html, body_text, attachments_json, msgid_header, references_header, list_unsub, body_fetched,
        snooze_until, flag_due, task_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(account_id, id) DO UPDATE SET
        thread_id = excluded.thread_id, from_name = excluded.from_name, from_email = excluded.from_email, to_json = excluded.to_json,
        cc_json = excluded.cc_json, bcc_json = excluded.bcc_json, reply_to_json = excluded.reply_to_json, subject = excluded.subject,
        snippet = excluded.snippet, date = excluded.date, labels = excluded.labels, has_attach = excluded.has_attach, size = excluded.size,
        unread = excluded.unread, starred = excluded.starred, msgid_header = excluded.msgid_header, references_header = excluded.references_header,
        list_unsub = excluded.list_unsub
        ${keepBody ? '' : ', body_html = excluded.body_html, body_text = excluded.body_text, attachments_json = excluded.attachments_json, body_fetched = excluded.body_fetched'}`,
      accountId, p.id, p.threadId, p.from.name ?? null, p.from.email, JSON.stringify(p.to), JSON.stringify(p.cc), JSON.stringify(p.bcc),
      JSON.stringify(p.replyTo), p.subject, p.snippet, p.date, JSON.stringify(p.labelIds), p.hasAttachments, p.size,
      p.labelIds.includes('UNREAD'), p.labelIds.includes('STARRED'), p.full ? p.html ?? null : null, p.full ? p.text ?? null : null,
      p.full ? JSON.stringify(p.attachments) : null, p.messageIdHeader, p.references, p.listUnsubscribe, p.full ? 1 : 0,
      existing?.snooze_until ?? null, existing?.flag_due ?? null, existing?.task_id ?? null
    );
    writeLabels(accountId, p.id, p.labelIds);
    const row = get<{ r: number; body_text: string | null; body_html: string | null }>(
      'SELECT rowid AS r, body_text, body_html FROM messages WHERE account_id = ? AND id = ?', accountId, p.id
    )!;
    const recipients = [...p.to, ...p.cc].map((a) => `${a.name ?? ''} ${a.email}`).join(' ');
    // When only headers were refreshed, keep indexing the full body we already have.
    const body = p.full ? indexBody(p.text, p.html, p.snippet) : indexBody(row.body_text, row.body_html, p.snippet);
    run('DELETE FROM mail_index WHERE rowid = ?', row.r);
    run('INSERT INTO mail_index (rowid, subject, sender, recipients, body) VALUES (?, ?, ?, ?, ?)', row.r, p.subject, `${p.from.name ?? ''} ${p.from.email}`, recipients, body);
  });
}

function writeLabels(accountId: string, id: string, labels: string[]): void {
  run('DELETE FROM message_labels WHERE account_id = ? AND message_id = ?', accountId, id);
  for (const l of labels) run('INSERT OR IGNORE INTO message_labels (account_id, message_id, label_id) VALUES (?, ?, ?)', accountId, id, l);
}

export function getLabels(accountId: string, id: string): string[] {
  return parseJson<string[]>(get<{ labels: string }>('SELECT labels FROM messages WHERE account_id = ? AND id = ?', accountId, id)?.labels, []);
}

export function setLabels(accountId: string, id: string, labels: string[]): void {
  const uniq = [...new Set(labels)];
  run(
    'UPDATE messages SET labels = ?, unread = ?, starred = ? WHERE account_id = ? AND id = ?',
    JSON.stringify(uniq), uniq.includes('UNREAD'), uniq.includes('STARRED'), accountId, id
  );
  writeLabels(accountId, id, uniq);
}

/** Applies a label change locally and returns the ids that actually changed. */
export function modifyLocal(accountId: string, ids: string[], add: string[], remove: string[]): string[] {
  const changedIds: string[] = [];
  tx(() => {
    for (const id of ids) {
      const before = getLabels(accountId, id);
      const after = before.filter((l) => !remove.includes(l)).concat(add.filter((l) => !before.includes(l)));
      if (after.length !== before.length || after.some((l, i) => l !== before[i])) {
        setLabels(accountId, id, after);
        changedIds.push(id);
      }
    }
  });
  return changedIds;
}

export function deleteLocal(accountId: string, ids: string[]): void {
  tx(() => {
    for (const id of ids) {
      const r = get<{ r: number }>('SELECT rowid AS r FROM messages WHERE account_id = ? AND id = ?', accountId, id)?.r;
      if (r !== undefined) run('DELETE FROM mail_index WHERE rowid = ?', r);
      run('DELETE FROM messages WHERE account_id = ? AND id = ?', accountId, id);
      run('DELETE FROM message_labels WHERE account_id = ? AND message_id = ?', accountId, id);
    }
  });
}

export function threadIds(accountId: string, threadId: string): string[] {
  return all<{ id: string }>('SELECT id FROM messages WHERE account_id = ? AND thread_id = ?', accountId, threadId).map((r) => r.id);
}

// ---------- Labels / folders ----------

interface LabelRow {
  account_id: string;
  id: string;
  name: string;
  path: string;
  type: 'system' | 'user';
  color: string | null;
  is_category: number;
  hidden: number;
}

export function labelRows(accountId: string): LabelRow[] {
  return all<LabelRow>('SELECT * FROM labels WHERE account_id = ?', accountId);
}

export function labelByPath(accountId: string, path: string): LabelRow | undefined {
  return get<LabelRow>('SELECT * FROM labels WHERE account_id = ? AND path = ?', accountId, path);
}

export function snoozeLabelId(accountId: string): string | undefined {
  return labelByPath(accountId, SNOOZE_LABEL_NAME)?.id;
}

export function folders(accountId: string): Folder[] {
  const counts = new Map<string, { total: number; unread: number }>();
  for (const r of all<{ label_id: string; total: number; unread: number }>(
    // Counted from the label table alone (UNREAD, TRASH and SPAM are labels too), without reading the messages.
    `WITH binned AS MATERIALIZED (SELECT message_id FROM message_labels WHERE account_id = ? AND label_id IN ('TRASH', 'SPAM')),
          unread AS MATERIALIZED (SELECT message_id FROM message_labels WHERE account_id = ? AND label_id = 'UNREAD')
     SELECT l.label_id, COUNT(*) AS total, SUM(l.message_id IN unread) AS unread FROM message_labels l
     WHERE l.account_id = ? AND (l.label_id IN ('TRASH', 'SPAM') OR l.message_id NOT IN binned)
     GROUP BY l.label_id`,
    accountId, accountId, accountId
  )) {
    counts.set(r.label_id, { total: r.total, unread: r.unread ?? 0 });
  }
  const out: Folder[] = [];
  const snoozeId = snoozeLabelId(accountId);
  for (const s of SYSTEM_FOLDERS) {
    let c = counts.get(s.id) ?? { total: 0, unread: 0 };
    if (s.id === 'SCHEDULED') {
      const n = get<{ n: number }>("SELECT COUNT(*) AS n FROM outbox WHERE account_id = ? AND status != 'sent'", accountId)?.n ?? 0;
      c = { total: n, unread: 0 };
    }
    if (s.id === 'SNOOZED') c = snoozeId ? counts.get(snoozeId) ?? c : c;
    if (s.id === 'ALL') c = { total: 0, unread: 0 };
    // Outlook shows Drafts and Scheduled as item counts rather than unread.
    const unread = ['DRAFT', 'SCHEDULED', 'SENT', 'TRASH', 'STARRED', 'ALL'].includes(s.id) ? 0 : c.unread;
    out.push({ accountId, id: s.id, name: s.name, path: s.name, type: 'system', unread, total: c.total, isCategory: false });
  }
  for (const l of labelRows(accountId)) {
    if (l.type === 'system' || HIDDEN_SYSTEM.has(l.id) || l.path === SNOOZE_LABEL_NAME) continue;
    const c = counts.get(l.id) ?? { total: 0, unread: 0 };
    out.push({
      accountId, id: l.id, name: l.name, path: l.path, type: 'user', unread: c.unread, total: c.total,
      color: l.color ?? undefined, isCategory: !!l.is_category, hidden: !!l.hidden
    });
  }
  return out;
}

function categoryMap(accountId: string): Map<string, { name: string; color: string }> {
  const m = new Map<string, { name: string; color: string }>();
  for (const l of labelRows(accountId)) if (l.is_category) m.set(l.id, { name: l.name, color: l.color ?? '#5B6472' });
  return m;
}

// ---------- Reading ----------

function toSummary(r: MsgRow, cats: Map<string, { name: string; color: string }>): MessageSummary {
  const labels = parseJson<string[]>(r.labels, []);
  return {
    accountId: r.account_id,
    id: r.id,
    threadId: r.thread_id,
    from: { name: r.from_name ?? undefined, email: r.from_email },
    to: parseJson<Addr[]>(r.to_json, []),
    cc: parseJson<Addr[]>(r.cc_json, []),
    subject: r.subject || '(no subject)',
    snippet: r.snippet,
    date: r.date,
    unread: r.any_unread !== undefined ? !!r.any_unread : !!r.unread,
    flagged: !!r.starred,
    important: labels.includes('IMPORTANT'),
    hasAttachments: !!r.has_attach,
    labelIds: labels,
    categories: labels.filter((l) => cats.has(l)).map((l) => cats.get(l)!),
    snoozedUntil: r.snooze_until ?? undefined,
    flagDue: r.flag_due ?? undefined,
    threadCount: r.cnt
  };
}

export function getRow(accountId: string, id: string): MsgRow | undefined {
  return get<MsgRow>('SELECT * FROM messages WHERE account_id = ? AND id = ?', accountId, id);
}

export function getSummary(accountId: string, id: string): MessageSummary | undefined {
  const r = getRow(accountId, id);
  return r ? toSummary(r, categoryMap(accountId)) : undefined;
}

export function getDetail(accountId: string, id: string): MessageDetail | undefined {
  const r = getRow(accountId, id);
  if (!r) return undefined;
  const s = toSummary(r, categoryMap(accountId));
  const html = r.body_html ?? undefined;
  return {
    ...s,
    bcc: parseJson<Addr[]>(r.bcc_json, []),
    replyTo: parseJson<Addr[]>(r.reply_to_json, []),
    html,
    text: r.body_text ?? undefined,
    attachments: parseJson(r.attachments_json, []),
    messageIdHeader: r.msgid_header ?? undefined,
    references: r.references_header ?? undefined,
    listUnsubscribe: r.list_unsub ?? undefined,
    hasRemoteImages: !!html && /<img[^>]+src=["']?https?:/i.test(html)
  };
}

export function bodyFetched(accountId: string, id: string): boolean {
  return !!getRow(accountId, id)?.body_fetched;
}

/** Converts a Gmail-style search into a local full-text query plus simple filters. */
export function localSearchSql(q: string): { where: string[]; params: (string | number)[]; fts?: string } {
  const where: string[] = [];
  const params: (string | number)[] = [];
  const free: string[] = [];
  const tokens = q.match(/(\w+:"[^"]*"|\w+:\([^)]*\)|\w+:\S+|"[^"]*"|\S+)/g) ?? [];
  for (const t of tokens) {
    const m = t.match(/^(\w+):(.*)$/);
    const val = m ? m[2].replace(/^["(]|[")]$/g, '').toLowerCase() : '';
    switch (m?.[1].toLowerCase()) {
      case 'from':
        where.push('(LOWER(m.from_email) LIKE ? OR LOWER(m.from_name) LIKE ?)');
        params.push(`%${val}%`, `%${val}%`);
        break;
      case 'to':
        where.push('(LOWER(m.to_json) LIKE ? OR LOWER(m.cc_json) LIKE ?)');
        params.push(`%${val}%`, `%${val}%`);
        break;
      case 'subject':
        where.push('LOWER(m.subject) LIKE ?');
        params.push(`%${val}%`);
        break;
      case 'has':
        if (val === 'attachment') where.push('m.has_attach = 1');
        break;
      case 'is':
        if (val === 'unread') where.push('m.unread = 1');
        if (val === 'read') where.push('m.unread = 0');
        if (val === 'starred' || val === 'flagged') where.push('m.starred = 1');
        break;
      case 'after':
      case 'newer': {
        const d = Date.parse(val.replace(/\//g, '-'));
        if (!isNaN(d)) {
          where.push('m.date >= ?');
          params.push(d);
        }
        break;
      }
      case 'before':
      case 'older': {
        const d = Date.parse(val.replace(/\//g, '-'));
        if (!isNaN(d)) {
          where.push('m.date < ?');
          params.push(d);
        }
        break;
      }
      case 'newer_than': {
        const n = parseInt(val, 10);
        const unit = val.slice(-1);
        const ms = unit === 'd' ? 864e5 : unit === 'm' ? 30 * 864e5 : unit === 'y' ? 365 * 864e5 : 864e5;
        where.push('m.date >= ?');
        params.push(Date.now() - n * ms);
        break;
      }
      case 'larger': {
        const n = parseFloat(val) * (/m$/i.test(val) ? 1024 * 1024 : /k$/i.test(val) ? 1024 : 1);
        where.push('m.size > ?');
        params.push(n);
        break;
      }
      case 'label':
      case 'in': {
        const v = val === 'inbox' ? 'INBOX' : val === 'sent' ? 'SENT' : val === 'trash' ? 'TRASH' : val === 'spam' ? 'SPAM' : null;
        if (v) {
          where.push('EXISTS (SELECT 1 FROM message_labels x WHERE x.account_id = m.account_id AND x.message_id = m.id AND x.label_id = ?)');
          params.push(v);
        } else {
          where.push(
            'EXISTS (SELECT 1 FROM message_labels x JOIN labels lb ON lb.account_id = x.account_id AND lb.id = x.label_id WHERE x.account_id = m.account_id AND x.message_id = m.id AND LOWER(lb.path) = ?)'
          );
          params.push(val.replace(/-/g, ' '));
        }
        break;
      }
      default:
        free.push(t.replace(/"/g, ''));
    }
  }
  const fts = free.length ? free.map((w) => `"${w.replace(/"/g, '')}"*`).join(' ') : undefined;
  return { where, params, fts };
}

export function list(q: ListQuery): MessageSummary[] {
  const s = getSettings();
  const where: string[] = [];
  const params: (string | number)[] = [];
  let join = '';
  let fts: string | undefined;

  if (q.accountId !== 'all') {
    where.push('m.account_id = ?');
    params.push(q.accountId);
  }
  // "Doesn't have label X" as one lookup list built once per query, rather than a check per message.
  // Labels are checked against an id list built once per query (much faster than a lookup per message).
  // Gmail message ids are unique, so for the unified views the list can span accounts.
  const acct = q.accountId !== 'all' ? q.accountId : undefined;
  const lacksLabel = (label: string) => {
    where.push(`m.id NOT IN (SELECT x.message_id FROM message_labels x WHERE x.label_id = ?${acct ? ' AND x.account_id = ?' : ''})`);
    params.push(label, ...(acct ? [acct] : []));
  };

  const f = q.folder;
  switch (f.type) {
    case 'label':
      if (f.id === 'ALL') {
        lacksLabel('TRASH');
        lacksLabel('SPAM');
      } else if (f.id === 'SNOOZED') {
        where.push('m.snooze_until IS NOT NULL');
        lacksLabel('TRASH');
      } else if (f.id === 'SCHEDULED') {
        return []; // scheduled mail is listed from the outbox
      } else {
        join = 'JOIN message_labels l ON l.account_id = m.account_id AND l.message_id = m.id AND l.label_id = ?';
        params.unshift(f.id);
        // Gmail keeps a message's other labels when it's binned; like Gmail, only Bin and Spam show those.
        if (f.id !== 'TRASH') lacksLabel('TRASH');
        if (f.id !== 'SPAM' && f.id !== 'TRASH') lacksLabel('SPAM');
        if (f.id === 'INBOX' && q.tab && q.tab !== 'all' && s.focusedInbox !== 'off') applyFocused(q.tab, s.focusedInbox, where, params, acct);
      }
      break;
    case 'unified': {
      const label = f.label === 'FLAGGED' ? 'STARRED' : f.label;
      join = 'JOIN message_labels l ON l.account_id = m.account_id AND l.message_id = m.id AND l.label_id = ?';
      params.unshift(label);
      lacksLabel('TRASH');
      lacksLabel('SPAM');
      if (label === 'INBOX' && q.tab && q.tab !== 'all' && s.focusedInbox !== 'off') applyFocused(q.tab, s.focusedInbox, where, params, acct);
      break;
    }
    case 'flagged':
      where.push('m.starred = 1');
      lacksLabel('TRASH');
      break;
    case 'snoozed':
      where.push('m.snooze_until IS NOT NULL');
      lacksLabel('TRASH');
      break;
    case 'scheduled':
      return [];
    case 'search':
    case 'searchFolder': {
      const query = f.type === 'search' ? f.q : kvAll<{ id: string; query: string }>('searchFolders').find((x) => x.id === f.id)?.query ?? '';
      const parsed = localSearchSql(query);
      where.push(...parsed.where);
      params.push(...parsed.params);
      fts = parsed.fts;
      if (!/\bin:(trash|spam)\b/i.test(query)) {
        lacksLabel('TRASH');
        lacksLabel('SPAM');
      }
      break;
    }
  }
  if (q.unreadOnly) where.push('m.unread = 1');
  if (fts) {
    where.push('m.rowid IN (SELECT rowid FROM mail_index WHERE mail_index MATCH ?)');
    params.push(fts);
  }

  const limit = q.limit ?? 200;
  const offset = q.offset ?? 0;
  const filter = `FROM messages m ${join} ${where.length ? 'WHERE ' + where.join(' AND ') : ''}`;
  const threaded = s.conversationView && f.type !== 'search' && !(f.type === 'label' && (f.id === 'DRAFT' || f.id === 'SENT'));
  // Conversation view groups the folder's messages by thread using only the small columns, then loads full
  // rows for just the page being shown (copying every message's body into the grouping step was the slow part).
  const sql = threaded
    ? `WITH f AS MATERIALIZED (SELECT m.account_id, m.id, m.thread_id, m.date, m.unread ${filter}),
       g AS (SELECT f.*, ROW_NUMBER() OVER (PARTITION BY account_id, thread_id ORDER BY date DESC) AS rn,
             MAX(unread) OVER (PARTITION BY account_id, thread_id) AS any_unread FROM f),
       -- Like Gmail and Outlook, a conversation sorts by its newest message, your replies included.
       h AS (SELECT g.account_id, g.id, g.any_unread,
             COALESCE((SELECT MAX(t.date) FROM messages t WHERE t.account_id = g.account_id AND t.thread_id = g.thread_id
               AND t.labels NOT LIKE '%"TRASH"%' AND t.labels NOT LIKE '%"SPAM"%' AND t.labels NOT LIKE '%"DRAFT"%'), g.date) AS last_date
             FROM g WHERE rn = 1 ORDER BY last_date DESC LIMIT ? OFFSET ?)
       SELECT m.*, h.any_unread, h.last_date,
             (SELECT COUNT(*) FROM messages t WHERE t.account_id = m.account_id AND t.thread_id = m.thread_id
               AND t.labels NOT LIKE '%"TRASH"%' AND t.labels NOT LIKE '%"SPAM"%') AS cnt
       FROM h JOIN messages m ON m.account_id = h.account_id AND m.id = h.id ORDER BY h.last_date DESC`
    : `SELECT m.* ${filter} ORDER BY m.date DESC LIMIT ? OFFSET ?`;
  const rows = all<MsgRow>(sql, ...params, limit, offset);
  const catCache = new Map<string, Map<string, { name: string; color: string }>>();
  return rows.map((r) => {
    if (!catCache.has(r.account_id)) catCache.set(r.account_id, categoryMap(r.account_id));
    const summary = toSummary(r, catCache.get(r.account_id)!);
    return threaded && (r.cnt ?? 1) > 1 ? withLatest(summary) : summary;
  });
}

/**
 * Conversation view: the row stays tied to the message in this folder (so actions on it work on the right
 * message), but shows the conversation as a whole, as Gmail and Outlook do: the newest message's time and
 * preview, even when that's your reply in Sent, and everyone who has written, with you as "me".
 */
function withLatest(s: MessageSummary): MessageSummary {
  const msgs = all<{ from_name: string | null; from_email: string; date: number; snippet: string; labels: string }>(
    `SELECT from_name, from_email, date, snippet, labels FROM messages WHERE account_id = ? AND thread_id = ?
     AND labels NOT LIKE '%"TRASH"%' AND labels NOT LIKE '%"SPAM"%' AND labels NOT LIKE '%"DRAFT"%' ORDER BY date`,
    s.accountId, s.threadId
  );
  if (!msgs.length) return s;
  const latest = msgs[msgs.length - 1];
  const mine = (m: { labels: string }) => m.labels.includes('"SENT"');
  const people: { key: string; name: string; me: boolean }[] = [];
  for (const m of msgs) {
    const me = mine(m);
    const key = me ? 'me' : m.from_email.toLowerCase();
    const at = people.findIndex((p) => p.key === key);
    if (at >= 0) people.splice(at, 1); // keep each person once, in order of their latest message
    people.push({ key, name: m.from_name || m.from_email, me });
  }
  const label = (p: { name: string; me: boolean }, short: boolean) => (p.me ? 'me' : short ? p.name.split(/[\s@]/)[0] : p.name);
  const short = people.length > 1;
  // Gmail-style: up to three names; with more, the first, then the latest two.
  const parts = people.length > 3 ? [label(people[0], short), '…', ...people.slice(-2).map((p) => label(p, short))] : people.map((p) => label(p, short));
  const senders = parts.join(', ').replace(/^me\b/, 'Me');
  return { ...s, date: latest.date, snippet: latest.snippet, threadSenders: people.length === 1 && !people[0].me ? undefined : senders };
}

function applyFocused(tab: 'focused' | 'other', mode: 'categories' | 'important', where: string[], params: (string | number)[], acct?: string) {
  const scope = acct ? ' AND x.account_id = ?' : '';
  if (mode === 'important') {
    where.push(`m.id ${tab === 'focused' ? '' : 'NOT '}IN (SELECT x.message_id FROM message_labels x WHERE x.label_id = 'IMPORTANT'${scope})`);
    if (acct) params.push(acct);
    return;
  }
  const placeholders = OTHER_CATEGORIES.map(() => '?').join(',');
  where.push(`m.id ${tab === 'focused' ? 'NOT ' : ''}IN (SELECT x.message_id FROM message_labels x WHERE x.label_id IN (${placeholders})${scope})`);
  params.push(...OTHER_CATEGORIES, ...(acct ? [acct] : []));
}

export function threadMessages(accountId: string, threadId: string): string[] {
  return all<{ id: string }>(
    `SELECT m.id FROM messages m WHERE m.account_id = ? AND m.thread_id = ?
     AND NOT EXISTS (SELECT 1 FROM message_labels x WHERE x.account_id = m.account_id AND x.message_id = m.id AND x.label_id = 'TRASH')
     ORDER BY m.date ASC`,
    accountId,
    threadId
  ).map((r) => r.id);
}

export function totalUnreadInbox(): number {
  return get<{ n: number }>(
    `SELECT COUNT(*) AS n FROM messages m JOIN message_labels l ON l.account_id = m.account_id AND l.message_id = m.id AND l.label_id = 'INBOX' WHERE m.unread = 1`
  )?.n ?? 0;
}

export function oldestDate(accountId: string): number | undefined {
  return get<{ d: number }>('SELECT MIN(date) AS d FROM messages WHERE account_id = ?', accountId)?.d;
}
