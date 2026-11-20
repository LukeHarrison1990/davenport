// Formatting helpers (British English conventions by default, following the system locale).
import type { Addr } from '../shared/types';

const LOCALE = navigator.language || 'en-GB';
const DAY = 864e5;

export const startOfDay = (ms: number) => {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};
export const addDays = (ms: number, n: number) => {
  const d = new Date(ms);
  d.setDate(d.getDate() + n);
  return d.getTime();
};
export const startOfWeek = (ms: number, firstDay = 1) => {
  const d = new Date(startOfDay(ms));
  const diff = (d.getDay() - firstDay + 7) % 7;
  return addDays(d.getTime(), -diff);
};
export const sameDay = (a: number, b: number) => startOfDay(a) === startOfDay(b);

export function listTime(ms: number): string {
  const now = Date.now();
  if (sameDay(ms, now)) return new Date(ms).toLocaleTimeString(LOCALE, { hour: '2-digit', minute: '2-digit' });
  if (now - ms < 6 * DAY && ms < now) return new Date(ms).toLocaleDateString(LOCALE, { weekday: 'short' }) + ' ' + new Date(ms).toLocaleTimeString(LOCALE, { hour: '2-digit', minute: '2-digit' });
  if (new Date(ms).getFullYear() === new Date(now).getFullYear()) return new Date(ms).toLocaleDateString(LOCALE, { day: 'numeric', month: 'short' });
  return new Date(ms).toLocaleDateString(LOCALE, { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function groupLabel(ms: number): string {
  const today = startOfDay(Date.now());
  if (ms >= today) return 'Today';
  if (ms >= today - DAY) return 'Yesterday';
  if (ms >= startOfWeek(Date.now())) return 'Earlier this week';
  if (ms >= startOfWeek(Date.now()) - 7 * DAY) return 'Last week';
  const d = new Date(ms);
  const n = new Date();
  if (d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth()) return 'Earlier this month';
  if (d.getFullYear() === n.getFullYear()) return d.toLocaleDateString(LOCALE, { month: 'long' });
  return 'Older';
}

export const fullDate = (ms: number) => new Date(ms).toLocaleString(LOCALE, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
export const time = (ms: number) => new Date(ms).toLocaleTimeString(LOCALE, { hour: '2-digit', minute: '2-digit' });
export const dayName = (ms: number, style: 'short' | 'long' = 'short') => new Date(ms).toLocaleDateString(LOCALE, { weekday: style });
export const dayMonth = (ms: number) => new Date(ms).toLocaleDateString(LOCALE, { day: 'numeric', month: 'short' });
export const longDay = (ms: number) => new Date(ms).toLocaleDateString(LOCALE, { weekday: 'long', day: 'numeric', month: 'long' });
export const monthYear = (ms: number) => new Date(ms).toLocaleDateString(LOCALE, { month: 'long', year: 'numeric' });

export function rangeTitle(start: number, end: number): string {
  const s = new Date(start);
  const e = new Date(end - 1);
  if (s.getMonth() === e.getMonth()) return `${s.getDate()}–${e.getDate()} ${s.toLocaleDateString(LOCALE, { month: 'long', year: 'numeric' })}`;
  if (s.getFullYear() === e.getFullYear()) return `${s.getDate()} ${s.toLocaleDateString(LOCALE, { month: 'short' })} – ${e.getDate()} ${e.toLocaleDateString(LOCALE, { month: 'short', year: 'numeric' })}`;
  return `${dayMonth(start)} ${s.getFullYear()} – ${dayMonth(end - 1)} ${e.getFullYear()}`;
}

export const bytes = (n: number) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

export const addrName = (a: Addr) => a.name || a.email;
export const addrFull = (a: Addr) => (a.name ? `${a.name} <${a.email}>` : a.email);

export function initials(name: string): string {
  const parts = name.replace(/[<(].*$/, '').replace(/@.*/, '').split(/[\s._-]+/).filter(Boolean);
  if (!parts.length) return '?';
  return ((parts[0][0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

const AVATAR = [
  ['#E0E7F1', '#1F3A5F'], ['#F6EBDD', '#7A4E14'], ['#E6F1EA', '#1E5B34'], ['#EDE3F4', '#4A2F5E'], ['#FBE6E1', '#8A2E1C'], ['#E5ECF7', '#24497A'], ['#EEF0F3', '#3A3F47']
];
export function avatarColours(seed: string): [string, string] {
  let h = 0;
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return AVATAR[h % AVATAR.length] as [string, string];
}

export function fileKind(name: string, mime: string): { label: string; colour: string } {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  if (/xlsx?|csv|ods/.test(ext) || mime.includes('sheet')) return { label: 'XLS', colour: '#1E7A45' };
  if (/docx?|odt|rtf/.test(ext) || mime.includes('word')) return { label: 'DOC', colour: '#2B579A' };
  if (/pptx?|odp/.test(ext) || mime.includes('presentation')) return { label: 'PPT', colour: '#C2512B' };
  if (ext === 'pdf' || mime === 'application/pdf') return { label: 'PDF', colour: '#B3361F' };
  if (mime.startsWith('image/')) return { label: 'IMG', colour: '#7A4E9C' };
  if (/zip|7z|rar|gz/.test(ext)) return { label: 'ZIP', colour: '#5B6472' };
  if (ext === 'ics') return { label: 'CAL', colour: '#1F3A5F' };
  return { label: (ext || 'FILE').slice(0, 4).toUpperCase(), colour: '#5B6472' };
}

export function isValidEmail(s: string): boolean {
  return /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[^\s@<>(),;:"]+$/.test(s.trim());
}

/** Parses pasted recipients like "A <a@x>; b@y, "C, D" <c@z>". */
export function parseRecipients(s: string): Addr[] {
  const out: Addr[] = [];
  const re = /(?:"([^"]+)"|([^,;<>"]+?))?\s*<([^>]+)>|([^\s,;<>"]+@[^\s,;<>"]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    if (m[3]) out.push({ name: (m[1] ?? m[2])?.trim() || undefined, email: m[3].trim() });
    else if (m[4]) out.push({ email: m[4].trim() });
  }
  return out;
}

export function toLocalInput(ms: number, dateOnly = false): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  const date = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  return dateOnly ? date : `${date}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
export function fromLocalInput(s: string): number {
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [y, m, d] = s.split('-').map(Number);
    return new Date(y, m - 1, d).getTime();
  }
  return new Date(s).getTime();
}

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

/** Quick snooze/flag times in the style of Outlook. */
export function quickTimes(): { label: string; at: number; hint: string }[] {
  const now = new Date();
  const at = (d: Date, h: number) => {
    const x = new Date(d);
    x.setHours(h, 0, 0, 0);
    return x.getTime();
  };
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  const nextMon = new Date(now);
  nextMon.setDate(now.getDate() + ((8 - now.getDay()) % 7 || 7));
  const sat = new Date(now);
  sat.setDate(now.getDate() + ((6 - now.getDay() + 7) % 7 || 7));
  const out = [];
  if (now.getHours() < 16) out.push({ label: 'Later today', at: at(now, Math.max(now.getHours() + 3, 17)), hint: '' });
  out.push({ label: 'Tomorrow', at: at(tomorrow, 8), hint: '' });
  if (now.getDay() >= 1 && now.getDay() <= 4) out.push({ label: 'This weekend', at: at(sat, 9), hint: '' });
  out.push({ label: 'Next week', at: at(nextMon, 8), hint: '' });
  return out.map((o) => ({ ...o, hint: new Date(o.at).toLocaleString(LOCALE, { weekday: 'short', hour: '2-digit', minute: '2-digit' }) }));
}
