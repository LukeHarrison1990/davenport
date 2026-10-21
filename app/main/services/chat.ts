// Google Chat: spaces, direct messages, threads and reactions (Workspace accounts with Chat enabled).
import { shell } from 'electron';
import type { ChatMessage, ChatSpace } from '../../shared/types';
import { all, get, kvGet, kvSet, run, tx } from '../db';
import { changed } from '../events';
import { GoogleApiError } from '../google/http';
import { client, getAccount, isDemo, listAccounts } from './accounts';
import { notifyChat } from './notify';
import { myPersonId } from './people';

const CHAT = 'https://chat.googleapis.com/v1';

interface GSpace {
  name: string;
  displayName?: string;
  spaceType?: 'SPACE' | 'GROUP_CHAT' | 'DIRECT_MESSAGE';
  lastActiveTime?: string;
  membershipCount?: { joinedDirectHumanUserCount?: number };
  externalUserAllowed?: boolean;
}
interface GMessage {
  name: string;
  sender?: { name: string; displayName?: string; type?: string };
  createTime: string;
  text?: string;
  argumentText?: string;
  thread?: { name: string };
  threadReply?: boolean;
  attachment?: { contentName?: string; driveDataRef?: { driveFileId: string }; source?: string }[];
  attachedGifs?: unknown[];
  emojiReactionSummaries?: { emoji?: { unicode?: string; customEmoji?: { uid: string } }; reactionCount?: number }[];
  matchedUrl?: { url: string };
}

async function me(accountId: string): Promise<string | undefined> {
  const cached = kvGet<string>('chatMe', accountId);
  if (cached) return cached;
  const id = await myPersonId(accountId);
  if (id) kvSet('chatMe', accountId, id);
  return id;
}

function putSpace(s: ChatSpace): void {
  run('INSERT OR REPLACE INTO chat_spaces (account_id, id, json, last_active) VALUES (?, ?, ?, ?)', s.accountId, s.id, JSON.stringify(s), s.lastActive);
}

export function spaces(accountId: string | 'all'): ChatSpace[] {
  const rows = accountId === 'all'
    ? all<{ json: string }>('SELECT json FROM chat_spaces ORDER BY last_active DESC')
    : all<{ json: string }>('SELECT json FROM chat_spaces WHERE account_id = ? ORDER BY last_active DESC', accountId);
  return rows.map((r) => JSON.parse(r.json) as ChatSpace);
}

const toMessage = (accountId: string, spaceId: string, m: GMessage, meId?: string): ChatMessage => ({
  accountId,
  spaceId,
  id: m.name,
  sender: { id: m.sender?.name ?? '', name: m.sender?.displayName ?? 'Unknown' },
  text: m.text ?? m.argumentText ?? (m.attachedGifs?.length ? '[GIF]' : ''),
  createTime: Date.parse(m.createTime),
  threadId: m.thread?.name,
  isThreadReply: !!m.threadReply,
  attachments: (m.attachment ?? []).map((a) => ({
    name: a.contentName ?? 'Attachment',
    url: a.driveDataRef ? `https://drive.google.com/open?id=${a.driveDataRef.driveFileId}` : undefined,
    kind: a.driveDataRef ? 'drive' : 'file'
  })),
  reactions: (m.emojiReactionSummaries ?? [])
    .filter((r) => r.emoji?.unicode)
    .map((r) => ({ emoji: r.emoji!.unicode!, count: r.reactionCount ?? 1, mine: false })),
  mine: !!meId && m.sender?.name === meId
});

function putMessages(msgs: ChatMessage[]): void {
  tx(() => {
    for (const m of msgs) {
      run(
        'INSERT OR REPLACE INTO chat_messages (account_id, space_id, id, create_time, thread_id, json) VALUES (?, ?, ?, ?, ?, ?)',
        m.accountId, m.spaceId, m.id, m.createTime, m.threadId ?? null, JSON.stringify(m)
      );
    }
  });
}

export async function syncChat(accountId: string, notify = true): Promise<void> {
  const acc = getAccount(accountId);
  if (isDemo(accountId) || !acc.chatEnabled) return;
  const c = client(accountId);
  let list: GSpace[];
  try {
    list = await c.all<GSpace>(CHAT + '/spaces', 'spaces', { pageSize: 200 }, 10);
  } catch (e) {
    if (e instanceof GoogleApiError && (e.status === 403 || e.status === 404)) {
      run('UPDATE accounts SET chat_enabled = 0 WHERE id = ?', accountId);
      changed('accounts');
      throw new Error('Google Chat is not available for this account. Check that the Chat API is enabled and configured in your Google Cloud project.');
    }
    throw e;
  }
  const meId = await me(accountId);
  const prev = new Map(spaces(accountId).map((s) => [s.id, s]));
  for (const g of list) {
    const lastActive = g.lastActiveTime ? Date.parse(g.lastActiveTime) : 0;
    const old = prev.get(g.name);
    let name = g.displayName ?? '';
    if (!name || g.spaceType !== 'SPACE') name = old?.name && old.name !== 'Direct message' ? old.name : await dmName(accountId, g.name, meId);
    const s: ChatSpace = {
      accountId,
      id: g.name,
      name,
      kind: g.spaceType === 'DIRECT_MESSAGE' ? 'dm' : g.spaceType === 'GROUP_CHAT' ? 'group' : 'space',
      unread: old?.unread ?? 0,
      lastActive,
      lastPreview: old?.lastPreview,
      memberCount: g.membershipCount?.joinedDirectHumanUserCount,
      external: g.externalUserAllowed
    };
    // Fetch new messages only for spaces that changed since we last looked.
    if (!old || lastActive > old.lastActive) {
      const fresh = await fetchMessages(accountId, g.name, meId, old?.lastActive);
      const newest = fresh.filter((m) => !m.isThreadReply || true).sort((a, b) => b.createTime - a.createTime)[0];
      if (newest) s.lastPreview = `${newest.mine ? 'You' : newest.sender.name.split(' ')[0]}: ${newest.text}`.slice(0, 120);
      s.unread = await unreadCount(accountId, g.name);
      if (old && notify) {
        for (const m of fresh.filter((m) => !m.mine && m.createTime > old.lastActive).slice(-3)) {
          notifyChat(accountId, g.name, m.sender.name, s.kind === 'dm' ? 'Direct message' : s.name, m.text);
        }
      }
    }
    putSpace(s);
  }
  changed('chat', accountId);
}

async function dmName(accountId: string, space: string, meId?: string): Promise<string> {
  try {
    const r = await client(accountId).get<{ memberships?: { member?: { name: string; displayName?: string; type?: string } }[] }>(CHAT + `/${space}/members`, { pageSize: 20 });
    const others = (r.memberships ?? []).map((m) => m.member).filter((m) => m && m.name !== meId && m.type !== 'BOT');
    const names = others.map((m) => m!.displayName).filter(Boolean);
    return names.length ? names.join(', ') : 'Direct message';
  } catch {
    return 'Direct message';
  }
}

async function fetchMessages(accountId: string, spaceId: string, meId?: string, since?: number): Promise<ChatMessage[]> {
  const r = await client(accountId).get<{ messages?: GMessage[] }>(CHAT + `/${spaceId}/messages`, {
    pageSize: 100,
    orderBy: 'createTime desc',
    filter: since ? `createTime > "${new Date(since - 60_000).toISOString()}"` : undefined
  });
  const msgs = (r.messages ?? []).map((m) => toMessage(accountId, spaceId, m, meId));
  putMessages(msgs);
  return msgs;
}

async function unreadCount(accountId: string, spaceId: string): Promise<number> {
  try {
    const st = await client(accountId).get<{ lastReadTime?: string }>(CHAT + `/users/me/${spaceId}/spaceReadState`);
    const last = st.lastReadTime ? Date.parse(st.lastReadTime) : 0;
    return get<{ n: number }>(
      "SELECT COUNT(*) AS n FROM chat_messages WHERE account_id = ? AND space_id = ? AND create_time > ? AND json NOT LIKE '%\"mine\":true%'",
      accountId, spaceId, last
    )?.n ?? 0;
  } catch {
    return 0;
  }
}

export function messages(accountId: string, spaceId: string): ChatMessage[] {
  const rows = all<{ json: string }>(
    'SELECT json FROM chat_messages WHERE account_id = ? AND space_id = ? ORDER BY create_time DESC LIMIT 300',
    accountId,
    spaceId
  ).map((r) => JSON.parse(r.json) as ChatMessage);
  // Show thread starters in the main view with their reply counts, like Google Chat.
  const replies = new Map<string, number>();
  for (const m of rows) if (m.isThreadReply && m.threadId) replies.set(m.threadId, (replies.get(m.threadId) ?? 0) + 1);
  return rows
    .filter((m) => !m.isThreadReply)
    .map((m) => ({ ...m, replyCount: m.threadId ? replies.get(m.threadId) : undefined }))
    .reverse();
}

export function thread(accountId: string, spaceId: string, threadId: string): ChatMessage[] {
  return all<{ json: string }>(
    'SELECT json FROM chat_messages WHERE account_id = ? AND space_id = ? AND thread_id = ? ORDER BY create_time',
    accountId, spaceId, threadId
  ).map((r) => JSON.parse(r.json) as ChatMessage);
}

export async function refresh(accountId: string, spaceId?: string): Promise<void> {
  if (isDemo(accountId)) return;
  if (spaceId) {
    await fetchMessages(accountId, spaceId, await me(accountId));
    changed('chat', accountId);
  } else await syncChat(accountId, false);
}

export async function send(accountId: string, spaceId: string, text: string, threadId?: string): Promise<ChatMessage> {
  let msg: ChatMessage;
  if (isDemo(accountId)) {
    msg = {
      accountId, spaceId, id: `${spaceId}/messages/local-${Date.now()}`, sender: { id: 'users/demo-me', name: 'Alex Morgan' }, text,
      createTime: Date.now(), threadId: threadId ?? `${spaceId}/threads/t-${Date.now()}`, isThreadReply: !!threadId, attachments: [], reactions: [], mine: true
    };
  } else {
    const g = await client(accountId).post<GMessage>(
      CHAT + `/${spaceId}/messages`,
      { text, thread: threadId ? { name: threadId } : undefined },
      threadId ? { messageReplyOption: 'REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD' } : undefined
    );
    msg = toMessage(accountId, spaceId, g, await me(accountId));
    msg.mine = true;
  }
  putMessages([msg]);
  const s = spaces(accountId).find((x) => x.id === spaceId);
  if (s) putSpace({ ...s, lastActive: msg.createTime, lastPreview: 'You: ' + text.slice(0, 100), unread: 0 });
  changed('chat', accountId);
  return msg;
}

export async function react(accountId: string, spaceId: string, messageId: string, emoji: string): Promise<void> {
  if (!isDemo(accountId)) await client(accountId).post(CHAT + `/${messageId}/reactions`, { emoji: { unicode: emoji } });
  const row = get<{ json: string }>('SELECT json FROM chat_messages WHERE account_id = ? AND space_id = ? AND id = ?', accountId, spaceId, messageId);
  if (row) {
    const m = JSON.parse(row.json) as ChatMessage;
    const r = m.reactions.find((x) => x.emoji === emoji);
    if (r) {
      if (!r.mine) {
        r.count++;
        r.mine = true;
      }
    } else m.reactions.push({ emoji, count: 1, mine: true });
    putMessages([m]);
  }
  changed('chat', accountId);
}

export async function markRead(accountId: string, spaceId: string): Promise<void> {
  const s = spaces(accountId).find((x) => x.id === spaceId);
  if (s && s.unread) putSpace({ ...s, unread: 0 });
  changed('chat', accountId);
  if (!isDemo(accountId) && s?.unread) {
    await client(accountId)
      .patch(CHAT + `/users/me/${spaceId}/spaceReadState`, { lastReadTime: new Date().toISOString() }, { updateMask: 'lastReadTime' })
      .catch(() => undefined);
  }
}

export function openInBrowser(accountId: string, spaceId: string): void {
  const acc = getAccount(accountId);
  void shell.openExternal(`https://chat.google.com/u/0/app/chat/${spaceId.replace('spaces/', '')}?authuser=${encodeURIComponent(acc.email)}`);
}

export function chatAccounts(): string[] {
  return listAccounts().filter((a) => a.chatEnabled).map((a) => a.id);
}
