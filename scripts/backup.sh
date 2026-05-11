#!/usr/bin/env bash
# Postgres logical backup. Run nightly via cron or a systemd timer.
#
#   DATABASE_URL=postgres://user:pass@host:5432/bot ./scripts/backup.sh
#
# Result: ./backups/bot-YYYYMMDD-HHMMSS.dump (custom format, compressed).
# Pipe to your object store of choice (S3, GCS, R2).
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"
ts="$(date -u +%Y%m%d-%H%M%S)"
out_dir="${BACKUP_DIR:-./backups}"
mkdir -p "$out_dir"
file="$out_dir/bot-$ts.dump"

pg_dump --no-owner --no-privileges --format=custom --compress=9 \
  --file="$file" "$DATABASE_URL"

echo "wrote $file ($(du -h "$file" | cut -f1))"

# Optional: aws s3 cp "$file" "s3://YOUR-BUCKET/postgres/" && rm "$file"
