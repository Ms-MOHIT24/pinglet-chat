# Pinglet — friend chat preview

Pinglet is a browser-first social chat prototype with unique friend codes, QR invites and an in-app QR scanner, saved friendships, one-to-one messaging, custom themes, mini-games, push-to-talk voice messages, and private voice/video rooms. The interface is responsive on desktop and mobile. A Capacitor Android preview is built from the same web app.

## Current features

- **Animated web and Android experience:** shared motion design for screen transitions, buttons, navigation, friend lists, chat bubbles, cards, calls and ambient backgrounds. Motion respects the device's reduced-motion setting. The Android Capacitor shell uses the hosted web app, so the same interface is shown on both platforms.

- **Rock, Paper, Scissors:** animated countdown and reveal, win/loss/tie feedback, local score tracking, and a direct entry from the home screen, Games tab, or `/games`.
- **Snake Duel:** a two-player online mini-game with server-authoritative movement.
- **Call Rooms:** create a voice-only or video room and invite up to four participants using a four-digit code. Toggle the microphone/camera, copy the room code, use reactions, and leave the room. The direct entry is `/call-rooms`.
- **Walkie-talkie voice messages:** press and hold the microphone button in a chat to record; release to send. Clips are limited to eight seconds and 30 KB, encrypted before storage, and playable in the conversation.
- **Friend connections:** unique friend codes, QR invites, saved friends, searchable contacts, labels, and requests.
- **Themes and conversation starters:** personal browser themes and quick prompts.

## Important limitations

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

Run `node --check server.js`, `node --check public/app.js`, and `node scripts/smoke-check.js` before deploying.

The GitHub Actions workflow runs the syntax and feature smoke-checks, then builds a debug APK and publishes it as the `android-latest` preview release. It is a test build, not a Play Store release.

Render serves the Node.js app from the `main` branch. Check the Render Events page and verify the deployed commit after publishing a new build.
