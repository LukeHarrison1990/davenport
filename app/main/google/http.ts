// Authenticated HTTP for one Google account: refreshes tokens, retries rate limits and transient errors.
import { get, run } from '../db';
import { seal, unseal } from '../secure';
import { refreshAccessToken, type TokenSet } from './oauth';

export class ReauthRequired extends Error {
  constructor(public accountId: string) {
    super('Google needs you to sign in to this account again.');
  }
}

export class GoogleApiError extends Error {
  constructor(public status: number, message: string, public reason?: string) {
    super(message);
  }
}

interface StoredTokens {
  refresh: string;
  access?: string;
  expiry?: number;
  scope?: string;
}

export function saveTokens(accountId: string, t: TokenSet, previousRefresh?: string): void {
  const stored: StoredTokens = {
    refresh: t.refresh_token ?? previousRefresh ?? '',
    access: t.access_token,
    expiry: Date.now() + (t.expires_in - 60) * 1000,
    scope: t.scope
  };
  run('UPDATE accounts SET tokens = ?, scopes = ? WHERE id = ?', seal(JSON.stringify(stored)), t.scope, accountId);
}

function loadTokens(accountId: string): StoredTokens | null {
  const row = get<{ tokens: string }>('SELECT tokens FROM accounts WHERE id = ?', accountId);
  const plain = unseal(row?.tokens);
  return plain ? (JSON.parse(plain) as StoredTokens) : null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface RequestOptions {
  query?: Record<string, string | number | boolean | string[] | undefined>;
  body?: unknown;
  rawBody?: BodyInit;
  headers?: Record<string, string>;
  responseType?: 'json' | 'text' | 'buffer';
}

export class GoogleClient {
  private refreshing: Promise<string> | null = null;
  private memo: StoredTokens | null = null;

  constructor(public accountId: string) {}

  private async accessToken(): Promise<string> {
    if (!this.memo) this.memo = loadTokens(this.accountId);
    if (!this.memo?.refresh) throw new ReauthRequired(this.accountId);
    if (this.memo.access && this.memo.expiry && this.memo.expiry > Date.now()) return this.memo.access;
    if (!this.refreshing) {
      this.refreshing = (async () => {
        try {
          const t = await refreshAccessToken(this.memo!.refresh);
          saveTokens(this.accountId, t, this.memo!.refresh);
          this.memo = loadTokens(this.accountId);
          return this.memo!.access!;
        } catch (e) {
          if ((e as { code?: string }).code === 'invalid_grant') {
            run("UPDATE accounts SET status = 'reauth' WHERE id = ?", this.accountId);
            throw new ReauthRequired(this.accountId);
          }
          throw e;
        } finally {
          this.refreshing = null;
        }
      })();
    }
    return this.refreshing;
  }

  invalidate(): void {
    if (this.memo) this.memo.expiry = 0;
  }

  hasScope(scope: string): boolean {
    if (!this.memo) this.memo = loadTokens(this.accountId);
    return (this.memo?.scope ?? '').split(' ').includes(scope);
  }

  async request<T = unknown>(method: string, url: string, opts: RequestOptions = {}): Promise<T> {
    const u = new URL(url);
    for (const [k, v] of Object.entries(opts.query ?? {})) {
      if (v === undefined) continue;
      if (Array.isArray(v)) v.forEach((x) => u.searchParams.append(k, x));
      else u.searchParams.set(k, String(v));
    }
    let attempt = 0;
    let refreshedOnce = false;
    for (;;) {
      const token = await this.accessToken();
      const headers: Record<string, string> = { Authorization: 'Bearer ' + token, ...(opts.headers ?? {}) };
      let body: BodyInit | undefined = opts.rawBody;
      if (opts.body !== undefined) {
        headers['Content-Type'] = 'application/json';
        body = JSON.stringify(opts.body);
      }
      let res: Response;
      try {
        res = await fetch(u, { method, headers, body });
      } catch (e) {
        if (attempt++ < 3) {
          await sleep(1000 * 2 ** attempt);
          continue;
        }
        throw e;
      }
      if (res.status === 401 && !refreshedOnce) {
        refreshedOnce = true;
        this.invalidate();
        continue;
      }
      if ((res.status === 429 || res.status >= 500 || res.status === 403) && attempt < 5) {
        // 403 is retried only for rate-limit reasons.
        if (res.status === 403) {
          const peek = await res.clone().text();
          if (!/rateLimitExceeded|userRateLimitExceeded|quotaExceeded/.test(peek)) {
            throw await toError(res, peek);
          }
        }
        const retryAfter = Number(res.headers.get('retry-after'));
        await sleep(retryAfter > 0 ? retryAfter * 1000 : 500 * 2 ** attempt + Math.random() * 400);
        attempt++;
        continue;
      }
      if (!res.ok) throw await toError(res);
      if (res.status === 204) return undefined as T;
      if (opts.responseType === 'text') return (await res.text()) as T;
      if (opts.responseType === 'buffer') return Buffer.from(await res.arrayBuffer()) as T;
      const text = await res.text();
      return (text ? JSON.parse(text) : undefined) as T;
    }
  }

  get<T>(url: string, query?: RequestOptions['query']): Promise<T> {
    return this.request<T>('GET', url, { query });
  }
  post<T>(url: string, body?: unknown, query?: RequestOptions['query']): Promise<T> {
    return this.request<T>('POST', url, { body, query });
  }
  patch<T>(url: string, body?: unknown, query?: RequestOptions['query']): Promise<T> {
    return this.request<T>('PATCH', url, { body, query });
  }
  put<T>(url: string, body?: unknown, query?: RequestOptions['query']): Promise<T> {
    return this.request<T>('PUT', url, { body, query });
  }
  del<T>(url: string, query?: RequestOptions['query']): Promise<T> {
    return this.request<T>('DELETE', url, { query });
  }

  /** Fetches every page of a list endpoint. */
  async all<T>(url: string, key: string, query: RequestOptions['query'] = {}, maxPages = 50): Promise<T[]> {
    const out: T[] = [];
    let pageToken: string | undefined;
    for (let i = 0; i < maxPages; i++) {
      const r = await this.get<Record<string, unknown>>(url, { ...query, pageToken });
      out.push(...(((r?.[key] as T[]) ?? [])));
      pageToken = r?.nextPageToken as string | undefined;
      if (!pageToken) break;
    }
    return out;
  }
}

async function toError(res: Response, text?: string): Promise<GoogleApiError> {
  const t = text ?? (await res.text().catch(() => ''));
  try {
    const j = JSON.parse(t);
    const reason = j.error?.errors?.[0]?.reason ?? j.error?.status;
    return new GoogleApiError(res.status, j.error?.message ?? res.statusText, reason);
  } catch {
    return new GoogleApiError(res.status, t || res.statusText);
  }
}

/** Runs async work over items with limited concurrency. */
export async function pool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  });
  await Promise.all(workers);
  return out;
}
