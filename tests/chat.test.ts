// Google Chat sending and status against a simulated Chat API (no network needed).
import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp', isPackaged: false, setBadgeCount: () => true },
  shell: { openExternal: vi.fn(), openPath: vi.fn() },
  BrowserWindow: { getAllWindows: () => [], getFocusedWindow: () => null },
  safeStorage: { isEncryptionAvailable: () => false },
  Notification: Object.assign(function () { return { on() {}, show() {} }; }, { isSupported: () => false }),
  nativeImage: { createFromPath: () => ({ isEmpty: () => true }), createEmpty: () => ({}), createFromDataURL: () => ({}) },
  dialog: {},
  screen: {},
  Menu: {},
  Tray: function () {}
}));

import { openDatabase, run, kvSet } from '../app/main/db';
import { saveTokens } from '../app/main/google/http';
import * as chat from '../app/main/services/chat';

const APP_MISSING = 'Google Chat app not found. To create a Chat app, you must turn on the Chat API and configure the app in the Google Cloud console.';
const google = {
  configured: false,
  availability: { name: 'users/me/availability', state: 'ACTIVE' } as Record<string, unknown>,
  calls: [] as { method: string; path: string; query: string; body?: Record<string, unknown> }[]
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

vi.stubGlobal('fetch', vi.fn(async (input: string | URL, init?: RequestInit) => {
  const url = new URL(String(input));
  const method = init?.method ?? 'GET';
  if (url.host === 'oauth2.googleapis.com') return json({ access_token: 'tok', expires_in: 3600 });
  if (url.host !== 'chat.googleapis.com') return json({ error: { message: 'Unhandled' } }, 400);
  const body = init?.body ? JSON.parse(String(init.body)) : undefined;
  google.calls.push({ method, path: url.pathname, query: url.search, body });
  // Like Google: reading works with just the API on; changing anything needs the Chat app configured.
  if (method !== 'GET' && !google.configured) return json({ error: { code: 404, message: APP_MISSING, status: 'NOT_FOUND' } }, 404);
  const p = url.pathname;
  if (p === '/v1/users/me/availability' && method === 'GET') return json(google.availability);
  if (p === '/v1/users/me/availability:markAsDoNotDisturb') {
    google.availability = { ...google.availability, state: 'DO_NOT_DISTURB', doNotDisturbMetadata: { expirationTime: body!.expireTime } };
    return json({});
  }
  if (p === '/v1/users/me/availability:markAsAway') return (google.availability = { ...google.availability, state: 'AWAY' }), json({});
  if (p === '/v1/users/me/availability:markAsActive') return (google.availability = { ...google.availability, state: 'ACTIVE', doNotDisturbMetadata: undefined }), json({});
  if (p === '/v1/users/me/availability' && method === 'PATCH') {
    google.availability = { ...google.availability, customStatus: body!.customStatus };
    return json(google.availability);
  }
  if (/^\/v1\/spaces\/[^/]+\/messages$/.test(p) && method === 'POST') {
    return json({ name: p.slice(4) + '/m1', sender: { name: 'users/me', displayName: 'Me' }, createTime: new Date().toISOString(), text: body!.text, thread: { name: 'spaces/s1/threads/t1' } });
  }
  return json({ error: { message: 'Unhandled ' + p } }, 400);
}));

beforeAll(() => {
  openDatabase('', ':memory:');
  kvSet('oauth', 'client', { clientId: 'id.apps.googleusercontent.com', secret: 'b64:' + Buffer.from('s').toString('base64') });
  run("INSERT INTO accounts (id, email, name, kind, color, status, sort, is_workspace, chat_enabled) VALUES ('g1', 'me@x.com', 'Me', 'google', '#000', 'ok', 1, 1, 1)");
  saveTokens('g1', { access_token: 'tok', refresh_token: 'refresh', expires_in: 3600, scope: 'openid https://www.googleapis.com/auth/chat.messages https://www.googleapis.com/auth/chat.users.availability' });
  kvSet('chatMe', 'g1', 'users/me');
});

describe('Google Chat', () => {
  it('explains the missing Chat app setting instead of passing on Google’s error', async () => {
    await expect(chat.send('g1', 'spaces/s1', 'Hello')).rejects.toThrow(/one more setting/);
    expect(chat.statuses()[0].needsSetup).toBe(true);
  });

  it('clears the setup notice once sending works', async () => {
    google.configured = true;
    const m = await chat.send('g1', 'spaces/s1', 'Hello');
    expect(m.text).toBe('Hello');
    expect(chat.statuses()[0].needsSetup).toBeUndefined();
  });

  it('reads the status from Google', async () => {
    await chat.fetchStatus('g1');
    expect(chat.statuses()[0]).toMatchObject({ accountId: 'g1', presence: 'active' });
  });

  it('sets Do not disturb in Google until the chosen time', async () => {
    const until = Date.now() + 2 * 3600_000;
    await chat.setPresence('g1', 'dnd', until);
    const call = google.calls.find((c) => c.path.endsWith(':markAsDoNotDisturb'))!;
    expect(call.body).toEqual({ expireTime: new Date(until).toISOString() });
    expect(chat.statuses()[0]).toMatchObject({ presence: 'dnd', dndUntil: until });
  });

  it('switches back to automatic and to away', async () => {
    await chat.setPresence('g1', 'away');
    expect(chat.statuses()[0].presence).toBe('away');
    await chat.setPresence('g1', 'automatic');
    expect(chat.statuses()[0].presence).toBe('active');
  });

  it('sets and clears a custom status with only customStatus in the update mask', async () => {
    const until = Date.now() + 3600_000;
    await chat.setCustomStatus('g1', 'Teaching', '🧑‍🏫', until);
    const set = google.calls.filter((c) => c.method === 'PATCH').at(-1)!;
    expect(set.query).toContain('updateMask=customStatus');
    expect(set.body).toMatchObject({ customStatus: { text: 'Teaching', emoji: { unicode: '🧑‍🏫' }, expireTime: new Date(until).toISOString() } });
    expect(chat.statuses()[0]).toMatchObject({ customText: 'Teaching', customEmoji: '🧑‍🏫', customUntil: until });
    await chat.setCustomStatus('g1', null);
    expect(google.calls.filter((c) => c.method === 'PATCH').at(-1)!.body).not.toHaveProperty('customStatus');
    expect(chat.statuses()[0].customText).toBeUndefined();
  });

  it('asks for permission when the account signed in before status was available', () => {
    saveTokens('g1', { access_token: 'tok', refresh_token: 'refresh', expires_in: 3600, scope: 'openid https://www.googleapis.com/auth/chat.messages' });
    expect(chat.statuses()[0].needsPermission).toBe(true);
  });
});
