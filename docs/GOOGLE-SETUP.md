# Connecting Davenport to Google (one-time setup)

Davenport signs in to Google as an app that **you** own, in your own Google Cloud project. Nothing passes through anyone else's servers, and no Google review is needed for your own use. Allow about ten minutes.

## 1. Create a project and enable the APIs

1. Go to [Google Cloud Console](https://console.cloud.google.com/) and sign in with the account you'll use (for Workspace, ideally an admin or the account itself).
2. Create a project, for example **Davenport**.
3. Open **APIs & Services › Library** and enable each of these:
   - Gmail API
   - Google Calendar API
   - People API
   - Google Tasks API
   - Google Drive API
   - Google Chat API *(Workspace only — skip for personal Gmail)*

## 2. Configure the consent screen

Open **APIs & Services › OAuth consent screen** (in newer consoles this is **Google Auth Platform › Branding / Audience**).

- **Google Workspace:** choose **Internal**. Anyone in your organisation can then sign in, with no verification needed.
- **Personal Gmail:** choose **External**, leave it in **Testing**, and add your Gmail address (and anyone else who'll use it, up to 100) under **Test users**. Testing-mode sign-ins need repeating every 7 days; to avoid that, publish the app (Google shows an "unverified app" notice for personal use, which you can accept).

App name: *Davenport*. Support email: yours. Scopes can be left blank here — Davenport requests them when you sign in.

## 3. Create the OAuth client

1. Open **APIs & Services › Credentials › Create credentials › OAuth client ID**.
2. Application type: **Desktop app**. Name: *Davenport for Windows*.
3. Click **Create**, then **Download JSON**.

In Davenport choose **Add a Google account › Load client JSON file…** and pick the file. (Or paste the client ID and secret. Google issues a secret for desktop apps even though it can't be kept truly secret; Davenport also uses PKCE, and stores the secret encrypted.)

Tip for organisations: put the JSON file next to `Davenport.exe` (or in `%APPDATA%\Davenport`) named `oauth-client.json`, and everyone gets connected automatically.

## 4. Google Chat (Workspace only)

The Chat API needs a "Chat app" configuration even when you're only reading and sending your own messages:

1. Open **APIs & Services › Google Chat API › Configuration**.
2. Fill in an app name (*Davenport*), an avatar URL (any image URL) and a description.
3. Under **Functionality** you can leave everything unticked. Under **Connection settings** choose **HTTP endpoint URL** and enter any `https://` address — it isn't used. Set visibility to yourself or your organisation and save.

Then in Davenport open **Settings › Accounts › Turn on Chat** and approve the extra permissions.

## What Davenport asks Google for

| Permission | Why |
| --- | --- |
| Read, compose, send and organise Gmail (`gmail.modify`) | Your mail, folders (labels), drafts, sending |
| Gmail settings (`gmail.settings.basic`) | Rules as Gmail filters, signatures, automatic replies |
| Calendar (`calendar`) | Events, invitations, free/busy, Meet links |
| Contacts, other contacts, directory | Address book, autocomplete, organisation directory |
| Tasks (`tasks`) | To-Do bar and follow-up flags |
| Drive files Davenport creates (`drive.file`) | Sharing large attachments as Drive links — Davenport can't see your other Drive files |
| Chat (optional) | Spaces, messages, reactions, read state |

You can remove access at any time from your Google Account's **Security › Third-party apps** page, or by removing the account in Davenport (which revokes the token).
