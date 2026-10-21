// Chat: Google Chat spaces and direct messages, with threads and reactions.
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import type { ChatMessage, ChatSpace } from '../../shared/types';
import { call, useLive } from '../api';
import { Icon } from '../components/Icon';
import { openMenu } from '../components/Menu';
import { Rail, Ribbon, StatusBar, TitleBar } from '../components/Shell';
import { Avatar, Empty } from '../components/ui';
import { fail, notify, useApp } from '../state';
import { cx, longDay, sameDay, time } from '../util';

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
  const dms = visible.filter((s) => s.kind !== 'space');
  const rooms = visible.filter((s) => s.kind === 'space');

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
    <button key={s.accountId + s.id} className={cx('conv', s.unread > 0 && 'unread')} aria-current={current?.id === s.id && current.accountId === s.accountId} onClick={() => setCurrent(s)}>
      {s.kind === 'space' ? (
        <span className="av" style={{ width: 28, height: 28, borderRadius: 6, background: 'var(--accent-soft)', color: 'var(--accent)', fontSize: 11 }}>{s.name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase()}</span>
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
          { label: 'Turn into email', icon: 'mail', disabled: !current, onClick: async () => {
            if (!current || !accounts[0]) return;
            const msgs = await call('chat.messages', current.accountId, current.id);
            const d = await call('mail.newDraft', current.accountId);
            d.subject = current.name;
            d.html = '<p>From our chat in ' + current.name + ':</p><blockquote>' + msgs.slice(-10).map((m) => `<p><b>${m.sender.name}</b>: ${m.text.replace(/</g, '&lt;')}</p>`).join('') + '</blockquote>' + d.html;
            void call('app.openWindow', 'compose', { draft: JSON.stringify(d) });
          } },
          { label: 'Open in Google Chat', icon: 'open', disabled: !current, onClick: () => current && call('chat.openInBrowser', current.accountId, current.id) },
          { label: 'Refresh', icon: 'sync', onClick: () => current && call('chat.refresh', current.accountId).catch(fail) }
        ] }
      ]} />
      <div className="body">
        <Rail />
        <nav className="pane chat-list" aria-label="Conversations">
          <div className="pane-heading">Direct messages</div>
          {dms.map(conv)}
          <div className="pane-heading" style={{ marginTop: 14 }}>Spaces</div>
          {rooms.map(conv)}
        </nav>
        {current ? <SpaceView key={current.accountId + current.id} space={current} onThread={setThread} /> : <div className="chat-main"><Empty icon="chat" title="Choose a conversation" /></div>}
        {thread && current && <ThreadPanel space={current} root={thread} onClose={() => setThread(null)} />}
      </div>
      <StatusBar left={<span>{spaces.filter((s) => s.unread).length} unread conversations</span>} />
    </>
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
          <span className="av" style={{ width: 36, height: 36, borderRadius: 8, background: 'var(--accent-soft)', color: 'var(--accent)' }}>{space.name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase()}</span>
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
            <div className="cmsg">
              <Avatar name={m.sender.name} email={m.sender.email ?? m.sender.id} size={36} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div><strong>{m.mine ? 'You' : m.sender.name}</strong> <span style={{ color: 'var(--muted)', fontSize: 12 }}>{time(m.createTime)}</span></div>
                <p>{renderText(m.text)}</p>
                {m.attachments.map((a, i) => (
                  <button key={i} className="attachment" onClick={() => a.url && call('app.openExternal', a.url)}>
                    <span className="kind" style={{ background: a.kind === 'drive' ? '#1E7A45' : '#5B6472' }}>{a.kind === 'drive' ? 'DRV' : 'FILE'}</span>
                    <span className="info"><b>{a.name}</b><span>{a.kind === 'drive' ? 'Google Drive' : 'Attachment'}</span></span>
                  </button>
                ))}
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

function ThreadPanel({ space, root, onClose }: { space: ChatSpace; root: ChatMessage; onClose: () => void }) {
  const [msgs] = useLive(() => (root.threadId ? call('chat.thread', space.accountId, space.id, root.threadId) : Promise.resolve([root])), ['chat'], [root.id], [] as ChatMessage[]);
  const [text, setText] = useState('');
  const send = async () => {
    const t = text.trim();
    if (!t) return;
    setText('');
    await call('chat.send', space.accountId, space.id, t, root.threadId).catch(fail);
  };
  return (
    <aside className="side-panel" aria-label="Thread">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ margin: 0, fontSize: 15 }}>Thread</h2>
        <button className="icon-btn" aria-label="Close thread" onClick={onClose}><Icon name="close" /></button>
      </div>
      {msgs.map((m, i) => (
        <div key={m.id} style={i === 0 ? { padding: 10, borderRadius: 8, background: 'var(--surface)', border: '1px solid var(--border-soft)' } : { padding: '0 10px' }}>
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
