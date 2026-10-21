// Line icons drawn for Davenport (24px grid, stroke follows the text colour).
const P: Record<string, string> = {
  mail: 'M3 5h18v14H3z|M3 7l9 6 9-6',
  calendar: 'M3 5h18v16H3z|M3 10h18|M8 3v4|M16 3v4',
  people: 'C9 8 3.5|M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6|C17 9 2.5|M16.5 14.2c2.9.3 5 2.4 5 5.8',
  person: 'C12 8 4|M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7',
  chat: 'M4 5h16v11H9l-5 4z',
  tasks: 'M4 4h16v16H4z|M8 12l3 3 5-6',
  settings: 'C12 12 3|M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1',
  plus: 'M12 5v14M5 12h14',
  trash: 'M4 7h16|M9 7V4h6v3|M6 7l1 13h10l1-13',
  archive: 'M3 4h18v5H3z|M5 9v11h14V9|M10 13h4',
  reply: 'M10 6L4 12l6 6|M4 12h10a6 6 0 0 1 6 6',
  replyAll: 'M8 6L2 12l6 6|M13 6l-6 6 6 6|M7 12h7a6 6 0 0 1 6 6',
  forward: 'M14 6l6 6-6 6|M20 12H10a6 6 0 0 0-6 6',
  move: 'M3 7h7l2 2h9v10H3z|M13 14h5|M16 11l3 3-3 3',
  tag: 'M3 12V4h8l10 10-8 8z|C7.5 8.5 1.5',
  flag: 'M5 21V4h11l-2 4 2 4H5',
  clock: 'C12 13 8|M12 9v4l3 2|M9 2h6',
  bolt: 'M13 2L4 14h7l-1 8 9-12h-7z',
  search: 'C11 11 6.5|M16 16l4.5 4.5',
  check: 'M5 12l4 4 10-10',
  close: 'M6 6l12 12M18 6L6 18',
  chevDown: 'M6 9l6 6 6-6',
  chevRight: 'M9 6l6 6-6 6',
  chevLeft: 'M15 6l-6 6 6 6',
  chevUp: 'M6 15l6-6 6 6',
  attach: 'M20 11l-8.5 8.5a5 5 0 0 1-7-7L13 4a3.5 3.5 0 0 1 5 5l-8.5 8.5a2 2 0 0 1-3-3L14 7',
  sync: 'M20 12a8 8 0 0 1-14.3 4.9|M4 12A8 8 0 0 1 18.3 7.1|M18 3v4.5h-4.5|M6 21v-4.5h4.5',
  more: 'C5 12 1.2|C12 12 1.2|C19 12 1.2',
  folder: 'M3 6h6l2 2h10v11H3z',
  folderPlus: 'M3 6h6l2 2h10v11H3z|M12 11v5M9.5 13.5h5',
  inbox: 'M3 13l3-8h12l3 8v6H3z|M3 13h5l1 2h6l1-2h5',
  send: 'M4 12l16-8-6 16-2-7z|M12 13l8-9',
  draft: 'M5 3h10l4 4v14H5z|M14 3v5h5|M8 13h8M8 17h5',
  bin: 'M4 7h16|M9 7V4h6v3|M6 7l1 13h10l1-13',
  spam: 'M12 3l9 16H3z|M12 10v4|M12 17v.5',
  star: 'M12 3l2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z',
  allmail: 'M3 7h18v12H3z|M3 9l9 5 9-5|M6 4h12',
  scheduled: 'C12 13 8|M12 9v4l2.5 1.5|M4 4l3 2M20 4l-3 2',
  snooze: 'C12 13 8|M10 10h4l-4 5h4|M4 4l3 2M20 4l-3 2',
  print: 'M6 9V3h12v6|M6 17H4v-7h16v7h-2|M7 14h10v7H7z',
  pdf: 'M5 3h10l4 4v14H5z|M14 3v5h5|M8 15h1.5a1.5 1.5 0 0 0 0-3H8v5|M13 12v5h1a2 2 0 0 0 2-2v-1a2 2 0 0 0-2-2z',
  download: 'M12 4v11|M7 10l5 5 5-5|M5 20h14',
  open: 'M14 4h6v6|M20 4l-9 9|M18 14v6H4V6h6',
  video: 'M3 7h12v10H3z|M15 10l6-3v10l-6-3',
  location: 'M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z|C12 10 2.5',
  bell: 'M6 16V11a6 6 0 0 1 12 0v5l2 2H4z|M10 20a2 2 0 0 0 4 0',
  repeat: 'M17 2l3 3-3 3|M4 11V9a4 4 0 0 1 4-4h12|M7 22l-3-3 3-3|M20 13v2a4 4 0 0 1-4 4H4',
  globe: 'C12 12 9|M3 12h18|M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3',
  home: 'M3 11l9-7 9 7|M5 10v10h14V10',
  building: 'M5 21V4h10v17|M15 9h4v12|M8 8h4M8 12h4M8 16h4|M3 21h18',
  focus: 'C12 12 8|C12 12 3',
  plane: 'M10 14L3 11l1-2 8 1 4-6h2l-2 7 5 1 1 2-6 1-2 7h-2l-1-6z',
  copy: 'M8 8h12v12H8z|M4 16V4h12',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1|M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  bold: 'M7 4h6a4 4 0 0 1 0 8H7z|M7 12h7a4 4 0 0 1 0 8H7z',
  italic: 'M10 4h8|M6 20h8|M15 4L9 20',
  underline: 'M7 4v7a5 5 0 0 0 10 0V4|M5 21h14',
  bullets: 'M9 6h11M9 12h11M9 18h11|C4.5 6 1|C4.5 12 1|C4.5 18 1',
  numbers: 'M10 6h10M10 12h10M10 18h10|M4 4h1v5|M3.5 14.5a1.5 1.5 0 1 1 2.5 1.2L3.5 19H6.5',
  indent: 'M10 6h10M10 12h10M10 18h10|M3 9l3 3-3 3',
  outdent: 'M10 6h10M10 12h10M10 18h10|M6 9l-3 3 3 3',
  clear: 'M4 7h12|M10 7l-3 13|M14 15l6 6M20 15l-6 6',
  image: 'M3 5h18v14H3z|C8.5 10 1.5|M21 16l-5-5-9 8',
  signature: 'M3 17c3 0 4-8 7-8s1 8 4 8 3-4 5-4 2 2 2 2|M3 21h18',
  template: 'M4 4h16v16H4z|M4 9h16|M9 9v11',
  rules: 'M4 6h10|M4 12h7|M4 18h10|M17 4v4|M15 6h4|M14 12h6|M17 16v4M15 18h4',
  smile: 'C12 12 9|M8.5 14a4 4 0 0 0 7 0|M9 9.5v.5M15 9.5v.5',
  thumb: 'M7 11v9H4v-9z|M7 11l4-8a2 2 0 0 1 3 2l-1 5h6a2 2 0 0 1 2 2.3l-1.2 6A2 2 0 0 1 17.8 20H7',
  thread: 'M4 5h12v8H8l-4 3z|M20 9v9l-3-2h-6',
  user: 'C12 8 4|M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7',
  edit: 'M4 20h4L19 9l-4-4L4 16z|M13 7l4 4',
  phone: 'M5 3h4l2 5-3 2a11 11 0 0 0 6 6l2-3 5 2v4a2 2 0 0 1-2 2A17 17 0 0 1 3 5a2 2 0 0 1 2-2z',
  info: 'C12 12 9|M12 11v5|M12 7.5v.5',
  warning: 'M12 3l9 16H3z|M12 10v4|M12 17v.5',
  sun: 'C12 12 4|M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  list: 'M8 6h12M8 12h12M8 18h12|M4 6h.5M4 12h.5M4 18h.5',
  grid: 'M4 4h7v7H4z|M13 4h7v7h-7z|M4 13h7v7H4z|M13 13h7v7h-7z',
  pane: 'M3 5h18v14H3z|M10 5v14',
  important: 'M4 6h12l4 6-4 6H4l4-6z',
  unread: 'M3 7h13v12H3z|M3 9l6.5 4L16 9|C19 6 2.5',
  read: 'M3 9l9-5 9 5v10H3z|M3 9l9 6 9-6',
  maximise: 'M5 5h14v14H5z',
  minimise: 'M5 12h14',
  popout: 'M14 4h6v6|M20 4l-8 8|M18 14v6H4V6h6',
  brightness: 'C12 12 4|M12 3v1M12 20v1M3 12h1M20 12h1'
};

export type IconName = keyof typeof P;

export function Icon({ name, size = 16, className, title, strokeWidth = 1.6, fill }: { name: string; size?: number; className?: string; title?: string; strokeWidth?: number; fill?: string }) {
  const def = P[name] ?? P.info;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={fill ?? 'none'}
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      {def.split('|').map((seg, i) => {
        if (seg.startsWith('C')) {
          const [cx, cy, r] = seg.slice(1).trim().split(/\s+/).map(Number);
          return <circle key={i} cx={cx} cy={cy} r={r} />;
        }
        return <path key={i} d={seg} />;
      })}
    </svg>
  );
}

export function Logo({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#D9B77A" strokeWidth="1.7" strokeLinejoin="round" aria-hidden>
      <path d="M3 10l9-5 9 5" />
      <path d="M4 10h16v10H4z" />
      <path d="M14 13h4M14 16h4" />
      <path d="M7 13h4v7" />
    </svg>
  );
}
