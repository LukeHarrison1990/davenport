# Changelog

## 1.0.15 — 2026-11-02

- The installer starts with a normal Welcome page, with a Davenport sidebar picture on the Welcome and Finish pages. The licence comes second, with one line above it: "Davenport is free software, licensed under the MIT License below."
- Fixed: choosing to install for everyone on the computer showed the licence a second time after the administrator prompt. The Welcome and Licence pages are now skipped after that prompt, and when updating.

## 1.0.14 — 2026-11-02

- Calendar: the tick boxes next to each calendar stay the same small size however wide the side pane is. Before, long calendar names squashed them. Tick boxes elsewhere no longer shrink either.
- The installer now shows the MIT License before installing, with a Next button. The MIT License doesn't ask anything of people who just use the app, so there's nothing to agree to. The page is skipped when updating.

## 1.0.13 — 2026-11-01

- The initials in the account button at the top right are now properly centred whatever font Windows uses.
- Dark mode: the initials on Chat space icons, and today's date heading in Calendar's Schedule view, were dark blue on dark blue. They now use a lighter blue that's easy to read.

## 1.0.12 — 2026-10-29

- Menus behave like Windows menus: hovering over an item with ▸ opens its submenu beside the menu, which stays open. Moving to another item closes it again. With the keyboard, Right opens a submenu and Left or Esc goes back. Long menus no longer need scrolling.
- Fixed: Davenport's icon could appear as a blank page on the taskbar. The program's icon is now stored the way Windows expects (classic bitmaps for the small sizes, PNG only at 256×256); some parts of Windows can't draw small PNG icons from a program file. `scripts/make-ico.py` rebuilds the .ico files from the PNG renders.

## 1.0.11 — 2026-10-28

- Resizable panes everywhere: Calendar's side pane; People's address book pane and contact list; Chat's conversation list and thread panel; Tasks' list pane and task details. The left-hand pane keeps the same width in every module. Double-click a divider to reset it.
- Right-click menus everywhere:
  - Calendar events: Open, Join with Google Meet, Accept / Tentative / Decline, Email attendees, Copy details, Show as Busy or Free, Private, Open in Google Calendar, Delete. Empty time: New event, New Google Meet meeting, New all-day event, Out of office, Focus time. Calendars in the side pane: Show, Hide, Show only this calendar, Show all.
  - People: Send email, Schedule a meeting, copy email addresses and phone numbers, Edit, add to or remove from groups, Add to contacts, Delete. Groups: Email group, Schedule a meeting with group, Copy email addresses.
  - Chat: conversations (Open, Mark as read, Turn into email, Start a Meet call, Copy name, Open in Google Chat) and messages (Reply in thread, React, Copy text, Turn into email, Open in Google Chat).
  - Tasks: Mark complete, Open, Due today / tomorrow / next week / no date, Open flagged email, Copy, Delete. Lists: Open, New task in this list.
  - With text selected, every menu starts with Copy.
- Fixed: Davenport's icon could show as a blank page on the Windows taskbar after updating. Each window now tells Windows to use the icon in Davenport.exe directly instead of relying on the Start menu shortcut.

## 1.0.10 — 2026-10-28

- Every pane in Mail can be resized: drag the divider between the folder pane, message list, reading pane (right or bottom) and To-Do bar. Sizes are remembered; double-click a divider to put it back. Dividers also move with the arrow keys.
- Right-clicking a message in the reading pane now opens a menu like Outlook's: Copy and Select all; Open link / Copy link, Send email / Copy email address, and Copy picture / Save picture as… for whatever you clicked on; Open in new window and Copy sender's address; then Reply, Reply all, Forward, Mark as read or unread, Categorise, Follow up, Snooze, Move to…, Archive, Report spam, Delete, Create event, Create rule, Print and Save as PDF.
- Text boxes everywhere (including the message editor) now have the usual right-click menu: spelling suggestions, Add to dictionary, Undo, Redo, Cut, Copy, Paste, Paste as plain text and Select all.

## 1.0.9 — 2026-10-26

- The inbox tabs are now **Primary** and **Other**, matching Gmail's own name for the mail that lands in the first tab (Social, Promotions, Updates and Forums go in Other). If you choose to split by Gmail's Important marker instead, the first tab is called **Important**. The setting and the View button are now called "Inbox tabs".

## 1.0.8 — 2026-10-26

- Send / Receive shows that it's working: the arrows turn, the status bar shows a progress bar with what's being fetched (Mail, Calendar, Tasks, Contacts, Directory, Chat, per account), and it says when it's finished. Pressing it again while it runs doesn't start a second one.
- The Focused Inbox's second tab was renamed (see 1.0.9 for the final names). Hovering over either tab shows what goes in it.
- Chat: conversations are grouped under each account (collapsible), like folders in Mail.
- Chat status: set Automatic, Do not disturb (30 minutes to a week) or Away, plus a status message with an emoji and an end time. It's stored in Google, so it's the same in Chat on the web and phones, and changes made there show up in Davenport. Accounts that turned Chat on earlier get an **Allow status** button for the extra permission.
- Chat: if Google says "Google Chat app not found" (the Cloud project's one-time Chat app details are missing, which Google requires for sending), Davenport now shows the steps to fix it in Chat, with a button to the right Google Cloud page. The setup guide has been updated to match.

## 1.0.7 — 2026-10-22

- Fixed: turning on automatic replies with "Also show me as out of office in Calendar" failed with "An out of office event must not have a description". Google keeps an out-of-office entry's message in its own decline-message field and refuses a description, so Davenport now sends the message there (and leaves out location, guests and Meet links, which Google also refuses on these entries). The message shows in the Calendar entry as before.

## 1.0.6 — 2026-10-22

- Search is now fast at any length. Backspacing a query down to two or three letters used to stall because every message was checked one by one (about 48 seconds per search on 5,000 messages); the search index is now linked directly to each message and indexes short prefixes, so searches take around 0.05 seconds even on 30,000 messages. The index is rebuilt once, automatically, the first time 1.0.6 starts.
- Automatic replies and Calendar "Out of office" are now linked. Google treats them as two separate features (Gmail's vacation responder and a Calendar out-of-office entry); setting automatic replies with dates now also blocks the same dates in Calendar and declines new meetings (you can untick this), and creating an Out of office entry in Calendar switches automatic replies on for the same dates. Turning either off, or deleting the entry, turns off the other.
- Saving automatic replies now checks with Gmail that the change was accepted, and says so if it wasn't (for example, if Davenport needs to be signed in again to manage Gmail settings).

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
