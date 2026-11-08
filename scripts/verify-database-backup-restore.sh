#!/usr/bin/env bash
set -euo pipefail
set +x

: "${DATABASE_URL:?DATABASE_URL must point to the disposable CI source database}"
: "${RESTORE_DATABASE_URL:?RESTORE_DATABASE_URL must point to the disposable localhost restore database}"

# This check is deliberately limited to a localhost-only CI database. It must
# never be reused as a production restore tool.
python3 - <<'PY'
import os
from urllib.parse import urlparse

source = urlparse(os.environ["DATABASE_URL"])
target = urlparse(os.environ["RESTORE_DATABASE_URL"])
allowed_hosts = {"127.0.0.1", "localhost", "::1"}
source_db = source.path.lstrip("/").split("/", 1)[0]
target_db = target.path.lstrip("/").split("/", 1)[0]

if source.scheme not in {"postgres", "postgresql"} or target.scheme not in {"postgres", "postgresql"}:
    raise SystemExit("Backup verification requires PostgreSQL connection URLs.")
if source.hostname not in allowed_hosts or target.hostname not in allowed_hosts:
    raise SystemExit("Refusing backup verification unless both databases are localhost-only.")
if target_db != "pinglet_restore_check":
    raise SystemExit("Restore target must be the disposable pinglet_restore_check database.")
if source_db == target_db:
    raise SystemExit("Source and restore databases must be different.")
if source.port != target.port or source.hostname != target.hostname:
    raise SystemExit("Source and restore databases must use the same local CI PostgreSQL service.")
PY

backup_dir="$(mktemp -d)"
trap 'rm -rf "$backup_dir"' EXIT

# Use client tools from the same PostgreSQL major image as the CI service.
# This avoids pg_dump/pg_restore version-specific session settings.
docker run --rm --network host \
  --env DATABASE_URL \
  --env RESTORE_DATABASE_URL \
  --volume "$backup_dir:/backup" \
  postgres:16 bash -euo pipefail -c '
    set +x
    backup_file="/backup/pinglet-ci.dump"
    restore_db="pinglet_restore_check"
    cleanup() {
      psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS $restore_db WITH (FORCE)" >/dev/null 2>&1 || true
    }
    trap cleanup EXIT

    pg_dump --format=custom --no-owner --no-acl --file="$backup_file" "$DATABASE_URL"
    test -s "$backup_file"
    pg_restore --list "$backup_file" > /backup/archive-contents.txt
    test -s /backup/archive-contents.txt

    psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS $restore_db WITH (FORCE)" >/dev/null
    psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "CREATE DATABASE $restore_db" >/dev/null
    pg_restore --exit-on-error --single-transaction --no-owner --no-acl --dbname="$RESTORE_DATABASE_URL" "$backup_file"

    count_query="SELECT format('users=%s;messages=%s;friendships=%s;friend_requests=%s;blocked_users=%s;reports=%s', (SELECT count(*) FROM users), (SELECT count(*) FROM messages), (SELECT count(*) FROM friendships), (SELECT count(*) FROM friend_requests), (SELECT count(*) FROM blocked_users), (SELECT count(*) FROM reports));"
    source_counts="$(psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -Atqc "$count_query")"
    restored_counts="$(psql "$RESTORE_DATABASE_URL" -v ON_ERROR_STOP=1 -Atqc "$count_query")"
    if [[ "$source_counts" != "$restored_counts" ]]; then
      echo "Restored database counts do not match the source database."
      exit 1
    fi

    echo "PASS  PostgreSQL custom-format backup archive is readable"
    echo "PASS  Backup restored into a separate disposable localhost database"
    echo "PASS  Core table counts match between source and restored databases"
  '
