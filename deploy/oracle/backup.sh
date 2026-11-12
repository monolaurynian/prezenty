#!/usr/bin/env bash
# Nightly dump of the database, compressed, kept for 14 days. Runs as root
# (cron), which MariaDB lets in over the local socket without a password.
# A backup that stays on the same machine does not survive losing the
# machine: copy one off it now and then (see deploy/oracle/README.md).
set -euo pipefail
DIR=/var/backups/prezenty
mkdir -p "$DIR"
chmod 700 "$DIR"
STAMP="$(date +%F_%H%M)"
OUT="$DIR/prezenty_$STAMP.sql.gz"
mariadb-dump --single-transaction --routines --default-character-set=utf8mb4 prezenty | gzip > "$OUT.tmp"
mv "$OUT.tmp" "$OUT"
find "$DIR" -name 'prezenty_*.sql.gz' -mtime +14 -delete
