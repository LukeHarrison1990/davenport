// Google Drive: uploads large attachments and shares them with the recipients (drive.file scope only).
import crypto from 'node:crypto';
import type { GoogleClient } from './http';

export async function uploadToDrive(c: GoogleClient, filename: string, mimeType: string, data: Buffer, shareWith: string[]): Promise<string> {
  const boundary = 'dav' + crypto.randomBytes(8).toString('hex');
  const meta = JSON.stringify({ name: filename, mimeType });
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: ${mimeType || 'application/octet-stream'}\r\n\r\n`),
    data,
    Buffer.from(`\r\n--${boundary}--`)
  ]);
  const file = await c.request<{ id: string; webViewLink: string }>('POST', 'https://www.googleapis.com/upload/drive/v3/files', {
    query: { uploadType: 'multipart', fields: 'id,webViewLink' },
    rawBody: body,
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }
  });
  for (const email of shareWith) {
    await c
      .post(`https://www.googleapis.com/drive/v3/files/${file.id}/permissions`, { role: 'reader', type: 'user', emailAddress: email }, { sendNotificationEmail: false })
      .catch(() => undefined);
  }
  return file.webViewLink;
}
