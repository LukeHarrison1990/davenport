# First run on Windows — a ten-minute check

Davenport was built and tested on Linux with automated tests (sync engine against a simulated Gmail, MIME, search, rules) and 19 end-to-end interface checks using the demo account. The Windows x64 and Arm64 executables were packaged and the x64 engine was confirmed to start under Wine, but the first live Google sign-in and a look at the real Windows window need doing on your machine. Tick these off and report anything odd.

## Install

- [ ] Run `Davenport-Setup-1.0.0.exe`. SmartScreen warns because the build isn't code-signed yet: **More info › Run anyway**.
- [ ] Davenport opens with the ink-blue title bar, and the minimise / maximise / close buttons sit in the top right.
- [ ] Choose **Explore with sample data** and click around every module (Ctrl+1 to Ctrl+5).

## Connect Google

- [ ] Follow [GOOGLE-SETUP.md](GOOGLE-SETUP.md) to create your OAuth client.
- [ ] **Add a Google account**, load the client JSON and finish signing in in your browser. The browser page says "You are signed in".
- [ ] The title bar shows *Syncing…*, the inbox fills within a minute, and the status bar ends on *All folders are up to date*.
- [ ] Your Gmail labels appear as folders, with nested labels shown as subfolders.

## Mail

- [ ] Open a message with pictures: they're hidden until you choose **Show pictures**.
- [ ] Reply inline, then send a new message from **New mail** to yourself. The *Sending… Undo* bar appears and the message arrives.
- [ ] Drag a message onto a folder; check it moved in Gmail on the web too.
- [ ] Flag a message for **Tomorrow** and check a task appears in Google Tasks.
- [ ] Snooze a message for a few minutes (Snooze › Choose a date and time) and check it returns with a notification.
- [ ] Create a rule (Move › Create rule…) and check it appears in Gmail › Settings › Filters.
- [ ] Windows notifications appear for new mail, and the taskbar icon shows an unread badge.

## Calendar, People, Tasks, Chat

- [ ] Your calendar shows the right events at the right times (check your time zone in the calendar header).
- [ ] Create a meeting with a colleague: the Scheduling Assistant shows their busy times; tick *Add Google Meet*; they receive the invitation.
- [ ] Contacts and contact groups appear in People; the directory search finds colleagues (Workspace).
- [ ] Workspace: **Settings › Accounts › Turn on Chat**, approve, and your spaces appear.

## If something goes wrong

Errors are written to `%APPDATA%\Davenport\davenport-errors.log`. The local cache is `%APPDATA%\Davenport\davenport.db` — deleting it (with Davenport closed) makes Davenport download everything again without affecting Google.
