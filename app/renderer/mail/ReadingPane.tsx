// Reading pane: the selected message or conversation, with attachments, follow-up banner and inline reply.
import { useEffect, useState } from 'react';
import type { Draft, Folder, MessageDetail } from '../../shared/types';
import { call, useLive } from '../api';
import { Icon } from '../components/Icon';
import { openMenu, type MenuEntry } from '../components/Menu';
import { Avatar, Empty } from '../components/ui';
import { fail, notify, useApp } from '../state';
import { addrFull, addrName, bytes, cx, fileKind, fullDate, listTime } from '../util';
import { createEventFrom, flag, flagMenu, newMail, respond, rowMenu, type Sel } from './actions';
import { Compose } from './Compose';
import { InviteCard } from './InviteCard';
import { MessageBody, type BodyContext } from './MessageBody';

export function ReadingPane({ folders, standalone }: { folders: Folder[]; standalone?: { accountId: string; id: string; threadId: string } }) {
  const { selected, settings, mail } = useApp();
  const target = standalone ?? (selected.length === 1 ? selected[0] : null);
  const [inlineDraft, setInlineDraft] = useState<Draft | null>(null);

  // An open reply stays open while the conversation it belongs to is shown, even when a new message arrives in it
  // (the list then points at the newer message). Only moving to a different conversation closes it.
  const threadKey = target ? target.accountId + (settings.conversationView ? target.threadId : target.id) : '';
  useEffect(() => setInlineDraft(null), [threadKey]);

  const [thread, , loading] = useLive<MessageDetail[] | null>(
    async () => {
      if (!target) return null;
      if (settings.conversationView) {
        const t = await call('mail.thread', target.accountId, target.threadId);
        return t.length ? t : [await call('mail.get', target.accountId, target.id)];
      }
      return [await call('mail.get', target.accountId, target.id)];
    },
    ['mail'],
    [target?.accountId, target?.id, target?.threadId, settings.conversationView],
    null
  );

  if (!target) {
    return (
      <div className="reading" style={{ justifyContent: 'center' }}>
        {selected.length > 1 ? (
          <Empty icon="mail" title={`${selected.length} items selected`} text="Use the ribbon or right-click to act on all of them." />
        ) : (
          <Empty icon="mail" title="Select an item to read" text="Nothing is selected." />
        )}
      </div>
    );
  }
  if (!thread) {
    return <div className="reading">{loading && <div className="empty">Loading…</div>}</div>;
  }

  // While replying, the reply's own saved copy (a Gmail draft in the same conversation) isn't shown above the editor.
  const shown = inlineDraft ? thread.filter((m) => !m.labelIds.includes('DRAFT')) : thread;
  const latest = shown[shown.length - 1] ?? thread[thread.length - 1];
  const sel: Sel = [{ accountId: latest.accountId, id: latest.id, threadId: latest.threadId }];
  const accFolders = folders.filter((f) => f.accountId === latest.accountId);
  const flagged = thread.find((m) => m.flagged);
  const folderId = mail.folder.type === 'label' ? mail.folder.id : 'INBOX';

  return (
    <article className="reading" aria-label="Reading pane">
      <div className="reading-inner">
        {flagged && (
          <div className="banner">
            <span style={{ color: 'var(--flag)', display: 'inline-flex' }}><Icon name="flag" fill="currentColor" /></span>
            <span>
              {flagged.flagDue ? <>Follow up by <strong>{new Date(flagged.flagDue).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}</strong></> : 'Flagged for follow-up'} · in your Google Tasks
            </span>
            <button onClick={() => void flag([{ accountId: flagged.accountId, id: flagged.id, threadId: flagged.threadId }], false)}>Mark complete</button>
          </div>
        )}
        {latest.snoozedUntil && (
          <div className="banner info">
            <Icon name="snooze" />
            <span>Snoozed until {new Date(latest.snoozedUntil).toLocaleString(undefined, { weekday: 'long', hour: '2-digit', minute: '2-digit' })}</span>
            <button onClick={() => call('mail.unsnooze', latest.accountId, [latest.id])}>Unsnooze</button>
          </div>
        )}
        <h1>{topic(latest.subject)}</h1>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 14 }}>
          {latest.categories.map((c) => (
            <span key={c.name} className="chip cat" style={{ ['--c' as string]: c.color, padding: '2px 8px', fontSize: 12 }}>{c.name}</span>
          ))}
          {latest.labelIds.filter((l) => ['INBOX', 'SENT', 'DRAFT', 'SPAM', 'TRASH'].includes(l)).map((l) => (
            <span key={l} className="chip" style={{ background: 'var(--divider)', color: 'var(--text-2)', fontWeight: 400, padding: '2px 8px', fontSize: 12 }}>
              {{ INBOX: 'Inbox', SENT: 'Sent', DRAFT: 'Draft', SPAM: 'Spam', TRASH: 'Bin' }[l]}
            </span>
          ))}
          {latest.important && <span className="chip" style={{ background: 'var(--brass-soft)', color: 'var(--brass-ink)', padding: '2px 8px', fontSize: 12 }}>Important</span>}
        </div>

        {shown.map((m, i) => (
          <ThreadMessage key={m.id} m={m} expandedByDefault={!inlineDraft && (i === shown.length - 1 || m.unread || shown.length <= 2)} single={shown.length === 1}
            onReply={(mode) => void respond([{ accountId: m.accountId, id: m.id, threadId: m.threadId }], mode, (d) => setInlineDraft(d))}
            onMenu={(e) => openMenu(rowMenu(m, [{ accountId: m.accountId, id: m.id, threadId: m.threadId }], accFolders, folderId), e.currentTarget)}
            onContext={(c) => openMenu(readingMenu(m, c, accFolders, folderId, !standalone), { x: c.x, y: c.y })}
          />
        ))}

        {inlineDraft ? (
          <Compose
            key={inlineDraft.localId}
            initial={inlineDraft}
            inline
            onClose={(sent) => {
              setInlineDraft(null);
              if (sent) notify('Sending…');
            }}
          />
        ) : (
          !latest.labelIds.includes('DRAFT') && (
            <div className="quick-reply" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button className="btn" onClick={() => void respond(sel, 'reply', setInlineDraft)}><Icon name="reply" /> Reply</button>
              <button className="btn" onClick={() => void respond(sel, 'replyAll', setInlineDraft)}><Icon name="replyAll" /> Reply all</button>
              <button className="btn" onClick={() => void respond(sel, 'forward')}><Icon name="forward" /> Forward</button>
              <button className="btn ghost" onClick={(e) => openMenu(flagMenu(sel, !!flagged), e.currentTarget)}><Icon name="flag" /> Follow up</button>
              <button className="btn ghost" onClick={() => void createEventFrom(latest)}><Icon name="calendar" /> Schedule a meeting</button>
            </div>
          )
        )}
        {!inlineDraft && latest.labelIds.includes('DRAFT') && (
          <div className="quick-reply">
            <button className="btn primary" onClick={() => call('mail.openDraft', latest.accountId, latest.id).then((d) => (d.inReplyTo ? setInlineDraft(d) : call('app.openWindow', 'compose', { draft: JSON.stringify(d) }))).catch(fail)}>
              <Icon name="edit" /> Continue editing
            </button>
          </div>
        )}
      </div>
    </article>
  );
}

function ThreadMessage({ m, expandedByDefault, single, onReply, onMenu, onContext }: { m: MessageDetail; expandedByDefault: boolean; single: boolean; onReply: (mode: 'reply' | 'replyAll' | 'forward') => void; onMenu: (e: React.MouseEvent<HTMLButtonElement>) => void; onContext: (c: BodyContext) => void }) {
  const [open, setOpen] = useState(expandedByDefault);
  const [allowRemote, setAllowRemote] = useState(false);
  const [blocked, setBlocked] = useState(0);
  const { settings } = useApp();

  useEffect(() => {
    setAllowRemote(m.remoteImagesAllowed ?? !settings.blockRemoteImages);
  }, [m.id, m.remoteImagesAllowed, settings.blockRemoteImages]);

  // A meeting invitation shows as a card with Accept / Tentative / Decline; its .ics file is then hidden.
  const [inviteShown, setInviteShown] = useState(false);
  const isIcs = (a: { filename: string; mimeType: string }) => /\.ics$/i.test(a.filename) || /^(text\/calendar|application\/ics)$/i.test(a.mimeType);
  const mayBeInvite = m.attachments.some((a) => a.role === 'invite' || (!a.contentId && isIcs(a)));
  const amp = m.attachments.some((a) => a.role === 'amp');
  const form = emailForm(m.html);
  const attachments = m.attachments.filter((a) => !a.contentId && !a.role && !(inviteShown && isIcs(a)));

  const head = (
    <div className="msg-head" style={single ? undefined : { borderBottom: open ? '1px solid var(--border-soft)' : 0, padding: '12px 14px' }}>
      <Avatar name={addrName(m.from)} email={m.from.email} size={40} />
      <div className="who">
        <div><strong>{addrName(m.from)}</strong> <span style={{ color: 'var(--muted)' }}>&lt;{m.from.email}&gt;</span></div>
        {open ? (
          <>
            <div className="meta">To: {m.to.map(addrName).join(', ') || '—'}{m.cc.length ? ` · Cc: ${m.cc.map(addrName).join(', ')}` : ''}{m.bcc.length ? ` · Bcc: ${m.bcc.map(addrName).join(', ')}` : ''}</div>
            <div className="meta">{fullDate(m.date)}</div>
          </>
        ) : (
          <div className="meta" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.snippet}</div>
        )}
      </div>
      {open ? (
        <div className="msg-actions" onClick={(e) => e.stopPropagation()}>
          <button className="btn" onClick={() => onReply('reply')} title="Reply (Ctrl+R)"><Icon name="reply" /> <span>Reply</span></button>
          <button className="btn" onClick={() => onReply('replyAll')} title="Reply all (Ctrl+Shift+R)"><Icon name="replyAll" /> <span>Reply all</span></button>
          <button className="btn" onClick={() => onReply('forward')} title="Forward (Ctrl+F)"><Icon name="forward" /> <span>Forward</span></button>
          <button className="btn" aria-label="More actions" onClick={onMenu}><Icon name="more" /></button>
        </div>
      ) : (
        <span className="meta">{listTime(m.date)}</span>
      )}
    </div>
  );

  const body = (
    <>
      {blocked > 0 && !allowRemote && (
        <div className="banner info" style={{ marginTop: 12 }}>
          <Icon name="image" />
          <span>Pictures from the internet are hidden to protect your privacy.</span>
          <button onClick={() => setAllowRemote(true)}>Show pictures</button>
          <button style={{ marginLeft: 8 }} onClick={() => {
            setAllowRemote(true);
            void call('mail.loadRemoteImages', m.accountId, m.id, true);
          }}>Always from {m.from.email}</button>
        </div>
      )}
      {mayBeInvite && <InviteCard m={m} onFound={setInviteShown} />}
      {form?.url ? (
        <div className="banner info" style={{ marginTop: 12 }}>
          <Icon name="info" />
          <span>This email contains a Google Form. For safety, forms aren't filled in inside emails; you can fill it in in your browser instead.</span>
          <button onClick={() => call('app.openExternal', form.url!).catch(fail)}>Open form</button>
        </div>
      ) : (amp || form) && (
        <div className="banner info" style={{ marginTop: 12 }}>
          <Icon name="info" />
          <span>This email has interactive parts (such as a form or a poll) that only work in Gmail on the web.</span>
          <button onClick={() => call('app.openExternal', gmailLink(m)).catch(fail)}>Open in Gmail</button>
        </div>
      )}
      {attachments.length > 0 && (
        <div className="attachments">
          {attachments.map((a) => {
            const k = fileKind(a.filename, a.mimeType);
            return (
              <button
                key={a.id}
                className="attachment"
                title={`${a.filename} — click to open, right-click for more`}
                onClick={() => call('mail.openAttachment', m.accountId, m.id, a.id, a.filename).catch(fail)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  openMenu([
                    { label: 'Open', icon: 'open', onClick: () => call('mail.openAttachment', m.accountId, m.id, a.id, a.filename).catch(fail) },
                    { label: 'Save as…', icon: 'download', onClick: () => call('mail.saveAttachment', m.accountId, m.id, a.id, a.filename).then((p) => p && notify('Saved to ' + p)).catch(fail) }
                  ], { x: e.clientX, y: e.clientY });
                }}
              >
                <span className="kind" style={{ background: k.colour }}>{k.label}</span>
                <span className="info"><b>{a.filename}</b><span>{bytes(a.size)}</span></span>
              </button>
            );
          })}
        </div>
      )}
      <div style={{ paddingTop: 12 }}>
        <MessageBody html={m.html} text={m.text ?? m.snippet} allowRemote={allowRemote} onBlocked={setBlocked} onContextMenu={onContext} />
      </div>
      {m.listUnsubscribe && (
        <div className="hint-text" style={{ marginTop: 12 }}>
          Mailing list ·{' '}
          <a href="#" onClick={(e) => {
            e.preventDefault();
            const url = m.listUnsubscribe!.match(/<(https?:[^>]+)>/)?.[1] ?? m.listUnsubscribe!.match(/<(mailto:[^>]+)>/)?.[1];
            if (url) void call('app.openExternal', url);
          }}>Unsubscribe</a>
        </div>
      )}
    </>
  );

  // Right-clicking the header or around the message gives the same menu as right-clicking its text.
  const onAreaMenu = (e: React.MouseEvent) => {
    if (e.defaultPrevented) return;
    const t = e.target as HTMLElement;
    if (t.closest('input, textarea, [contenteditable="true"], .attachment')) return;
    e.preventDefault();
    const sel = window.getSelection();
    onContext({
      x: e.clientX,
      y: e.clientY,
      selection: sel && !sel.isCollapsed ? sel.toString() : '',
      link: t.closest('a')?.getAttribute('href') ?? undefined,
      selectAll: () => {
        const area = (e.target as HTMLElement).closest('.msg-area');
        if (!area) return;
        const range = document.createRange();
        range.selectNodeContents(area);
        sel?.removeAllRanges();
        sel?.addRange(range);
      }
    });
  };

  if (single) {
    return (
      <div className="msg-area" onContextMenu={onAreaMenu}>
        {head}
        {body}
      </div>
    );
  }
  return (
    <div className={cx('thread-item msg-area', !open && 'collapsed')} onClick={() => !open && setOpen(true)} onContextMenu={onAreaMenu}>
      <div onClick={() => open && setOpen(false)} style={{ cursor: 'pointer' }} title={open ? 'Collapse' : undefined}>{head}</div>
      {open && <div className="body">{body}</div>}
    </div>
  );
}

/** The reading pane's right-click menu: what you clicked on first (text, a link, a picture), then the message's own actions. */
function readingMenu(m: MessageDetail, c: BodyContext, folders: Folder[], folderId: string, canPopOut: boolean): MenuEntry[] {
  const items: MenuEntry[] = [];
  const copy = (text: string, what: string) => void call('app.copyText', text).then(() => notify(`${what} copied`)).catch(fail);
  if (c.selection.trim()) items.push({ label: 'Copy', icon: 'copy', hint: 'Ctrl+C', onClick: () => copy(c.selection, 'Text') });
  items.push({ label: 'Select all', hint: 'Ctrl+A', onClick: c.selectAll });
  if (c.link && /^mailto:/i.test(c.link)) {
    const address = decodeURIComponent(c.link.replace(/^mailto:/i, '').split('?')[0]);
    items.push(
      { sep: true },
      { label: `Send email to ${address}`, icon: 'mail', onClick: () => void newMail(m.accountId, address) },
      { label: 'Copy email address', icon: 'copy', onClick: () => copy(address, 'Email address') }
    );
  } else if (c.link && /^https?:/i.test(c.link)) {
    const url = c.link;
    items.push(
      { sep: true },
      { label: 'Open link', icon: 'open', onClick: () => void call('app.openExternal', url) },
      { label: 'Copy link', icon: 'link', onClick: () => copy(url, 'Link') }
    );
  }
  if (c.image) {
    const src = c.image;
    items.push(
      { sep: true },
      { label: 'Copy picture', icon: 'image', onClick: () => void call('app.copyImage', src).then(() => notify('Picture copied')).catch(fail) },
      { label: 'Save picture as…', icon: 'download', onClick: () => void call('app.saveImage', src).then((p) => p && notify('Saved to ' + p)).catch(fail) }
    );
  }
  const sel = [{ accountId: m.accountId, id: m.id, threadId: m.threadId }];
  items.push({ sep: true });
  if (canPopOut) items.push({ label: 'Open in new window', icon: 'popout', onClick: () => void call('app.openWindow', 'message', { accountId: m.accountId, id: m.id, threadId: m.threadId }) });
  items.push({ label: 'Copy sender’s address', icon: 'person', onClick: () => copy(m.from.email, 'Email address') });
  items.push({ sep: true }, ...rowMenu(m, sel, folders, folderId));
  return items;
}

/** A form inside an email (not shown, for safety). For a Google Form, the address to fill it in in a browser. */
function emailForm(html: string | undefined): { url?: string } | null {
  if (!html || !/<form[\s>]/i.test(html)) return null;
  const action = html.match(/<form[^>]+action=["'](https:\/\/docs\.google\.com\/forms\/[^"']+)["']/i)?.[1];
  if (!action) return {};
  return { url: action.replace(/&amp;/g, '&').replace(/\/formResponse(\?.*)?$/, '/viewform') };
}

/** The message in Gmail on the web, signed in as the account it belongs to. */
const gmailLink = (m: MessageDetail) => {
  const email = useApp.getState().accounts.find((a) => a.id === m.accountId)?.email ?? '0';
  return `https://mail.google.com/mail/u/${encodeURIComponent(email)}/#all/${m.threadId}`;
};

/** The conversation's topic, as Outlook shows it: the subject without Re:/Fwd: prefixes, so it doesn't change as replies arrive. */
function topic(subject: string): string {
  return subject.replace(/^(\s*(re|fwd?|aw|wg|sv|vs|tr)\s*(\[\d+\])?\s*:\s*)+/i, '') || subject;
}

export function addrsTitle(list: { name?: string; email: string }[]): string {
  return list.map(addrFull).join(', ');
}
