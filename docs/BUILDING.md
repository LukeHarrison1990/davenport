# Building Davenport

## Requirements

- Node.js 22 or later
- For Windows installers on Linux or macOS: [Wine](https://www.winehq.org/), 64- and 32-bit
- For macOS builds: a Mac

```bash
npm install
npm run dev          # run with hot reload
npm run typecheck
npm test             # unit tests
npm run e2e          # interface checks against the demo account
npm run dist:win     # Windows installer and portable builds (x64 and Arm64) into release/
npm run dist:mac     # macOS universal .dmg
npm run dist:linux   # AppImage and .deb
```

## Davenport's Google sign-in

Official builds sign in to Google with Davenport's own OAuth client (a *Desktop app* client in the Davenport Google Cloud project), so users don't have to set anything up. The client is **not** in this repository, so copies built by other people don't sign in as Davenport. It's added at build time from either:

1. `oauth-client.json` in the project folder: the JSON file Google Cloud gives you for a Desktop app client. Git ignores this file. Or
2. the `DAVENPORT_CLIENT_ID` and `DAVENPORT_CLIENT_SECRET` environment variables, which the release workflow fills from the repository secrets of the same names.

`npm run build` prints which one it used, or that there's no built-in client. Without one, Davenport asks each user to connect their own Google Cloud project (see [GOOGLE-SETUP.md](GOOGLE-SETUP.md)).

Google treats a desktop app's client secret as not confidential, because anyone can extract it from an installed app. Davenport's sign-in is protected by PKCE and a one-time loopback redirect, as Google recommends for desktop apps. It's kept out of the repository only so that forks use their own Google projects.

## Releasing

1. Add `DAVENPORT_CLIENT_ID` and `DAVENPORT_CLIENT_SECRET` as repository secrets (**Settings › Secrets and variables › Actions**).
2. Update `version` in `package.json` and add a section to `CHANGELOG.md`.
3. Commit, then tag and push: `git tag v1.1.0 && git push origin main v1.1.0`.
4. The **Build** workflow tests, builds the installers and drafts a GitHub release with them attached. Check it over and publish it.

macOS and Linux builds are ready but switched off; set the repository variables `ENABLE_MAC` and `ENABLE_LINUX` to `true` to build them too.
