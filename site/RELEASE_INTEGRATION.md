# Android website download integration

The public Android button reads `site/release-config.js`.

- Keep `downloadUrl` empty while there is only a debug or preview APK. The site then keeps the download button disabled.
- An accountable adult service operator must approve the release, own the signing process and verify the final APK on supported physical devices.
- Once a signed APK has been approved, set `downloadUrl` to its direct GitHub Releases asset URL. The website only enables a URL on the Pinglet repository's HTTPS `/releases/download/` path ending in `.apk`.
- Set `version` to the user-facing version label.
- Commit the config change to `website/landing-page`; Render auto-deploys that branch. No merge to `main` is needed.
- Do not point this button at `android-latest/app-debug.apk`. A signed Android App Bundle (`.aab`) is intended for Play distribution and is not a direct-install APK.

The config file is public website code. It must never contain keystore data, passwords, API secrets, tokens or private information.
