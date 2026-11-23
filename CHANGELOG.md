# Changelog

## 1.2.0 — unreleased

**Updates**
- Davenport now keeps itself up to date. It checks GitHub for a new version shortly after starting and every six hours, and when there's one it says so in the corner of the window: **Update** downloads it in the background, then **Restart and install** installs it and opens Davenport again. Nothing installs without you choosing to.
- Settings › About has **Check for updates** and a setting to switch the automatic checks off.

**For network managers**
- Davenport installs silently with `/S /allusers`, and the new `/DISABLEUPDATES` switch (or a registry policy) leaves updates to you. An organisation's own Google client can be deployed to `C:\ProgramData\Davenport\oauth-client.json`. All of it is in the new deployment guide, docs/DEPLOYMENT.md.

**Fixes**
- The Rules window could say "No rules yet" even though your rules existed in Gmail. Davenport now reads every kind of Gmail filter, shows "Loading rules…" while it fetches them, and says what went wrong instead of an empty list if Gmail can't be reached.

## 1.1.0 — 2026-11-20

**Sign in with Google**
- Adding an account is now just **Add a Google account**, then sign in and click Allow in your browser. Davenport signs in with its own Google app, so there's no Google Cloud project to create and no JSON file to load.
- One sign-in now covers everything, Google Chat included, for Workspace accounts. There's no separate "Turn on Chat" step.
- Organisations that would rather use their own Google Cloud project still can: **Settings › Accounts › Use your own Google Cloud project instead**. Davenport installations already set up that way keep working as they are, and can switch to Davenport's own connection in the same place.
- Until Google finishes reviewing Davenport, its sign-in page may say "Google hasn't verified this app". Choose **Advanced › Go to Davenport**.

## 1.0.21 — 2026-11-19

**Meeting invitations**
- Invitation emails now show a meeting card above the message with the title, date and time, location, organiser and a Join button for Teams, Meet or Zoom. It also says whether the meeting clashes with anything already in your calendar. The invitation's .ics file is no longer shown as an attachment.
- **Accept**, **Tentative** and **Decline** answer the invitation and update your Google Calendar:
  - From Google Calendar: your response is set on the event, as Gmail does, and Google tells the organiser.
  - From Outlook, Microsoft 365, Exchange and other systems: the meeting is added to your Google Calendar, or updated if it's already there, and Davenport sends the organiser a standard meeting response, as Outlook does. Microsoft time zone names are understood.
  - Untick **Send my response to the organiser** to change only your own calendar.
- Cancellations show as cancelled, with **Remove from calendar** if the meeting is still in it.
- When someone answers an invitation you sent, the email says whether they accepted, declined or tentatively accepted.
- A calendar file that isn't an invitation (a booking or a ticket) gets an **Add to calendar** button.
- **View in calendar** opens the Calendar on that day.

**Forms and interactive emails**
- An email containing a Google Form now offers **Open form**, to fill it in in your browser. For safety, forms are still not filled in inside emails.
- Emails with interactive Gmail-only content (AMP) say so and offer **Open in Gmail**.

## 1.0.20 — 2026-11-18

**Replying**
- Your reply's saved draft no longer appears in the conversation above the box you're typing in, so nothing jumps when it autosaves.
- If a new message arrives in the conversation you're replying to, the reply stays open with everything you've typed. The new message appears collapsed above it, so the page doesn't jump. Before, the reply could close, leaving its draft behind, and the reading pane could even move to a different email.
- Drafts disappear as soon as you click Send or Discard, instead of hanging around in Drafts and in the conversation until the next sync.
- Changing a reply's subject no longer leaves an old copy of the draft behind.
- Continue editing on a saved reply now opens it in the reading pane, still part of its conversation. Before, it opened as a new message and could be sent outside the conversation.

**Tweaks**
- The heading above a conversation shows its topic without "Re:" or "Fwd:", as Outlook does, so it doesn't change as replies come in.

## 1.0.19 — 2026-11-17

**Fixes**
- Delete forever and Empty Bin now really delete messages. Before, Davenport removed them from its own list, but Gmail refused the request because Davenport hadn't asked for permission to permanently delete, so the messages stayed in the Bin online. Davenport now asks for full access to the mailbox, as Outlook does.
- Accounts signed in before this version are asked to sign in again the first time you permanently delete something. You only need to do this once per account. If you'd rather not, nothing is deleted, and Gmail empties the Bin after 30 days as usual.

**For your own Google Cloud project**
- If you use your own OAuth client, add the `https://mail.google.com/` scope to its data access list in place of `gmail.modify`.

## 1.0.18 — 2026-11-05

Davenport is responsive again.

**Fixes**
- The message list had become slow on large mailboxes. 1.0.16 changed the list to show each conversation's latest message, but the database looked conversations up the slow way. With around 20,000 cached messages, each refresh of the Inbox took about 1.4 seconds. The database works on the same thread that handles the window, so while it worked, the window couldn't react to the mouse. That's why hovering and clicks lagged, and it happened every time new mail arrived or a sync finished. Lists now load in 20–50 ms:

  | List (20,000 messages) | 1.0.17 | 1.0.18 |
  |---|---|---|
  | Inbox, Primary tab | 1,450 ms | 49 ms |
  | Inbox, all | 1,396 ms | 26 ms |
  | Unified inbox | 1,378 ms | 32 ms |
  | Folder counts | 48 ms | 33 ms |

- Each sync no longer reloads the folder pane, unread badges and account list when nothing has changed. Before, it did this every 45 seconds or so for each account.
- The first time 1.0.18 starts, it rebuilds one database index. This takes a moment on a big mailbox and only happens once.

## 1.0.17 — 2026-11-03

A full review of the app for bugs and security problems.

**Security**
- Attachments: programs, scripts, shortcuts and disk images (.exe, .js, .lnk, .iso and the rest of Outlook's blocked list) are no longer opened straight from an email; you can still save them. Every attachment Davenport opens or saves is marked as downloaded from the internet, so Windows SmartScreen warns before running it and Office opens it in Protected View.
- Replying to or forwarding an email no longer lets its styles restyle Davenport's window while you write, and its remote pictures don't load while you write if you've blocked pictures (recipients still get them).
- Print and Save as PDF no longer load remote pictures you've blocked, and can't be redirected to another page by the email.
- Outgoing headers are cleaned: a malformed address or a crafted email being replied to can no longer add headers such as Bcc to your message. Invalid addresses are caught when you press Send.
- The engine only accepts requests from Davenport's own windows; web pages get no camera, microphone or location access; test-only switches are ignored in the installed app; the development server is no longer allowed by the production content policy.
- Sign-in ignores stray requests to its local callback instead of cancelling, and checks that Google says which account signed in.

**Fixes**
- Compose: closing the window with ✕ now asks Save / Don't save / Cancel instead of losing what you'd typed since the last autosave. Sending while an autosave is in progress no longer leaves a stray draft.
- Outbox: a message that was sending when Davenport closed is marked so you can check Sent and send it again, instead of being stuck. A message Gmail has accepted is never marked failed by a later hiccup (which risked sending it twice). Failed and scheduled messages have Send again / Send now.
- "Always show pictures from this sender" now works; before, it was saved but not used.
- After a week or more offline (when Gmail's change history has expired), or after a very large number of changes, Davenport now updates every cached message and removes deleted ones, instead of only adding new mail.
- Discarding a draft removes only that draft, not every draft with the same subject.
- Deleting a folder that Gmail refuses to delete reports the problem instead of hiding the folder until the next sync.
- If Google permanently refuses a change, Davenport re-reads those messages so what you see matches Gmail; messages already deleted on the server are dropped quietly.
- Calendar only downloads the dates you browse to, and the regular sync covers two months back to a year ahead, instead of re-downloading everything you've ever looked at every five minutes.
- mailto: links with several addresses, cc and bcc open correctly.
- Task due dates are read as dates, so they no longer shift by a day for people west of the UK.

**About box**
- Rewritten as a standard About box: version, copyright, the MIT License, the website and third-party licences.

## 1.0.16 — 2026-11-02

- Conversation view now works like Gmail and Outlook: each conversation in the message list shows the time and preview of its newest message, including your own replies, and moves up the list when anyone replies. The sender column lists who's in the conversation ("Nicola, me"). The row still stands for the message in that folder, so moving, deleting and archiving work as before.

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
