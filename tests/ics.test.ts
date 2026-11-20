import { describe, expect, it } from 'vitest';
import { buildReply, mainEvent, parseIcs } from '../app/main/services/ics';

const GOOGLE = [
  'BEGIN:VCALENDAR',
  'PRODID:-//Google Inc//Google Calendar 70.9054//EN',
  'VERSION:2.0',
  'METHOD:REQUEST',
  'BEGIN:VEVENT',
  'DTSTART:20261126T140000Z',
  'DTEND:20261126T150000Z',
  'ORGANIZER;CN=Lena Okafor:mailto:lena@brightwater.example',
  'UID:abc123@google.com',
  'ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE;CN=Alex Morgan;X-NUM-GUESTS=0:mailto:alex@northfield.example',
  'SUMMARY:Supplier call\\, with notes',
  'DESCRIPTION:Join with Google Meet: https://meet.google.com/abc-defg-hij\\n\\nMore phone numbers',
  'SEQUENCE:2',
  'END:VEVENT',
  'END:VCALENDAR'
].join('\r\n');

// Outlook: Windows zone name, a folded line, quoted parameters with colons, and a Teams link.
const OUTLOOK = [
  'BEGIN:VCALENDAR',
  'METHOD:REQUEST',
  'PRODID:Microsoft Exchange Server 2010',
  'VERSION:2.0',
  'BEGIN:VTIMEZONE',
  'TZID:GMT Standard Time',
  'BEGIN:STANDARD',
  'DTSTART:16010101T020000',
  'TZOFFSETFROM:+0100',
  'TZOFFSETTO:+0000',
  'END:STANDARD',
  'END:VTIMEZONE',
  'BEGIN:VEVENT',
  'ORGANIZER;CN="Okafor, Lena":mailto:Lena@Brightwater.example',
  'ATTENDEE;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE;CN=alex@northfield.example:mailto:alex@n',
  ' orthfield.example',
  'DESCRIPTION;LANGUAGE=en-US:Agenda to follow',
  'UID:040000008200E00074C5B7101A82E00800000000ABCDEF',
  'SUMMARY;LANGUAGE=en-US:Quarterly review',
  'DTSTART;TZID=GMT Standard Time:20260715T100000',
  'DTEND;TZID=GMT Standard Time:20260715T113000',
  'LOCATION;LANGUAGE=en-US:Microsoft Teams Meeting',
  'RRULE:FREQ=MONTHLY;BYMONTHDAY=15',
  'X-MICROSOFT-SKYPETEAMSMEETINGURL:https://teams.microsoft.com/l/meetup-join/19%3ameeting_x',
  'SEQUENCE:0',
  'END:VEVENT',
  'END:VCALENDAR'
].join('\r\n');

describe('iCalendar invitations', () => {
  it('reads a Google Calendar invitation', () => {
    const cal = parseIcs(GOOGLE)!;
    expect(cal.method).toBe('REQUEST');
    const ev = mainEvent(cal);
    expect(ev.uid).toBe('abc123@google.com');
    expect(ev.summary).toBe('Supplier call, with notes');
    expect(ev.start).toBe(Date.UTC(2026, 10, 26, 14));
    expect(ev.end - ev.start).toBe(3_600_000);
    expect(ev.organizer).toEqual({ email: 'lena@brightwater.example', name: 'Lena Okafor' });
    expect(ev.attendees[0]).toMatchObject({ email: 'alex@northfield.example', partstat: 'NEEDS-ACTION' });
    expect(ev.meetingUrl).toBe('https://meet.google.com/abc-defg-hij');
    expect(ev.sequence).toBe(2);
  });

  it('reads an Outlook invitation with a Windows time zone in summer time', () => {
    const ev = mainEvent(parseIcs(OUTLOOK)!);
    // 10:00 London time in July is 09:00 UTC.
    expect(ev.start).toBe(Date.UTC(2026, 6, 15, 9));
    expect(ev.end).toBe(Date.UTC(2026, 6, 15, 10, 30));
    expect(ev.organizer).toEqual({ email: 'lena@brightwater.example', name: 'Okafor, Lena' });
    expect(ev.attendees[0].email).toBe('alex@northfield.example');
    expect(ev.rrule).toBe('FREQ=MONTHLY;BYMONTHDAY=15');
    expect(ev.location).toBe('Microsoft Teams Meeting');
    expect(ev.meetingUrl).toContain('teams.microsoft.com');
  });

  it('reads all-day events and cancellations', () => {
    const cal = parseIcs(['BEGIN:VCALENDAR', 'METHOD:CANCEL', 'BEGIN:VEVENT', 'UID:x', 'DTSTART;VALUE=DATE:20261201', 'SUMMARY:Away day', 'END:VEVENT', 'END:VCALENDAR'].join('\n'))!;
    expect(cal.method).toBe('CANCEL');
    const ev = mainEvent(cal);
    expect(ev.allDay).toBe(true);
    expect(ev.end - ev.start).toBe(86_400_000);
  });

  it('treats a file with no METHOD as an event to add, and ignores anything that is not a calendar', () => {
    expect(parseIcs(['BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'UID:y', 'DTSTART:20261201T090000Z', 'END:VEVENT', 'END:VCALENDAR'].join('\n'))!.method).toBe('PUBLISH');
    expect(parseIcs('hello')).toBeNull();
  });

  it('builds a reply the organiser can process', () => {
    const cal = parseIcs(OUTLOOK)!;
    const reply = buildReply(cal, mainEvent(cal), { email: 'alex@northfield.example', name: 'Alex Morgan' }, 'ACCEPTED');
    expect(reply).toContain('METHOD:REPLY');
    expect(reply).toContain('UID:040000008200E00074C5B7101A82E00800000000ABCDEF');
    expect(reply).toContain('ATTENDEE;PARTSTAT=ACCEPTED;CN="Alex Morgan":mailto:alex@northfield.example');
    expect(reply).toContain('DTSTART;TZID=GMT Standard Time:20260715T100000');
    expect(reply).toContain('TZID:GMT Standard Time'); // the VTIMEZONE travels with it
    for (const line of reply.split('\r\n')) expect(Buffer.byteLength(line)).toBeLessThanOrEqual(75);
    // It can be read back.
    const back = mainEvent(parseIcs(reply)!);
    expect(back.attendees[0]).toMatchObject({ email: 'alex@northfield.example', partstat: 'ACCEPTED' });
  });
});
