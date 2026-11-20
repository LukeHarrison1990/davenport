// Google sign-in for desktop apps: the system browser opens Google's own sign-in page and returns
// to a one-time listener on 127.0.0.1 (loopback redirect) with PKCE, as Google recommends.
import { app, shell } from 'electron';
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { kvDelete, kvGet, kvSet } from '../db';
import { seal, unseal } from '../secure';

/** Full Gmail access: everything gmail.modify allows, plus permanently deleting messages (Delete forever, Empty Bin). */
export const FULL_MAIL_SCOPE = 'https://mail.google.com/';

export const BASE_SCOPES = [
  'openid',
  'email',
  'profile',
  FULL_MAIL_SCOPE,
  'https://www.googleapis.com/auth/gmail.settings.basic',
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/contacts',
  'https://www.googleapis.com/auth/contacts.other.readonly',
  'https://www.googleapis.com/auth/directory.readonly',
  'https://www.googleapis.com/auth/tasks',
  'https://www.googleapis.com/auth/drive.file'
];

export const CHAT_SCOPES = [
  'https://www.googleapis.com/auth/chat.spaces.readonly',
  'https://www.googleapis.com/auth/chat.messages',
  'https://www.googleapis.com/auth/chat.messages.reactions',
  'https://www.googleapis.com/auth/chat.memberships.readonly',
  'https://www.googleapis.com/auth/chat.users.readstate',
  'https://www.googleapis.com/auth/chat.users.availability'
];

export interface OAuthClient {
  clientId: string;
  clientSecret: string;
  source: 'settings' | 'file' | 'builtin';
}

// Davenport's own Google app, added when the installer is built (from oauth-client.json or the
// DAVENPORT_CLIENT_ID / DAVENPORT_CLIENT_SECRET environment variables; see docs/BUILDING.md). It is never in the
// source code, so copies built by other people don't sign in as Davenport. Google treats a desktop app's secret
// as not confidential: sign-in is protected by PKCE and the loopback redirect instead.
declare const __DAVENPORT_CLIENT_ID__: string;
declare const __DAVENPORT_CLIENT_SECRET__: string;
const BUILT_IN: { clientId: string; clientSecret: string } | null =
  typeof __DAVENPORT_CLIENT_ID__ === 'string' && __DAVENPORT_CLIENT_ID__ ? { clientId: __DAVENPORT_CLIENT_ID__, clientSecret: __DAVENPORT_CLIENT_SECRET__ } : null;

export const hasBuiltInClient = (): boolean => !!BUILT_IN;

interface StoredClient {
  clientId: string;
  secret: string; // sealed
}

/**
 * The Google app Davenport signs in as: one the user (or their organisation) set up in settings or in an
 * oauth-client.json beside the app or in its data folder, otherwise Davenport's own built-in one.
 */
export function getOAuthClient(): OAuthClient | null {
  const stored = kvGet<StoredClient>('oauth', 'client');
  if (stored?.clientId) {
    return { clientId: stored.clientId, clientSecret: unseal(stored.secret) ?? '', source: 'settings' };
  }
  const candidates = [
    path.join(app.getPath('userData'), 'oauth-client.json'),
    path.join(path.dirname(app.getPath('exe')), 'oauth-client.json'),
    process.env.PORTABLE_EXECUTABLE_DIR ? path.join(process.env.PORTABLE_EXECUTABLE_DIR, 'oauth-client.json') : ''
  ].filter(Boolean);
  for (const file of candidates) {
    const parsed = readClientFile(file);
    if (parsed) return { ...parsed, source: 'file' };
  }
  return BUILT_IN ? { ...BUILT_IN, source: 'builtin' } : null;
}

/** Stop using a client set in settings, going back to the built-in one. */
export function clearOAuthClient(): void {
  kvDelete('oauth', 'client');
}

export function readClientFile(file: string): { clientId: string; clientSecret: string } | null {
  try {
    if (!fs.existsSync(file)) return null;
    const json = JSON.parse(fs.readFileSync(file, 'utf8'));
    const c = json.installed ?? json.web ?? json;
    if (c.client_id) return { clientId: c.client_id, clientSecret: c.client_secret ?? '' };
  } catch {
    /* not a client file */
  }
  return null;
}

export function setOAuthClient(clientId: string, clientSecret: string): void {
  kvSet('oauth', 'client', { clientId: clientId.trim(), secret: seal(clientSecret.trim()) } satisfies StoredClient);
}

export interface TokenSet {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope: string;
  id_token?: string;
}

export interface SignInResult {
  tokens: TokenSet;
  email: string;
  name: string;
  hostedDomain?: string;
}

const b64url = (buf: Buffer) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const PAGE = (title: string, body: string) => `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
<style>body{font-family:'Segoe UI',system-ui,sans-serif;background:#EEF0F3;color:#1B1F24;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
main{background:#fff;border:1px solid #DADDE2;border-radius:12px;padding:32px 40px;max-width:420px;text-align:center}
h1{font-size:20px;color:#1F3A5F;margin:0 0 8px}p{color:#4A5260;line-height:1.5;margin:0}</style></head>
<body><main><h1>${title}</h1><p>${body}</p></main></body></html>`;

/** Opens the browser for consent and resolves with tokens and the signed-in profile. */
export async function signIn(opts: { scopes: string[]; loginHint?: string }): Promise<SignInResult> {
  const client = getOAuthClient();
  if (!client) throw new Error('Add your Google OAuth client first (Settings › Accounts).');

  const verifier = b64url(crypto.randomBytes(32));
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  const state = b64url(crypto.randomBytes(16));

  const { code, redirectUri } = await new Promise<{ code: string; redirectUri: string }>((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      if (url.pathname !== '/') {
        res.writeHead(404).end();
        return;
      }
      const err = url.searchParams.get('error');
      const gotState = url.searchParams.get('state');
      const gotCode = url.searchParams.get('code');
      // Anything that isn't Google's answer to this sign-in (a browser retry, another program probing the port)
      // is ignored rather than cancelling the sign-in.
      if (gotState !== state || (!err && !gotCode)) {
        res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' }).end('This page is only used to finish signing in to Davenport.');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      if (err || !gotCode) {
        res.end(PAGE('Sign-in was not completed', 'You can close this tab and try again from Davenport.'));
        cleanup();
        reject(new Error(err === 'access_denied' ? 'Sign-in was cancelled.' : 'Sign-in failed: ' + (err ?? 'invalid response')));
        return;
      }
      res.end(PAGE('You are signed in', 'You can close this tab and return to Davenport.'));
      cleanup();
      resolve({ code: gotCode, redirectUri });
    });
    let redirectUri = '';
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('Sign-in timed out after 5 minutes.'));
    }, 5 * 60 * 1000);
    const cleanup = () => {
      clearTimeout(timeout);
      server.close();
    };
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as { port: number }).port;
      redirectUri = `http://127.0.0.1:${port}`;
      const auth = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      auth.searchParams.set('client_id', client.clientId);
      auth.searchParams.set('redirect_uri', redirectUri);
      auth.searchParams.set('response_type', 'code');
      auth.searchParams.set('scope', opts.scopes.join(' '));
      auth.searchParams.set('code_challenge', challenge);
      auth.searchParams.set('code_challenge_method', 'S256');
      auth.searchParams.set('state', state);
      auth.searchParams.set('access_type', 'offline');
      auth.searchParams.set('prompt', 'consent');
      auth.searchParams.set('include_granted_scopes', 'true');
      if (opts.loginHint) auth.searchParams.set('login_hint', opts.loginHint);
      void shell.openExternal(auth.toString());
    });
    server.on('error', (e) => {
      cleanup();
      reject(e);
    });
  });

  const body = new URLSearchParams({
    code,
    client_id: client.clientId,
    client_secret: client.clientSecret,
    code_verifier: verifier,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code'
  });
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });
  const tokens = (await res.json()) as TokenSet & { error?: string; error_description?: string };
  if (!res.ok || tokens.error) throw new Error('Google refused the sign-in: ' + (tokens.error_description ?? tokens.error ?? res.status));

  const infoRes = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: { Authorization: 'Bearer ' + tokens.access_token }
  });
  const info = (await infoRes.json().catch(() => ({}))) as { email?: string; name?: string; hd?: string };
  if (!infoRes.ok || !info.email) throw new Error("Signed in, but Google didn't say which account it was. Please try again.");

  return { tokens, email: info.email, name: info.name ?? info.email, hostedDomain: info.hd };
}

export async function refreshAccessToken(refreshToken: string): Promise<TokenSet> {
  const client = getOAuthClient();
  if (!client) throw new Error('No OAuth client configured');
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: client.clientId,
      client_secret: client.clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token'
    })
  });
  const json = (await res.json()) as TokenSet & { error?: string; error_description?: string };
  if (!res.ok || json.error) {
    const e = new Error(json.error_description ?? json.error ?? 'Token refresh failed');
    (e as Error & { code?: string }).code = json.error;
    throw e;
  }
  return json;
}

export async function revoke(token: string): Promise<void> {
  try {
    await fetch('https://oauth2.googleapis.com/revoke?token=' + encodeURIComponent(token), { method: 'POST' });
  } catch {
    /* best effort */
  }
}
