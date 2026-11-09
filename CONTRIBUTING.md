# Contributing to Pinglet

Thanks for considering a contribution. Pinglet is a browser-first social chat project; changes should improve real user safety, reliability, accessibility, or maintainability.

## Before starting

- Check the README and the Play Store release checklist for current capabilities and known limitations.
- Search existing issues and pull requests before opening a duplicate.
- For a substantial change, open an issue first to discuss the problem and intended approach.
- Keep changes focused. Do not add dependencies, paid services, telemetry, or infrastructure costs without explaining the need and getting maintainer approval.
- Never include passwords, API tokens, database URLs, signing keys, production exports, real user messages, or other personal data in commits, issues, screenshots, or test fixtures.

## Development setup

Use Node.js 22 or newer and a disposable PostgreSQL database. Follow the local setup steps in the README. Do not point tests or experiments at production.

## Checks before opening a pull request

Run the checks relevant to your change:

```sh
npm ci
node --check lib/origin-policy.js
node --check server.js
node --check public/app.js
node scripts/smoke-check.js
```

The API integration test requires a disposable PostgreSQL database and the test environment variables documented in the GitHub Actions workflow:

```sh
node scripts/api-integration-check.js
```

The workflow also verifies Android runtime/CSP generation and the CI-only database backup/restore rehearsal. Run the Android preview workflow when changing Android packaging, permissions, runtime configuration, or native integration.

## Pull request expectations

Include:

1. The user problem and why the change is needed.
2. A concise description of the implementation.
3. Tests run and their results (including anything not tested).
4. Screenshots or a short recording for visible UI changes, using synthetic/demo data only.
5. Any privacy, security, accessibility, migration, or compatibility impact.

Keep pull requests small enough to review. Do not merge your own change merely because CI is green. Wait for maintainer review and resolve requested changes.

## Safety and privacy

- Preserve report, block, account deletion, and child-safety safeguards.
- Do not weaken authentication, authorization, rate limits, origin checks, or input validation to make a test pass.
- Treat message encryption as experimental unless an independent security review establishes otherwise. Do not describe it as audited or Signal-equivalent.
- Do not add features that expose private conversations, friend codes, call-room codes, report contents, or account details to unintended users.
- Use synthetic accounts and data for development and tests.

## Release discipline

A passing CI run or debug APK is not a production release. Follow `docs/PLAY_STORE_RELEASE_CHECKLIST.md`; production releases require the responsible operator's review of safety, privacy, signing, moderation, backups, and Play Console declarations.
