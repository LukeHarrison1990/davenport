// Compose: new mail, replies and forwards — inline in the reading pane or in its own window.
import { useEffect, useRef, useState } from 'react';
import type { ComposeAttachment, Draft, SendAs, Template } from '../../shared/types';
import { call } from '../api';
import { AddressInput } from '../components/AddressInput';
import { Icon } from '../components/Icon';
import { openMenu } from '../components/Menu';
import { RichEditor, type RichEditorHandle } from '../components/RichEditor';
import { fail, notify, useApp } from '../state';
import { bytes, fileKind, fromLocalInput, quickTimes, toLocalInput } from '../util';

export function Compose({ initial, inline, onClose }: { initial: Draft; inline?: boolean; onClose: (sent: boolean) => void }) {
  const [d, setD] = useState<Draft>(initial);
  const [showCc, setShowCc] = useState(initial.cc.length > 0 || initial.bcc.length > 0);
  const [showBcc, setShowBcc] = useState(initial.bcc.length > 0);
  const [sendAs, setSendAs] = useState<SendAs[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [saving, setSaving] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [pickLater, setPickLater] = useState(false);
  const [laterValue, setLaterValue] = useState(() => toLocalInput(quickTimes()[0].at));
  const blockImages = useApp((st) => st.settings.blockRemoteImages);
  const dirty = useRef(false);
  const editor = useRef<RichEditorHandle>(null);
  const latest = useRef(d);
  latest.current = d;

  useEffect(() => {
    call('gmail.sendAs', d.accountId).then(setSendAs).catch(() => undefined);
    call('templates.list').then(setTemplates).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d.accountId]);

  useEffect(() => {
    if (initial.mode !== 'new' && inline) setTimeout(() => editor.current?.focus(), 50);
  }, [initial.mode, inline]);

  // Autosave to Gmail Drafts every 30 seconds while editing.
  useEffect(() => {
    const t = setInterval(() => {
      if (dirty.current) void save(true);
    }, 30_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const update = (p: Partial<Draft>) => {
    dirty.current = true;
    setD((x) => ({ ...x, ...p }));
  };

  // One save at a time; sending waits for a save in progress so it can't leave a stray draft behind.
  const saving$ = useRef<Promise<void> | null>(null);
  const finished = useRef(false);
  const save = (quiet = false): Promise<void> => {
    if (finished.current) return Promise.resolve();
    const run = (saving$.current ?? Promise.resolve()).then(() => doSave(quiet));
    saving$.current = run.finally(() => {
      if (saving$.current === run) saving$.current = null;
    });
    return run;
  };
  const doSave = async (quiet: boolean) => {
    if (finished.current) return;
    setSaving('saving');
    try {
      const r = await call('mail.saveDraft', latest.current);
      setD((x) => ({ ...x, gmailDraftId: r.gmailDraftId }));
      latest.current = { ...latest.current, gmailDraftId: r.gmailDraftId };
      dirty.current = false;
      setSaving('saved');
      if (!quiet) notify('Draft saved.');
    } catch (e) {
      setSaving('idle');
      if (!quiet) fail(e);
    }
  };

  const send = async (sendAt?: number) => {
    const draft = { ...latest.current, sendAt };
    if (!draft.to.length && !draft.cc.length && !draft.bcc.length) return notify('Add at least one recipient.', 'error');
    if (!draft.subject.trim() && !window.confirm('Send this message without a subject?')) return;
    const mentionsAttachment = /\b(attached|attachment|enclosed)\b/i.test(draft.html.replace(/<blockquote[\s\S]*<\/blockquote>/i, ''));
    if (mentionsAttachment && !draft.attachments.length && !window.confirm('Your message mentions an attachment, but nothing is attached. Send anyway?')) return;
    try {
      await saving$.current?.catch(() => undefined);
      draft.gmailDraftId = latest.current.gmailDraftId;
      await call('mail.send', draft);
      finished.current = true;
      if (draft.gmailDraftId && sendAt) await call('mail.discardDraft', draft).catch(() => undefined);
      dirty.current = false;
      onClose(true);
    } catch (e) {
      fail(e);
    }
  };

  const discard = async () => {
    if (dirty.current && !window.confirm('Discard this message?')) return;
    await saving$.current?.catch(() => undefined);
    finished.current = true;
    if (latest.current.gmailDraftId) await call('mail.discardDraft', latest.current).catch(() => undefined);
    dirty.current = false;
    onClose(false);
  };

  // Like Outlook: closing with unsaved changes asks Save / Don't save / Cancel.
  const close = async () => {
    if (dirty.current) {
      const answer = await call('app.askSaveDraft');
      if (answer === 'cancel') return;
      if (answer === 'save') await save(true);
    }
    finished.current = true;
    dirty.current = false;
    onClose(false);
  };

  // The window's own close button (✕) goes through the same question instead of losing the message.
  useEffect(() => {
    if (inline) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!dirty.current || finished.current) return;
      e.preventDefault();
      e.returnValue = '';
      void close();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inline]);

  const attach = async () => {
    const files = await call('app.pickFiles');
    if (files.length) update({ attachments: [...d.attachments, ...files.map((f) => ({ ...f }))] });
  };

  const onDrop = async (e: React.DragEvent) => {
    if (!e.dataTransfer.files.length) return;
    e.preventDefault();
    const add: ComposeAttachment[] = [];
    for (const f of Array.from(e.dataTransfer.files)) {
      const buf = await f.arrayBuffer();
      let bin = '';
      const bytesArr = new Uint8Array(buf);
      for (let i = 0; i < bytesArr.length; i += 0x8000) bin += String.fromCharCode(...bytesArr.subarray(i, i + 0x8000));
      add.push({ filename: f.name, mimeType: f.type || 'application/octet-stream', size: f.size, dataBase64: btoa(bin) });
    }
    update({ attachments: [...d.attachments, ...add] });
  };

  const total = d.attachments.reduce((n, a) => n + a.size, 0);

  const swapSignature = (from: string) => {
    const sig = sendAs.find((s) => s.email === from)?.signature;
    const html = editor.current?.getHtml() ?? d.html;
    const replaced = html.replace(/<div class="dav-signature">[\s\S]*?<\/div>(?=(<div class="dav-quote">|$))/, sig ? `<div class="dav-signature">${sig}</div>` : '');
    update({ from });
    if (replaced !== html) editor.current?.setHtml(replaced);
  };

  return (
    <div className={'compose' + (inline ? ' inline' : '')} onDragOver={(e) => e.dataTransfer.types.includes('Files') && e.preventDefault()} onDrop={onDrop}
      onKeyDown={(e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
          e.preventDefault();
          void send();
        }
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
          e.preventDefault();
          void save();
        }
      }}>
      <div className="compose-bar" role="toolbar" aria-label="Message">
        <div style={{ display: 'inline-flex' }}>
          <button className="btn primary" onClick={() => void send()} title="Send (Ctrl+Enter)" style={{ borderTopRightRadius: 0, borderBottomRightRadius: 0 }}>
            <Icon name="send" /> Send
          </button>
          <button
            className="btn primary"
            aria-label="Send options"
            style={{ borderTopLeftRadius: 0, borderBottomLeftRadius: 0, borderLeft: '1px solid rgba(255,255,255,0.35)', padding: '0 8px' }}
            onClick={(e) =>
              openMenu(
                [
                  { header: 'Send later' },
                  ...quickTimes().map((t) => ({ label: t.label, hint: t.hint, icon: 'scheduled', onClick: () => void send(t.at) })),
                  { label: 'Choose a time…', icon: 'calendar', onClick: () => setPickLater(true) }
                ],
                e.currentTarget
              )
            }
          >
            <Icon name="chevDown" size={12} />
          </button>
        </div>
        <button className="btn ghost" onClick={attach}><Icon name="attach" /> Attach</button>
        <button
          className="btn ghost"
          onClick={(e) =>
            openMenu(
              templates.length
                ? templates.map((t) => ({
                    label: t.name,
                    icon: 'template',
                    onClick: () => {
                      editor.current?.insertHtml(t.html);
                      if (!d.subject && t.subject) update({ subject: t.subject });
                    }
                  }))
                : [{ label: 'No templates yet — add them in Settings › Templates', disabled: true }],
              e.currentTarget
            )
          }
        >
          <Icon name="template" /> Templates
        </button>
        <button
          className="btn ghost"
          onClick={(e) => openMenu(sendAs.length ? sendAs.map((s) => ({ label: s.signature ? `Signature for ${s.email}` : `${s.email} (no signature)`, disabled: !s.signature, icon: 'signature', onClick: () => editor.current?.insertHtml(`<div class="dav-signature">${s.signature}</div>`) })) : [{ label: 'No signatures', disabled: true }], e.currentTarget)}
        >
          <Icon name="signature" /> Signature
        </button>
        <button className="btn ghost" aria-pressed={d.importance === 'high'} onClick={() => update({ importance: d.importance === 'high' ? 'normal' : 'high' })} style={d.importance === 'high' ? { color: 'var(--danger)' } : undefined}>
          <Icon name="important" /> High importance
        </button>
        <span style={{ flex: 1 }} />
        <span className="hint-text">{saving === 'saving' ? 'Saving…' : saving === 'saved' ? 'Draft saved' : ''}</span>
        <button className="btn ghost" onClick={() => void save()} title="Save draft (Ctrl+S)">Save</button>
        {inline && (
          <button className="icon-btn" title="Pop out" aria-label="Pop out" onClick={() => {
            void call('app.openWindow', 'compose', { draft: JSON.stringify({ ...latest.current, html: editor.current?.getHtml() ?? latest.current.html }) });
            dirty.current = false;
            onClose(false);
          }}>
            <Icon name="popout" />
          </button>
        )}
        <button className="icon-btn" title="Discard" aria-label="Discard" onClick={discard}><Icon name="trash" /></button>
        {!inline && <button className="icon-btn" title="Close" aria-label="Close" onClick={close}><Icon name="close" /></button>}
      </div>
      {pickLater && (
        <div className="banner info" style={{ margin: '8px 14px 0' }}>
          <Icon name="scheduled" />
          <label>Send at <input type="datetime-local" className="input" style={{ width: 220, display: 'inline-block', marginLeft: 6 }} value={laterValue} onChange={(e) => setLaterValue(e.target.value)} /></label>
          <button className="btn primary small" style={{ textDecoration: 'none', marginLeft: 'auto' }} onClick={() => void send(fromLocalInput(laterValue))}>Schedule</button>
          <button style={{ marginLeft: 4 }} onClick={() => setPickLater(false)}>Cancel</button>
        </div>
      )}
      <div className="compose-fields">
        {sendAs.length > 1 && (
          <div className="addr-row">
            <label htmlFor="c-from">From</label>
            <select id="c-from" className="input" style={{ border: 0, padding: '4px 0' }} value={d.from} onChange={(e) => swapSignature(e.target.value)}>
              {sendAs.map((s) => <option key={s.email} value={s.email}>{s.displayName ? `${s.displayName} <${s.email}>` : s.email}</option>)}
            </select>
          </div>
        )}
        <div className="addr-row">
          <button className="lbl" type="button" onClick={() => setShowCc(true)}>To</button>
          <AddressInput id="c-to" label="To" value={d.to} onChange={(to) => update({ to })} autoFocus={d.mode === 'new' || d.mode === 'forward'} />
          {!showCc && <button className="btn ghost small" onClick={() => setShowCc(true)}>Cc</button>}
          {!showBcc && <button className="btn ghost small" onClick={() => { setShowCc(true); setShowBcc(true); }}>Bcc</button>}
        </div>
        {showCc && (
          <div className="addr-row">
            <label htmlFor="c-cc">Cc</label>
            <AddressInput id="c-cc" label="Cc" value={d.cc} onChange={(cc) => update({ cc })} />
          </div>
        )}
        {showBcc && (
          <div className="addr-row">
            <label htmlFor="c-bcc">Bcc</label>
            <AddressInput id="c-bcc" label="Bcc" value={d.bcc} onChange={(bcc) => update({ bcc })} />
          </div>
        )}
        <div className="addr-row">
          <label htmlFor="c-subject" className="sr-only">Subject</label>
          <input id="c-subject" className="subject-input" placeholder="Add a subject" value={d.subject} onChange={(e) => update({ subject: e.target.value })} />
        </div>
      </div>
      {d.attachments.length > 0 && (
        <div className="compose-atts">
          {d.attachments.map((a, i) => {
            const k = fileKind(a.filename, a.mimeType);
            return (
              <span key={a.filename + i} className="attachment">
                <span className="kind" style={{ background: k.colour }}>{k.label}</span>
                <span className="info"><b>{a.filename}</b><span>{bytes(a.size)}</span></span>
                <button className="icon-btn" aria-label={`Remove ${a.filename}`} onClick={() => update({ attachments: d.attachments.filter((_, j) => j !== i) })}><Icon name="close" size={14} /></button>
              </span>
            );
          })}
          {total > 25 * 1024 * 1024 && <span className="hint-text" style={{ alignSelf: 'center' }}>Over 25 MB — these will be shared as Google Drive links.</span>}
        </div>
      )}
      <RichEditor ref={editor} initialHtml={d.html} onChange={(html) => update({ html })} minHeight={inline ? 200 : 260} holdImages={blockImages} />
    </div>
  );
}
