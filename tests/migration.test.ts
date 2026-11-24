import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { get, openDatabase, run } from '../app/main/db';

describe('upgrading the cache', () => {
  it('turns photos hidden by older versions back into attachments', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dav-mig-'));
    openDatabase(dir);
    const atts = [
      { id: 'a1', filename: 'IMG_0001.jpeg', mimeType: 'image/jpeg', size: 10, contentId: 'A1B2@icloud' },
      { id: 'a0', filename: 'logo.png', mimeType: 'image/png', size: 10, contentId: 'logo@sig' }
    ];
    run("INSERT INTO messages (account_id, id, thread_id, date, labels, body_html, attachments_json, has_attach) VALUES ('acc', 'm1', 't1', 1, '[]', ?, ?, 0)",
      '<img src="cid:logo@sig">', JSON.stringify(atts));
    run("UPDATE meta SET value = '3' WHERE key = 'schema'");
    openDatabase(dir);
    const row = get<{ attachments_json: string; has_attach: number }>("SELECT attachments_json, has_attach FROM messages WHERE id = 'm1'")!;
    const after = JSON.parse(row.attachments_json);
    expect(after[0].contentId).toBeUndefined();
    expect(after[1].contentId).toBe('logo@sig');
    expect(row.has_attach).toBe(1);
  });
});
