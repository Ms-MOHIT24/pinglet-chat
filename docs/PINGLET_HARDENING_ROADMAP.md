# Pinglet hardening roadmap

**Snapshot date:** 8 November 2026  
**Repository:** `Ms-MOHIT24/pinglet-chat`  
**Branch:** `main` is production-connected; this document is a work plan only.  
**Release status:** Not approved for public production release.

This roadmap groups the agreed work into six tracks and orders them by risk. Completing a checklist item requires evidence (a test result, a reviewed decision, or an operator record); a code change or green CI run alone is not evidence that a live service is safe.

## Verified starting position

| Area | Observed position | What remains unverified |
|---|---|---|
| GitHub / CI | Latest observed run succeeded on commit `f638e7f5a049c7639fcb7cbf6a76fbbfa85c0718` on 7 Nov 2026. | No CI run has yet tested this roadmap branch. |
| Render web service | `pinglet-chat-live` is configured for `main`, auto-deploy enabled, Free plan. Latest observed live deploy was commit `858d883bb8161d3f79e927720d025234018619d7` on 7 Nov 2026. | The currently served runtime was not independently verified; logs/metrics did not provide enough evidence to declare it healthy. |
| PostgreSQL | `pinglet-chat-db` reported available, Free plan, Singapore region, PostgreSQL 18. The provider reported expiry at `2026-12-06T21:47:38Z`. | Backup existence, export integrity, restore procedure and data integrity have not been verified. |
| Dependency reproducibility | Root `package.json` exists; no root `package-lock.json` was present in the inspected repository listing. CI uses `npm install`. | Exact deployed dependency tree and reproducible install are not pinned by a committed lockfile. |
| Encryption / identity | The app uses an experimental ECDH + AES-GCM design. | Public-key identity is not verified; there has been no independent cryptographic audit or multi-device key recovery test. |
| Moderation | Report submission and a protected report queue exist in code. | No staffed review operation, public monitored child-safety contact or verified response process was established by this inspection. |
| Calls / games | Socket.IO signaling and real-time features exist. Call and Snake Duel state is in memory; calls use STUN without a configured TURN relay. | Cross-network call success, relay behavior, restart handling and real-device quality remain untested. |
| Device / accessibility | Automated syntax, smoke, database-backed integration and Android packaging checks exist. | No physical Android acceptance run, assistive-technology review or network-transition test has been completed in this work session. |

**Current blockers:** deployment drift, the database expiry decision and verified backup/restore, adult-operated safety and moderation, and real-device acceptance. Do not describe Pinglet as production-ready while any blocker remains open.

## Track 1 — Infrastructure and GitHub

### Work
- [ ] Assign an accountable adult operator for the live service, database, release keys, incident response, support and policy decisions.
- [ ] Before the database expiry date, export the database and independently verify that the export is readable.
- [ ] Restore the export into a separate disposable database and record the restore result. A download alone is not a successful backup test.
- [ ] Have the adult operator decide whether to upgrade the existing database or migrate to a supported plan. Do not delete or replace the current database until a verified restore and rollback path exist.
- [ ] Reconcile the Render live commit with the intended reviewed release commit. Review the diff before any redeploy; never deploy this documentation branch.
- [ ] Add and commit a dependency lockfile, then change CI and the service build to deterministic installation only after the lockfile is generated and verified against the current package manifest.
- [ ] Separate staging from production; staging must use a separate database and secrets.
- [ ] Review database migrations so production schema changes are repeatable and do not rely solely on application startup side effects.
- [ ] Add an operator runbook for backup, restore, rollback, service wake-up, incident response and credential rotation.
- [ ] Define basic monitoring and alert ownership; a successful health endpoint is one signal, not proof of end-to-end chat availability.

### Acceptance evidence
- A dated backup export plus a successful restore record.
- The chosen database plan and owner decision documented by the adult operator.
- The deployed commit SHA matches the reviewed release SHA.
- A lockfile-based clean install passes CI.
- A staging-to-production release and rollback rehearsal is recorded.

## Track 2 — Accounts, sessions and encryption

### Work
- [ ] Write a short threat model covering account takeover, friend-code discovery, session theft, device loss, malicious peers, compromised servers and database exposure.
- [ ] Obtain independent cryptographic review before making any end-to-end-encryption claim.
- [ ] Design authenticated identity-key verification (for example, a user-visible fingerprint comparison) before treating public keys as trusted.
- [ ] Document the effect of losing browser storage or switching devices; decide whether a safe, user-controlled recovery approach is feasible.
- [ ] Review password handling, login throttling, token expiry, token storage, logout and account deletion on shared devices.
- [ ] Test account deletion against database records, active Socket.IO sessions, local key material and the documented retention policy.
- [ ] Ensure APIs consistently require authentication and enforce the accepted-terms state for social operations.
- [ ] Review friend-code lookup and request endpoints for enumeration, spam and abuse; tune limits using test evidence rather than guesswork.

### Acceptance evidence
- Reviewed threat model and cryptography report.
- Tests for login throttling, token expiry, logout, device loss and account deletion.
- Clear, accurate in-app encryption wording that does not imply an audit or identity verification that has not happened.

## Track 3 — Chat and friend experience

### Work
- [ ] Add cursor-based message-history pagination; the current history path is limited to the latest 100 messages.
- [ ] Test ordering, duplicate sends, retries, reconnects, concurrent friend requests and duplicate relationship prevention.
- [ ] Verify that block state is enforced in REST routes, Socket.IO events, active calls and active games.
- [ ] Review friend-code and QR invite flows for accidental exposure and unwanted contact.
- [ ] Decide whether delivery/read indicators are needed; do not add them without a clear privacy setting.
- [ ] Make voice-message reporting useful without silently claiming that audio evidence is attached. State clearly what report data is submitted.
- [ ] Verify drafts, keyboard navigation, empty states, message errors and reconnect behavior on small screens.

### Acceptance evidence
- Automated tests cover pagination boundaries, reconnects, duplicate requests and block enforcement.
- Manual test record for chat and invites on at least two physical Android devices.
- Report flow wording matches the actual evidence collected.

## Track 4 — Safety, privacy and moderation

### Work
- [ ] Adult operator defines the service audience, age rules, parental-consent requirements where relevant, support coverage and incident ownership before inviting users.
- [ ] Publish a monitored child-safety contact only after the responsible operator verifies it works and assigns someone to monitor it.
- [ ] Appoint actual report reviewers and document review coverage, escalation, emergency handling, evidence access, retention, appeals/contact path and incident records.
- [ ] Keep the moderation token server-side in an approved secret store; never add it to client code, app bundles, screenshots or source control.
- [ ] Add a practical moderator workflow and audit trail before accepting real reports at scale.
- [ ] Add in-call report/block access, and test that blocking takes effect immediately across active sessions.
- [ ] Review privacy policy, terms, data inventory, deletion behavior and retention periods with the accountable operator and qualified advice where needed.
- [ ] Complete platform data-safety declarations only from a verified data inventory.
- [ ] Establish anti-spam and abuse escalation checks; do not rely on rate limits as a substitute for moderation.
- [ ] Do not promote or open the service to a teen audience until the product and operating process have been reviewed for applicable safety requirements.

### Acceptance evidence
- Named adult owner and written moderation procedure.
- Verified monitored contact route and successful test contact.
- Tested report-to-review-to-action workflow with access controls and audit records.
- Reviewed policy and data inventory that match actual implementation.

## Track 5 — Voice, video and live games

### Work
- [ ] Select and configure a trusted TURN service only after an adult operator approves provider, cost, credential handling and privacy terms.
- [ ] Test WebRTC calls on different networks, including networks that do not allow direct peer-to-peer connectivity.
- [ ] Add clear call connection, reconnect, permission-denied and failure states.
- [ ] Review room-code entropy, rate limiting, invitation privacy and room access rules.
- [ ] Decide whether live rooms/games must survive server restarts. If yes, move authoritative state to a suitable shared store and define cleanup/expiry behavior.
- [ ] Ensure blocking or reporting can be performed during a live call without forcing a user to navigate away.
- [ ] Verify microphone/camera permission prompts, mute state, camera-off state, leave behavior and cleanup of media tracks.
- [ ] Test multi-participant behavior and graceful failure when one participant disconnects.

### Acceptance evidence
- Call matrix showing successful audio/video setup on at least two networks and two physical devices.
- TURN relay use confirmed for a test call where direct connectivity is unavailable.
- Restart/disconnect behavior and room cleanup verified.
- No camera or microphone track remains active after leaving a room.

## Track 6 — Design, accessibility and usability

### Work
- [ ] Audit all dialogs for an accessible name/description, correct dialog semantics, initial focus, focus containment, Escape handling where appropriate and focus restoration.
- [ ] Verify every interactive control can be reached and operated with a keyboard or Android accessibility controls.
- [ ] Review text size, contrast, touch-target size, error announcements and screen-reader labels.
- [ ] Test Android font scaling and browser zoom without clipped controls or hidden actions.
- [ ] Verify reduced-motion preferences are respected throughout; ensure animation never blocks a task.
- [ ] Review loading, empty, error, offline and wake-up states.
- [ ] Check that every icon-only button has a meaningful accessible name.
- [ ] Test responsive layouts on small phones, larger phones and desktop widths.

### Acceptance evidence
- Accessibility review with issues recorded and fixed or explicitly accepted.
- Screen-reader and enlarged-text test notes from a physical device.
- Keyboard-only walkthrough completed for the primary journeys.

## Ordered delivery phases

### Phase 0 — Protect data and establish ownership
1. Confirm adult operator and service ownership.
2. Verify database export and restore.
3. Resolve the 6 Dec 2026 database expiry decision.
4. Reconcile production deployment drift and establish a staging boundary.
5. Freeze feature expansion while these controls are incomplete.

**Exit gate:** backup/restore is proven, database continuity is decided, and production deployment ownership is clear.

### Phase 1 — Trust and abuse resistance
1. Complete threat model and cryptographic review plan.
2. Establish staffed moderation and child-safety contact.
3. Review privacy, terms, age rules and deletion/retention.
4. Close account, block, report and authentication gaps.

**Exit gate:** an accountable adult can operate the service safely and the app's security/privacy claims match the evidence.

### Phase 2 — Reliable everyday communication
1. Add message pagination and robust reconnect behavior.
2. Complete friend and block edge-case coverage.
3. Improve call reliability with TURN and clearer failure states.
4. Address accessibility issues in primary chat journeys.

**Exit gate:** primary messaging and calling pass automated and device-based checks.

### Phase 3 — Quality and device acceptance
1. Run the full real-device plan in `REAL_DEVICE_ACCEPTANCE_PLAN.md`.
2. Test multiple networks and Android versions.
3. Complete accessibility and privacy verification.
4. Record all defects and re-test fixes.

**Exit gate:** no open critical/high severity release defects; medium issues have documented owner and decision.

### Phase 4 — Controlled release
1. Adult operator reviews the complete evidence set.
2. Create signed release artifacts under adult-controlled keys.
3. Complete store declarations and required testing.
4. Roll out gradually with monitoring and a tested rollback path.

**Exit gate:** all release blockers have written evidence and the adult operator explicitly approves the release.

## Working rules

- This branch is a documentation and planning change; it must not be deployed to the live service.
- No database migration, upgrade, deletion, restore-overwrite, secret change, service restart or production deploy is authorised by this roadmap.
- Do not use real users' private messages or personal information as test fixtures.
- Mark work complete only with an artifact or reproducible test result.
- A green CI result verifies only what CI actually ran. It does not prove real-device behavior, staffed moderation, legal compliance or production availability.
