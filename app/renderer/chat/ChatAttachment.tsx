// A file in a Chat message: pictures uploaded into Chat show in the conversation; other files and Google Drive
// files open on click, with Open and Save as… on the right-click menu.
import { useEffect, useState } from 'react';
import type { ChatAttachment as Att } from '../../shared/types';
import { call } from '../api';
import { contextMenu, copyText } from '../components/contextMenu';
import type { MenuEntry } from '../components/Menu';
import { fail, notify } from '../state';

const isPicture = (a: Att) => !!a.resource && /^image\/(png|jpe?g|gif|webp|bmp)$/i.test(a.mimeType ?? '');

function kindLabel(a: Att): { badge: string; colour: string; sub: string } {
  if (a.kind === 'drive') return { badge: 'DRV', colour: '#1E7A45', sub: 'Google Drive' };
  const ext = (a.name.split('.').pop() ?? '').toUpperCase().slice(0, 4);
  return { badge: ext && ext !== a.name.toUpperCase() ? ext : 'FILE', colour: '#5B6472', sub: 'Attachment' };
}

export function ChatAttachment({ a, accountId }: { a: Att; accountId: string }) {
  const [preview, setPreview] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const picture = isPicture(a);

  useEffect(() => {
    if (!picture) return;
    let live = true;
    call('chat.attachmentPreview', accountId, a.resource!, a.mimeType!)
      .then((url) => live && setPreview(url))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [accountId, a.resource, a.mimeType, picture]);

  const open = () => {
    if (a.resource) call('chat.openAttachment', accountId, a.resource, a.name).catch(fail);
    else if (a.url) call('app.openExternal', a.url).catch(fail);
    else notify("Google Chat didn't give Davenport a way to open this file. Open the conversation in Google Chat to see it.", 'error');
  };
  const menu = (): MenuEntry[] =>
    a.resource
      ? [
          { label: 'Open', icon: 'open', onClick: open },
          { label: 'Save as…', icon: 'download', onClick: () => void call('chat.saveAttachment', accountId, a.resource!, a.name).then((p) => p && notify('Saved.')).catch(fail) }
        ]
      : a.url
        ? [
            { label: a.kind === 'drive' ? 'Open in Google Drive' : 'Open link', icon: 'open', onClick: open },
            { label: 'Copy link', icon: 'copy', onClick: () => copyText(a.url!) }
          ]
        : [];

  if (picture && preview && !failed)
    return (
      <button className="chat-picture" onClick={open} onContextMenu={contextMenu(menu)} title={`${a.name} — click to open`} aria-label={`Picture: ${a.name}. Open`}>
        <img src={preview} alt={a.name} />
      </button>
    );
  const k = kindLabel(a);
  return (
    <button className="attachment" onClick={open} onContextMenu={contextMenu(menu)} title={a.resource || a.url ? 'Click to open, right-click for more' : undefined}>
      <span className="kind" style={{ background: k.colour }}>{k.badge}</span>
      <span className="info"><b>{a.name}</b><span>{picture && !failed ? 'Loading picture…' : k.sub}</span></span>
    </button>
  );
}
