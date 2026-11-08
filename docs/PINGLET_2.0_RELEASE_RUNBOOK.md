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

## Availability and capacity planning

The production Blueprint currently selects the Free web-service and Free PostgreSQL instance types. Treat this as a preview/hobby configuration, not a dependable production availability design.

As checked against Render's current documentation on 9 November 2026:

- A Free web service spins down after 15 minutes without inbound HTTP requests or WebSocket messages; the next request can take about one minute to wake it. Free web services also have a 750-hour monthly workspace allowance and can be suspended when that allowance is consumed.
- A Free PostgreSQL database expires 30 days after creation, has a 1 GB storage cap, permits only one active Free database per workspace, and has no provider backups or managed connection pooling. After expiry there is a 14-day upgrade grace period before deletion.
- Free PostgreSQL can be restarted for maintenance. A separate Free staging database cannot coexist with the existing Free production database in the same workspace.
- Paid web-service instance types do not spin down. Paid database backup, retention and high-availability features depend on the selected plan; verify the currently offered features and price in the Render Dashboard before choosing.

References: [Render Free limits](https://render.com/docs/free), [Render health checks](https://render.com/docs/health-checks), and [Render compute plans](https://render.com/docs/compute-plans).

### Recommended availability design

1. Keep a single paid web-service instance initially, with a non-sleeping plan selected against measured memory, CPU, concurrency and monthly budget. Do not add instances solely to claim higher availability.
2. Move production PostgreSQL to a paid plan with provider backups/restore options and a retention policy the operator has checked. Complete a separate restore rehearsal before relying on it.
3. Provision staging with a different database and unique secrets. Because the workspace already has a Free Postgres instance, staging needs a paid database plan or a separately approved workspace; do not delete or replace production to make room.
4. Use Render's HTTP readiness check at `/health` (also available as `/readyz`); use `/livez` only for process liveness. Configure an external monitor and alert an accountable adult operator on repeated health failures, sustained elevated latency, deploy failures, or database expiry warnings.
5. Keep horizontal scaling disabled until call-room and Snake Duel state no longer depends on process-local memory and Socket.IO has a supported cross-instance adapter/session strategy. Current in-memory sessions can end when the process restarts or a deploy occurs.
6. Define an explicit availability target and maintenance/incident process with the service owner. Do not claim an uptime percentage or SLA until it is measured and backed by the actual hosting plan and monitoring data.

Do not generate keep-alive traffic to bypass Free-plan spin-down. It does not solve database expiry, lack of backups, maintenance restarts, or real failover.

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

### API reliability and graceful deployment shutdown

- Async Express 4 route failures must be forwarded to centralized error handling.
- Client responses must not reveal stack traces, SQL, database credentials or internal exception messages.
- Keep `/livez` as a process-liveness probe that does not depend on PostgreSQL.
- Keep `/readyz` as a PostgreSQL-backed readiness probe; preserve `/health` as the Render readiness alias.
- During shutdown, reject new requests with HTTP 503, reject new Socket.IO handshakes, close active Socket.IO connections, and drain the PostgreSQL pool.
- Handle both `SIGTERM` (platform deploy/restart) and `SIGINT`; use a bounded shutdown deadline.
- Test malformed JSON, oversized request bodies, rejected async handlers, authentication failures, unknown routes, database unavailability and rate-limit responses.
- Test that `SIGTERM` during active Socket.IO sessions disconnects clients cleanly and exits without a forced kill.
- In-memory call rooms and Snake Duel state are transient and will end on a restart; test client reconnection and present clear user-facing behavior.
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

The application derives its browser-origin policy from the exact HTTPS `PUBLIC_URL` (falling back to Render's `RENDER_EXTERNAL_URL` when `PUBLIC_URL` is blank). Production and staging therefore allow only their own configured web origin plus the known native Capacitor origins. Port-qualified localhost browser origins and WebSocket sources are added only for local development when no public origin is configured and `NODE_ENV` is not production or staging. HTTP CORS, Socket.IO polling and WebSocket handshakes share that allowlist. Helmet's browser Content Security Policy adds only the matching HTTPS origin and its WSS origin; it does not include broad `ws:` or `wss:` sources. The static HTML deliberately has no hard-coded dual-environment CSP. Android builds generate a matching native CSP alongside the runtime API origin: a blank workflow input retains production, while a staging preview uses the staging origin. A staging Android preview can be built through the Android workflow's manual `api_origin` input. That build is published under a separate `android-staging` preview tag; it must never overwrite the production preview or create a Play Store AAB. Confirm the configured origin is the staging service before running that workflow.

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
