# Pinglet — friend chat preview

Pinglet is a browser-first social chat prototype with unique friend codes, QR invites and an in-app QR scanner, saved friendships, one-to-one messaging, custom themes, mini-games, push-to-talk voice messages, and private voice/video rooms. The interface is responsive on desktop and mobile. A Capacitor Android preview is built from the same web app.

## Current features

- **Account safety:** Terms acceptance, report and block controls, blocked-account management, account deletion from inside the app and from a public web page, and a protected moderation-report API. New account registrations are closed by default and require an explicit operator-controlled opt-in.
- **Policy pages:** Terms of Use, Privacy Policy, Child Safety Standards and external account deletion pages. These are drafts until the responsible service operator finalises contact and retention details.
- **Android packaging:** the Capacitor app bundles the web UI locally and connects to the hosted API; it no longer depends on loading the hosted website as its app screen.

- **Free-host wake-up handling:** read-only API requests retry temporary 502/503/504 and network failures while the free service is starting. Render may still show its own cold-start screen for about a minute after idle periods.
- **Animated web and Android experience:** shared motion design for screen transitions, buttons, navigation, friend lists, chat bubbles, cards, calls and ambient backgrounds. Motion respects the device's reduced-motion setting. The Android Capacitor shell bundles the interface locally and connects to the hosted API, so the app screen can open independently of the hosted website.

- **Rock, Paper, Scissors:** animated countdown and reveal, win/loss/tie feedback, local score tracking, and a direct entry from the home screen, Games tab, or `/games`.
- **Snake Duel:** a two-player online mini-game with server-authoritative movement.
- **Call Rooms:** create a voice-only or video room and invite up to four participants using a four-digit code. Toggle the microphone/camera, copy the room code, use reactions, and leave the room. The direct entry is `/call-rooms`.
- **Walkie-talkie voice messages:** press and hold the microphone button in a chat to record; release to send. Clips are limited to eight seconds and 30 KB, encrypted before storage, and playable in the conversation.
- **Friend connections:** unique friend codes, QR invites, saved friends, searchable contacts, labels, and requests.
- **Themes and conversation starters:** personal browser themes and quick prompts.

## Important limitations

- **Not yet Play Store approved or release-ready.** Automated builds are previews. A signed release App Bundle, adult-operated Play Console account, verified policy declarations, live child-safety contact, staffed report review, and hands-on device testing are still required. The server accepts new accounts only when `PUBLIC_SIGNUPS_ENABLED=true`; leave this variable unset until the responsible operator approves public registration.
- **Moderation is not staffed by code.** Reports can be stored and accessed through a protected API, but the service operator must configure `REPORTS_ADMIN_TOKEN`, appoint reviewers, publish a monitored child-safety contact, and run a real response/escalation process.

- **Encryption is experimental.** The current ECDH + AES-GCM exchange does not verify identity keys and is not a Signal-protocol implementation or an audited messenger. Do not use it for sensitive conversations.
- **Keys are device-local.** Private keys are stored in this browser's IndexedDB. There is no multi-device key recovery, so signing in on another browser or after clearing site data may make old messages unreadable.
- **Voice/video calls use peer-to-peer WebRTC with STUN discovery.** No TURN relay is configured yet, so some restrictive networks may not establish a call. A production rollout should configure a trusted TURN provider.
- **Call rooms are temporary and in-memory.** Four-digit codes work only while the room is active, up to four participants can join, and a service restart/redeploy ends active rooms.
- **Voice messages use the existing experimental encryption.** Keep recordings short; browser microphone permission is required.
- **Snake Duel rooms are also in-memory** and reset when the server restarts or redeploys.
- **Account data uses PostgreSQL.** Use a suitable database plan and backups before treating chat history as durable; free hosting/database resources can have limits or expiry.
- No service can promise zero lag or zero bugs. Availability depends on the host, device and network.

## Run locally

Use Node.js 22 or newer and a PostgreSQL database.

1. Install dependencies with `npm install`.
2. Set `DATABASE_URL` to a PostgreSQL connection string.
3. Set `JWT_SECRET` to a random secret containing at least 32 bytes.
4. Optionally set `PUBLIC_URL` to the public HTTPS origin used for QR invites.
5. Start the server with `npm start`.

The server listens on the port provided by the host (or port 3000 locally) and exposes `/health` for health checks.

## Checks and deployment

Run `node --check server.js`, `node --check public/app.js`, `node scripts/smoke-check.js`, and `node scripts/api-integration-check.js` (the integration test expects a disposable PostgreSQL database) before deploying.

The GitHub Actions workflow runs syntax checks, static feature checks, PostgreSQL-backed API integration checks and an Android API target check. It always builds a debug APK preview; it only builds a signed Play Store AAB when all four Android upload-key secrets (`ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`) are configured. Never commit the keystore or passwords. A debug APK is not a Play Store release.

Render serves the Node.js app from the `main` branch. Check the Render Events page and verify the deployed commit after publishing a new build.


## Chat composer usability

Unsent chat drafts stay attached to the selected friend while switching conversations during the current session. Drafts are kept in memory only (not written to local storage) and are cleared on sign-out. The Send control stays disabled until a conversation and non-empty message are ready.


## Play Store release gates

See [docs/PLAY_STORE_RELEASE_CHECKLIST.md](docs/PLAY_STORE_RELEASE_CHECKLIST.md) before any public release. It lists the remaining adult-operator, child-safety, moderation, legal/privacy, signing, testing, and infrastructure requirements. The current Terms and Privacy pages are technical drafts, not legal advice.
