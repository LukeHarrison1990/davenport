// Google Chat: spaces, direct messages, threads and reactions (Workspace accounts with Chat enabled).
import { shell } from 'electron';
import type { ChatMessage, ChatSpace, ChatStatus } from '../../shared/types';
import { all, get, kvDelete, kvGet, kvSet, run, tx } from '../db';
import { changed } from '../events';
import { GoogleApiError } from '../google/http';
import { client, getAccount, isDemo, listAccounts } from './accounts';
import { notifyChat } from './notify';
import { myPersonId } from './people';

const CHAT = 'https://chat.googleapis.com/v1';
const AVAILABILITY_SCOPE = 'https://www.googleapis.com/auth/chat.users.availability';

/** The Google Cloud page where the one-time Chat app settings live. */
export const CHAT_SETUP_URL = 'https://console.cloud.google.com/apis/api/chat.googleapis.com/hangouts-chat';

// Google lets apps read Chat with just the API switched on, but sending, reacting or changing your status
// also needs the project's "Chat app" details filled in. When they're missing, Google answers "Google Chat app not found".
const isChatAppMissing = (e: unknown): boolean =>
  e instanceof GoogleApiError && /chat app not found|configure the (chat )?app/i.test(e.message);

async function needsChatApp<T>(accountId: string, fn: () => Promise<T>): Promise<T> {
  try {
    const r = await fn();
    if (kvGet('chatSetup', accountId)) {
      kvDelete('chatSetup', accountId);
      changed('chat', accountId);
    }
    return r;
  } catch (e) {
    if (isChatAppMissing(e)) {
      kvSet('chatSetup', accountId, true);
      changed('chat', accountId);
      throw new Error('Google needs one more setting in your Google Cloud project before Davenport can send Chat messages or change your status. The steps are shown in Chat.');
    }
    throw e;
  }
}

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
  attachment?: {
    name?: string;
    contentName?: string;
    contentType?: string;
    attachmentDataRef?: { resourceName?: string };
    driveDataRef?: { driveFileId: string };
    source?: 'UPLOADED_CONTENT' | 'DRIVE_FILE' | string;
  }[];
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
    kind: a.driveDataRef ? 'drive' : 'file',
    url: a.driveDataRef ? `https://drive.google.com/open?id=${a.driveDataRef.driveFileId}` : undefined,
    mimeType: a.contentType,
    resource: a.attachmentDataRef?.resourceName
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
  await fetchStatus(accountId).catch(() => undefined);
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
    const g = await needsChatApp(accountId, () =>
      client(accountId).post<GMessage>(
        CHAT + `/${spaceId}/messages`,
        { text, thread: threadId ? { name: threadId } : undefined },
        threadId ? { messageReplyOption: 'REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD' } : undefined
      )
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
  if (!isDemo(accountId)) await needsChatApp(accountId, () => client(accountId).post(CHAT + `/${messageId}/reactions`, { emoji: { unicode: emoji } }));
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

// ---------- Status (Google Chat availability) ----------

interface GAvailability {
  name?: string;
  state?: 'STATE_UNSPECIFIED' | 'ACTIVE' | 'IDLE' | 'AWAY' | 'DO_NOT_DISTURB';
  customStatus?: { text?: string; expireTime?: string; emoji?: { unicode?: string } };
  doNotDisturbMetadata?: { expirationTime?: string };
}

const PRESENCE: Record<string, ChatStatus['presence']> = { ACTIVE: 'active', IDLE: 'idle', AWAY: 'away', DO_NOT_DISTURB: 'dnd' };

function hasAvailabilityScope(accountId: string): boolean {
  const r = get<{ scopes: string | null }>('SELECT scopes FROM accounts WHERE id = ?', accountId);
  // Older sign-ins didn't record scopes; let Google decide in that case.
  return !r?.scopes || r.scopes.split(/\s+/).includes(AVAILABILITY_SCOPE);
}

function clearCustom(s: ChatStatus): void {
  delete s.customText;
  delete s.customEmoji;
  delete s.customUntil;
}

function stored(accountId: string): ChatStatus {
  return kvGet<ChatStatus>('chatStatus', accountId) ?? { accountId, presence: isDemo(accountId) ? 'active' : 'unknown' };
}

function withFlags(s: ChatStatus): ChatStatus {
  const now = Date.now();
  const out: ChatStatus = { ...s, needsSetup: !!kvGet('chatSetup', s.accountId) || undefined };
  if (!isDemo(s.accountId)) out.needsPermission = !hasAvailabilityScope(s.accountId) || !!kvGet('chatStatusDenied', s.accountId) || undefined;
  // Drop anything that has run out since we last heard from Google.
  if (out.customUntil && out.customUntil < now) clearCustom(out);
  if (out.presence === 'dnd' && out.dndUntil && out.dndUntil < now) {
    out.presence = 'active';
    delete out.dndUntil;
  }
  return out;
}

/** The Chat status of every account that has Chat turned on. */
export function statuses(): ChatStatus[] {
  return chatAccounts().map((id) => withFlags(stored(id)));
}

const toStatus = (accountId: string, g: GAvailability): ChatStatus => ({
  accountId,
  presence: PRESENCE[g.state ?? ''] ?? 'unknown',
  dndUntil: g.doNotDisturbMetadata?.expirationTime ? Date.parse(g.doNotDisturbMetadata.expirationTime) : undefined,
  customText: g.customStatus?.text || undefined,
  customEmoji: g.customStatus?.emoji?.unicode || undefined,
  customUntil: g.customStatus?.expireTime ? Date.parse(g.customStatus.expireTime) : undefined
});

/** Reads the status from Google (so changes made on the web or phone show up here too). */
export async function fetchStatus(accountId: string): Promise<void> {
  if (isDemo(accountId) || !hasAvailabilityScope(accountId)) return;
  try {
    const g = await client(accountId).get<GAvailability>(CHAT + '/users/me/availability');
    kvSet('chatStatus', accountId, toStatus(accountId, g));
    kvDelete('chatStatusDenied', accountId);
  } catch (e) {
    if (e instanceof GoogleApiError && e.status === 403 && /scope|permission/i.test(e.message)) kvSet('chatStatusDenied', accountId, true);
    else throw e;
  }
  changed('chat', accountId);
}

function demoStatus(accountId: string, patch: Partial<ChatStatus>, clear = false): void {
  const s = { ...stored(accountId), ...patch };
  if (clear) clearCustom(s);
  kvSet('chatStatus', accountId, s);
  changed('chat', accountId);
}

const iso = (ms: number) => new Date(ms).toISOString();

/** Automatic (active), Away, or Do not disturb until a time. Changes your status everywhere you use Google Chat. */
export async function setPresence(accountId: string, mode: 'automatic' | 'away' | 'dnd', until?: number): Promise<void> {
  if (mode === 'dnd' && (!until || until <= Date.now())) throw new Error('Choose how long Do not disturb should last.');
  if (isDemo(accountId)) return demoStatus(accountId, { presence: mode === 'automatic' ? 'active' : mode, dndUntil: mode === 'dnd' ? until : undefined });
  const c = client(accountId);
  const base = CHAT + '/users/me/availability';
  await needsChatApp(accountId, () =>
    mode === 'automatic' ? c.post(base + ':markAsActive', {})
      : mode === 'away' ? c.post(base + ':markAsAway', {})
        : c.post(base + ':markAsDoNotDisturb', { expireTime: iso(until!) })
  );
  // Show the change straight away, then confirm with Google.
  kvSet('chatStatus', accountId, { ...stored(accountId), presence: mode === 'automatic' ? 'active' : mode, dndUntil: mode === 'dnd' ? until : undefined });
  changed('chat', accountId);
  await fetchStatus(accountId).catch(() => undefined);
}

/** Sets (or, with no text, clears) the custom status shown next to your name in Google Chat. */
export async function setCustomStatus(accountId: string, text: string | null, emoji?: string, until?: number): Promise<void> {
  const t = text?.trim().slice(0, 64);
  if (isDemo(accountId)) return demoStatus(accountId, t ? { customText: t, customEmoji: emoji || undefined, customUntil: until } : {}, !t);
  await needsChatApp(accountId, () =>
    client(accountId).patch(
      CHAT + '/users/me/availability',
      {
        name: 'users/me/availability',
        customStatus: t ? { text: t, emoji: emoji ? { unicode: emoji } : undefined, expireTime: until ? iso(until) : undefined } : undefined
      },
      { updateMask: 'customStatus' }
    )
  );
  const s = { ...stored(accountId) };
  if (t) Object.assign(s, { customText: t, customEmoji: emoji || undefined, customUntil: until });
  else clearCustom(s);
  kvSet('chatStatus', accountId, s);
  changed('chat', accountId);
  await fetchStatus(accountId).catch(() => undefined);
}

/** Opens the Google Cloud page for the one-time Chat app settings. */
export function openChatSetup(accountId: string): void {
  const acc = getAccount(accountId);
  void shell.openExternal(`${CHAT_SETUP_URL}?authuser=${encodeURIComponent(acc.email)}`);
}

// ---------- Files uploaded into Chat ----------

const MAX_PREVIEW = 15 * 1024 * 1024;
const fileCache = new Map<string, Buffer>();

/** Downloads a file uploaded into Chat (Chat API media download), keeping the last few in memory. */
export async function attachmentData(accountId: string, resource: string): Promise<Buffer> {
  const key = accountId + '|' + resource;
  const hit = fileCache.get(key);
  if (hit) return hit;
  const data = isDemo(accountId)
    ? demoChatFile(resource)
    : await client(accountId).request<Buffer>('GET', `${CHAT}/media/${resource.split('/').map(encodeURIComponent).join('/')}`, { query: { alt: 'media' }, responseType: 'buffer' });
  fileCache.set(key, data);
  while (fileCache.size > 40) fileCache.delete(fileCache.keys().next().value!);
  return data;
}

/** A picture to show in the conversation, as a data address the window can display. */
export async function attachmentPreview(accountId: string, resource: string, mimeType: string): Promise<string | null> {
  if (!/^image\/(png|jpe?g|gif|webp|bmp)$/i.test(mimeType)) return null;
  const data = await attachmentData(accountId, resource);
  if (data.length > MAX_PREVIEW) return null;
  return `data:${mimeType.toLowerCase()};base64,${data.toString('base64')}`;
}

export async function openAttachment(accountId: string, resource: string, name: string): Promise<void> {
  const { openFileData } = await import('./mail');
  await openFileData(await attachmentData(accountId, resource), name);
}

export async function saveAttachment(accountId: string, resource: string, name: string): Promise<string | null> {
  const { saveFileData } = await import('./mail');
  return saveFileData(() => attachmentData(accountId, resource), name);
}

/** The demo account's uploaded files: a small picture made on the spot. */
function demoChatFile(resource: string): Buffer {
  if (!resource.startsWith('demo/')) throw new Error('No such file.');
  // A 2 x 2 PNG (blue and amber), enough to show the preview working.
  return Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGNkYPj/n4GBgZGBgYGBAQAvEQQBOtVWZQAAAABJRU5ErkJggg==', 'base64');
}
