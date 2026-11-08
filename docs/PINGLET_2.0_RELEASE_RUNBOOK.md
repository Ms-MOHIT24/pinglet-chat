# Pinglet 2.0 release operations runbook

**Status snapshot:** 8 November 2026  
**Current code base:** Pinglet 1.9.0  
**Purpose:** Define the evidence required before calling a controlled release Pinglet 2.0.

This runbook is for the responsible adult service operator. It is not an authorization to access production, export user data, change plans, provision services, rotate secrets, or deploy. Do not ask a student to perform account-owner, billing, legal, moderation, signing-key, or production database duties.

## Release principles

- Stability and operational recoverability take priority over adding features.
- Never test a restore by overwriting the production database.
- Never use production messages or personal information as test fixtures.
- A green CI run is not proof of production health, human moderation, legal compliance, cryptographic security, or physical-device behavior.
- Keep the package version at 1.9.0 until the 2.0 release candidate has passed all gates. Do not relabel a preview build as 2.0.

## Gate 1 — Database safety

### Required operator evidence

1. Confirm the actual database resource, PostgreSQL major version, plan, region, current expiry date/time and any provider backup/restore features in the Render Dashboard.
2. Make a provider-supported backup and a separate logical export using PostgreSQL 18-compatible client tools for the current PostgreSQL 18 database.
3. Store the backup encrypted in an adult-controlled location separate from the Render service and GitHub repository. Restrict access to people who need it. Do not put database URLs, dumps, passwords or user content in Git, issues, chat messages, CI artifacts or screenshots.
4. Verify the custom-format archive can be listed with `pg_restore --list`.
5. Restore into a newly-created, separate disposable database or isolated cluster. Do not use `--clean` against production and do not point the restore target at the live database.
6. Verify the restored schema, row counts, indexes, constraints, sample disposable-account login, chat-history access, report records, and deletion behavior. Record any difference and resolve it before cutover.
7. Record the export date, database version, archive checksum, restore target identity, verification result, operator and retention date without recording secrets or user content.

### Example logical backup and restore

Run only from a secured operator workstation by the adult operator. Set both connection URLs using the approved secret manager or protected environment; never paste their values into a terminal transcript or commit them to a file.

```bash
umask 077
BACKUP_FILE="$PWD/pinglet-db-$(date -u +%Y%m%dT%H%M%SZ).dump"

# Source is the live database. Destination is a newly-created, separate,
# empty disposable database or isolated restore cluster.
pg_dump --format=custom --no-owner --no-acl \
  --file="$BACKUP_FILE" "$PINGLET_SOURCE_DATABASE_URL"

test -s "$BACKUP_FILE"
pg_restore --list "$BACKUP_FILE" >/dev/null

# This command restores into the separate target only. Do not add --clean.
pg_restore --exit-on-error --no-owner --no-acl \
  --dbname="$PINGLET_RESTORE_DATABASE_URL" "$BACKUP_FILE"

sha256sum "$BACKUP_FILE"
```

Use PostgreSQL client tools compatible with the source server (PostgreSQL 18 for the current service). Keep the file encrypted at rest and remove temporary plaintext copies after the retention copy is verified. A successful download or archive listing alone is not a successful restore test.

### Expiry / continuity decision

The last recorded provider-reported expiry in the previous inspection was **2026-12-06 21:47:38 UTC (2026-12-07 03:17:38 IST)**. This is historical evidence, not a fresh status check. Recheck the exact current date/time and resource in Render before acting.

The adult operator must choose and record one path before the verified expiry:
- upgrade/extend the existing database plan; or
- migrate to a supported database with a tested restore/cutover and rollback plan.

Do not delete or replace the existing database until the new database has passed restore and application acceptance. Include a maintenance window, final backup, write-freeze/cutover approach, DNS/connection change plan if relevant, health checks and rollback decision. The student does not make billing or database-retention decisions.

## Gate 2 — GitHub / Render deployment consistency

1. Read the current GitHub `main` SHA and the live Render deploy's commit SHA from the adult-confirmed workspace.
2. Confirm the Render service is the intended `pinglet-chat-live` service and still references the expected repository and branch. Read the current build command, deploy trigger, health-check path, region and environment-variable *names*; never expose values.
3. Review differences between the currently live SHA, GitHub `main`, and the proposed PR merge commit.
4. Before merging a PR that changes `render.yaml`, confirm that the package lockfile is present in the same merge and the new build command passes clean CI.
5. Do not merge or deploy until Gate 1 backup/restore evidence is recorded and the adult operator has approved the deployment window.
6. After the approved deploy, record the resulting Render deploy ID and commit SHA, check the service logs for startup errors, verify `/health`, and perform disposable-account sign-up, login, friend request, messaging and sign-out checks.
7. Keep the last known-good commit and rollback steps documented. A healthy `/health` response verifies database connectivity only; it does not prove every feature works.

No automatic production deploy should be inferred from a code change or PR approval alone. The adult operator must understand that the current service is configured for automatic deploys from `main`.

## Gate 3 — Reproducible engineering and staging

### Reproducible installation

- Commit `package-lock.json` and keep it in sync with `package.json`.
- Use Node 22 and `npm ci --no-audit --no-fund` for CI and Render installation.
- Do not change dependencies without reviewing the resulting lockfile diff and CI results.
- Confirm the Android build workflow uses the lockfile-backed install as well.

### API reliability

- Async Express 4 route failures must be forwarded to centralized error handling.
- Client responses must not reveal stack traces, SQL, database credentials or internal exception messages.
- Test malformed JSON, oversized request bodies, rejected async handlers, authentication failures, unknown routes, database unavailability and rate-limit responses.
- Keep integration-only fault injection disabled unless `NODE_ENV=test`.

### Separate staging environment

The adult operator should provision a separate Render staging web service and a separate PostgreSQL database. Staging must not reuse production's `DATABASE_URL`, JWT secret, moderation token, TURN secret, or storage. Choose a plan with an explicit data-retention/expiry decision; a temporary free database is not a durable staging environment.

Minimum staging environment:
- service name such as `pinglet-chat-staging`;
- separate staging database such as `pinglet-chat-staging-db`;
- `PUBLIC_URL` set to the exact HTTPS staging origin;
- unique, randomly generated `JWT_SECRET` (at least 32 random bytes);
- unique `REPORTS_ADMIN_TOKEN` (at least 32 random bytes);
- `DATABASE_URL` connected only to staging;
- `NODE_ENV=staging` (never `test` in an internet-accessible service);
- no real users; use disposable test accounts and messages only.

The application now adds the configured `PUBLIC_URL` HTTPS origin to its CORS/Socket.IO allowlist. Browser staging uses the same-origin API. CORS and Content Security Policy explicitly allow Pinglet's production and staging Render origins; do not widen them to all external hosts. The native runtime configuration script accepts only those two Pinglet origins. A staging Android preview can be built through the Android workflow's manual `api_origin` input. That build is published under a separate `android-staging` preview tag; it must never overwrite the production preview or create a Play Store AAB. Confirm the configured origin is the staging service before running that workflow.

GitHub CI also runs a disposable localhost-only PostgreSQL custom-format backup/restore check. It dumps the CI database, verifies the archive, restores to a separate CI database, compares core table counts, and drops the scratch database. This proves the automated test workflow can restore its own disposable database; it is not a production backup and does not replace the adult operator's provider backup and isolated production restore evidence.

Staging acceptance should include:
- clean sign-up/login and terms acceptance with two disposable accounts;
- friend request, chat send, history pagination and reconnect;
- report and block behavior using test-only data;
- account deletion and report anonymization;
- call room signaling and, after an adult operator configures an approved relay, TURN behavior;
- deployment restart and database restore rehearsal;
- logs, CORS, invite links, Android local-origin requests and all error states.

## Later release gates — do not skip

Only after Gates 1–3 are evidenced:
- Security: threat model, session/account tests, dependency and configuration review, external cryptographic review and key-identity/recovery decisions.
- Safety: adult-operated moderation team and escalation coverage, verified monitored child-safety contact, age/audience decision, tested reports/blocks, reviewed privacy/terms/retention and platform declarations.
- Calling: approved TURN provider and cost/privacy review, HMAC compatibility confirmation, cross-network relay tests, call teardown and restart cases.
- Devices: two or more physical Android devices, multiple networks, microphone/camera permission cases, screen-reader/font-scale/accessibility checks, install/update/uninstall and reconnect tests.

## Evidence record

For each gate, retain: date/time, accountable adult operator, exact commit SHA, environment name (not secret values), commands or checklist version, pass/fail/blocker, redacted evidence location, defect references and retest outcome.

**Release decision remains “not approved” while any database recovery, deployment, staging, security, child-safety, cryptographic, calling or device gate is unverified.**
