// Checks what Davenport sends to Google Calendar for special entry types.
import { describe, expect, it, vi } from 'vitest';

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

import { toGoogle } from '../app/main/services/calendar';

describe('Calendar out-of-office entries', () => {
  const base = { accountId: 'a', calendarId: 'primary', title: 'Out of office', start: Date.UTC(2026, 10, 2, 9), end: Date.UTC(2026, 10, 6, 17), allDay: false };

  it('sends the message as the decline message, never as a description (Google rejects that)', () => {
    const body = toGoogle({ event: { ...base, eventType: 'outOfOffice', autoDecline: true, description: 'On leave until Friday', location: 'Home', attendees: [{ email: 'x@y.z', response: 'needsAction' }] }, addMeet: true });
    expect(body.eventType).toBe('outOfOffice');
    expect(body).not.toHaveProperty('description');
    expect(body).not.toHaveProperty('location');
    expect(body).not.toHaveProperty('attendees');
    expect(body).not.toHaveProperty('conferenceData');
    expect(body.outOfOfficeProperties).toEqual({ autoDeclineMode: 'declineAllConflictingInvitations', declineMessage: 'On leave until Friday' });
  });

  it('keeps descriptions on ordinary events', () => {
    const body = toGoogle({ event: { ...base, eventType: 'default', description: 'Agenda' } });
    expect(body.description).toBe('Agenda');
  });
});
