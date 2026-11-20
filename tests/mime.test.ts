import { describe, expect, it } from 'vitest';
import { buildMime, decodeHeader, encodeHeader, formatAddr, htmlToText, parseAddressList, toBase64Url, fromBase64Url } from '../app/main/google/mime';

describe('address parsing', () => {
  it('parses names, quotes and commas inside quotes', () => {
    expect(parseAddressList('"Shah, Priya" <priya@x.com>, tom@y.org, Lena Okafor <lena@z.io>')).toEqual([
      { name: 'Shah, Priya', email: 'priya@x.com' },
      { email: 'tom@y.org' },
      { name: 'Lena Okafor', email: 'lena@z.io' }
    ]);
  });
  it('decodes encoded-word names', () => {
    expect(parseAddressList('=?UTF-8?B?w4lsb2RpZQ==?= <e@x.com>')).toEqual([{ name: 'Élodie', email: 'e@x.com' }]);
  });
  it('returns an empty list for missing headers', () => {
    expect(parseAddressList(undefined)).toEqual([]);
  });
});

describe('headers', () => {
  it('leaves ASCII alone and encodes Unicode', () => {
    expect(encodeHeader('Q4 budget')).toBe('Q4 budget');
    const enc = encodeHeader('Budget — £4,280 ✓');
    expect(enc).toMatch(/^=\?UTF-8\?B\?/);
    expect(decodeHeader(enc.replace(/\r\n /g, ' '))).toBe('Budget — £4,280 ✓');
  });
  it('quotes display names with special characters', () => {
    expect(formatAddr({ name: 'Shah, Priya', email: 'p@x.com' })).toBe('"Shah, Priya" <p@x.com>');
    expect(formatAddr({ email: 'p@x.com' })).toBe('p@x.com');
  });
  it('decodes quoted-printable encoded words', () => {
    expect(decodeHeader('=?ISO-8859-1?Q?Caf=E9_menu?=')).toBe('Café menu');
  });
});

describe('buildMime', () => {
  it('builds a multipart/alternative message with threading headers', () => {
    const mime = buildMime({
      from: { name: 'Alex Morgan', email: 'alex@x.com' },
      to: [{ email: 'priya@x.com' }],
      cc: [{ name: 'Tom', email: 'tom@x.com' }],
      subject: 'Re: Q4 budget',
      html: '<p>Hello <b>Priya</b></p>',
      inReplyTo: '<abc@mail.gmail.com>',
      references: '<root@mail.gmail.com>'
    });
    expect(mime).toContain('From: Alex Morgan <alex@x.com>');
    expect(mime).toContain('Cc: Tom <tom@x.com>');
    expect(mime).toContain('In-Reply-To: <abc@mail.gmail.com>');
    expect(mime).toContain('References: <root@mail.gmail.com> <abc@mail.gmail.com>');
    expect(mime).toContain('multipart/alternative');
    expect(mime).not.toContain('multipart/mixed');
    expect(mime.split('\r\n').every((l) => l.length <= 998)).toBe(true);
  });
  it('adds attachments as multipart/mixed with RFC 2231 names', () => {
    const mime = buildMime({
      from: { email: 'a@x.com' },
      to: [{ email: 'b@x.com' }],
      subject: 'Files',
      html: '<p>Attached</p>',
      attachments: [{ filename: 'Résumé.pdf', mimeType: 'application/pdf', data: Buffer.from('PDFDATA') }]
    });
    expect(mime).toContain('multipart/mixed');
    expect(mime).toContain("filename*=UTF-8''R%C3%A9sum%C3%A9.pdf");
    expect(mime).toContain(Buffer.from('PDFDATA').toString('base64'));
  });
  it('marks high importance', () => {
    const mime = buildMime({ from: { email: 'a@x.com' }, to: [{ email: 'b@x.com' }], subject: 's', html: 'x', importance: 'high' });
    expect(mime).toContain('Importance: High');
  });
});

describe('helpers', () => {
  it('converts HTML to readable text', () => {
    expect(htmlToText('<p>Hi&nbsp;Alex,</p><ul><li>One</li><li>Two</li></ul><a href="https://x.com">site</a>')).toBe('Hi Alex,\n• One\n• Two\nsite (https://x.com)');
  });
  it('round-trips base64url', () => {
    const s = 'subjects?/with+odd=chars';
    expect(fromBase64Url(toBase64Url(s)).toString()).toBe(s);
    expect(toBase64Url(s)).not.toMatch(/[+/=]/);
  });
});
