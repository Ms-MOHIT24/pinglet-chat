# Pinglet release readiness — current evidence

**Snapshot:** 8 November 2026  
**Repository:** `Ms-MOHIT24/pinglet-chat`  
**Latest merged commit:** `7fc38d6527a9267e74294b0ad638c9ce3221fe21`  
**Decision:** **Not approved for public release.** A successful CI run and a debug APK do not close operational, safety, device, or security review gates.

## Evidence completed

| Gate | Evidence | Status |
|---|---|---|
| Hardening roadmap and device plan | PR #1 merged | Done |
| In-call Report and Block controls and dialog accessibility improvements | PR #1 merged; automated smoke checks passed | Done in code; device behavior not yet verified |
| Message-history pagination beyond 100 messages | PR #2 merged | Done in code |
| Pagination boundary, stable timestamp ordering and malformed-cursor tests | PostgreSQL integration checks passed | Done in automated tests |
| Main-branch validation | GitHub Actions run [#13](https://github.com/Ms-MOHIT24/pinglet-chat/actions/runs/42487789449) passed on the latest merged commit | Passed |
| Android debug preview build | Android workflow [run](https://github.com/Ms-MOHIT24/pinglet-chat/actions/runs/42487789422) passed | Built |
| Android Play target API | Build log reports target SDK 36 | Passed build check |
| Installable Android preview | [Debug APK release](https://github.com/Ms-MOHIT24/pinglet-chat/releases/tag/android-latest) published | Preview only |

## Remaining release blockers

### 1. Infrastructure, database and deployment

- [ ] An accountable adult service owner confirms the Render workspace, service ownership, support coverage and incident responsibility.
- [ ] Inspect the current Render live deployment after the merge; the latest production commit has not been independently verified from this snapshot.
- [ ] Verify the production `/health` endpoint and inspect service events, logs and metrics.
- [ ] Export the production database, validate the export, and restore it into a separate disposable database.
- [ ] Record a rollback plan and an adult owner's decision about database continuity.
- [ ] The last provider-reported database expiry recorded in the prior service inspection was **7 December 2026 at 03:17 IST**. Re-check the provider state before relying on this date; do not wait until the deadline.
- [ ] Decide on a supported database/hosting plan and availability target with the account owner. The current deployment was last observed on a Free plan.

**Why not checked:** the Render workspace has not been selected for this session, production database access was not independently verified, and no backup/restore was performed. Do not perform production mutations from this checklist.

### 2. TURN and call reliability

- [ ] Review and merge the current TURN credential support change only after CI and code review pass.
- [ ] An adult operator selects a trusted TURN provider and approves cost, privacy terms and credential handling.
- [ ] Configure `TURN_URLS`, `TURN_SHARED_SECRET` (at least 32 random bytes), and the optional credential TTL in the server's secret/config store.
- [ ] Verify that the ICE endpoint returns short-lived credentials but never the shared secret.
- [ ] Verify a real relayed call between physical devices on different networks, including a network where direct peer connectivity fails.
- [ ] Confirm microphone/camera tracks stop when a participant leaves and that failure/reconnect behavior is understandable.

**Current limit:** a credential endpoint alone is not a TURN relay. Calls remain STUN-only until a real service is configured and relay use is proved.

### 3. Human safety and moderation

- [ ] Appoint an accountable adult operator and real report reviewers.
- [ ] Configure a monitored child-safety contact address and confirm that someone is responsible for responding.
- [ ] Establish report triage, escalation, evidence access, reviewer coverage, action records, appeals/contact path, and retention rules.
- [ ] Test the report-to-review-to-action process in staging.
- [ ] Keep the moderation secret server-side and verify that only authorised moderators can access the queue.

**Current limit:** the code provides a protected report API, but no staffed human moderation operation or configured public child-safety contact has been verified. The child-safety page explicitly identifies this as unconfigured.

### 4. Security, privacy and policy

- [ ] Commission an independent review of the experimental ECDH/AES-GCM implementation and public-key identity verification.
- [ ] Review password/session lifecycle, account deletion, backup retention and recovery behavior.
- [ ] An accountable operator and qualified reviewer finalise the Privacy Policy, Terms, age rules, consent decisions, data inventory and Data Safety declarations.
- [ ] Confirm data collection and service-provider disclosures against the deployed system.
- [ ] Do not claim audited or identity-verified end-to-end encryption; it has not been established.

**Current limit:** the policy pages are technical drafts, not a substitute for operator/legal review. The app's encryption remains experimental and unaudited.

### 5. Android and Google Play

- [x] The latest Android preview build passed the API 36 target check.
- [ ] Build and verify a signed Release AAB from the exact approved release commit.
- [ ] The four upload-signing secrets are absent from the latest workflow run, so it built a debug APK only. An adult account owner must manage the keystore and secrets.
- [ ] Test the build on a current and an older supported physical Android device.
- [ ] Complete the real-device acceptance plan, including accessibility, network changes, camera/microphone permissions, calls, reporting, blocking and account deletion.
- [ ] Complete Play Console setup, store listing, content rating, target-audience and Data Safety declarations under an adult-owned account.

**Account and testing gates:** Google Play Console account owners must be at least 18. The 12-testers/14-continuous-day closed-test requirement applies to personal developer accounts created after 13 November 2023; the responsible account owner must check which rules apply to their account.

## Safe test instructions

- Use staging and disposable test accounts only.
- Use dummy messages and non-personal display names.
- Do not test with real users' messages, contact details or friend codes.
- Do not treat the debug APK as a Play Store release.
- Do not invite the public or describe Pinglet as secure, audited, actively moderated, or production-ready until the relevant evidence is complete.

## Release decision rule

Any open critical or high-severity privacy, safety, security, reliability or accessibility defect blocks public release. The accountable adult operator must review the evidence and explicitly approve release; that decision cannot be replaced by a green CI run.
