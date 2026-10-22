# Changelog

## 1.0.5 — 2026-10-22

- Ctrl+A in Mail selects every message in the current folder wherever the focus is (outside a text box), instead of highlighting the window's text. The window's own labels can no longer be highlighted by accident; email bodies, contact details and anything you type remain selectable.
- Search updates as you type (a moment after you pause), in Mail, Calendar, People, Chat and now Tasks. Enter still searches immediately; the down arrow moves from the search box into the results.
- Switching between Mail, Calendar, People, Chat and Tasks clears the search box.

## 1.0.4 — 2026-10-22

- Settings keeps the same size and position whichever section you open; long sections scroll inside the window.
- The Settings button in the sidebar is now a gear instead of a sun-like icon.

## 1.0.3 — 2026-10-22

- People: Davenport now downloads your whole Google Workspace directory (everyone in the organisation, plus shared domain contacts), not just search results. The first download happens automatically; after that only changes are fetched, every six hours. Browse and search it offline, and every colleague appears in address autocomplete. A Refresh button re-downloads it on demand.
- If your organisation doesn't share its directory with apps, People explains which Admin console setting controls it.
- New logo: a modern "D"-shaped envelope with an amber new-mail dot, used for the app, installer, taskbar, notification area, title bar and welcome screen.

## 1.0.2 — 2026-10-22

- Fixed: deleting a message from any folder other than the inbox left it in the folder. Binned and spam mail is now hidden from every folder except Bin and Spam (as in Gmail), and folder counts match.
- Delete inside the Bin now deletes permanently (after confirming), and the Bin's right-click menu has Restore.
- Fixed: with the reading pane at the bottom, the pane didn't appear and the message list ran over the status bar. The list and reading pane now split the space, with a draggable divider (remembered between sessions).
- New mail is now a split button — one click for a new email, the arrow for other new items — replacing the separate "New items" arrow.
- Classic ribbon: every button has the same height with icons on one line, and dropdown arrows sit beside the label instead of underneath.
- Search box simply says "Search mail"; welcome text reworded.
- New logo (see 1.0.3).

## 1.0.1 — 2026-10-22

- Fixed: first sync of a large mailbox could hit Google's "Quota exceeded … Units per minute per user" limit and stall. Gmail calls are now paced below Google's per-user quota, every call for the account pauses together when Google asks it to slow down, and an interrupted first sync resumes where it left off instead of starting again.
- Rate-limit pauses now show as "Syncing" in the status bar rather than as an error.

## 1.0.0 — 2026-10-21

First release.

- Mail: Gmail sync with history IDs, offline cache and full-text search; folder tree from labels; Favourites and unified folders across accounts; Focused / Other; conversations; reading pane right/bottom/off; drag to folders; categories; rules as Gmail filters (plus local rules); Quick Steps; Search Folders; follow-up flags linked to Google Tasks; snooze; send later; undo send; signatures; templates; automatic replies; high importance; large attachments as Drive links; print and save as PDF; remote images blocked by default.
- Calendar: day, work week, week, month and schedule views; drag to create and move; Scheduling Assistant with suggested times; Google Meet; rooms; repeating events; reminders; focus time, out of office and working location; invitations; colleagues' calendars; second time zone.
- People: Google Contacts, groups, Workspace directory, autocomplete.
- Chat: spaces, direct messages, threads, reactions, notifications.
- Tasks: Google Tasks lists, My Day, tasks from flagged mail.
- Desktop: Windows notifications and taskbar badge, notification-area icon, Outlook or Gmail keyboard shortcuts, light/dark themes, densities, simplified or classic ribbon, `mailto:` links, multiple accounts, demo account.
- Builds for Windows x64 and Arm64 (installer and portable); macOS and Linux build targets ready in CI.
