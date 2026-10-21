// Folder pane: Favourites, each account's folder tree (Gmail labels), and Search Folders.
import { useState } from 'react';
import type { Account, Folder, SearchFolder } from '../../shared/types';
import { call, useLive } from '../api';
import { Icon } from '../components/Icon';
import { openMenu } from '../components/Menu';
import { fail, notify, useApp } from '../state';
import { cx } from '../util';

const SYS_ICON: Record<string, string> = {
  INBOX: 'inbox', DRAFT: 'draft', SENT: 'send', SCHEDULED: 'scheduled', SNOOZED: 'snooze', STARRED: 'flag', ALL: 'allmail', SPAM: 'spam', TRASH: 'bin'
};
export const DRAG_MIME = 'application/x-davenport-messages';

interface TreeNode {
  folder: Folder;
  children: TreeNode[];
}

function buildTree(folders: Folder[]): TreeNode[] {
  const user = folders.filter((f) => f.type === 'user' && !f.hidden).sort((a, b) => a.path.localeCompare(b.path, undefined, { sensitivity: 'base' }));
  const byPath = new Map<string, TreeNode>();
  const roots: TreeNode[] = [];
  for (const f of user) {
    const node = { folder: f, children: [] };
    byPath.set(f.path, node);
    const parent = f.path.includes('/') ? byPath.get(f.path.slice(0, f.path.lastIndexOf('/'))) : undefined;
    (parent ? parent.children : roots).push(node);
  }
  return roots;
}

export function FolderPane() {
  const { accounts, mail, openFolder, settings, updateSettings, openDialog } = useApp();
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [folders] = useLive(
    async () => {
      const out: Record<string, Folder[]> = {};
      for (const a of accounts) out[a.id] = await call('mail.folders', a.id);
      return out;
    },
    ['folders', 'mail', 'outbox', 'accounts'],
    [accounts.map((a) => a.id).join()],
    {} as Record<string, Folder[]>
  );
  const [searchFolders] = useLive(() => call('searchFolders.list'), ['folders'], [], [] as SearchFolder[]);
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  const toggle = (key: string) => {
    const n = new Set(collapsed);
    n.has(key) ? n.delete(key) : n.add(key);
    setCollapsed(n);
  };

  const isCurrent = (accountId: string | 'all', id: string) =>
    mail.accountId === accountId && ((mail.folder.type === 'label' && mail.folder.id === id) || (mail.folder.type === 'unified' && id === 'U:' + mail.folder.label));

  const dropProps = (accountId: string, f: Folder) => ({
    onDragOver: (e: React.DragEvent) => {
      if (e.dataTransfer.types.includes(DRAG_MIME) && !['SENT', 'DRAFT', 'SCHEDULED', 'SNOOZED', 'ALL'].includes(f.id)) {
        e.preventDefault();
        e.dataTransfer.dropEffect = e.ctrlKey ? 'copy' : 'move';
        setDropTarget(accountId + f.id);
      }
    },
    onDragLeave: () => setDropTarget(null),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      setDropTarget(null);
      const items = JSON.parse(e.dataTransfer.getData(DRAG_MIME)) as { accountId: string; id: string; from: string }[];
      const mine = items.filter((i) => i.accountId === accountId);
      if (!mine.length) return notify("Messages can only be moved between folders of the same account.", 'error');
      const ids = mine.map((i) => i.id);
      const p = f.id === 'STARRED'
        ? call('mail.flag', accountId, ids, true)
        : e.ctrlKey
          ? call('mail.label', accountId, ids, [f.id], [])
          : call('mail.move', accountId, ids, f.id, mine[0].from);
      p.then(() => notify(`${ids.length === 1 ? 'Message' : ids.length + ' messages'} ${e.ctrlKey ? 'labelled' : 'moved to'} ${f.name}.`)).catch(fail);
    }
  });

  const folderMenu = (a: Account, f: Folder, e: React.MouseEvent) => {
    e.preventDefault();
    const fav = settings.favourites.some((x) => x.accountId === a.id && x.labelId === f.id);
    openMenu(
      [
        { label: fav ? 'Remove from Favourites' : 'Add to Favourites', icon: 'star', onClick: () => updateSettings({ favourites: fav ? settings.favourites.filter((x) => !(x.accountId === a.id && x.labelId === f.id)) : [...settings.favourites, { accountId: a.id, labelId: f.id }] }) },
        { label: 'Mark all as read', icon: 'read', onClick: async () => {
          const items = await call('mail.list', { accountId: a.id, folder: { type: 'label', id: f.id }, limit: 5000, unreadOnly: true });
          if (items.length) await call('mail.markRead', a.id, items.map((m) => m.id), true);
        } },
        { sep: true },
        { label: 'New subfolder…', icon: 'folderPlus', disabled: f.type !== 'user' && f.id !== 'INBOX', onClick: () => openDialog('newFolder', { accountId: a.id, parent: f.type === 'user' ? f.path : '' }) },
        { label: 'Rename…', icon: 'edit', disabled: f.type !== 'user', onClick: () => openDialog('newFolder', { accountId: a.id, rename: f }) },
        f.type === 'user'
          ? { label: f.isCategory ? 'Stop using as a category' : 'Use as a category', icon: 'tag', onClick: () => call('mail.setCategory', a.id, f.id, !f.isCategory, f.color ?? '#24497A') }
          : { label: 'Use as a category', icon: 'tag', disabled: true },
        ...(f.id === 'TRASH' || f.id === 'SPAM'
          ? [{ label: f.id === 'TRASH' ? 'Empty Bin' : 'Empty Spam', icon: 'trash', danger: true, onClick: () => {
              if (window.confirm(`Permanently delete everything in ${f.name}? This can't be undone.`)) void call('mail.emptyFolder', a.id, f.id as 'TRASH' | 'SPAM').catch(fail);
            } }]
          : []),
        { label: 'Delete folder', icon: 'trash', danger: true, disabled: f.type !== 'user', onClick: () => {
          if (window.confirm(`Delete the folder "${f.path}"? Messages in it stay in All Mail.`)) void call('mail.deleteFolder', a.id, f.id).catch(fail);
        } }
      ],
      { x: e.clientX, y: e.clientY }
    );
  };

  const renderFolder = (a: Account, f: Folder, depth: number, children?: TreeNode[]) => {
    const key = a.id + f.id;
    const isOpen = !collapsed.has(key);
    const count = f.id === 'DRAFT' || f.id === 'SCHEDULED' ? f.total : f.unread;
    return (
      <div key={key}>
        <button
          className={cx('folder', dropTarget === key && 'drop-target')}
          style={{ paddingLeft: 8 + depth * 14 }}
          aria-current={isCurrent(a.id, f.id)}
          onClick={() => openFolder({ accountId: a.id, folder: { type: 'label', id: f.id }, folderName: f.name })}
          onContextMenu={(e) => folderMenu(a, f, e)}
          {...dropProps(a.id, f)}
        >
          {children?.length ? (
            <span className="twisty" role="button" aria-label={isOpen ? 'Collapse' : 'Expand'} onClick={(e) => { e.stopPropagation(); toggle(key); }}>
              <Icon name={isOpen ? 'chevDown' : 'chevRight'} size={12} />
            </span>
          ) : (
            <span className="twisty" />
          )}
          {f.type === 'system' ? <Icon name={SYS_ICON[f.id] ?? 'folder'} size={15} /> : f.isCategory ? <span className="dot" style={{ background: f.color ?? '#5B6472' }} /> : <Icon name="folder" size={15} />}
          <span className="name">{f.name}</span>
          {count > 0 && <span className={cx('count', (f.id === 'DRAFT' || f.id === 'SCHEDULED') && 'items')}>{count}</span>}
        </button>
        {isOpen && children?.map((c) => renderFolder(a, c.folder, depth + 1, c.children))}
      </div>
    );
  };

  const unifiedCount = (id: string) => accounts.reduce((n, a) => n + ((folders[a.id] ?? []).find((f) => f.id === id)?.[id === 'DRAFT' ? 'total' : 'unread'] ?? 0), 0);

  return (
    <nav className="pane folder-pane" aria-label="Folders">
      <div className="pane-heading">
        Favourites
        <button aria-label="New folder" title="New folder" onClick={() => openDialog('newFolder', { accountId: mail.accountId !== 'all' ? mail.accountId : accounts[0]?.id, parent: '' })}>
          <Icon name="folderPlus" size={14} />
        </button>
      </div>
      {accounts.length > 1 && settings.unifiedInbox && (
        <>
          {(['INBOX', 'FLAGGED', 'DRAFT', 'SENT'] as const).map((l) => {
            const name = { INBOX: 'All inboxes', FLAGGED: 'All flagged', DRAFT: 'All drafts', SENT: 'All sent' }[l];
            const n = l === 'INBOX' ? unifiedCount('INBOX') : l === 'DRAFT' ? unifiedCount('DRAFT') : 0;
            return (
              <button key={l} className="folder" aria-current={isCurrent('all', 'U:' + l)} onClick={() => openFolder({ accountId: 'all', folder: { type: 'unified', label: l }, folderName: name })}>
                <span className="twisty" />
                <Icon name={l === 'INBOX' ? 'inbox' : l === 'FLAGGED' ? 'flag' : l === 'DRAFT' ? 'draft' : 'send'} size={15} />
                <span className="name">{name}</span>
                {n > 0 && <span className={cx('count', l === 'DRAFT' && 'items')}>{n}</span>}
              </button>
            );
          })}
        </>
      )}
      {accounts.length === 1 &&
        ['INBOX', 'DRAFT', 'SENT', 'STARRED'].map((id) => {
          const a = accounts[0];
          const f = (folders[a.id] ?? []).find((x) => x.id === id);
          return f ? renderFolder(a, f, 0) : null;
        })}
      {settings.favourites.map(({ accountId, labelId }) => {
        const a = accounts.find((x) => x.id === accountId);
        const f = (folders[accountId] ?? []).find((x) => x.id === labelId);
        return a && f ? <div key={'fav' + accountId + labelId}>{renderFolder(a, f, 0)}</div> : null;
      })}

      {accounts.map((a) => {
        const list = folders[a.id] ?? [];
        const isOpen = !collapsed.has('acc' + a.id);
        return (
          <div key={a.id}>
            <button className="account-heading" onClick={() => toggle('acc' + a.id)} aria-expanded={isOpen}>
              <span className="dot" style={{ background: a.color }} />
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.email}</span>
              {a.status === 'reauth' && <Icon name="warning" size={14} title="Sign in again" />}
              <Icon name={isOpen ? 'chevDown' : 'chevRight'} size={12} />
            </button>
            {isOpen && (
              <>
                {list.filter((f) => f.type === 'system').map((f) => renderFolder(a, f, 0))}
                {buildTree(list).map((n) => renderFolder(a, n.folder, 0, n.children))}
              </>
            )}
          </div>
        );
      })}

      <div className="pane-heading" style={{ marginTop: 14 }}>
        Search Folders
        <button aria-label="New Search Folder" title="New Search Folder" onClick={() => openDialog('searchFolder')}>
          <Icon name="plus" size={14} />
        </button>
      </div>
      {searchFolders.map((s) => (
        <button
          key={s.id}
          className="folder"
          aria-current={mail.folder.type === 'searchFolder' && mail.folder.id === s.id}
          onClick={() => openFolder({ accountId: s.accountId, folder: { type: 'searchFolder', id: s.id }, folderName: s.name })}
          onContextMenu={(e) => {
            e.preventDefault();
            openMenu([
              { label: 'Edit…', icon: 'edit', onClick: () => openDialog('searchFolder', s) },
              { label: 'Delete', icon: 'trash', danger: true, onClick: () => call('searchFolders.delete', s.id) }
            ], { x: e.clientX, y: e.clientY });
          }}
        >
          <span className="twisty" />
          <Icon name="search" size={15} />
          <span className="name">{s.name}</span>
        </button>
      ))}
      {!searchFolders.length && <div className="hint-text" style={{ padding: '2px 12px 8px 30px' }}>Saved searches appear here.</div>}
    </nav>
  );
}
