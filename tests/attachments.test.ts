import { describe, expect, it } from 'vitest';
import { parseMessage } from '../app/main/google/gmail';

const b64 = (s: string) => Buffer.from(s).toString('base64url');
const header = (name: string, value: string) => ({ name, value });

// A forwarded email as an iPhone sends it: two photos attached with Content-IDs, which the HTML doesn't show,
// and a signature logo the HTML does show.
const forwarded = {
  id: 'm1',
  threadId: 't1',
  labelIds: ['INBOX'],
  snippet: 'Photos from the trip',
  payload: {
    mimeType: 'multipart/mixed',
    headers: [header('From', 'Jo <jo@example.com>'), header('Subject', 'Fwd: Trip photos'), header('Date', 'Tue, 24 Nov 2026 10:00:00 +0000')],
    parts: [
      {
        partId: '0',
        mimeType: 'multipart/related',
        parts: [
          { partId: '0.0', mimeType: 'text/html', body: { data: b64('<p>Photos from the trip</p><img src="cid:logo@sig">') } },
          { partId: '0.1', mimeType: 'image/png', filename: 'logo.png', headers: [header('Content-ID', '<logo@sig>'), header('Content-Disposition', 'inline')], body: { attachmentId: 'a0', size: 900 } }
        ]
      },
      { partId: '1', mimeType: 'image/jpeg', filename: 'IMG_0001.jpeg', headers: [header('Content-ID', '<A1B2@icloud>'), header('Content-Disposition', 'attachment; filename="IMG_0001.jpeg"')], body: { attachmentId: 'a1', size: 2_400_000 } },
      { partId: '2', mimeType: 'image/jpeg', filename: 'IMG_0002.jpeg', headers: [header('Content-ID', '<C3D4@icloud>'), header('Content-Disposition', 'inline; filename="IMG_0002.jpeg"')], body: { attachmentId: 'a2', size: 2_100_000 } }
    ]
  }
};

describe('attached pictures', () => {
  it('shows photos the email body does not display as attachments', () => {
    const p = parseMessage(forwarded as never);
    const files = p.attachments.filter((a) => !a.contentId).map((a) => a.filename);
    expect(files).toEqual(['IMG_0001.jpeg', 'IMG_0002.jpeg']);
    expect(p.hasAttachments).toBe(true);
  });

  it('keeps pictures the body does display inside the email', () => {
    const p = parseMessage(forwarded as never);
    expect(p.attachments.find((a) => a.filename === 'logo.png')?.contentId).toBe('logo@sig');
  });
});
