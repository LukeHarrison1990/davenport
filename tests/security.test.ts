// Checks for the hardening added in 1.0.17.
import { describe, expect, it } from 'vitest';
import { buildMime, cleanEmail } from '../app/main/google/mime';
import { isBlockedType } from '../app/main/services/attachmentSafety';
import { parseMailto } from '../app/main/mailto';

const headersOf = (mime: string) => mime.split('\r\n\r\n')[0];

describe('outgoing headers', () => {
  it('refuses an address that would smuggle in another header', () => {
    expect(() => cleanEmail('victim@example.com\r\nBcc: spy@example.com')).toThrow(/valid email/);
    expect(() => buildMime({ from: { email: 'me@x.com' }, to: [{ email: 'a@b.com\nBcc: c@d.com' }], subject: 'Hi', html: '<p>Hi</p>' })).toThrow();
  });

  it('keeps display names on one line', () => {
    const mime = buildMime({ from: { email: 'me@x.com' }, to: [{ email: 'a@b.com', name: 'Ann\r\nBcc: spy@example.com' }], subject: 'Hi', html: '<p>Hi</p>' });
    expect(headersOf(mime)).not.toMatch(/^Bcc:/m);
  });

  it('only copies Message-IDs from the email being replied to', () => {
    const mime = buildMime({
      from: { email: 'me@x.com' }, to: [{ email: 'a@b.com' }], subject: 'Re: Hi', html: '<p>Hi</p>',
      inReplyTo: '<abc@mail.example>\r\nBcc: spy@example.com', references: '<one@x> <two@y>\nX-Evil: 1'
    });
    const h = headersOf(mime);
    expect(h).toMatch(/^In-Reply-To: <abc@mail\.example>$/m);
    expect(h).toMatch(/^References: <one@x> <two@y> <abc@mail\.example>$/m);
    expect(h).not.toMatch(/^(Bcc|X-Evil):/m);
  });

  it('cleans attachment types and content IDs taken from other emails', () => {
    const mime = buildMime({
      from: { email: 'me@x.com' }, to: [{ email: 'a@b.com' }], subject: 'Fw', html: '<p>x</p>',
      attachments: [{ filename: 'a.png', mimeType: 'image/png\r\nX-Evil: 1', data: Buffer.from('x'), contentId: 'id1>\r\nX-Evil: 2' }]
    });
    expect(mime).not.toMatch(/^X-Evil/m);
    expect(mime).toMatch(/Content-Type: application\/octet-stream; name="a.png"/);
  });
});

describe('attachments', () => {
  it('blocks programs, scripts and shortcuts, including disguised names', () => {
    for (const n of ['setup.exe', 'invoice.pdf.js', 'Report.LNK', 'update.exe.', 'run.ps1 ', 'disk.iso', 'macro.hta']) expect(isBlockedType(n)).toBe(true);
  });
  it('allows ordinary documents and pictures', () => {
    for (const n of ['report.pdf', 'budget.xlsx', 'photo.jpg', 'notes.txt', 'archive.zip']) expect(isBlockedType(n)).toBe(false);
  });
});

describe('mailto links', () => {
  it('reads several addresses, cc, bcc, subject and body', () => {
    const m = parseMailto('mailto:a@x.com,b@y.com?cc=c@z.com&bcc=d@w.com&subject=Hello%20there&body=Line%201%0ALine%202');
    expect(m).toEqual({ to: ['a@x.com', 'b@y.com'], cc: ['c@z.com'], bcc: ['d@w.com'], subject: 'Hello there', body: 'Line 1\nLine 2' });
  });
  it('drops anything that is not an address, and line breaks in the subject', () => {
    const m = parseMailto('mailto:not-an-address?to=ok@x.com&subject=Hi%0D%0ABcc:%20spy@x.com&attach=C:%5Cevil.exe');
    expect(m.to).toEqual(['ok@x.com']);
    expect(m.subject).toBe('Hi Bcc: spy@x.com');
    expect(m).not.toHaveProperty('attach');
  });
});
