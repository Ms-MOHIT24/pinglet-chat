# Pinglet — friend chat preview

Pinglet is a browser-first chat prototype with unique friend codes, QR invites and scanning, searchable saved friendships, friendship labels, one-to-one messaging, customizable themes, an on-device QR camera scanner with image upload fallback, conversation starters, Rock/Paper/Scissors with local score tracking, and a two-player Snake Duel. The responsive interface is designed for desktop and mobile browsers. The web app is also packaged as an Android preview with Capacitor.

## Important limitations

- **Encryption is experimental.** The current ECDH + AES-GCM exchange does not verify identity keys and is not a Signal-protocol implementation or an audited messenger. Do not use it for sensitive conversations.
- **Keys are device-local.** Private keys are stored in this browser's IndexedDB. There is no multi-device key recovery, so signing in on another browser or after clearing site data may make old messages unreadable.
- **Account data uses PostgreSQL.** The Render service reads its database from `DATABASE_URL`. Use a suitable database plan and backups before treating chat history as durable; free hosting/database resources can have limits or expiry.
- **Snake Duel is an in-memory prototype.** Active game rooms reset when the server restarts or the service redeploys.
- No service can promise zero lag or zero bugs. Availability depends on the host, device and network.

## Run locally

Use Node.js 22 or newer and a PostgreSQL database.

1. Install dependencies with `npm install`.
2. Set `DATABASE_URL` to a PostgreSQL connection string.
3. Set `JWT_SECRET` to a random secret containing at least 32 bytes.
4. Optionally set `PUBLIC_URL` to the public HTTPS origin used for QR invites.
5. Start the server with `npm start`.

The server listens on the port provided by the host (or port 3000 locally) and exposes `/health` for health checks.

## Deployment and Android preview

Render deploys the Node.js service from the `main` branch. The GitHub Actions workflow builds a debug APK after relevant app changes and publishes it as the `android-latest` preview release. It is a test build, not a Play Store release.
