// Tells the user a new Davenport is available and installs it when they say so.
import { useEffect, useState } from 'react';
import type { UpdateState } from '../../shared/types';
import { call, onEngine } from '../api';
import { fail } from '../state';
import { Icon } from './Icon';

export function useUpdateState(): UpdateState | null {
  const [s, setS] = useState<UpdateState | null>(null);
  useEffect(() => {
    void call('update.state').then(setS);
    return onEngine({ update: setS });
  }, []);
  return s;
}

export function UpdateBanner() {
  const s = useUpdateState();
  const [hidden, setHidden] = useState<string | null>(null);
  const [notes, setNotes] = useState(false);
  if (!s || !['available', 'downloading', 'ready'].includes(s.status) || hidden === s.latest + s.status) return null;
  return (
    <div className="update-banner" role="status">
      <Icon name="download" />
      <div className="grow">
        {s.status === 'available' && <b>Davenport {s.latest} is available.</b>}
        {s.status === 'downloading' && <b>Downloading Davenport {s.latest}… {s.percent ?? 0}%</b>}
        {s.status === 'ready' && <b>Davenport {s.latest} is ready to install.</b>}
        <div className="sub">
          {s.status === 'available' && (s.portable ? 'Download the new version from GitHub.' : 'It downloads in the background while you work.')}
          {s.status === 'downloading' && 'You can keep working.'}
          {s.status === 'ready' && 'Davenport will close, update and open again. It takes a few seconds.'}
        </div>
        {notes && s.notes && <pre className="update-notes">{s.notes}</pre>}
      </div>
      {s.notes && s.status === 'available' && (
        <button className="btn ghost small" onClick={() => setNotes(!notes)}>{notes ? 'Hide' : "What's new"}</button>
      )}
      {s.status === 'available' && (
        <button className="btn primary small" onClick={() => call('update.download').catch(fail)}>{s.portable ? 'Download' : 'Update'}</button>
      )}
      {s.status === 'ready' && (
        <button className="btn primary small" onClick={() => call('update.install').catch(fail)}>Restart and install</button>
      )}
      {s.status !== 'downloading' && (
        <button className="btn ghost small" aria-label="Later" title="Later" onClick={() => setHidden(s.latest + s.status)}>Later</button>
      )}
    </div>
  );
}

/** The updates section of About: version status, a Check now button and the automatic-check setting. */
export function UpdateSettings({ autoUpdate, onToggle }: { autoUpdate: boolean; onToggle: (on: boolean) => void }) {
  const s = useUpdateState();
  const [busy, setBusy] = useState(false);
  const check = () => {
    setBusy(true);
    call('update.check').catch(fail).finally(() => setBusy(false));
  };
  const line = !s
    ? ''
    : s.status === 'managed'
      ? 'Updates on this computer are managed by your organisation.'
      : s.status === 'checking'
        ? 'Checking for updates…'
        : s.status === 'current'
          ? 'Davenport is up to date.'
          : s.status === 'available'
            ? `Davenport ${s.latest} is available.`
            : s.status === 'downloading'
              ? `Downloading Davenport ${s.latest}… ${s.percent ?? 0}%`
              : s.status === 'ready'
                ? `Davenport ${s.latest} is ready to install.`
                : s.status === 'error'
                  ? s.error ?? 'Checking for updates failed.'
                  : '';
  return (
    <div className="update-settings">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <button className="btn" disabled={busy || s?.status === 'managed' || s?.status === 'downloading'} onClick={check}>
          <Icon name="sync" size={14} /> Check for updates
        </button>
        {s?.status === 'available' && <button className="btn primary" onClick={() => call('update.download').catch(fail)}>{s.portable ? 'Download' : 'Update now'}</button>}
        {s?.status === 'ready' && <button className="btn primary" onClick={() => call('update.install').catch(fail)}>Restart and install</button>}
        <span className="hint-text">{line}</span>
      </div>
      {s?.status !== 'managed' && (
        <label className="check" style={{ marginTop: 8 }}>
          <input type="checkbox" checked={autoUpdate} onChange={(e) => onToggle(e.target.checked)} /> Check for updates automatically
        </label>
      )}
    </div>
  );
}
