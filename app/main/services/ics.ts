import crypto from 'node:crypto';

// A small iCalendar (RFC 5545) reader for meeting invitations, enough for what Google Calendar, Outlook and
// Exchange send: METHOD, the main VEVENT, its times and time zone, organiser and attendees.

export interface IcsProp {
  name: string;
  params: Record<string, string>;
  value: string;
  /** The property exactly as it appeared (unfolded), for copying into a reply. */
  raw: string;
}

export interface IcsAttendee {
  email: string;
  name?: string;
  partstat?: string;
  role?: string;
}

export interface IcsEvent {
  uid: string;
  sequence: number;
  summary: string;
  description?: string;
  location?: string;
  start: number;
  end: number;
  allDay: boolean;
  organizer?: { email: string; name?: string };
  attendees: IcsAttendee[];
  rrule?: string;
  recurrenceId?: string;
  status?: string;
  meetingUrl?: string;
  /** Raw DTSTART / RECURRENCE-ID / ORGANIZER lines, copied as they are into a reply. */
  rawLines: { dtstart?: string; recurrenceId?: string; organizer?: string };
}

export interface IcsCalendar {
  method: string;
  events: IcsEvent[];
  /** Raw VTIMEZONE blocks, copied into a reply so its times mean the same thing. */
  timezones: string[];
}

const unescapeText = (v: string) => v.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1');

function parseLine(raw: string): IcsProp | null {
  // NAME;PARAM=a;PARAM="b:c":value — colons inside quoted parameter values don't end the name part.
  let i = 0;
  let quoted = false;
  for (; i < raw.length; i++) {
    const ch = raw[i];
    if (ch === '"') quoted = !quoted;
    else if (ch === ':' && !quoted) break;
  }
  if (i >= raw.length) return null;
  const head = raw.slice(0, i);
  const value = raw.slice(i + 1);
  const parts: string[] = [];
  let cur = '';
  quoted = false;
  for (const ch of head) {
    if (ch === '"') quoted = !quoted;
    if (ch === ';' && !quoted) {
      parts.push(cur);
      cur = '';
    } else cur += ch;
  }
  parts.push(cur);
  const params: Record<string, string> = {};
  for (const p of parts.slice(1)) {
    const eq = p.indexOf('=');
    if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, '');
  }
  return { name: parts[0].toUpperCase(), params, value, raw };
}

/** Windows time zone names (Outlook / Exchange) to IANA, for the zones people are most likely to meet. */
const WINDOWS_ZONES: Record<string, string> = {
  'GMT Standard Time': 'Europe/London',
  'Greenwich Standard Time': 'Atlantic/Reykjavik',
  'W. Europe Standard Time': 'Europe/Berlin',
  'Central Europe Standard Time': 'Europe/Budapest',
  'Central European Standard Time': 'Europe/Warsaw',
  'Romance Standard Time': 'Europe/Paris',
  'E. Europe Standard Time': 'Europe/Chisinau',
  'FLE Standard Time': 'Europe/Kiev',
  'GTB Standard Time': 'Europe/Bucharest',
  'Russian Standard Time': 'Europe/Moscow',
  'Turkey Standard Time': 'Europe/Istanbul',
  'Israel Standard Time': 'Asia/Jerusalem',
  'South Africa Standard Time': 'Africa/Johannesburg',
  'Arabian Standard Time': 'Asia/Dubai',
  'India Standard Time': 'Asia/Kolkata',
  'China Standard Time': 'Asia/Shanghai',
  'Singapore Standard Time': 'Asia/Singapore',
  'Tokyo Standard Time': 'Asia/Tokyo',
  'Korea Standard Time': 'Asia/Seoul',
  'AUS Eastern Standard Time': 'Australia/Sydney',
  'E. Australia Standard Time': 'Australia/Brisbane',
  'W. Australia Standard Time': 'Australia/Perth',
  'New Zealand Standard Time': 'Pacific/Auckland',
  'Eastern Standard Time': 'America/New_York',
  'Central Standard Time': 'America/Chicago',
  'Mountain Standard Time': 'America/Denver',
  'US Mountain Standard Time': 'America/Phoenix',
  'Pacific Standard Time': 'America/Los_Angeles',
  'Alaskan Standard Time': 'America/Anchorage',
  'Hawaiian Standard Time': 'Pacific/Honolulu',
  'Atlantic Standard Time': 'America/Halifax',
  'Canada Central Standard Time': 'America/Regina',
  'SA Pacific Standard Time': 'America/Bogota',
  'E. South America Standard Time': 'America/Sao_Paulo',
  'Argentina Standard Time': 'America/Buenos_Aires',
  'UTC': 'UTC',
  'Coordinated Universal Time': 'UTC'
};

function ianaZone(tzid: string | undefined): string | undefined {
  if (!tzid) return undefined;
  const clean = tzid.replace(/^\/+/, '').replace(/^"|"$/g, '');
  const mapped = WINDOWS_ZONES[clean] ?? clean;
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: mapped });
    return mapped;
  } catch {
    return undefined;
  }
}

/** Offset (ms) of a zone from UTC at a given instant. */
function zoneOffset(zone: string, at: number): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit'
  }).formatToParts(new Date(at));
  const v = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return Date.UTC(v('year'), v('month') - 1, v('day'), v('hour'), v('minute'), v('second')) - Math.floor(at / 1000) * 1000;
}

/** A wall-clock time in a zone, as an instant. */
function wallToUtc(y: number, mo: number, d: number, h: number, mi: number, s: number, zone: string): number {
  const guess = Date.UTC(y, mo, d, h, mi, s);
  let t = guess - zoneOffset(zone, guess);
  t = guess - zoneOffset(zone, t); // second pass settles times near a daylight-saving change
  return t;
}

/** "+0100" style offset of a VTIMEZONE's standard time, for zones we can't name. */
function vtimezoneOffset(block: string | undefined): number | undefined {
  const m = block?.match(/BEGIN:STANDARD[\s\S]*?TZOFFSETTO:([+-])(\d{2})(\d{2})/);
  if (!m) return undefined;
  return (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) * 60_000;
}

function parseDate(p: IcsProp | undefined, tzBlocks: Map<string, string>): { ms: number; allDay: boolean } | undefined {
  if (!p) return undefined;
  const m = p.value.trim().match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/);
  if (!m) return undefined;
  const [y, mo, d] = [Number(m[1]), Number(m[2]) - 1, Number(m[3])];
  if (!m[4] || p.params.VALUE === 'DATE') return { ms: new Date(y, mo, d).getTime(), allDay: true };
  const [h, mi, s] = [Number(m[4]), Number(m[5]), Number(m[6] ?? 0)];
  if (m[7]) return { ms: Date.UTC(y, mo, d, h, mi, s), allDay: false };
  const zone = ianaZone(p.params.TZID);
  if (zone) return { ms: wallToUtc(y, mo, d, h, mi, s, zone), allDay: false };
  const off = vtimezoneOffset(p.params.TZID ? tzBlocks.get(p.params.TZID) : undefined);
  if (off !== undefined) return { ms: Date.UTC(y, mo, d, h, mi, s) - off, allDay: false };
  return { ms: new Date(y, mo, d, h, mi, s).getTime(), allDay: false }; // floating time: the computer's own zone
}

function parseDuration(v: string | undefined): number | undefined {
  const m = v?.match(/^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/);
  if (!m) return undefined;
  const ms = (((Number(m[2] ?? 0) * 7 + Number(m[3] ?? 0)) * 24 + Number(m[4] ?? 0)) * 60 + Number(m[5] ?? 0)) * 60_000 + Number(m[6] ?? 0) * 1000;
  return m[1] === '-' ? -ms : ms;
}

const mailto = (v: string) => v.replace(/^mailto:/i, '').trim().toLowerCase();

export function parseIcs(text: string): IcsCalendar | null {
  if (!/BEGIN:VCALENDAR/i.test(text)) return null;
  const lines = text.replace(/\r\n|\r/g, '\n').replace(/\n[ \t]/g, '').split('\n');
  let method = '';
  const timezones: string[] = [];
  const tzBlocks = new Map<string, string>();
  const rawEvents: IcsProp[][] = [];
  const stack: string[] = [];
  let tzLines: string[] | null = null;
  let props: IcsProp[] | null = null;
  for (const raw of lines) {
    if (!raw.trim()) continue;
    const p = parseLine(raw);
    if (!p) continue;
    if (p.name === 'BEGIN') {
      stack.push(p.value.toUpperCase());
      if (p.value.toUpperCase() === 'VTIMEZONE') tzLines = [];
      if (p.value.toUpperCase() === 'VEVENT' && stack.length === 2) props = [];
    }
    if (tzLines) tzLines.push(raw);
    if (p.name === 'END') {
      const what = stack.pop();
      if (what === 'VTIMEZONE' && tzLines) {
        const block = tzLines.join('\r\n');
        timezones.push(block);
        const id = block.match(/^TZID[^:]*:(.*)$/m)?.[1]?.trim();
        if (id) tzBlocks.set(id, block);
        tzLines = null;
      }
      if (what === 'VEVENT' && props) {
        rawEvents.push(props);
        props = null;
      }
      continue;
    }
    if (p.name === 'METHOD' && stack.length === 1) method = p.value.trim().toUpperCase();
    if (props && stack[stack.length - 1] === 'VEVENT' && p.name !== 'BEGIN') props.push(p);
  }

  const events: IcsEvent[] = [];
  for (const ps of rawEvents) {
    const one = (n: string) => ps.find((p) => p.name === n);
    const uid = one('UID')?.value.trim();
    const start = parseDate(one('DTSTART'), tzBlocks);
    if (!uid || !start) continue;
    const endProp = parseDate(one('DTEND'), tzBlocks);
    const dur = parseDuration(one('DURATION')?.value.trim());
    const end = endProp?.ms ?? start.ms + (dur ?? (start.allDay ? 86_400_000 : 3_600_000));
    const org = one('ORGANIZER');
    const teams = one('X-MICROSOFT-SKYPETEAMSMEETINGURL')?.value ?? one('X-GOOGLE-CONFERENCE')?.value;
    const description = one('DESCRIPTION') ? unescapeText(one('DESCRIPTION')!.value) : undefined;
    events.push({
      uid,
      sequence: Number(one('SEQUENCE')?.value ?? 0) || 0,
      summary: unescapeText(one('SUMMARY')?.value ?? '').trim() || '(No title)',
      description,
      location: one('LOCATION') ? unescapeText(one('LOCATION')!.value).trim() || undefined : undefined,
      start: start.ms,
      end,
      allDay: start.allDay,
      organizer: org ? { email: mailto(org.value), name: org.params.CN } : undefined,
      attendees: ps
        .filter((p) => p.name === 'ATTENDEE')
        .map((p) => ({ email: mailto(p.value), name: p.params.CN, partstat: p.params.PARTSTAT?.toUpperCase(), role: p.params.ROLE })),
      rrule: one('RRULE')?.value,
      recurrenceId: one('RECURRENCE-ID')?.value,
      status: one('STATUS')?.value.toUpperCase(),
      meetingUrl: teams ?? description?.match(/https:\/\/(?:teams\.microsoft\.com\/l\/meetup-join|meet\.google\.com|[\w.-]*zoom\.us\/j)\/[^\s<>"]+/)?.[0],
      rawLines: { dtstart: one('DTSTART')?.raw, recurrenceId: one('RECURRENCE-ID')?.raw, organizer: org?.raw }
    });
  }
  if (!events.length) return null;
  return { method: method || 'PUBLISH', events, timezones };
}

/** The invitation's main event: the series (no RECURRENCE-ID) if there is one, otherwise the first. */
export function mainEvent(cal: IcsCalendar): IcsEvent {
  return cal.events.find((e) => !e.recurrenceId) ?? cal.events[0];
}

const icsEscape = (v: string) => v.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

/** Fold a content line at 75 octets, as RFC 5545 asks. */
function fold(line: string): string {
  const bytes = Buffer.from(line, 'utf8');
  if (bytes.length <= 75) return line;
  const out: string[] = [];
  let cur = '';
  let len = 0;
  for (const ch of line) {
    const n = Buffer.byteLength(ch);
    if (len + n > (out.length ? 74 : 75)) {
      out.push(cur);
      cur = '';
      len = 0;
    }
    cur += ch;
    len += n;
  }
  out.push(cur);
  return out.join('\r\n ');
}

const stamp = (ms: number) => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

/** An iTIP REPLY (RFC 5546) telling the organiser how the attendee responded. */
export function buildReply(cal: IcsCalendar, ev: IcsEvent, me: { email: string; name?: string }, partstat: 'ACCEPTED' | 'TENTATIVE' | 'DECLINED', comment?: string): string {
  const cn = me.name ? `;CN="${me.name.replace(/"/g, "'")}"` : '';
  const lines = [
    'BEGIN:VCALENDAR',
    'PRODID:-//Davenport//Davenport for Windows//EN',
    'VERSION:2.0',
    'METHOD:REPLY',
    ...cal.timezones.flatMap((t) => t.split(/\r?\n/)),
    'BEGIN:VEVENT',
    `UID:${ev.uid}`,
    ...(ev.recurrenceId && ev.rawLines.recurrenceId ? [ev.rawLines.recurrenceId] : []),
    `SEQUENCE:${ev.sequence}`,
    `DTSTAMP:${stamp(Date.now())}`,
    ...(ev.rawLines.dtstart ? [ev.rawLines.dtstart] : []),
    ...(ev.rawLines.organizer ? [ev.rawLines.organizer] : []),
    `ATTENDEE;PARTSTAT=${partstat}${cn}:mailto:${me.email}`,
    `SUMMARY:${icsEscape(ev.summary)}`,
    ...(comment ? [`COMMENT:${icsEscape(comment)}`] : []),
    'END:VEVENT',
    'END:VCALENDAR'
  ];
  return lines.map(fold).join('\r\n') + '\r\n';
}

/** The demo account's event id for an invitation's UID. */
export const demoEventId = (uid: string) => 'inv-' + crypto.createHash('sha1').update(uid).digest('hex').slice(0, 16);
