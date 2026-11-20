# Contributing to Davenport

Thanks for helping. Davenport aims to feel familiar to people coming from Outlook while working the way Google Workspace does, so the most useful contributions are bug reports from real use and fixes that keep that balance.

## Reporting a bug or asking for a feature

Open an [issue](../../issues/new/choose) using one of the templates. For bugs, the Davenport version (Settings › About), your operating system and the steps that led to it make all the difference. Please don't paste anything private from your mail.

Security problems should be reported privately: see [SECURITY.md](SECURITY.md).

## Working on the code

```bash
npm install
npm run dev
```

Choose **Explore with sample data** to work against the demo account, which needs no Google sign-in. To sign in to a real account from a source build, connect your own Google Cloud project as described in [docs/GOOGLE-SETUP.md](docs/GOOGLE-SETUP.md). [docs/BUILDING.md](docs/BUILDING.md) explains the build and release process.

How the code is organised:

- `app/main` is the background engine. It owns accounts, the local SQLite cache, sync and every call to Google. The window never talks to Google directly.
- `app/renderer` is the interface (React).
- `app/shared/api.ts` is the typed contract between the two. A new feature usually adds an entry there, a handler in `app/main/ipc.ts`, and the interface that calls it.
- `app/main/demo.ts` holds the demo account's data. If you add a feature, give the demo something to show it with.

## Before opening a pull request

- `npm run typecheck` and `npm test` pass.
- Interface changes pass `npm run e2e` (on Linux, run it under `xvfb-run`), and new behaviour has a check in `scripts/interactions.mjs` where practical.
- Anything users will notice has a line in `CHANGELOG.md`, written for them rather than for developers.
- Words in the interface use plain British English, as the rest of the app does ("Organiser", "Bin", "Favourites").

Keep pull requests focused: one fix or feature each is much easier to review.

## Licence

By contributing you agree that your contributions are licensed under the [MIT License](LICENSE).
