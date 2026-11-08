# Pinglet — Google Play release gate checklist

**Release candidate:** 1.9.0  
**Android application ID:** `com.pinglet.chat`  
**Current repository:** `Ms-MOHIT24/pinglet-chat`  
**Status:** Not approved for production submission. This checklist records implementation work and gates that still require an accountable adult service operator.

## Automated engineering gates

- [x] GitHub Actions syntax, smoke and PostgreSQL-backed API integration checks passed on merge commit `7fc38d6527a9267e74294b0ad638c9ce3221fe21` (run `42487789449`).
- [x] Android preview build passed on the same commit (run `42487789422`); generated Android target SDK was verified as **36**.
- [ ] Build and verify a signed Release AAB. The current workflow produced only a debug APK because adult-controlled upload-signing secrets are not configured.
- [ ] Test the Android build on real devices (at least one current Android version and one older supported version).
- [ ] Exercise sign-up, sign-in, friend request/accept/decline, QR camera and image import, chat text, voice notes, RPS, Snake Duel, voice call, video call, report, block, unblock, and in-app/external deletion manually.
- [ ] Configure an approved TURN provider and the server-side `TURN_URLS` / `TURN_SHARED_SECRET` settings, then verify relayed calls on multiple networks. A credential endpoint is proposed in the current engineering PR, but no TURN provider is configured and restrictive networks may still fail.
- [ ] Verify the native app starts with the local bundled UI while the API is unavailable, then recovers when the backend wakes.
- [ ] Verify invite links, camera/microphone permissions, keyboard behavior, screen readers, contrast, text scaling, and reduced motion on physical devices.

## Security, privacy, and user safety — production blockers

- [ ] An adult operator owns the service, the Google Play Console account, infrastructure, keys, user support, and legal/policy decisions.
- [ ] Configure a monitored child-safety contact and publish it on the Child Safety Standards page and in Play Console.
- [ ] Appoint people who can review reports. The current code has a protected report API, but no staffed moderation operation or moderation dashboard. Define review coverage, escalation, response targets, evidence handling, appeal/contact path, and incident records before inviting real users.
- [ ] Configure a strong `REPORTS_ADMIN_TOKEN` in the service environment and store it only in the operator's secret manager. Do not put it in source control, APKs, screenshots, or client code.
- [ ] Review the reporting flow, block enforcement, moderator access, data retention, and abuse escalation with the responsible operator. Do not describe the report queue as actively moderated until a human process is operating.
- [ ] Have the Privacy Policy and Terms of Use reviewed and finalised by the responsible operator. Current pages are technical drafts and explicitly say they are not legal advice.
- [ ] Set clear account age rules, audience declarations, parental-consent requirements where applicable, and child-safety procedures. Do not select a child or teen audience in Play Console until the product and operations meet all applicable requirements.
- [ ] Complete an accurate Google Play Data safety form, including account data, identifiers, messages/voice payloads, user reports, camera/microphone use, local storage, service providers, security practices, and deletion/retention.
- [ ] Confirm report retention and backup deletion windows. Current account deletion removes account-linked messages, friendships, and requests; reports about a deleted reported account are de-identified by clearing that subject link.
- [ ] Commission an independent review of the experimental ECDH/AES-GCM message design. Public-key identity is not verified and private keys are browser/device-local; do not market it as audited or verified end-to-end encryption.
- [ ] Decide whether to add TURN relay, persistent/recoverable call rooms, account recovery, and multi-device key migration before public launch.
- [ ] Verify backend durability, database backups, restore procedures, incident response, and availability. Render Free services can sleep and are not an appropriate production availability plan without an explicit operational decision.

## Android signing and Play Console setup

- [ ] Create/verify the application in an adult-owned Play Console account. Google requires the account owner to be at least 18.
- [ ] Generate and securely back up an Android upload keystore under the adult operator's control. Never commit it to GitHub.
- [ ] Configure GitHub Actions repository secrets: `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, and `ANDROID_KEY_PASSWORD`. The workflow builds a signed Release AAB only when all four secrets exist.
- [ ] Confirm Play App Signing setup and retain an offline backup of the upload key.
- [ ] Confirm the signed App Bundle is generated from the exact commit being submitted. The preview APK is a debug build and is not a Play Store upload.
- [ ] Complete store listing: app name, short/full descriptions, screenshots, feature graphic, app icon, support/contact details, privacy URL, app access/reviewer instructions, content rating, target audience, ads declaration, data safety, and data-deletion URL.
- [ ] If this is a new personal developer account created after 13 November 2023, complete the closed test with at least 12 continuously opted-in testers for 14 days, then request production access.
- [ ] Review the final Play Console policy declarations and submit only after all safety, privacy, quality, and operational blockers are closed.

## Current known technical limitations

1. The backend still runs on Render Free. The native UI is bundled locally, but user accounts, messages, games and calls still depend on the hosted API.
2. Calls currently use STUN only. A server-side, short-lived TURN credential flow is proposed separately; it does not provide relay connectivity until an adult operator configures a trusted TURN service.
3. Call-room and Snake Duel live state is held in memory and can reset after a server restart or deploy.
4. Message encryption is experimental and has not been independently audited; there is no verified identity-key exchange or cross-device private-key recovery.
5. The report queue is protected by an environment secret, but an actual human moderation operation and public safety contact are not configured by code alone.

**A successful CI run or APK preview is not proof of Play Store approval.** Only the responsible account owner can complete Play Console identity, declarations, signing, testing, and submission.
