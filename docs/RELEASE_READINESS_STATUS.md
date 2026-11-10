# Pinglet release readiness — current evidence

**Snapshot:** 9 November 2026  
**Repository:** `Ms-MOHIT24/pinglet-chat`  
**Latest merged commit:** `d1799538a804ef736d29376cae5d79a1c88963f8` (PR #4)  
**Decision:** **Not approved for public release.** A merged engineering change and green branch CI do not prove production deployment, data recoverability, real TURN relay operation, device acceptance, staffed moderation, or audited encryption.

## Evidence completed

| Gate | Evidence | Status |
|---|---|---|
| Hardening roadmap and device plan | PR #1 merged | Done in code; device behavior still needs testing |
| In-call Report and Block controls and dialog accessibility improvements | PR #1 merged; smoke checks passed | Done in code; device behavior still needs testing |
| Message-history pagination beyond 100 messages | PR #2 merged; PostgreSQL integration tests cover page boundaries and cursors | Done in code and automated tests |
| Stability, environment-origin isolation, TURN credential endpoint and graceful shutdown | PR #4 merged as `d1799538a804ef736d29376cae5d79a1c88963f8` | Merged; production deployment not verified |
| Combined engineering validation | GitHub Actions run [#61](https://github.com/Ms-MOHIT24/pinglet-chat/actions/runs/42514027660) passed on PR head `d428cdf539c74216f25bf1764ff6fb0675c58bd1` | Passed before merge; merge-commit checks still need verification |
| Android preview and target API | Prior preview build succeeded and generated target SDK 36 | Preview only; current merged code still needs a fresh build |

## Remaining release blockers

### 1. Infrastructure, database and deployment

- [ ] Verify a successful validation workflow on the exact merged `main` commit.
- [ ] Deploy the merged code only after backup/restore evidence, review and an approved deployment window.
- [ ] Verify the production `/health` endpoint from an external monitor and inspect startup logs, request metrics and service events.
- [ ] Export the production database, validate the archive, and restore it into a separate disposable database. This has **not** been done.
- [ ] Record rollback steps and the database continuity decision before the provider expiry.
- [ ] Read-only Render inspection on 9 November 2026 found `pinglet-chat-live` still on the Free plan, with one instance, auto-deploy from `main`, build command `npm install`, and health path `/health`. The last deployment listed as Live was commit `858d883bb8161d3f79e927720d025234018619d7`, not the merged PR #4 commit.
- [ ] The linked Free PostgreSQL 18 database was reported `available`, with provider expiry `2026-12-06T21:47:38Z` (**7 December 2026, 03:17:38 IST**). Recheck this exact provider state before acting.
- [ ] Service metrics returned no samples in the queried 24-hour window, and the query for `/health` request logs returned none. Treat live HTTP health as unverified, not healthy.
- [ ] A read-only SQL inspection was blocked because the database IP allowlist is empty. No allowlist change was made and no SQL data was read.
- [ ] A second legacy Free service named `pinglet-chat` remains in the workspace; its latest listed deployment failed and it has no configured health-check path. Confirm ownership and usage before considering cleanup.
- [ ] Decide on a non-sleeping web-service plan, a recoverable database plan, a measured availability target and external monitoring.

**What was not done:** no production export, restore, infrastructure change, plan change, deployment, or resource deletion occurred during this inspection.

### 2. TURN and call reliability

- [x] PR #4 added an authenticated, Terms-gated endpoint for short-lived coturn-style credentials.
- [ ] Review the additional TURN URI validation follow-up before relying on it.
- [ ] An operator selects a trusted TURN provider and approves its cost and privacy terms.
- [ ] Configure `TURN_URLS`, `TURN_SHARED_SECRET` (at least 32 random bytes), and the optional credential TTL in the server secret store.
- [ ] Verify a real relayed call between physical devices on different networks, including a network where direct connectivity fails.
- [ ] Confirm microphone/camera tracks stop on participant exit and reconnection behavior is clear.

**Current limit:** a credential endpoint is not a TURN relay. Calls remain dependent on STUN until a real relay service is configured and successfully tested.

### 3. Human safety and moderation

- [ ] Appoint an accountable service operator and real report reviewers.
- [ ] Configure a monitored child-safety contact and response responsibility.
- [ ] Establish report triage, escalation, evidence access, reviewer coverage, action records, appeals/contact path and retention rules.
- [ ] Test the report-to-review-to-action process in staging.
- [ ] Verify that only authorised moderators can access the moderation queue.

**Current limit:** the code has a protected reporting API, but no staffed human moderation operation or configured public child-safety contact has been verified.

### 4. Security, privacy and policy

- [x] Dependency audit: `npm audit --audit-level=low` passed on run [#79](https://github.com/Ms-MOHIT24/pinglet-chat/actions/runs/42613545842) on the current dependency lockfile; the log reported **0 vulnerabilities**.
- [ ] Commission independent review of experimental ECDH/AES-GCM encryption and public-key identity verification.
- [ ] Review password/session lifecycle, account deletion, backup retention and recovery behavior.
- [ ] Have qualified reviewers finalise the Privacy Policy, Terms, age rules, consent decisions, data inventory and Data Safety declarations.
- [ ] Confirm service-provider disclosures against the deployed system.
- [ ] Do not claim audited or identity-verified end-to-end encryption.

**Current limit:** encryption is experimental and unaudited; policy pages are technical drafts.

### 5. Android and Google Play

- [ ] Build and verify a signed Release AAB from the exact approved release commit.
- [ ] Verify the upload-signing secrets and keystore through the account owner; the previous workflow produced a debug APK only.
- [ ] Test on a current and an older supported physical Android device.
- [ ] Complete the real-device acceptance plan: accessibility, network changes, camera/microphone permissions, calls, reporting, blocking and deletion.
- [ ] Complete Play Console setup, store listing, content rating, target-audience and Data Safety declarations under the appropriate account owner.

## Current engineering follow-up

The corrective changes are in open PR #6 on `fix/pinglet-post-merge-review-2026-11-09`. The PR is not merged or deployed. The current head after the dependency-audit workflow change is `acf5ce9826b0e456e0afd28a87391fc6e56f46fc`.

The change set covers:
- close and remove partially-created WebRTC peers when connection setup fails;
- strictly parse TURN URIs and reject embedded credentials, malformed hosts/ports and unsupported query parameters;
- constrain the disposable backup/restore rehearsal to GitHub Actions CI and the exact fixture database names, loopback host, port and user;
- reject non-default HTTPS ports in Android API-origin configuration;
- add regression checks for those cases;
- trigger main validation and Android preview workflows when `lib/**` changes;
- improve cold-start readiness checks and saved-session retry feedback;
- refresh interactive service-worker assets network-first;
- simplify mobile navigation by grouping secondary controls in More;
- run a full lockfile-based npm dependency audit during validation.

GitHub Actions validation run [#79](https://github.com/Ms-MOHIT24/pinglet-chat/actions/runs/42613545842) passed on commit `acf5ce9826b0e456e0afd28a87391fc6e56f46fc`. The audit step reported **0 vulnerabilities**. The complete job also passed JavaScript syntax, feature smoke checks, PostgreSQL-backed API integration, Android runtime/CSP generation checks, and the CI-only disposable database backup/restore rehearsal.

**Still outstanding:** no human review or inline review threads are recorded on PR #6; the Android APK/AAB workflow was not run on this PR head; no signed Play Store AAB or physical-device acceptance test is available; no production database backup/restore or external production-health verification has been completed. The successful CI run is engineering evidence, not release approval.
 
## Safe test instructions

- Use staging and disposable accounts only.
- Use dummy messages and non-personal display names.
- Never use production user content as a test fixture.
- Do not treat a debug APK as a Play Store release.
- Do not invite the public or describe Pinglet as secure, audited, actively moderated or production-ready until the relevant evidence is complete.

## Release decision rule

Any open critical or high-severity privacy, safety, security, reliability or accessibility defect blocks public release. A successful CI run cannot replace external health checks, a verified production restore, human review, physical-device testing or explicit operator approval.

## Latest operational recheck — 10 November 2026

This section supersedes any earlier statement that the merged PR #4 commit had not yet been deployed. It records the latest read-only provider checks; it does **not** approve public release.

### Render website

- [x] The independent Static Site `pinglet-website` is configured to deploy from `website/landing-page`, publishing `site/`.
- [x] The latest checked website deployment is Live on commit `4b806b4d24e64b2d4bfc5011c82aaeeca87ab56c` (Render deploy `dep-dbpd4mon74is73dkbjtg`).
- [x] GitHub validation run [#90](https://github.com/Ms-MOHIT24/pinglet-chat/actions/runs/42780958882) passed on the same commit. This includes the public-site smoke test, app smoke checks, PostgreSQL integration tests, Android runtime/CSP generation checks, and the disposable CI-only database backup/restore rehearsal.
- [x] The public website explicitly describes itself as informational, displays the app launch status, links to the privacy/safety status page, and keeps the Android download disabled while no approved signed APK URL is configured.
- [ ] Visual and physical-device review of the deployed site on current mobile and desktop browsers remains outstanding.

### Render production backend and database

- [x] Read-only Render inspection confirms `pinglet-chat-live` remains on `main`, Free plan, one configured instance, auto-deploy enabled, and HTTP health path `/health`.
- [x] Render reports the current live deployment as commit `d1799538a804ef736d29376cae5d79a1c88963f8` (PR #4 merge), deploy `dep-dbpd2n0n74is73dk65sg`, completed successfully on 10 November 2026.
- [ ] A verified external HTTP response from `/health` is still outstanding. The Render HTTP request-count and latency metrics returned empty series in the inspected 24-hour window, and the log retrieval API was unavailable during the check. A failed external network lookup from the inspection environment is not proof that the service itself is down or up.
- [ ] Production database export, archive validation, and restore into a separate disposable database have **not** been performed. The successful CI backup/restore test uses disposable workflow databases and is not a production backup.
- [ ] The linked PostgreSQL 18 database is reported `available` on the Free plan, with provider expiry `2026-12-06T21:47:38Z` (**7 December 2026, 03:17:38 IST**). The responsible account owner must choose and complete an approved continuity plan before that time.
- [ ] The legacy Render web service `pinglet-chat` remains present on `main`; its only listed deployment failed with exit status 12 and it has no health-check path. Its traffic/use is unknown. Do not delete or reconfigure it until the service owner confirms whether anything depends on it.

### Android release and human operating requirements

- [ ] The published GitHub artifact remains the prerelease `Pinglet Android Preview` containing `app-debug.apk`; it is not a signed production APK or Play Store AAB. The website download remains intentionally disabled.
- [ ] An eligible adult account owner must control Play Console identity, the upload keystore, signing secrets, production infrastructure decisions, privacy/legal approvals, and incident responsibility. Do not put signing keys, account passwords, or secret values in this repository or in chat.
- [ ] Google Play's current UGC policy requires robust, ongoing moderation, terms acceptance, in-app reporting, blocking for one-to-one interaction, and appropriate action on reported content/users. Pinglet's code does not by itself provide staffed reviewers or a monitored public child-safety contact.
- [ ] The responsible adult operator must provide verifiable evidence of reviewer coverage, escalation and retention procedures, and an actually monitored child-safety contact before the app is opened to the public.
- [ ] The intended age group, consent model, app content rating, and Data safety declarations must be selected and reviewed against the actual product and applicable Play policies. Do not falsify age or audience declarations.
- [ ] Real-device acceptance, a real TURN provider and relayed-call tests, and an independent review of the experimental message-encryption design remain outstanding.

**Release decision remains: NOT APPROVED for public app launch.** The static website is published. Automated engineering checks are passing on the recorded commits. Production recoverability, externally verified service health, human moderation, final policy/legal review, signed Android release, and device/security acceptance remain open. A green dashboard or CI run cannot substitute for these checks.

