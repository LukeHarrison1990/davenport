// Settings and first-run: accounts and Google connection, appearance, mail, calendar, categories.
import { UpdateSettings } from '../components/UpdateBanner';
import { useEffect, useState } from 'react';
import type { AppInfo, Folder } from '../../shared/types';
import { call, useLive } from '../api';
import { Icon, Logo } from '../components/Icon';
import { Dialog, Field } from '../components/ui';
import { fail, notify, useApp } from '../state';
import licenceText from '../../../LICENSE?raw';

const CAT_COLOURS = ['#24497A', '#2E7D5B', '#9A7740', '#7A4E9C', '#B3361F', '#1E7A8A', '#5C6B2E', '#5B6472'];

export function OAuthClientForm({ onDone }: { onDone?: () => void }) {
  const [client, setClient] = useState<{ clientId: string; hasSecret: boolean; source: string; builtInAvailable: boolean } | null>(null);
  const [id, setId] = useState('');
  const [secret, setSecret] = useState('');
  const load = () =>
    call('auth.getClient').then((c) => {
      setClient(c);
      setId(c.clientId);
      setSecret('');
    });
  useEffect(() => void load(), []);
  const save = async () => {
    if (!id.trim().endsWith('.apps.googleusercontent.com')) return notify('That doesn\'t look like a Google client ID (it ends in .apps.googleusercontent.com).', 'error');
    await call('auth.setClient', id.trim(), secret.trim());
    await load();
    notify('Google connection saved. Accounts added with a different connection need to sign in again.');
    onDone?.();
  };
  const useBuiltIn = async () => {
    await call('auth.clearClient');
    await load();
    notify('Using Davenport’s own Google connection. Accounts added with your own connection need to sign in again.');
    onDone?.();
  };
  const form = (
    <div>
      <p className="hint-text">
        Organisations that would rather Davenport signed in as their own Google app can create a <b>Desktop app</b> OAuth client in their
        Google Cloud project (docs/GOOGLE-SETUP.md walks through it), then load the JSON file Google gives them, or paste the ID and secret.
      </p>
      <div style={{ display: 'flex', gap: 8, margin: '10px 0' }}>
        <button className="btn" onClick={() => call('auth.loadClientFile').then(async (r) => { if (r) { await load(); notify('Google connection loaded.'); onDone?.(); } }).catch(fail)}>
          <Icon name="open" /> Load client JSON file…
        </button>
        <button className="btn ghost" onClick={() => call('app.openExternal', 'https://console.cloud.google.com/apis/credentials')}>Open Google Cloud Console</button>
      </div>
      <Field label="Client ID"><input className="input" value={id} onChange={(e) => setId(e.target.value)} placeholder="1234567890-abc.apps.googleusercontent.com" /></Field>
      <Field label="Client secret" hint={client?.hasSecret ? 'A secret is saved (stored encrypted). Enter a new one to replace it.' : undefined}>
        <input className="input" type="password" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder={client?.hasSecret ? '••••••••' : 'GOCSPX-…'} />
      </Field>
      <button className="btn primary" onClick={save} disabled={!id}>Save</button>
    </div>
  );
  if (!client) return null;
  if (client.source === 'builtin')
    return (
      <div>
        <p className="hint-text">Davenport signs in with its own Google app, so there's nothing to set up: just add an account.</p>
        <details className="advanced">
          <summary>Use your own Google Cloud project instead</summary>
          {form}
        </details>
      </div>
    );
  return (
    <div>
      {client.source !== 'none' && (
        <p className="hint-text">
          Signing in with {client.source === 'file' ? 'the Google app in oauth-client.json' : 'your own Google app'}: <code>{client.clientId}</code>
        </p>
      )}
      {client.source === 'settings' && client.builtInAvailable && (
        <button className="btn" style={{ marginBottom: 12 }} onClick={() => void useBuiltIn().catch(fail)}>Use Davenport’s own connection instead</button>
      )}
      {client.source !== 'file' && form}
    </div>
  );
}

export function Welcome() {
  const [step, setStep] = useState<'start' | 'google'>('start');
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState<AppInfo | null>(null);
  useEffect(() => void call('app.info').then(setInfo), []);
  const addGoogle = async () => {
    setBusy(true);
    try {
      await call('accounts.addGoogle');
      notify('Signed in. Your mail is downloading.');
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="welcome">
      <div className="welcome-card">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
          <Logo size={54} tile />
          <h1>Welcome to Davenport</h1>
        </div>
        {step === 'start' ? (
          <>
            <p>A desktop app for Google Workspace: Gmail, Calendar, Contacts, Chat and Tasks together in one window.</p>
            <div className="choice-grid">
              <button className="choice" onClick={() => (info?.hasOAuthClient ? void addGoogle() : setStep('google'))} disabled={busy}>
                <Icon name="mail" size={22} />
                <b>{busy ? 'Waiting for Google sign-in…' : 'Add a Google account'}</b>
                <span>Sign in through your browser. Works with Google Workspace and personal Gmail.</span>
              </button>
              <button className="choice" onClick={() => call('accounts.addDemo').catch(fail)}>
                <Icon name="grid" size={22} />
                <b>Explore with sample data</b>
                <span>Try every screen with a demo account first. You can remove it any time.</span>
              </button>
            </div>
            {busy && <p className="hint-text" style={{ marginTop: 14 }}>Finish signing in in your browser, then come back here.</p>}
          </>
        ) : (
          <>
            <p><b>One-time setup:</b> connect Davenport to your own Google Cloud project.</p>
            <ol className="steps">
              <li>In Google Cloud Console, create a project and enable the Gmail, Calendar, People, Tasks, Drive and (for Workspace) Chat APIs.</li>
              <li>Set up the OAuth consent screen. On Workspace choose <b>Internal</b>; for personal Gmail use <b>Testing</b> and add yourself as a test user.</li>
              <li>Create an OAuth client of type <b>Desktop app</b> and download its JSON file.</li>
            </ol>
            <OAuthClientForm onDone={() => { setStep('start'); void call('app.info').then(setInfo); }} />
            <div style={{ marginTop: 16 }}>
              <button className="btn ghost" onClick={() => setStep('start')}>Back</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

type Section = 'accounts' | 'general' | 'mail' | 'categories' | 'calendar' | 'about';

export function SettingsDialog({ arg, onClose }: { arg?: unknown; onClose: () => void }) {
  const { accounts, settings, updateSettings, openDialog } = useApp();
  const [section, setSection] = useState<Section>((arg as Section) ?? 'accounts');
  const [busy, setBusy] = useState<string | null>(null);
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [folders] = useLive(async () => {
    const out: Folder[] = [];
    for (const a of accounts) out.push(...(await call('mail.folders', a.id)));
    return out;
  }, ['folders'], [accounts.length], [] as Folder[]);
  useEffect(() => void call('app.info').then(setInfo), []);

  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    try {
      await fn();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  };

  const nav = (id: Section, label: string) => (
    <button aria-current={section === id} onClick={() => setSection(id)}>{label}</button>
  );

  return (
    <Dialog title="Settings" wide className="settings-dialog" onClose={onClose}>
      <div className="settings">
        <nav aria-label="Settings sections">
          {nav('accounts', 'Accounts')}
          {nav('general', 'General')}
          {nav('mail', 'Mail')}
          {nav('categories', 'Categories')}
          {nav('calendar', 'Calendar')}
          {nav('about', 'About')}
        </nav>
        <section>
          {section === 'accounts' && (
            <>
              <h3>Accounts</h3>
              <div className="list-box">
                {accounts.map((a) => (
                  <div className="item" key={a.id}>
                    <input type="color" aria-label={`Colour for ${a.email}`} value={a.color} onChange={(e) => call('accounts.setColor', a.id, e.target.value)} style={{ width: 28, height: 28, border: 0, padding: 0, background: 'transparent' }} />
                    <div className="grow">
                      <div>{a.email}</div>
                      <div className="sub">
                        {a.kind === 'demo' ? 'Demo account with sample data' : a.isWorkspace ? 'Google Workspace' : 'Google account'}
                        {' · '}
                        {a.status === 'reauth' ? 'Needs you to sign in again' : a.status === 'ok' ? (a.lastSync ? 'Synced ' + new Date(a.lastSync).toLocaleTimeString() : 'Connected') : a.error ?? a.status}
                        {a.chatEnabled ? ' · Chat on' : ''}
                      </div>
                    </div>
                    {a.status === 'reauth' && <button className="btn small primary" disabled={!!busy} onClick={() => run('re' + a.id, () => call('accounts.reauth', a.id))}>Sign in</button>}
                    {a.kind === 'google' && !a.chatEnabled && a.isWorkspace && (
                      <button className="btn small" disabled={!!busy} onClick={() => run('chat' + a.id, () => call('accounts.enableChat', a.id))}>{busy === 'chat' + a.id ? 'Waiting…' : 'Turn on Chat'}</button>
                    )}
                    <button className="btn small danger" onClick={() => window.confirm(`Remove ${a.email} from Davenport? Nothing is deleted from Google.`) && run('rm' + a.id, () => call('accounts.remove', a.id))}>Remove</button>
                  </div>
                ))}
                {!accounts.length && <div className="item"><span className="sub">No accounts yet.</span></div>}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn primary" disabled={!!busy || !info?.hasOAuthClient} onClick={() => run('add', () => call('accounts.addGoogle'))}>
                  <Icon name="plus" /> {busy === 'add' ? 'Waiting for Google sign-in…' : 'Add Google account'}
                </button>
                {!accounts.some((a) => a.kind === 'demo') && <button className="btn" onClick={() => run('demo', () => call('accounts.addDemo'))}>Add demo account</button>}
              </div>
              {!info?.hasOAuthClient && <p className="hint-text">Add your Google connection below first.</p>}
              <h3 style={{ marginTop: 22 }}>Google connection</h3>
              <OAuthClientForm onDone={() => void call('app.info').then(setInfo)} />
            </>
          )}
          {section === 'general' && (
            <>
              <h3>Appearance</h3>
              <div className="row-3">
                <Field label="Theme">
                  <select className="input" value={settings.theme} onChange={(e) => updateSettings({ theme: e.target.value as never })}>
                    <option value="system">Follow Windows</option><option value="light">Light</option><option value="dark">Dark</option>
                  </select>
                </Field>
                <Field label="Density">
                  <select className="input" value={settings.density} onChange={(e) => updateSettings({ density: e.target.value as never })}>
                    <option value="compact">Compact</option><option value="standard">Standard</option><option value="roomy">Roomy</option>
                  </select>
                </Field>
                <Field label="Ribbon">
                  <select className="input" value={settings.ribbon} onChange={(e) => updateSettings({ ribbon: e.target.value as never })}>
                    <option value="simplified">Simplified</option><option value="classic">Classic</option>
                  </select>
                </Field>
              </div>
              <Field label="Accent colour">
                <div style={{ display: 'flex', gap: 8 }}>
                  {['#1F3A5F', '#2B4C3F', '#4A2F5E', '#3A3F47', '#7A3B2E', '#1E5A6E'].map((c) => (
                    <button key={c} aria-label={`Accent ${c}`} onClick={() => updateSettings({ accent: c })} style={{ width: 32, height: 32, borderRadius: 8, background: c, border: settings.accent === c ? '3px solid var(--brass-light)' : '1px solid var(--border)' }} />
                  ))}
                </div>
              </Field>
              <h3>Keyboard</h3>
              <Field label="Shortcuts">
                <select className="input" value={settings.shortcuts} onChange={(e) => updateSettings({ shortcuts: e.target.value as never })}>
                  <option value="outlook">Outlook (Ctrl+R reply, Ctrl+N new, Del delete…)</option>
                  <option value="gmail">Gmail (c, r, a, f, e, #, j/k…) plus Outlook keys</option>
                </select>
              </Field>
              <h3>Behaviour</h3>
              <label className="check"><input type="checkbox" checked={settings.notifications} onChange={(e) => updateSettings({ notifications: e.target.checked })} /> Show desktop notifications</label>
              <label className="check"><input type="checkbox" checked={settings.notificationSound} onChange={(e) => updateSettings({ notificationSound: e.target.checked })} /> Play a sound with notifications</label>
              <label className="check"><input type="checkbox" checked={settings.closeToTray} onChange={(e) => updateSettings({ closeToTray: e.target.checked })} /> Keep running in the notification area when closed (needed for snooze, send later and reminders)</label>
              <label className="check"><input type="checkbox" checked={settings.startWithWindows} onChange={(e) => updateSettings({ startWithWindows: e.target.checked })} /> Start Davenport when I sign in to Windows</label>
              <label className="check"><input type="checkbox" checked={settings.todoBar} onChange={(e) => updateSettings({ todoBar: e.target.checked })} /> Show the To-Do bar</label>
            </>
          )}
          {section === 'mail' && (
            <>
              <h3>Reading</h3>
              <div className="row-2">
                <Field label="Reading pane">
                  <select className="input" value={settings.readingPane} onChange={(e) => updateSettings({ readingPane: e.target.value as never })}>
                    <option value="right">Right</option><option value="bottom">Bottom</option><option value="off">Off</option>
                  </select>
                </Field>
                <Field label="Mark as read">
                  <select className="input" value={settings.markReadAfterSeconds} onChange={(e) => updateSettings({ markReadAfterSeconds: Number(e.target.value) })}>
                    <option value={0}>Straight away</option><option value={2}>After 2 seconds</option><option value={5}>After 5 seconds</option><option value={-1}>Never automatically</option>
                  </select>
                </Field>
              </div>
              <label className="check"><input type="checkbox" checked={settings.conversationView} onChange={(e) => updateSettings({ conversationView: e.target.checked })} /> Show messages as conversations</label>
              <label className="check"><input type="checkbox" checked={settings.blockRemoteImages} onChange={(e) => updateSettings({ blockRemoteImages: e.target.checked })} /> Don't download pictures automatically (protects your privacy)</label>
              <Field label="Inbox tabs">
                <select className="input" value={settings.focusedInbox} onChange={(e) => updateSettings({ focusedInbox: e.target.value as never })}>
                  <option value="categories">Primary and Other — Promotions and Social go in Other (like Gmail)</option>
                  <option value="categoriesAll">Primary and Other — Promotions, Social, Updates and Forums go in Other</option>
                  <option value="important">Important and Other — uses Gmail's Important marker</option>
                  <option value="off">Off</option>
                </select>
              </Field>
              <label className="check"><input type="checkbox" checked={settings.unifiedInbox} onChange={(e) => updateSettings({ unifiedInbox: e.target.checked })} /> Show combined folders for all accounts</label>
              <h3>Sending</h3>
              <div className="row-2">
                <Field label="Undo send">
                  <select className="input" value={settings.undoSendSeconds} onChange={(e) => updateSettings({ undoSendSeconds: Number(e.target.value) })}>
                    {[0, 5, 10, 20, 30].map((n) => <option key={n} value={n}>{n ? `${n} seconds` : 'Off'}</option>)}
                  </select>
                </Field>
                <Field label="Share attachments as Drive links when over">
                  <select className="input" value={settings.attachAsDriveLinkOverMB} onChange={(e) => updateSettings({ attachAsDriveLinkOverMB: Number(e.target.value) })}>
                    {[10, 20, 25].map((n) => <option key={n} value={n}>{n} MB</option>)}
                  </select>
                </Field>
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button className="btn" onClick={() => openDialog('signature')}><Icon name="signature" /> Signatures</button>
                <button className="btn" onClick={() => openDialog('outOfOffice')}><Icon name="plane" /> Automatic replies</button>
                <button className="btn" onClick={() => openDialog('rules')}><Icon name="rules" /> Rules</button>
                <button className="btn" onClick={() => openDialog('quicksteps')}><Icon name="bolt" /> Quick Steps</button>
                <button className="btn" onClick={() => openDialog('templates')}><Icon name="template" /> Templates</button>
              </div>
              <h3>Sync</h3>
              <div className="row-2">
                <Field label="Keep mail on this computer for" hint="Older mail is still searchable on Google.">
                  <select className="input" value={settings.syncDays} onChange={(e) => updateSettings({ syncDays: Number(e.target.value) })}>
                    {[30, 90, 180, 365, 730].map((n) => <option key={n} value={n}>{n < 365 ? `${n} days` : `${n / 365} year${n > 365 ? 's' : ''}`}</option>)}
                  </select>
                </Field>
                <Field label="Check for new mail every">
                  <select className="input" value={settings.pollSeconds} onChange={(e) => updateSettings({ pollSeconds: Number(e.target.value) })}>
                    {[30, 45, 60, 120, 300].map((n) => <option key={n} value={n}>{n < 60 ? `${n} seconds` : `${n / 60} minute${n > 60 ? 's' : ''}`}</option>)}
                  </select>
                </Field>
              </div>
            </>
          )}
          {section === 'categories' && (
            <>
              <h3>Categories</h3>
              <p className="hint-text">Any Gmail label can be a category: it shows as a coloured chip on messages instead of a folder. Turn labels on below.</p>
              <div className="list-box">
                {folders.filter((f) => f.type === 'user').map((f) => (
                  <div className="item" key={f.accountId + f.id}>
                    <input type="checkbox" checked={f.isCategory} aria-label={`Use ${f.path} as a category`} onChange={(e) => call('mail.setCategory', f.accountId, f.id, e.target.checked, f.color ?? CAT_COLOURS[0])} />
                    <div className="grow">
                      <div>{f.path}</div>
                      {accounts.length > 1 && <div className="sub">{accounts.find((a) => a.id === f.accountId)?.email}</div>}
                    </div>
                    {f.isCategory && (
                      <div style={{ display: 'flex', gap: 4 }}>
                        {CAT_COLOURS.map((c) => (
                          <button key={c} aria-label={`Colour ${c}`} onClick={() => call('mail.setCategory', f.accountId, f.id, true, c)} style={{ width: 20, height: 20, borderRadius: 10, background: c, border: f.color === c ? '2px solid var(--text)' : '1px solid var(--border)' }} />
                        ))}
                      </div>
                    )}
                  </div>
                ))}
                {!folders.some((f) => f.type === 'user') && <div className="item"><span className="sub">Create a folder first.</span></div>}
              </div>
            </>
          )}
          {section === 'calendar' && (
            <>
              <h3>Work week</h3>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
                {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d, i) => (
                  <label className="check" key={d}>
                    <input type="checkbox" checked={settings.workWeek.includes(i)} onChange={(e) => updateSettings({ workWeek: e.target.checked ? [...settings.workWeek, i].sort() : settings.workWeek.filter((x) => x !== i) })} /> {d}
                  </label>
                ))}
              </div>
              <div className="row-2">
                <Field label="Working hours start">
                  <select className="input" value={settings.dayStartHour} onChange={(e) => updateSettings({ dayStartHour: Number(e.target.value) })}>
                    {Array.from({ length: 13 }, (_, i) => i + 5).map((h) => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}
                  </select>
                </Field>
                <Field label="Working hours end">
                  <select className="input" value={settings.dayEndHour} onChange={(e) => updateSettings({ dayEndHour: Number(e.target.value) })}>
                    {Array.from({ length: 12 }, (_, i) => i + 13).map((h) => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}
                  </select>
                </Field>
              </div>
              <Field label="Second time zone" hint="Shown as an extra column in day and week views.">
                <select className="input" value={settings.secondTimeZone ?? ''} onChange={(e) => updateSettings({ secondTimeZone: e.target.value || undefined })}>
                  <option value="">None</option>
                  {['America/New_York', 'America/Chicago', 'America/Los_Angeles', 'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Asia/Dubai', 'Asia/Kolkata', 'Asia/Singapore', 'Asia/Tokyo', 'Australia/Sydney', 'UTC'].map((z) => <option key={z} value={z}>{z.replace('_', ' ')}</option>)}
                </select>
              </Field>
            </>
          )}
          {section === 'about' && <About info={info} />}
        </section>
      </div>
    </Dialog>
  );
}

function About({ info }: { info: AppInfo | null }) {
  const arch = info ? ({ x64: '64-bit', arm64: 'ARM64', ia32: '32-bit' } as Record<string, string>)[info.arch] ?? info.arch : '';
  return (
    <div className="about">
      <div className="about-head">
        <Logo size={56} tile />
        <div>
          <div className="about-name">Davenport</div>
          <div>Version {info?.version ?? '…'}{arch ? ` (${arch})` : ''}</div>
          <div className="hint-text">Copyright © 2026 Davenport contributors</div>
        </div>
      </div>
      <p>A desktop email, calendar, contacts and chat app for Google Workspace.</p>
      <AboutUpdates />
      <p>
        Davenport is free software, licensed under the MIT License:
      </p>
      <div className="licence-text" tabIndex={0} role="document" aria-label="MIT License">
        {/* LICENSE is hard-wrapped at 80 columns; reflow each paragraph to fit the box. */}
        {licenceText.trim().split(/\n\s*\n/).map((para, i) => <p key={i}>{para.replace(/\s*\n\s*/g, ' ')}</p>)}
      </div>
      <div className="about-links">
        <button className="btn ghost small" onClick={() => call('app.openExternal', 'https://davenport-app.com')}><Icon name="globe" size={14} /> davenport-app.com</button>
        <button className="btn ghost small" onClick={() => call('app.openThirdPartyLicences').catch(fail)}><Icon name="list" size={14} /> Third-party licences</button>
      </div>
      {info?.electron && (
        <p className="hint-text" style={{ marginBottom: 0 }}>Built with Electron {info.electron} and Chromium {info.chrome}. Your data is stored on this computer in {info.userDataPath}.</p>
      )}
    </div>
  );
}

function AboutUpdates() {
  const { settings, updateSettings } = useApp();
  return <UpdateSettings autoUpdate={settings.autoUpdate !== false} onToggle={(on) => updateSettings({ autoUpdate: on })} />;
}

export function AboutDialog({ onClose }: { onClose: () => void }) {
  const [info, setInfo] = useState<AppInfo | null>(null);
  useEffect(() => void call('app.info').then(setInfo), []);
  return (
    <Dialog title="About Davenport" onClose={onClose} footer={<button className="btn" onClick={onClose}>Close</button>}>
      <About info={info} />
    </Dialog>
  );
}
