# Davenport

**An Outlook-style desktop client for Google Workspace.** Gmail, Google Calendar, Contacts, Google Chat and Google Tasks in one window, with the tools people rely on in Outlook: a folder pane, reading pane, ribbon, rules, Quick Steps, Search Folders, follow-up flags, a Scheduling Assistant and a To-Do bar.

> A *davenport* is a small English writing desk with drawers, made for keeping correspondence in order.

![Mail](docs/screenshots/01-mail.png)

## Features

| Area | What you get |
| --- | --- |
| **Mail** | Folder tree from Gmail labels (nested), Favourites, unified inbox across accounts, Primary / Other inbox tabs, conversation view, reading pane right/bottom/off, drag-and-drop to folders, categories as coloured chips, rules (saved as real Gmail filters), Quick Steps, Search Folders, flag for follow-up (creates a Google Task), snooze, send later, undo send, signatures, templates, automatic replies (linked with Calendar out of office), high importance, large attachments as Drive links, print and save as PDF, offline reading and instant full-text search, remote images blocked until you allow them |
| **Calendar** | Day, Work week, Week, Month and Schedule views; drag to create and move events; Scheduling Assistant from Google free/busy with suggested times; Google Meet links; rooms; repeat; reminders; focus time, out of office and working location; accept/tentative/decline; colleagues' calendars; a second time zone; create an event from an email |
| **People** | Google Contacts with groups, the whole Workspace directory downloaded for offline browsing, address autocomplete from contacts, the directory and people you've emailed; create, edit, email a group |
| **Chat** | Google Chat spaces and direct messages grouped by account, threads, reactions, mentions, notifications, your Chat status (Automatic, Do not disturb, Away, status message, synced with Google), turn a chat into an email |
| **Tasks** | Google Tasks lists, My Day, tasks from flagged email that complete the flag when ticked off |
| **Desktop** | Windows notifications, taskbar unread badge, notification-area icon, Outlook keyboard shortcuts (or Gmail's), light/dark/system theme, three densities, simplified or classic ribbon, `mailto:` handler, multiple accounts |

## Download

Get the latest build from the [Releases](../../releases) page:

- `Davenport-Setup-<version>.exe` — installer for Windows 10/11 that picks x64 or Arm64 automatically
- `Davenport-<version>-x64-portable.exe` / `-arm64-portable.exe` — no installation needed

The builds are not yet code-signed, so Windows SmartScreen will warn the first time: choose **More info › Run anyway**.

## First run

1. Davenport signs in to Google as **your own** OAuth app, so your mail never passes through anyone else's server. Follow [docs/GOOGLE-SETUP.md](docs/GOOGLE-SETUP.md) (about ten minutes) to create it.
2. Start Davenport, choose **Add a Google account**, load the client JSON file you downloaded, and sign in through your browser.
3. To explore first, choose **Explore with sample data** — a demo account with sample mail, calendar, contacts, chat and tasks. Remove it any time in Settings › Accounts.

## Keyboard shortcuts

| Action | Outlook keys (default) | Gmail keys (optional) |
| --- | --- | --- |
| Mail / Calendar / People / Chat / Tasks | Ctrl+1 … Ctrl+5 | |
| New item | Ctrl+N | c |
| Reply / Reply all / Forward | Ctrl+R / Ctrl+Shift+R / Ctrl+F | r / a / f |
| Delete / Archive | Delete / Backspace | # / e |
| Mark read / unread | Ctrl+Q / Ctrl+U | Shift+I / u |
| Flag | Insert | s |
| Move to folder | Ctrl+Shift+V | v |
| Search | Ctrl+E | / |
| Send / Receive | F9 | |
| Send message | Ctrl+Enter | |
| Previous / next week (calendar) | Alt+← / Alt+→ | |

## What Google doesn't allow (and what Davenport does instead)

- **Snooze and scheduled send** aren't available to apps through the Gmail API. Davenport provides both itself, so they need Davenport running (it can stay in the notification area). Snoozed mail is kept in a `Davenport/Snoozed` label so it's visible on other devices.
- **Gmail's own templates** can't be read by apps; Davenport has its own template library.
- **Google Chat** works for Google Workspace accounts and needs a Chat app configuration in your Cloud project (see the setup guide). Calls open in Google Meet.
- **New mail** is checked every 30–60 seconds (configurable). Instant push would need a cloud relay, which Davenport deliberately avoids.
- **Recall and read receipts** have no Gmail equivalent.

## Building from source

Requirements: Node.js 22 or later.

```bash
npm install
npm run dev          # run with hot reload
npm test             # unit tests (sync engine, MIME, search, rules)
npm run typecheck
npm run dist:win     # Windows installer + portable builds (x64 and arm64) into release/
npm run dist:mac     # macOS universal .dmg (run on a Mac)
npm run dist:linux   # AppImage and .deb
```

Building Windows installers on Linux or macOS needs [Wine](https://www.winehq.org/) (64- and 32-bit). The included GitHub Actions workflow builds Windows, macOS and Linux on native runners and attaches the results to a release whenever you push a tag like `v1.0.0`.

`node scripts/screenshots.mjs` launches the app with the demo account and captures every screen (useful for checking UI changes).

## How it's built

- **Electron + TypeScript + React.** The window never talks to Google directly; a background engine (Electron's main process) owns accounts, the local cache and every API call. The two halves talk over a typed contract in `app/shared/api.ts`.
- **Local cache:** SQLite built into Electron (`node:sqlite`) with FTS5 full-text search — no native modules, so x64 and Arm64 builds are identical.
- **Sync:** Gmail history IDs for incremental mail sync; an offline queue replays your changes in order when you reconnect.
- **Security:** OAuth 2.0 with PKCE through the system browser; refresh tokens encrypted by the operating system (DPAPI on Windows); email rendered in a sandboxed frame with scripts disabled and remote content blocked by default.

```
app/main        background engine: accounts, sync, outbox, rules, cache, notifications
app/main/google Google API clients (Gmail, Calendar, People, Tasks, Chat, Drive) and MIME
app/preload     the narrow bridge the window is allowed to use
app/renderer    the interface (React)
app/shared      types and the API contract shared by both halves
tests           unit tests, including the sync engine against a simulated Gmail
scripts         build helpers and the screenshot harness
```

## Licence

MIT — see [LICENSE](LICENSE). Davenport is an independent project and is not affiliated with Google or Microsoft. Gmail, Google Workspace and Google Chat are trademarks of Google LLC; Outlook is a trademark of Microsoft Corporation.
