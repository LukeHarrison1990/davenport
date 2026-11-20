// Builds RFC 5322 / MIME messages for sending through the Gmail API, and parses address headers.
import crypto from 'node:crypto';
import type { Addr } from '../../shared/types';

export interface MimeAttachment {
  filename: string;
  mimeType: string;
  data: Buffer;
  contentId?: string;
}

export interface MimeInput {
  from: Addr;
  to: Addr[];
  cc?: Addr[];
  bcc?: Addr[];
  subject: string;
  html: string;
  text?: string;
  attachments?: MimeAttachment[];
  inReplyTo?: string;
  references?: string;
  importance?: 'normal' | 'high';
  date?: Date;
  /** A meeting invitation part (iMIP): e.g. a REPLY saying whether the sender is going. */
  calendar?: { method: 'REPLY' | 'REQUEST' | 'CANCEL'; ics: string };
}

const CRLF = '\r\n';

const isAscii = (s: string) => /^[\x20-\x7E]*$/.test(s);

/** RFC 2047 encoded-word for non-ASCII header text, split so no line grows too long. */
export function encodeHeader(value: string): string {
  if (isAscii(value)) return value;
  const words: string[] = [];
  let chunk = '';
  for (const ch of value) {
    if (Buffer.byteLength(chunk + ch, 'utf8') > 45) {
      words.push(chunk);
      chunk = '';
    }
    chunk += ch;
  }
  if (chunk) words.push(chunk);
  return words.map((w) => `=?UTF-8?B?${Buffer.from(w, 'utf8').toString('base64')}?=`).join(CRLF + ' ');
}

/** Header values can't contain line breaks: a stray CR/LF would start a new header (header injection). */
const oneLine = (s: string) => s.replace(/[\r\n\t]+/g, ' ').trim();

/** An email address that's safe to put in a header, or an error explaining what's wrong with it. */
export function cleanEmail(email: string): string {
  const e = oneLine(email);
  if (!/^[^\s<>()\[\],;:"\\@]+@[^\s<>()\[\],;:"\\@]+$/.test(e)) throw new Error(`"${e}" isn't a valid email address.`);
  return e;
}

/** Message-IDs as used in In-Reply-To and References: only the <...> tokens, nothing else. */
const cleanIds = (s: string) => (oneLine(s).match(/<[^<>\s]+>/g) ?? []).join(' ');

/** A MIME type like "image/png", or a safe default if the value from another email looks odd. */
const cleanType = (t: string) => (/^[\w.+-]+\/[\w.+-]+$/.test(t.trim()) ? t.trim() : 'application/octet-stream');

export function formatAddr(a: Addr): string {
  const email = cleanEmail(a.email);
  const name = a.name ? oneLine(a.name) : '';
  if (!name || name === email) return email;
  const shown = isAscii(name)
    ? /[(),.:;<>@[\]"\\]/.test(name) ? `"${name.replace(/(["\\])/g, '\\$1')}"` : name
    : encodeHeader(name);
  return `${shown} <${email}>`;
}

const formatList = (list: Addr[]) => list.map(formatAddr).join(', ');

const wrap76 = (b64: string) => b64.replace(/.{1,76}/g, (m) => m + CRLF).trimEnd();

const boundary = () => '=_dav_' + crypto.randomBytes(12).toString('hex');

export function htmlToText(html: string): string {
  return html
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li|tr|blockquote)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<a [^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (_m, href, text) => (text.trim() === href ? href : `${text} (${href})`))
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function filenameParam(name: string): string {
  if (isAscii(name) && !/["\\]/.test(name)) return `filename="${name}"`;
  // RFC 2231 for non-ASCII filenames, plus an encoded-word fallback that most clients read.
  return `filename*=UTF-8''${encodeURIComponent(name)}`;
}

export function buildMime(m: MimeInput): string {
  const headers: string[] = [];
  headers.push('MIME-Version: 1.0');
  headers.push('Date: ' + (m.date ?? new Date()).toUTCString().replace('GMT', '+0000'));
  headers.push('From: ' + formatAddr(m.from));
  if (m.to.length) headers.push('To: ' + formatList(m.to));
  if (m.cc?.length) headers.push('Cc: ' + formatList(m.cc));
  if (m.bcc?.length) headers.push('Bcc: ' + formatList(m.bcc));
  headers.push('Subject: ' + encodeHeader(m.subject));
  const inReplyTo = m.inReplyTo ? cleanIds(m.inReplyTo) : '';
  const references = cleanIds([m.references, inReplyTo].filter(Boolean).join(' '));
  if (inReplyTo) headers.push('In-Reply-To: ' + inReplyTo);
  if (references) headers.push('References: ' + references);
  if (m.importance === 'high') {
    headers.push('Importance: High');
    headers.push('X-Priority: 1');
  }

  const text = m.text ?? htmlToText(m.html);
  const html = /<html[\s>]/i.test(m.html)
    ? m.html
    : `<html><head><meta charset="utf-8"></head><body>${m.html}</body></html>`;

  const altB = boundary();
  const alternative = [
    `Content-Type: multipart/alternative; boundary="${altB}"`,
    '',
    `--${altB}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    wrap76(Buffer.from(text, 'utf8').toString('base64')),
    `--${altB}`,
    'Content-Type: text/html; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    wrap76(Buffer.from(html, 'utf8').toString('base64')),
    ...(m.calendar
      ? [
          `--${altB}`,
          `Content-Type: text/calendar; charset="UTF-8"; method=${m.calendar.method}`,
          'Content-Transfer-Encoding: base64',
          '',
          wrap76(Buffer.from(m.calendar.ics, 'utf8').toString('base64'))
        ]
      : []),
    `--${altB}--`
  ].join(CRLF);

  const atts = m.attachments ?? [];
  if (!atts.length) return headers.join(CRLF) + CRLF + alternative + CRLF;

  const mixB = boundary();
  const parts = [`Content-Type: multipart/mixed; boundary="${mixB}"`, '', `--${mixB}`, alternative];
  for (const a of atts) {
    parts.push(`--${mixB}`);
    const filename = oneLine(a.filename) || 'attachment';
    const contentId = a.contentId ? a.contentId.replace(/[^\w.@$+-]/g, '') : '';
    parts.push(`Content-Type: ${cleanType(a.mimeType || '')}; name="${isAscii(filename) && !/["\\]/.test(filename) ? filename : encodeHeader(filename)}"`);
    parts.push(`Content-Disposition: ${contentId ? 'inline' : 'attachment'}; ${filenameParam(filename)}`);
    if (contentId) parts.push(`Content-ID: <${contentId}>`);
    parts.push('Content-Transfer-Encoding: base64');
    parts.push('');
    parts.push(wrap76(a.data.toString('base64')));
  }
  parts.push(`--${mixB}--`);
  return headers.join(CRLF) + CRLF + parts.join(CRLF) + CRLF;
}

export const toBase64Url = (s: string | Buffer) =>
  Buffer.from(s).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export const fromBase64Url = (s: string) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

// ---------- Parsing ----------

/** Decodes RFC 2047 encoded-words in a header value. */
export function decodeHeader(v: string): string {
  return v
    .replace(/\?=\s+=\?/g, '?==?')
    .replace(/=\?([^?]+)\?([bBqQ])\?([^?]*)\?=/g, (_m, charset: string, enc: string, text: string) => {
      try {
        const buf =
          enc.toUpperCase() === 'B'
            ? Buffer.from(text, 'base64')
            : Buffer.from(
                text.replace(/_/g, ' ').replace(/=([0-9A-Fa-f]{2})/g, (_x, h) => String.fromCharCode(parseInt(h, 16))),
                'latin1'
              );
        return new TextDecoder(charset.toLowerCase()).decode(buf);
      } catch {
        return text;
      }
    });
}

/** Parses an address-list header ("A <a@x>, "B, C" <b@y>, c@z") into structured addresses. */
export function parseAddressList(header: string | undefined): Addr[] {
  if (!header) return [];
  const value = decodeHeader(header);
  const out: Addr[] = [];
  let cur = '';
  let inQuote = false;
  let depth = 0;
  const push = () => {
    const s = cur.trim();
    cur = '';
    if (!s) return;
    const m = s.match(/^(.*?)<([^>]+)>\s*$/);
    if (m) {
      const name = m[1].trim().replace(/^"(.*)"$/, '$1').replace(/\\(.)/g, '$1').trim();
      out.push({ name: name || undefined, email: m[2].trim() });
    } else {
      const email = s.replace(/\(.*\)/, '').trim();
      if (email.includes('@')) out.push({ email });
    }
  };
  for (const ch of value) {
    if (ch === '"' && depth === 0) inQuote = !inQuote;
    if (!inQuote && ch === '<') depth++;
    if (!inQuote && ch === '>') depth = Math.max(0, depth - 1);
    if (ch === ',' && !inQuote && depth === 0) push();
    else cur += ch;
  }
  push();
  return out;
}
