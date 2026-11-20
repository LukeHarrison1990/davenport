# Using your own Google Cloud project (optional)

Davenport normally signs in with its own Google app: you just choose **Add a Google account** and sign in. You only need this guide if:

- your organisation would rather Davenport signed in as **its own** app (for example an *Internal* app in your Workspace, which needs no Google review and that your admins fully control), or
- you've built Davenport from source without Davenport's Google client.

Either way nothing passes through anyone else's servers. Allow about ten minutes.

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
2. Application type: **Desktop app**. Name: *Davenport desktop* (the same client works on Windows, macOS and Linux).
3. Click **Create**, then **Download JSON**.

In Davenport open **Settings › Accounts › Use your own Google Cloud project instead › Load client JSON file…** and pick the file (in a build without Davenport's client, **Add a Google account** takes you straight there). (Or paste the client ID and secret. Google issues a secret for desktop apps even though it can't be kept truly secret; Davenport also uses PKCE, and stores the secret encrypted.)

Tip for organisations: put the JSON file next to `Davenport.exe` (or in `%APPDATA%\Davenport`) named `oauth-client.json`, and everyone gets connected automatically.

## 4. Google Chat (Workspace only)

Reading Chat works as soon as the Chat API is switched on. Google also requires the project's "Chat app" details before an app can **send messages, add reactions or change your status**. Without them, Google answers *"Google Chat app not found"* and Davenport shows these steps in Chat:

1. Open **APIs & Services › Google Chat API › Configuration** (in the same project as Davenport's OAuth client).
2. Under **Application info**, enter:
   - **App name**: *Davenport* (up to 25 letters and numbers)
   - **Avatar URL**: an `https://` link to a square PNG or JPEG, 256×256 or bigger. Your organisation's logo from its website works, or Davenport's icon once the code is on GitHub (the "raw" link to `build/icon.png`).
   - **Description**: e.g. *Desktop email and chat* (up to 40 characters)
3. Leave **Enable interactive features** turned off. Davenport only uses the API, so no connection settings are needed.
4. Click **Save**. It can take a minute or two to start working.

Chat is included when you sign in to a Workspace account. Accounts added before Davenport 1.1 can switch it on in **Settings › Accounts › Turn on Chat**.

### Chat status

Davenport sets your Chat status (Automatic, Do not disturb, Away, and a status message) through Google's availability API, so it's the same status people see on the web and on phones. This uses the `chat.users.availability` permission. If you turned Chat on before Davenport 1.0.8, Chat shows an **Allow status** button that asks Google for it.

## What Davenport asks Google for

| Permission | Why |
| --- | --- |
| Full access to Gmail (`https://mail.google.com/`) | Your mail, folders (labels), drafts, sending, and permanently deleting messages (Delete forever, Empty Bin) |
| Gmail settings (`gmail.settings.basic`) | Rules as Gmail filters, signatures, automatic replies |
| Calendar (`calendar`) | Events, invitations, free/busy, Meet links |
| Contacts, other contacts, directory | Address book, autocomplete, organisation directory |
| Tasks (`tasks`) | To-Do bar and follow-up flags |
| Drive files Davenport creates (`drive.file`) | Sharing large attachments as Drive links — Davenport can't see your other Drive files |
| Chat (Workspace accounts) | Spaces, messages, reactions, read state, your Chat status |

You can remove access at any time from your Google Account's **Security › Third-party apps** page, or by removing the account in Davenport (which revokes the token).
