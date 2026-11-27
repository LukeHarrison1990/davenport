// Chat: Google Chat spaces and direct messages, with threads and reactions.
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import type { Account, ChatMessage, ChatSpace, ChatStatus } from '../../shared/types';
import { call, useLive } from '../api';
import { Icon } from '../components/Icon';
import { ChatAttachment } from './ChatAttachment';
import { contextMenu, copyText } from '../components/contextMenu';
import { openMenu, type MenuEntry } from '../components/Menu';
import { Splitter, usePaneSize } from '../components/Splitter';
import { Rail, Ribbon, StatusBar, TitleBar } from '../components/Shell';
import { Avatar, Dialog, Empty, Field } from '../components/ui';
import { fail, notify, useApp } from '../state';
import { addDays, cx, dayName, longDay, sameDay, startOfDay, time } from '../util';

const REACTIONS = ['👍', '❤️', '😂', '🎉', '👀', '✅'];

function renderText(text: string) {
  const parts = text.split(/(@[A-Z][\w'-]+(?: [A-Z][\w'-]+)?|https?:\/\/\S+)/g);
  return parts.map((p, i) =>
    p.startsWith('@') ? <span key={i} className="mention">{p}</span>
      : /^https?:\/\//.test(p) ? <a key={i} href="#" onClick={(e) => { e.preventDefault(); void call('app.openExternal', p); }}>{p}</a>
        : <Fragment key={i}>{p.replace(/\*([^*]+)\*/g, '$1')}</Fragment>
  );
}

export function ChatView() {
  const { accounts, openDialog, search, setSearch } = useApp();
  const chatAccounts = accounts.filter((a) => a.chatEnabled);
  const [spaces] = useLive(() => call('chat.spaces', 'all'), ['chat', 'accounts'], [], [] as ChatSpace[]);
  const [current, setCurrent] = useState<ChatSpace | null>(null);
  const [thread, setThread] = useState<ChatMessage | null>(null);
  const [statuses] = useLive(() => call('chat.statuses'), ['chat', 'accounts'], [], [] as ChatStatus[]);
  const [editing, setEditing] = useState<ChatStatus | null>(null);
  const [listWidth, setListWidth, saveListWidth] = usePaneSize('dav.chat.listWidth', 280);
  const [threadWidth, setThreadWidth, saveThreadWidth] = usePaneSize('dav.chat.threadWidth', 340);
  const [collapsed, setCollapsed] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem('dav.chatCollapsed') ?? '[]') as string[];
    } catch {
      return [];
    }
  });
  const toggle = (id: string) => {
    const next = collapsed.includes(id) ? collapsed.filter((x) => x !== id) : [...collapsed, id];
    setCollapsed(next);
    try {
      localStorage.setItem('dav.chatCollapsed', JSON.stringify(next));
    } catch {
      /* not essential */
    }
  };

  useEffect(() => {
    if (!current && spaces.length) setCurrent(spaces.find((s) => s.kind === 'space') ?? spaces[0]);
  }, [spaces, current]);
  useEffect(() => {
    if (current?.unread) void call('chat.markRead', current.accountId, current.id);
    setThread(null);
    if (current) void call('chat.refresh', current.accountId, current.id).catch(() => undefined);
  }, [current?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const q = search.toLowerCase();
  const visible = spaces.filter((s) => !q || s.name.toLowerCase().includes(q) || (s.lastPreview ?? '').toLowerCase().includes(q));
  const statusOf = (id: string): ChatStatus => statuses.find((x) => x.accountId === id) ?? { accountId: id, presence: 'unknown' };
  const statusAccount = current?.accountId ?? chatAccounts[0]?.id;

  if (!chatAccounts.length) {
    return (
      <>
        <TitleBar placeholder="Search chat" />
        <div className="body">
          <Rail />
          <div className="detail" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Empty icon="chat" title="Google Chat isn't turned on yet" text="Chat works with Google Workspace accounts. Turn it on in Settings › Accounts — Google will ask you to allow Chat access.">
              <button className="btn primary" onClick={() => openDialog('settings', 'accounts')}>Open account settings</button>
            </Empty>
          </div>
        </div>
        <StatusBar />
      </>
    );
  }

  const conv = (s: ChatSpace) => (
    <button key={s.accountId + s.id} className={cx('conv', s.unread > 0 && 'unread')} aria-current={current?.id === s.id && current.accountId === s.accountId} onClick={() => setCurrent(s)}
      onContextMenu={contextMenu(() => [
        { label: 'Open', icon: 'chat', onClick: () => setCurrent(s) },
        { label: 'Mark as read', icon: 'read', disabled: !s.unread, onClick: () => void call('chat.markRead', s.accountId, s.id).catch(fail) },
        { sep: true },
        { label: 'Turn into email', icon: 'mail', onClick: () => void emailFromChat(s) },
        { label: 'Start a Meet call', icon: 'video', onClick: () => void call('app.openExternal', 'https://meet.google.com/new') },
        { label: 'Copy name', icon: 'copy', onClick: () => copyText(s.name, 'Name') },
        { sep: true },
        { label: 'Open in Google Chat', icon: 'globe', onClick: () => void call('chat.openInBrowser', s.accountId, s.id) }
      ])}>
      {s.kind === 'space' ? (
        <span className="av" style={{ width: 28, height: 28, borderRadius: 6, background: 'var(--accent-soft)', color: 'var(--accent-ink)', fontSize: 11 }}>{s.name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase()}</span>
      ) : (
        <Avatar name={s.name} size={28} />
      )}
      <span className="n"><b>{s.name}</b><span>{s.lastPreview ?? ''}</span></span>
      {s.unread > 0 && <span className="cnt">{s.unread}</span>}
    </button>
  );

  return (
    <>
      <TitleBar placeholder="Search chats and spaces" onSearch={setSearch} />
      <Ribbon groups={[
        { label: 'New', buttons: [
          { label: 'New chat', icon: 'plus', primary: true, title: 'Start a new chat in Google Chat', onClick: () => call('app.openExternal', 'https://chat.google.com/') },
          { label: 'Browse spaces', icon: 'search', onClick: () => call('app.openExternal', 'https://chat.google.com/') }
        ] },
        { label: 'Conversation', buttons: [
          { label: 'Start a Meet call', icon: 'video', onClick: () => call('app.openExternal', 'https://meet.google.com/new') },
          { label: 'Turn into email', icon: 'mail', disabled: !current, onClick: () => current && void emailFromChat(current) },
          { label: 'Open in Google Chat', icon: 'open', disabled: !current, onClick: () => current && call('chat.openInBrowser', current.accountId, current.id) },
          { label: 'Refresh', icon: 'sync', onClick: () => current && call('chat.refresh', current.accountId).catch(fail) }
        ] },
        { label: 'Status', buttons: [
          { label: 'Set status', icon: 'user', disabled: !statusAccount, menu: () => (statusAccount ? statusMenu(chatAccounts.find((a) => a.id === statusAccount)!, statusOf(statusAccount), setEditing, chatAccounts.length > 1) : []) }
        ] }
      ]} />
      <div className="body">
        <Rail />
        <nav className="pane chat-list" aria-label="Conversations" style={{ flex: `0 0 ${listWidth}px` }}>
          {chatAccounts.map((a) => {
            const mine = visible.filter((s) => s.accountId === a.id);
            const dms = mine.filter((s) => s.kind !== 'space');
            const rooms = mine.filter((s) => s.kind === 'space');
            const st = statusOf(a.id);
            const open = !collapsed.includes(a.id);
            const unread = mine.filter((s) => s.unread).length;
            if (q && !mine.length) return null;
            return (
              <section key={a.id} className="chat-account" aria-label={`Chat for ${a.email}`}>
                <div className="chat-account-head">
                  <button className="account-heading" onClick={() => toggle(a.id)} aria-expanded={open}>
                    <Icon name={open ? 'chevDown' : 'chevRight'} size={12} />
                    <span className="dot" style={{ background: a.color }} />
                    <span className="email">{a.email}</span>
                    {!open && <PresenceDot presence={st.presence} />}
                    {!open && unread > 0 && <span className="cnt">{unread}</span>}
                  </button>
                </div>
                {open && (
                  <>
                    <div className="chat-status-row">
                      <button className="presence-pill" aria-label={`Status for ${a.email}: ${presenceLabel(st)}. Change status`} title={presenceLabel(st)}
                        onClick={(e) => openMenu(statusMenu(a, st, setEditing, false), e.currentTarget)}>
                        <PresenceDot presence={st.presence} />
                        <span>{presenceShort(st)}</span>
                        <Icon name="chevDown" size={10} />
                      </button>
                      <button className="custom-status" onClick={() => setEditing(st)} title={st.customText ? `${st.customText}${st.customUntil ? ' · until ' + untilText(st.customUntil) : ''}` : 'Set a status message'}>
                        {st.customText ? <>{st.customEmoji && <span className="emoji">{st.customEmoji}</span>}<span className="text">{st.customText}</span></> : <span className="placeholder">Set a status message</span>}
                      </button>
                    </div>
                    {st.needsSetup && <ChatSetupHelp account={a} />}
                    {st.needsPermission && !st.needsSetup && (
                      <div className="chat-notice" role="note">
                        <p>To show and change your Chat status, Google needs you to give Davenport one more permission.</p>
                        <button className="btn small" onClick={() => call('accounts.enableChat', a.id).catch(fail)}>Allow status</button>
                      </div>
                    )}
                    {dms.length > 0 && <div className="pane-heading">Direct messages</div>}
                    {dms.map(conv)}
                    {rooms.length > 0 && <div className="pane-heading" style={{ marginTop: 10 }}>Spaces</div>}
                    {rooms.map(conv)}
                    {!mine.length && <p className="hint-text" style={{ padding: '4px 8px' }}>{q ? 'No matches' : 'No conversations yet'}</p>}
                  </>
                )}
              </section>
            );
          })}
        </nav>
        <Splitter dir="x" label="Resize conversation list" size={listWidth} setSize={setListWidth} onCommit={saveListWidth} min={220} max={520} reset={280} />
        {current ? <SpaceView key={current.accountId + current.id} space={current} onThread={setThread} /> : <div className="chat-main"><Empty icon="chat" title="Choose a conversation" /></div>}
        {thread && current && (
          <>
            <Splitter dir="x" invert label="Resize thread" size={threadWidth} setSize={setThreadWidth} onCommit={saveThreadWidth} min={260} max={640} reset={340} />
            <ThreadPanel space={current} root={thread} width={threadWidth} onClose={() => setThread(null)} />
          </>
        )}
      </div>
      <StatusBar left={<span>{spaces.filter((s) => s.unread).length} unread conversations</span>} />
      {editing && <CustomStatusDialog status={editing} account={chatAccounts.find((a) => a.id === editing.accountId)} onClose={() => setEditing(null)} />}
    </>
  );
}

// ---------- Right-click menus ----------

const escapeHtml = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Starts an email quoting a conversation (its last ten messages) or one message from it. */
async function emailFromChat(space: ChatSpace, only?: ChatMessage): Promise<void> {
  try {
    const msgs = only ? [only] : (await call('chat.messages', space.accountId, space.id)).slice(-10);
    const d = await call('mail.newDraft', space.accountId);
    d.subject = space.name;
    d.html = '<p>From our chat in ' + escapeHtml(space.name) + ':</p><blockquote>' + msgs.map((m) => `<p><b>${escapeHtml(m.sender.name)}</b>: ${escapeHtml(m.text)}</p>`).join('') + '</blockquote>' + d.html;
    void call('app.openWindow', 'compose', { draft: JSON.stringify(d) });
  } catch (e) {
    fail(e);
  }
}

/** A chat message's menu: reply in thread, react, copy, email it, open on the web. */
function messageMenu(space: ChatSpace, m: ChatMessage, reply?: () => void): MenuEntry[] {
  return [
    ...(reply && space.kind === 'space' ? [{ label: 'Reply in thread', icon: 'thread', onClick: reply } as MenuEntry] : []),
    { label: 'React', icon: 'smile', submenu: REACTIONS.map((r) => ({ label: r, onClick: () => void call('chat.react', m.accountId, m.spaceId, m.id, r).catch(fail) })) },
    { sep: true },
    { label: 'Copy text', icon: 'copy', disabled: !m.text, onClick: () => copyText(m.text, 'Message') },
    { label: 'Turn into email', icon: 'mail', onClick: () => void emailFromChat(space, m) },
    { sep: true },
    { label: 'Open in Google Chat', icon: 'globe', onClick: () => void call('chat.openInBrowser', space.accountId, space.id) }
  ];
}

// ---------- Status ----------

const untilText = (ms: number) => (sameDay(ms, Date.now()) ? time(ms) : `${dayName(ms)} ${time(ms)}`);

function presenceShort(s: ChatStatus): string {
  switch (s.presence) {
    case 'active': return 'Active';
    case 'idle': return 'Idle';
    case 'away': return 'Away';
    case 'dnd': return 'Do not disturb';
    default: return 'Status';
  }
}
const presenceLabel = (s: ChatStatus) => (s.presence === 'dnd' && s.dndUntil ? `Do not disturb until ${untilText(s.dndUntil)}` : presenceShort(s));

export function PresenceDot({ presence }: { presence: ChatStatus['presence'] }) {
  return <span className={cx('presence-dot', presence)} aria-hidden="true" />;
}

/** Ends of common time spans, in the same spirit as Google Chat's own menu. */
function dndChoices(): { label: string; at: number }[] {
  const now = Date.now();
  const tomorrow9 = startOfDay(addDays(now, 1)) + 9 * 3600_000;
  const day = new Date(now).getDay();
  const nextMonday9 = startOfDay(addDays(now, ((8 - day) % 7) || 7)) + 9 * 3600_000;
  return [
    { label: '30 minutes', at: now + 30 * 60_000 },
    { label: '1 hour', at: now + 3600_000 },
    { label: '2 hours', at: now + 2 * 3600_000 },
    { label: '4 hours', at: now + 4 * 3600_000 },
    { label: '8 hours', at: now + 8 * 3600_000 },
    { label: `Until tomorrow (${time(tomorrow9)})`, at: tomorrow9 },
    { label: 'Until next week', at: nextMonday9 }
  ];
}

function statusMenu(a: Account, st: ChatStatus, edit: (s: ChatStatus) => void, showAccount: boolean): MenuEntry[] {
  const set = (mode: 'automatic' | 'away' | 'dnd', until?: number) =>
    call('chat.setPresence', a.id, mode, until).then(() => notify(mode === 'dnd' ? `Do not disturb until ${untilText(until!)}` : mode === 'away' ? 'Your status is Away' : 'Your status is Automatic')).catch(fail);
  return [
    ...(showAccount ? [{ header: a.email } as MenuEntry] : []),
    { label: 'Automatic', hint: 'Active when you’re using Chat', checked: st.presence === 'active' || st.presence === 'idle', onClick: () => void set('automatic') },
    { label: 'Do not disturb', hint: st.presence === 'dnd' && st.dndUntil ? `until ${untilText(st.dndUntil)}` : 'Mute notifications', checked: st.presence === 'dnd', submenu: dndChoices().map((c) => ({ label: c.label, onClick: () => void set('dnd', c.at) })) },
    { label: 'Set as away', checked: st.presence === 'away', onClick: () => void set('away') },
    { sep: true },
    { label: st.customText ? 'Edit status message…' : 'Add a status message…', icon: 'edit', onClick: () => edit(st) },
    { label: 'Clear status message', disabled: !st.customText, onClick: () => void call('chat.setCustomStatus', a.id, null).catch(fail) }
  ];
}

const PRESETS: { emoji: string; text: string; clear: string }[] = [
  { emoji: '📅', text: 'In a meeting', clear: '1h' },
  { emoji: '🧑‍🏫', text: 'Teaching', clear: '1h' },
  { emoji: '🚗', text: 'Commuting', clear: '30m' },
  { emoji: '🍽️', text: 'Out for lunch', clear: '1h' },
  { emoji: '🏠', text: 'Working from home', clear: 'today' },
  { emoji: '🤒', text: 'Off sick', clear: 'today' },
  { emoji: '🌴', text: 'On holiday', clear: 'never' }
];
const EMOJIS = ['💬', '📅', '🧑‍🏫', '🚗', '🍽️', '🏠', '🤒', '🌴', '🎧', '✈️', '🔕', '☕'];

function clearAt(choice: string): number | undefined {
  const now = Date.now();
  switch (choice) {
    case '30m': return now + 30 * 60_000;
    case '1h': return now + 3600_000;
    case '4h': return now + 4 * 3600_000;
    case 'today': return startOfDay(addDays(now, 1)) - 60_000;
    case 'week': {
      const day = new Date(now).getDay();
      return startOfDay(addDays(now, ((7 - day) % 7) || 7)) + 24 * 3600_000 - 60_000;
    }
    default: return undefined;
  }
}

function CustomStatusDialog({ status, account, onClose }: { status: ChatStatus; account?: Account; onClose: () => void }) {
  const [text, setText] = useState(status.customText ?? '');
  const [emoji, setEmoji] = useState(status.customEmoji ?? '💬');
  const [clear, setClear] = useState(status.customUntil ? 'keep' : 'never');
  const [busy, setBusy] = useState(false);
  const save = async (t: string | null) => {
    setBusy(true);
    try {
      const until = clear === 'keep' ? status.customUntil : clearAt(clear);
      await call('chat.setCustomStatus', status.accountId, t, t ? emoji : undefined, until);
      notify(t ? 'Status message set in Google Chat' : 'Status message cleared');
      onClose();
    } catch (e) {
      fail(e);
      setBusy(false);
    }
  };
  return (
    <Dialog title="Status message" onClose={onClose} className="status-dialog"
      footer={<>
        {status.customText && <button className="btn" disabled={busy} onClick={() => void save(null)}>Clear</button>}
        <span style={{ flex: 1 }} />
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn primary" disabled={busy || !text.trim()} onClick={() => void save(text)}>Save</button>
      </>}>
      {account && <p className="hint-text" style={{ marginTop: 0 }}>Shown next to your name in Google Chat for {account.email}, on the web and on phones too.</p>}
      <div className="status-input">
        <button className="emoji-btn" aria-label={`Emoji: ${emoji}. Change`} onClick={(e) => openMenu(EMOJIS.map((x) => ({ label: x, onClick: () => setEmoji(x) })), e.currentTarget)}>{emoji}</button>
        <label htmlFor="status-text" className="sr-only">Status message</label>
        <input id="status-text" className="input" maxLength={64} placeholder="What's your status?" value={text} onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && text.trim() && void save(text)} />
      </div>
      <div className="status-presets" role="list" aria-label="Suggestions">
        {PRESETS.map((p) => (
          <button key={p.text} role="listitem" className="preset" onClick={() => { setEmoji(p.emoji); setText(p.text); setClear(p.clear); }}>
            <span className="emoji">{p.emoji}</span> {p.text}
          </button>
        ))}
      </div>
      <Field label="Clear after">
        <select className="input" value={clear} onChange={(e) => setClear(e.target.value)}>
          {status.customUntil && <option value="keep">Keep current ({untilText(status.customUntil)})</option>}
          <option value="never">Don't clear</option>
          <option value="30m">30 minutes</option>
          <option value="1h">1 hour</option>
          <option value="4h">4 hours</option>
          <option value="today">Today</option>
          <option value="week">This week</option>
        </select>
      </Field>
    </Dialog>
  );
}

/** Google's one-time Chat app settings, explained where the problem shows up. */
function ChatSetupHelp({ account }: { account: Account }) {
  return (
    <div className="chat-notice setup" role="note" aria-label="Chat setup needed">
      <p><b>One more Google setting is needed</b> before Davenport can send messages or change your status (reading works already). In the Google Cloud project that holds Davenport's sign-in:</p>
      <ol>
        <li>Open <b>Google Chat API › Configuration</b>.</li>
        <li>Enter an <b>App name</b> (Davenport), an <b>Avatar URL</b> (an https link to any square picture) and a <b>Description</b>.</li>
        <li>Leave <b>Enable interactive features</b> turned off, then click <b>Save</b>.</li>
      </ol>
      <p>Then send your message again — it can take a minute or two to start working.</p>
      <button className="btn small primary" onClick={() => call('chat.openSetup', account.id).catch(fail)}>Open Google Cloud</button>
    </div>
  );
}

function SpaceView({ space, onThread }: { space: ChatSpace; onThread: (m: ChatMessage) => void }) {
  const [msgs] = useLive(() => call('chat.messages', space.accountId, space.id), ['chat'], [space.id], [] as ChatMessage[]);
  const [text, setText] = useState('');
  const scroller = useRef<HTMLDivElement>(null);
  const last = msgs[msgs.length - 1]?.id;
  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [last]);

  const send = async () => {
    const t = text.trim();
    if (!t) return;
    setText('');
    await call('chat.send', space.accountId, space.id, t).catch((e) => {
      setText(t);
      fail(e);
    });
  };

  const grouped = useMemo(() => msgs.map((m, i) => ({ m, newDay: i === 0 || !sameDay(m.createTime, msgs[i - 1].createTime) })), [msgs]);

  return (
    <main className="chat-main" aria-label={space.name}>
      <div className="chat-head">
        {space.kind === 'space' ? (
          <span className="av" style={{ width: 36, height: 36, borderRadius: 8, background: 'var(--accent-soft)', color: 'var(--accent-ink)' }}>{space.name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase()}</span>
        ) : <Avatar name={space.name} size={36} />}
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <h1 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>{space.name}</h1>
          <span style={{ color: 'var(--muted)' }}>{space.kind === 'dm' ? 'Direct message' : `${space.memberCount ?? ''} members${space.external ? ' · includes people outside your organisation' : ''}`}</span>
        </div>
      </div>
      <div className="chat-msgs" ref={scroller}>
        {grouped.map(({ m, newDay }) => (
          <Fragment key={m.id}>
            {newDay && <div className="day-sep">{sameDay(m.createTime, Date.now()) ? 'Today' : longDay(m.createTime)}</div>}
            <div className="cmsg" onContextMenu={contextMenu(() => messageMenu(space, m, () => onThread(m)))}>
              <Avatar name={m.sender.name} email={m.sender.email ?? m.sender.id} size={36} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div><strong>{m.mine ? 'You' : m.sender.name}</strong> <span style={{ color: 'var(--muted)', fontSize: 12 }}>{time(m.createTime)}</span></div>
                <p>{renderText(m.text)}</p>
                {m.attachments.length > 0 && (
                  <div className="chat-attachments">
                    {m.attachments.map((a, i) => <ChatAttachment key={i} a={a} accountId={m.accountId} />)}
                  </div>
                )}
                <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                  {m.reactions.map((r) => (
                    <button key={r.emoji} className={cx('reaction', r.mine && 'mine')} onClick={() => call('chat.react', m.accountId, m.spaceId, m.id, r.emoji).catch(fail)}>{r.emoji} {r.count}</button>
                  ))}
                  <button className="reaction" aria-label="Add reaction" onClick={(e) => openMenu(REACTIONS.map((r) => ({ label: r, onClick: () => call('chat.react', m.accountId, m.spaceId, m.id, r).catch(fail) })), e.currentTarget)}><Icon name="smile" size={14} /></button>
                  {space.kind === 'space' && (
                    <button className="btn ghost small" onClick={() => onThread(m)}>
                      <Icon name="thread" size={14} /> {m.replyCount ? `${m.replyCount} ${m.replyCount === 1 ? 'reply' : 'replies'}` : 'Reply in thread'}
                    </button>
                  )}
                </div>
              </div>
            </div>
          </Fragment>
        ))}
        {!msgs.length && <Empty icon="chat" title="No messages yet" text="Say hello." />}
      </div>
      <div className="composer">
        <label htmlFor="chat-input" className="sr-only">Message {space.name}</label>
        <textarea id="chat-input" placeholder={`Message ${space.name}`} value={text} rows={1}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }} />
        <div className="bar">
          <button className="icon-btn" aria-label="Emoji" onClick={(e) => openMenu(REACTIONS.map((r) => ({ label: r, onClick: () => setText(text + r) })), e.currentTarget)}><Icon name="smile" /></button>
          <button className="icon-btn" aria-label="Start a Meet call" onClick={() => call('app.openExternal', 'https://meet.google.com/new')}><Icon name="video" /></button>
          <button className="icon-btn" aria-label="Attach in Google Chat" title="Attachments are added in Google Chat" onClick={() => { notify('Opening Google Chat to add a file.'); void call('chat.openInBrowser', space.accountId, space.id); }}><Icon name="attach" /></button>
          <span className="hint-text" style={{ marginLeft: 8 }}>Enter to send · Shift+Enter for a new line</span>
          <button className="btn primary small" style={{ marginLeft: 'auto' }} onClick={() => void send()} disabled={!text.trim()}>Send</button>
        </div>
      </div>
    </main>
  );
}

function ThreadPanel({ space, root, width, onClose }: { space: ChatSpace; root: ChatMessage; width?: number; onClose: () => void }) {
  const [msgs] = useLive(() => (root.threadId ? call('chat.thread', space.accountId, space.id, root.threadId) : Promise.resolve([root])), ['chat'], [root.id], [] as ChatMessage[]);
  const [text, setText] = useState('');
  const send = async () => {
    const t = text.trim();
    if (!t) return;
    setText('');
    await call('chat.send', space.accountId, space.id, t, root.threadId).catch(fail);
  };
  return (
    <aside className="side-panel" aria-label="Thread" style={width ? { flex: `0 0 ${width}px` } : undefined}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ margin: 0, fontSize: 15 }}>Thread</h2>
        <button className="icon-btn" aria-label="Close thread" onClick={onClose}><Icon name="close" /></button>
      </div>
      {msgs.map((m, i) => (
        <div key={m.id} style={i === 0 ? { padding: 10, borderRadius: 8, background: 'var(--surface)', border: '1px solid var(--border-soft)' } : { padding: '0 10px' }} onContextMenu={contextMenu(() => messageMenu(space, m))}>
          <div><strong>{m.mine ? 'You' : m.sender.name}</strong> <span style={{ color: 'var(--muted)', fontSize: 12 }}>{time(m.createTime)}</span></div>
          <p style={{ margin: '4px 0 0', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{renderText(m.text)}</p>
        </div>
      ))}
      <form style={{ marginTop: 'auto' }} onSubmit={(e) => { e.preventDefault(); void send(); }}>
        <label htmlFor="thread-input" className="sr-only">Reply in thread</label>
        <input id="thread-input" className="input" style={{ minHeight: 44 }} placeholder="Reply in thread" value={text} onChange={(e) => setText(e.target.value)} />
      </form>
    </aside>
  );
}
