import { describe, expect, it } from 'vitest';
import { parseMessage, ruleToFilter, ruleToQuery } from '../app/main/google/gmail';
import { toBase64Url } from '../app/main/google/mime';
import type { Rule } from '../app/shared/types';

const b64 = (s: string) => toBase64Url(Buffer.from(s, 'utf8'));

describe('parseMessage', () => {
  it('reads metadata messages', () => {
    const p = parseMessage({
      id: 'm1',
      threadId: 't1',
      labelIds: ['INBOX', 'UNREAD'],
      snippet: 'Hi Alex, here&#39;s the &quot;plan&quot;',
      internalDate: '1761036120000',
      payload: {
        mimeType: 'multipart/mixed',
        headers: [
          { name: 'From', value: 'Priya Shah <priya@x.com>' },
          { name: 'To', value: 'alex@x.com' },
          { name: 'Subject', value: '=?UTF-8?B?UTQgYnVkZ2V0IOKAlCByZXZpc2Vk?=' },
          { name: 'Message-ID', value: '<id1@x.com>' }
        ]
      }
    });
    expect(p.subject).toBe('Q4 budget — revised');
    expect(p.from).toEqual({ name: 'Priya Shah', email: 'priya@x.com' });
    expect(p.snippet).toBe('Hi Alex, here\'s the "plan"');
    expect(p.hasAttachments).toBe(true);
    expect(p.full).toBe(false);
    expect(p.date).toBe(1761036120000);
  });

  it('extracts html, text, attachments and inline images from full messages', () => {
    const p = parseMessage({
      id: 'm2',
      threadId: 't2',
      internalDate: '1',
      payload: {
        mimeType: 'multipart/mixed',
        headers: [{ name: 'From', value: 'a@x.com' }],
        parts: [
          {
            mimeType: 'multipart/related',
            parts: [
              {
                mimeType: 'multipart/alternative',
                parts: [
                  { partId: '0.0', mimeType: 'text/plain', headers: [{ name: 'Content-Type', value: 'text/plain; charset="UTF-8"' }], body: { size: 5, data: b64('Hello') } },
                  { partId: '0.1', mimeType: 'text/html', headers: [{ name: 'Content-Type', value: 'text/html; charset=UTF-8' }], body: { size: 20, data: b64('<p>Hello <img src="cid:logo"></p>') } }
                ]
              },
              { partId: '1', mimeType: 'image/png', filename: 'logo.png', headers: [{ name: 'Content-ID', value: '<logo>' }, { name: 'Content-Disposition', value: 'inline' }], body: { size: 100, attachmentId: 'att-logo' } }
            ]
          },
          { partId: '2', mimeType: 'application/pdf', filename: 'Report.pdf', headers: [{ name: 'Content-Disposition', value: 'attachment' }], body: { size: 2048, attachmentId: 'att-pdf' } }
        ]
      }
    });
    expect(p.full).toBe(true);
    expect(p.text).toBe('Hello');
    expect(p.html).toContain('cid:logo');
    expect(p.attachments).toHaveLength(2);
    expect(p.attachments.find((a) => a.filename === 'logo.png')?.contentId).toBe('logo');
    expect(p.attachments.find((a) => a.filename === 'Report.pdf')?.contentId).toBeUndefined();
    expect(p.hasAttachments).toBe(true);
  });

  it('decodes non-UTF-8 bodies', () => {
    const latin = Buffer.from('Caf\xe9', 'latin1').toString('base64').replace(/\+/g, '-').replace(/\//g, '_');
    const p = parseMessage({
      id: 'm3', threadId: 't3', internalDate: '1',
      payload: { mimeType: 'text/plain', headers: [{ name: 'Content-Type', value: 'text/plain; charset=iso-8859-1' }], body: { size: 4, data: latin } }
    });
    expect(p.text).toBe('Café');
  });
});

describe('rules as Gmail filters', () => {
  const rule: Rule = {
    id: 'r', accountId: 'a', name: 'Acme', enabled: true, where: 'server',
    conditions: { from: 'acme.com', subject: 'invoice', hasAttachment: true },
    actions: { addLabelId: 'Label_1', archive: true, markRead: true, flag: true }
  };
  it('maps to filter criteria and actions', () => {
    expect(ruleToFilter(rule)).toEqual({
      criteria: { from: 'acme.com', to: undefined, subject: 'invoice', query: undefined, hasAttachment: true },
      action: { addLabelIds: ['Label_1', 'STARRED'], removeLabelIds: ['INBOX', 'UNREAD'], forward: undefined }
    });
  });
  it('maps to a search query', () => {
    expect(ruleToQuery(rule)).toBe('from:(acme.com) subject:(invoice) has:attachment');
  });
});
