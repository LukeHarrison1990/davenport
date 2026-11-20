# Security policy

Davenport handles people's email, calendars and contacts, so security reports are taken seriously.

## Reporting a problem

Please **don't** open a public issue. Email **support@davenport-app.com** with:

- what the problem is and what someone could do with it,
- the steps or a proof of concept to reproduce it,
- the Davenport version and operating system.

You'll get a reply within a few days. Once a fix is released, you'll be credited in the changelog if you'd like to be.

## Supported versions

Only the latest release gets security fixes. Davenport updates are published on the [releases page](../../releases).

## How Davenport protects your data

- Davenport talks to Google directly from your computer. There is no Davenport server, and Google data is never sent to the developers or anyone else.
- Sign-in uses Google's own page in your browser, with PKCE and a one-time loopback redirect. Davenport never sees your password.
- Sign-in tokens are encrypted with the operating system's own protection (DPAPI on Windows, the Keychain on macOS).
- Emails are shown in a sandboxed frame with scripts, forms and plugins removed and remote content blocked until you allow it.
- Attachments of dangerous types (programs and scripts) aren't opened directly, and on Windows saved attachments are marked as downloaded from the internet, so Windows checks them before they run.
- The window can only reach Google through the background engine's typed, checked interface.
