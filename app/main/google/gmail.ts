// Gmail API (v1) wrappers and message parsing.
import type { Addr, Attachment, Rule, SendAs, Vacation } from '../../shared/types';
import { GoogleClient, pool } from './http';
import { decodeHeader, fromBase64Url, parseAddressList, toBase64Url } from './mime';

const enc = encodeURIComponent;
const BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';

export interface GLabel {
  id: string;
  name: string;
  type: 'system' | 'user';
  messagesTotal?: number;
  messagesUnread?: number;
  color?: { backgroundColor?: string; textColor?: string };
  labelListVisibility?: string;
}

interface GHeader {
  name: string;
  value: string;
}
interface GPart {
  partId?: string;
  mimeType: string;
  filename?: string;
  headers?: GHeader[];
  body?: { size: number; data?: string; attachmentId?: string };
  parts?: GPart[];
}
export interface GMessage {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet?: string;
  internalDate?: string;
  sizeEstimate?: number;
  historyId?: string;
  payload?: GPart;
}

export interface ParsedMessage {
  id: string;
  threadId: string;
  labelIds: string[];
  snippet: string;
  date: number;
  size: number;
  from: Addr;
  to: Addr[];
  cc: Addr[];
  bcc: Addr[];
  replyTo: Addr[];
  subject: string;
  messageIdHeader?: string;
  references?: string;
  listUnsubscribe?: string;
  hasAttachments: boolean;
  html?: string;
  text?: string;
  attachments: Attachment[];
  full: boolean;
}

const META_HEADERS = ['From', 'To', 'Cc', 'Bcc', 'Reply-To', 'Subject', 'Date', 'Message-ID', 'References', 'List-Unsubscribe'];

const unescapeSnippet = (s: string) =>
  s.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

function headerMap(headers: GHeader[] = []): Map<string, string> {
  const m = new Map<string, string>();
  for (const h of headers) {
    const k = h.name.toLowerCase();
    if (!m.has(k)) m.set(k, h.value);
  }
  return m;
}

function decodeBody(data: string | undefined, part: GPart): string {
  if (!data) return '';
  const buf = fromBase64Url(data);
  const ct = headerMap(part.headers).get('content-type') ?? '';
  const charset = (ct.match(/charset="?([^";\s]+)"?/i)?.[1] ?? 'utf-8').toLowerCase();
  try {
    return new TextDecoder(charset).decode(buf);
  } catch {
    return buf.toString('utf8');
  }
}

export function parseMessage(m: GMessage): ParsedMessage {
  const h = headerMap(m.payload?.headers);
  const attachments: Attachment[] = [];
  let html: string | undefined;
  let text: string | undefined;
  let full = false;

  const walk = (p: GPart | undefined) => {
    if (!p) return;
    if (p.body?.data !== undefined || p.body?.attachmentId) full = true;
    const ph = headerMap(p.headers);
    const disp = ph.get('content-disposition') ?? '';
    const cid = ph.get('content-id')?.replace(/[<>]/g, '');
    if (p.body?.attachmentId || (p.filename && p.filename.length)) {
      attachments.push({
        id: p.body?.attachmentId ?? 'part:' + p.partId,
        filename: decodeHeader(p.filename || 'attachment'),
        mimeType: p.mimeType,
        size: p.body?.size ?? 0,
        contentId: cid && (/inline/i.test(disp) || p.mimeType.startsWith('image/')) ? cid : undefined
      });
      // Small inline parts can carry data directly; keep it for cid: resolution.
      if (p.body?.data && !p.body.attachmentId && cid) {
        (attachments[attachments.length - 1] as Attachment & { inlineData?: string }).inlineData = p.body.data;
      }
    } else if (p.mimeType === 'text/html' && html === undefined) {
      html = decodeBody(p.body?.data, p);
    } else if (p.mimeType === 'text/plain' && text === undefined) {
      text = decodeBody(p.body?.data, p);
    }
    p.parts?.forEach(walk);
  };
  walk(m.payload);

  const fromList = parseAddressList(h.get('from'));
  const realAttachments = attachments.filter((a) => !a.contentId);
  return {
    id: m.id,
    threadId: m.threadId,
    labelIds: m.labelIds ?? [],
    snippet: unescapeSnippet(m.snippet ?? ''),
    date: Number(m.internalDate ?? Date.parse(h.get('date') ?? '') ?? Date.now()),
    size: m.sizeEstimate ?? 0,
    from: fromList[0] ?? { email: 'unknown' },
    to: parseAddressList(h.get('to')),
    cc: parseAddressList(h.get('cc')),
    bcc: parseAddressList(h.get('bcc')),
    replyTo: parseAddressList(h.get('reply-to')),
    subject: decodeHeader(h.get('subject') ?? '').trim(),
    messageIdHeader: h.get('message-id'),
    references: h.get('references'),
    listUnsubscribe: h.get('list-unsubscribe'),
    hasAttachments: full ? realAttachments.length > 0 : m.payload?.mimeType === 'multipart/mixed',
    html,
    text,
    attachments,
    full
  };
}

export class Gmail {
  constructor(private c: GoogleClient) {}

  profile() {
    return this.c.get<{ emailAddress: string; historyId: string; messagesTotal: number }>(BASE + '/profile');
  }

  async labels(): Promise<GLabel[]> {
    const r = await this.c.get<{ labels: GLabel[] }>(BASE + '/labels');
    return r.labels ?? [];
  }

  label(id: string) {
    return this.c.get<GLabel>(BASE + '/labels/' + encodeURIComponent(id));
  }

  createLabel(name: string) {
    return this.c.post<GLabel>(BASE + '/labels', { name, labelListVisibility: 'labelShow', messageListVisibility: 'show' });
  }
  updateLabel(id: string, patch: Partial<GLabel>) {
    return this.c.patch<GLabel>(BASE + '/labels/' + encodeURIComponent(id), patch);
  }
  deleteLabel(id: string) {
    return this.c.del(BASE + '/labels/' + encodeURIComponent(id));
  }

  /** Lists message ids, newest first. */
  async listIds(q: string | undefined, labelIds: string[] | undefined, max: number, includeSpamTrash = false) {
    const ids: { id: string; threadId: string }[] = [];
    let pageToken: string | undefined;
    while (ids.length < max) {
      const r = await this.c.get<{ messages?: { id: string; threadId: string }[]; nextPageToken?: string }>(BASE + '/messages', {
        q,
        labelIds,
        maxResults: Math.min(500, max - ids.length),
        pageToken,
        includeSpamTrash
      });
      ids.push(...(r.messages ?? []));
      pageToken = r.nextPageToken;
      if (!pageToken) break;
    }
    return ids;
  }

  async metadata(ids: string[]): Promise<ParsedMessage[]> {
    const res = await pool(ids, 8, async (id) => {
      try {
        const m = await this.c.get<GMessage>(BASE + '/messages/' + enc(id), { format: 'metadata', metadataHeaders: META_HEADERS });
        return parseMessage(m);
      } catch (e) {
        if ((e as { status?: number }).status === 404) return null;
        throw e;
      }
    });
    return res.filter((x): x is ParsedMessage => !!x);
  }

  async full(id: string): Promise<ParsedMessage> {
    const m = await this.c.get<GMessage>(BASE + '/messages/' + enc(id), { format: 'full' });
    return parseMessage(m);
  }

  async raw(id: string): Promise<Buffer> {
    const m = await this.c.get<{ raw: string }>(BASE + '/messages/' + enc(id), { format: 'raw' });
    return fromBase64Url(m.raw);
  }

  async attachment(messageId: string, attachmentId: string): Promise<Buffer> {
    const r = await this.c.get<{ data: string }>(BASE + `/messages/${enc(messageId)}/attachments/${enc(attachmentId)}`);
    return fromBase64Url(r.data);
  }

  async history(startHistoryId: string) {
    type H = {
      id: string;
      messagesAdded?: { message: GMessage }[];
      messagesDeleted?: { message: GMessage }[];
      labelsAdded?: { message: GMessage; labelIds: string[] }[];
      labelsRemoved?: { message: GMessage; labelIds: string[] }[];
    };
    const changes: H[] = [];
    let pageToken: string | undefined;
    let historyId = startHistoryId;
    for (let i = 0; i < 40; i++) {
      const r = await this.c.get<{ history?: H[]; historyId: string; nextPageToken?: string }>(BASE + '/history', {
        startHistoryId,
        pageToken,
        maxResults: 500
      });
      changes.push(...(r.history ?? []));
      historyId = r.historyId;
      pageToken = r.nextPageToken;
      if (!pageToken) break;
    }
    // More changes than we read in one go: the caller refreshes everything instead of skipping the rest.
    return { changes, historyId, truncated: !!pageToken };
  }

  batchModify(ids: string[], add: string[], remove: string[]) {
    return this.c.post(BASE + '/messages/batchModify', { ids, addLabelIds: add, removeLabelIds: remove });
  }

  async trash(ids: string[]) {
    await pool(ids, 6, (id) => this.c.post(BASE + `/messages/${enc(id)}/trash`));
  }
  async untrash(ids: string[]) {
    await pool(ids, 6, (id) => this.c.post(BASE + `/messages/${enc(id)}/untrash`));
  }
  batchDelete(ids: string[]) {
    return this.c.post(BASE + '/messages/batchDelete', { ids });
  }

  send(rawMime: string, threadId?: string) {
    return this.c.post<GMessage>(BASE + '/messages/send', { raw: toBase64Url(rawMime), threadId });
  }

  async saveDraft(rawMime: string, threadId: string | undefined, draftId?: string) {
    const body = { message: { raw: toBase64Url(rawMime), threadId } };
    if (draftId) return this.c.put<{ id: string; message: GMessage }>(BASE + '/drafts/' + enc(draftId), body);
    return this.c.post<{ id: string; message: GMessage }>(BASE + '/drafts', body);
  }
  /** The id of the message a draft currently holds (it changes every time the draft is saved). */
  async draftMessageId(draftId: string): Promise<string | undefined> {
    const d = await this.c.get<{ message?: { id: string } }>(BASE + '/drafts/' + enc(draftId), { format: 'minimal' });
    return d.message?.id;
  }
  deleteDraft(draftId: string) {
    return this.c.del(BASE + '/drafts/' + enc(draftId));
  }
  async draftIdForMessage(messageId: string): Promise<string | undefined> {
    const all = await this.c.all<{ id: string; message: { id: string } }>(BASE + '/drafts', 'drafts', { maxResults: 500 }, 5);
    return all.find((d) => d.message.id === messageId)?.id;
  }

  // ----- Settings -----

  async sendAs(): Promise<SendAs[]> {
    const r = await this.c.get<{ sendAs: { sendAsEmail: string; displayName?: string; signature?: string; isDefault?: boolean; isPrimary?: boolean }[] }>(
      BASE + '/settings/sendAs'
    );
    return (r.sendAs ?? []).map((s) => ({
      email: s.sendAsEmail,
      displayName: s.displayName ?? '',
      signature: s.signature ?? '',
      isDefault: !!s.isDefault,
      isPrimary: !!s.isPrimary
    }));
  }
  setSignature(email: string, signature: string) {
    return this.c.patch(BASE + '/settings/sendAs/' + encodeURIComponent(email), { signature });
  }

  async vacation(): Promise<Vacation> {
    const v = await this.c.get<{
      enableAutoReply: boolean;
      responseSubject?: string;
      responseBodyHtml?: string;
      responseBodyPlainText?: string;
      restrictToContacts?: boolean;
      restrictToDomain?: boolean;
      startTime?: string;
      endTime?: string;
    }>(BASE + '/settings/vacation');
    return {
      enabled: v.enableAutoReply,
      subject: v.responseSubject ?? '',
      html: v.responseBodyHtml ?? (v.responseBodyPlainText ?? '').replace(/\n/g, '<br>'),
      restrictToContacts: !!v.restrictToContacts,
      restrictToDomain: !!v.restrictToDomain,
      startTime: v.startTime ? Number(v.startTime) : undefined,
      endTime: v.endTime ? Number(v.endTime) : undefined
    };
  }
  setVacation(v: Vacation) {
    return this.c.put(BASE + '/settings/vacation', {
      enableAutoReply: v.enabled,
      responseSubject: v.subject,
      responseBodyHtml: v.html,
      restrictToContacts: v.restrictToContacts,
      restrictToDomain: v.restrictToDomain,
      startTime: v.startTime ? String(v.startTime) : undefined,
      endTime: v.endTime ? String(v.endTime) : undefined
    });
  }

  // ----- Filters (server-side rules) -----

  async filters() {
    const r = await this.c.get<{ filter?: GFilter[] }>(BASE + '/settings/filters');
    return r.filter ?? [];
  }
  createFilter(rule: Rule) {
    return this.c.post<GFilter>(BASE + '/settings/filters', ruleToFilter(rule));
  }
  deleteFilter(id: string) {
    return this.c.del(BASE + '/settings/filters/' + id);
  }
  async addForwardingAddress(email: string) {
    return this.c.post(BASE + '/settings/forwardingAddresses', { forwardingEmail: email });
  }
}

export interface GFilter {
  id?: string;
  criteria: { from?: string; to?: string; subject?: string; query?: string; hasAttachment?: boolean };
  action: { addLabelIds?: string[]; removeLabelIds?: string[]; forward?: string };
}

export function ruleToFilter(rule: Rule): GFilter {
  const add: string[] = [];
  const remove: string[] = [];
  if (rule.actions.addLabelId) add.push(rule.actions.addLabelId);
  if (rule.actions.flag) add.push('STARRED');
  if (rule.actions.trash) add.push('TRASH');
  if (rule.actions.markImportant) add.push('IMPORTANT');
  if (rule.actions.archive) remove.push('INBOX');
  if (rule.actions.markRead) remove.push('UNREAD');
  if (rule.actions.neverSpam) remove.push('SPAM');
  return {
    criteria: {
      from: rule.conditions.from || undefined,
      to: rule.conditions.to || undefined,
      subject: rule.conditions.subject || undefined,
      query: rule.conditions.hasWords || undefined,
      hasAttachment: rule.conditions.hasAttachment || undefined
    },
    action: { addLabelIds: add.length ? add : undefined, removeLabelIds: remove.length ? remove : undefined, forward: rule.actions.forwardTo || undefined }
  };
}

/** The Gmail search query equivalent of a rule, used to apply it to existing mail and for local rules. */
export function ruleToQuery(rule: Rule): string {
  const parts: string[] = [];
  const c = rule.conditions;
  if (c.from) parts.push(`from:(${c.from})`);
  if (c.to) parts.push(`to:(${c.to})`);
  if (c.subject) parts.push(`subject:(${c.subject})`);
  if (c.hasWords) parts.push(`(${c.hasWords})`);
  if (c.hasAttachment) parts.push('has:attachment');
  return parts.join(' ');
}
