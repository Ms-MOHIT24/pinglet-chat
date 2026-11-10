# Pinglet release execution runbook

**Snapshot:** 10 November 2026  
**Release decision:** NOT APPROVED for public app launch  
**Repository:** `Ms-MOHIT24/pinglet-chat`

This document turns the outstanding release gates into actions and evidence. It does not grant production approval, perform account-holder actions, or replace qualified legal/security review.

## Current verified state

| Gate | Current evidence | Status |
|---|---|---|
| Signed production Android AAB | The Android workflow contains a signed-AAB path, but it runs only when all four upload-signing secrets exist. The published preview is a debug APK. No production AAB/signature evidence was verified. | Blocked |
| Physical Android testing | No signed release candidate or signed device-acceptance record was supplied. | Outstanding |
| Real TURN relay | Server code can issue time-limited coturn-style credentials when configured. No TURN provider/configuration or relayed-call evidence is present. | Outstanding |
| Independent encryption review | Source code was inspected preliminarily; no independent specialist report exists. | Outstanding |
| Staffed moderation | A report API exists, but named reviewers, coverage, escalation, and an operating process are not established. | Not established |
| Monitored safety contact | No real monitored child-safety contact is configured and verified. | Not configured |
| Privacy/legal review | Policy pages are technical drafts; no qualified sign-off is recorded. | Outstanding |
| Production database backup/restore | No production export or restore was performed. CI exercises use disposable test databases only. | Not verified |

### Infrastructure facts requiring prompt operator attention

- Render reports `pinglet-chat-live` on `main`, with auto-deploy enabled and `/health` configured as its health path. The reported live commit is `d1799538a804ef736d29376cae5d79a1c88963f8`.
- The linked PostgreSQL 18 database was reported `available` on the Free plan, with provider expiry `2026-12-06T21:47:38Z` (**7 December 2026, 03:17:38 IST**). Re-check the provider before relying on this timestamp. An accountable adult owner must decide and execute the continuity plan before expiry.
- Production HTTP health has not been independently verified from an external monitor. Empty metrics are not proof of a healthy service or a down service.
- The fail-closed registration change is in PR #10 and is not deployed. The current production commit therefore must not be described as having that gate.
- The separate static information website being Live does not mean the chat app is open or launch-ready.

## 1. Signed production Android App Bundle

The existing `.github/workflows/android-apk.yml` already contains a conditional signed-AAB path. It requires all four repository secrets:

- `ANDROID_KEYSTORE_BASE64`
- `ANDROID_KEYSTORE_PASSWORD`
- `ANDROID_KEY_ALIAS`
- `ANDROID_KEY_PASSWORD`

The production keystore and Play Console account must remain under the control of the accountable, eligible adult service owner. Do not commit a keystore, paste key material/passwords into chat, or place signing values in source code or build logs.

Execution and evidence:
1. The adult owner confirms the package name, Play App Signing arrangement, version code, release commit, and offline backup of the upload key.
2. The owner configures the four secrets in the repository's protected Actions secret store.
3. Run the Android workflow on the exact reviewed release commit with the production API origin (do not pass a staging origin).
4. Verify that the workflow actually ran the signed `bundleRelease` and upload-artifact steps, and that the AAB exists.
5. Verify the AAB signature/certificate, package ID, version code/name, and target SDK. Record the AAB SHA-256 and the exact source commit.
6. The adult Play Console owner checks that the AAB is accepted by Play Console's internal app-bundle validation. This is distinct from app approval/publication.

The new CI-only bundle-build check in this branch uses a throwaway signing key generated inside the GitHub runner. It tests whether Gradle can produce a signed AAB; it is deliberately not uploaded, published, or reusable as a production signing key. A green result from that job does **not** close this gate.

Google Play Console registration requires the account holder to be at least 18. Account ownership and identity must not be misrepresented. See [Google Play Console sign-up requirements](https://support.google.com/googleplay/android-developer/answer/6112435).

## 2. Physical Android acceptance

Do not infer device acceptance from browser testing, a debug APK, CI, emulator screenshots, or a successful build.

Use two real Android devices spanning a current and an older supported Android release. Record manufacturer/model, Android version, app version, tested commit, date, tester, and outcome. Use staging accounts and dummy data.

Minimum test matrix:
- Install, first launch, restart, update, sign-up/sign-in, sign-out, and account deletion.
- Camera permission allow/deny/revoke; QR scan and image import.
- Microphone permission allow/deny/revoke; voice note record/playback.
- Text chat, friend request/accept/decline, block/unblock, report submission, and report confirmation.
- Voice/video call on same Wi-Fi and across separate networks; switch Wi-Fi/mobile data; lock/unlock; background/foreground; deny permissions; end call and confirm media tracks stop.
- Offline start, temporary API outage, recovery after backend wake, and retry behavior.
- Screen reader, large text, contrast, keyboard/focus, landscape/portrait, and reduced-motion behavior where supported.
- Verify no test account or user-generated content is real production data.

Attach a redacted test report and list every failure. A failed critical privacy, safety, sign-in, reporting, call, or data-deletion test blocks release.

## 3. Real TURN relay testing

A TURN credential endpoint is not itself a TURN relay. Calls are not verified as relayed until a real service is configured and a physical-device call proves relay use.

1. The adult operator chooses a reputable TURN provider after reviewing cost, privacy terms, data location, reliability, and support.
2. Store `TURN_URLS`, `TURN_SHARED_SECRET` (at least 32 random bytes), and optional credential TTL only in the backend secret store. Do not commit or print secret values.
3. Use approved staging first. Authenticate and accept Terms, then confirm the ICE-server response reports TURN configured and includes only short-lived credentials; verify the shared secret is never returned.
4. Place a call between two physical devices on different networks. For a controlled staging test, force relay-only ICE policy if the test harness supports it; inspect WebRTC selected candidate-pair statistics and confirm the selected candidate type is `relay`.
5. Repeat on restrictive networks and after network change/reconnect. Confirm both parties can end the call and microphone/camera tracks stop.
6. Record provider/region, test build, network types, selected candidate-pair evidence, call outcome, latency observations, and failure/reconnect behavior. Redact credentials, IPs, and personal data from logs.

Do not enable public registration or announce calling as production-ready based only on a configured URL or a successful STUN call.

## 4. Independent encryption review

A preliminary source inspection is recorded in [ENCRYPTION_PRELIMINARY_REVIEW.md](ENCRYPTION_PRELIMINARY_REVIEW.md). It is not an independent audit and must not be represented as one.

Before handling sensitive conversations:
- Have an independent cryptography/security specialist review the complete client and server design, key lifecycle, identity authentication, message/voice payload paths, browser storage, account recovery, deletion, and threat model.
- Require a written report with severity-ranked findings, reproducible tests, fixes, and retest results.
- Prefer a well-reviewed, maintained messaging protocol/library over expanding a custom cryptographic protocol. Any migration requires specialist design and compatibility testing.
- Until the review and fixes are complete, retain the UI warning that encryption is experimental and friend identity keys are not verified. Do not claim audited, identity-verified, or Signal-equivalent end-to-end encryption.

## 5. Staffed moderation

Code does not create a moderation team. Before any public access, the accountable operator must appoint real reviewers and document:
- who reviews reports, who covers absence, and who can make urgent safety decisions;
- how often the queue is checked and the response targets for routine and urgent reports;
- triage categories, escalation route, evidence access, preservation/deletion rules, action records, appeals, and account restrictions;
- a staging exercise from report submission through human review, action, and user-facing outcome;
- access control and rotation procedure for `REPORTS_ADMIN_TOKEN`, held only as a backend secret.

Do not use a fake name, unattended inbox, placeholder contact, or an unstaffed API endpoint as evidence of moderation. Record the responsible team's approval and the date the operational test passed.

## 6. Monitored child-safety contact

The responsible operator must provide a real service-controlled contact address and assign people who monitor it. Verify that:
- messages reach the intended team and are acknowledged;
- urgent reports have an escalation path and backup coverage;
- the public Child Safety Standards page and Play Console use the same working contact;
- the team can preserve only necessary evidence, restrict access, and follow the approved response/retention process.

Do not publish a personal contact address without the owner's consent. Do not mark this gate complete until an end-to-end delivery test and monitoring ownership are recorded.

## 7. Privacy and legal review

A qualified reviewer familiar with the jurisdictions and intended audience must inspect the real deployed product and its vendors. Review at least:
- age/audience and consent model; data collected from users and devices;
- messages, voice recordings, friend codes, identifiers, reports, logs, analytics, IP/network information, and retention;
- hosting, database, TURN, email/support and other processor/subprocessor disclosures;
- purpose, lawful basis/consent where applicable, user rights, access/correction/deletion, backup expiry, and incident response;
- Privacy Policy, Terms, Child Safety Standards, account-deletion flow, Play Data safety answers, store listing, and actual implementation.

Record reviewer identity/qualification, jurisdictions covered, document versions, findings, remediation, and sign-off date. This repository checklist is not legal advice and cannot supply a legal approval.

## 8. Production database backup and restore

The production database is a separate operational risk and has not been backed up or restored in this inspection. The last provider read reported PostgreSQL 18 on a Free plan expiring 7 December 2026 at 03:17:38 IST. Treat this as time-sensitive and re-check the live provider state.

The accountable adult owner must:
1. Choose and approve a supported database continuity plan before expiry. Consider a new database, storage, retention, access control, region, recovery objectives, and cost.
2. Use a secure, owner-approved connection path. Do not broaden the database IP allowlist to the public internet merely to make a tool connect. Never paste connection strings or credentials into chat, GitHub, shell history, or logs.
3. Use PostgreSQL 18-compatible client tools. Create a custom-format export with restrictive file permissions, then calculate and record a SHA-256 checksum.
4. Verify the archive is readable with `pg_restore --list`.
5. Restore into a separate, empty, non-production database. Never test a restore by overwriting production.
6. Compare core table counts and constraints, run application integration checks against the restored copy, and record any excluded data/extensions.
7. Store the backup encrypted with limited access and a documented retention/deletion policy. Keep the key separately from the archive.
8. Record source database identifier, timestamp, tool versions, archive size/hash, target database identifier, restore timestamp, validation results, and operator approval.

The existing GitHub Actions backup/restore rehearsal is intentionally restricted to disposable CI loopback databases. It is valuable regression coverage, not production backup evidence.

## Required sign-off record

Complete this record with the accountable owner and actual evidence links. Do not fill fields with assumed values.

| Gate | Evidence link / artifact hash | Responsible reviewer/operator | Date | Result |
|---|---|---|---|---|
| Signed production AAB | | | | |
| Physical Android acceptance | | | | |
| Real TURN relay | | | | |
| Independent encryption audit and retest | | | | |
| Staffed moderation exercise | | | | |
| Monitored child-safety contact test | | | | |
| Privacy/legal sign-off | | | | |
| Production backup and successful restore | | | | |

**Release rule:** every gate above must have real evidence and accountable sign-off. A passing build, a public website, a CI database fixture, or an AI/source-code review is not a substitute. Keep the app closed to public registration until the human, safety, privacy, security, and recovery gates are complete.
