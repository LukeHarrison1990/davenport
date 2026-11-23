import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: { getVersion: () => '1.2.0', isPackaged: false } }));
vi.mock('../app/main/events', () => ({ emit: () => undefined }));
vi.mock('../app/main/settings', () => ({ getSettings: () => ({ autoUpdate: true }) }));

describe('update version comparison', () => {
  it('only offers genuinely newer versions', async () => {
    const { newer } = await import('../app/main/updater');
    expect(newer('1.2.1', '1.2.0')).toBe(true);
    expect(newer('1.10.0', '1.9.3')).toBe(true);
    expect(newer('2.0.0', '1.99.99')).toBe(true);
    expect(newer('1.2.0', '1.2.0')).toBe(false);
    expect(newer('1.1.9', '1.2.0')).toBe(false);
  });
});
