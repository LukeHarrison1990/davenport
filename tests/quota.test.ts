import { describe, expect, it } from 'vitest';
import { QuotaLimiter, gmailCost, isQuotaError } from '../app/main/google/http';

describe('Gmail quota limiter', () => {
  it('paces calls to the configured rate', async () => {
    const q = new QuotaLimiter(1000, 50); // 1000 units/s, burst 50
    const t0 = Date.now();
    await Promise.all(Array.from({ length: 60 }, () => q.take(5))); // 300 units
    const elapsed = Date.now() - t0;
    expect(elapsed).toBeGreaterThanOrEqual(230); // (300 - 50) / 1000 s
    expect(elapsed).toBeLessThan(1500);
  });

  it('stops everything while paused', async () => {
    const q = new QuotaLimiter(10_000, 1000);
    q.pause(300);
    const t0 = Date.now();
    await q.take(5);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(280);
  });

  it('knows Gmail costs and quota errors', () => {
    const u = (p: string) => new URL('https://gmail.googleapis.com/gmail/v1/users/me' + p);
    expect(gmailCost('GET', u('/messages/abc'))).toBe(5);
    expect(gmailCost('POST', u('/messages/send'))).toBe(100);
    expect(gmailCost('POST', u('/messages/batchModify'))).toBe(50);
    expect(gmailCost('GET', u('/history'))).toBe(2);
    expect(isQuotaError("Quota exceeded for quota metric 'Total Query Cost' and limit 'Units per minute per user'")).toBe(true);
    expect(isQuotaError('Insufficient Permission')).toBe(false);
  });
});
