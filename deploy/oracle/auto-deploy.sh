#!/usr/bin/env bash
# Deploys new commits from GitHub and goes back to the previous commit if the
# app does not come up healthy. Run every 5 minutes by the systemd timer
# prezenty-deploy.timer, and by hand through update.sh.
#
# - Branch: main (override with DEPLOY_BRANCH).
# - A commit that failed its health check is remembered and skipped until a
#   NEWER commit arrives (so a broken push does not restart the app every 5 min).
# - If the database is down at deploy time the health check fails too and the
#   commit is rolled back and marked; the next push gets a fresh try.
# - Progress goes to $STATE_DIR/status.json and deploy.log (written through
#   write-status.js) for the signed-in /deploy page. Both are best effort: if
#   they cannot be written the deploy carries on.
set -uo pipefail
umask 022
APP_DIR="${APP_DIR:-/opt/prezenty/app}"
APP_USER="${APP_USER:-prezenty}"
BRANCH="${DEPLOY_BRANCH:-main}"
STATE_DIR="${STATE_DIR:-/var/lib/prezenty-deploy}"
LOCK_FILE="${LOCK_FILE:-/run/prezenty-deploy.lock}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:3000/health}"
BAD_FILE="$STATE_DIR/bad-commit"
LOG_FILE="$STATE_DIR/deploy.log"
STATUS_JS="$(dirname "$(readlink -f "$0")")/write-status.js"
DEPLOYING=0
say() {
  echo "[deploy] $*"
  printf '%s %s\n' "$(date -Iseconds)" "$*" >> "$LOG_FILE" 2>/dev/null || true
}
# status key=value ... : see write-status.js. Never fails the deploy.
status() { STATE_DIR="$STATE_DIR" node "$STATUS_JS" "$@" >/dev/null 2>&1 || true; }
now() { date -Iseconds; }
as_app() { sudo -H -u "$APP_USER" "$@"; }
if [ "$(id -u)" -ne 0 ]; then echo "Run as root (sudo)." >&2; exit 1; fi
mkdir -p "$STATE_DIR"
chmod 755 "$STATE_DIR"
# keep the log short
if [ -f "$LOG_FILE" ] && [ "$(wc -l < "$LOG_FILE")" -gt 400 ]; then
  tail -n 200 "$LOG_FILE" > "$LOG_FILE.tmp" && mv "$LOG_FILE.tmp" "$LOG_FILE"
fi
# one deploy at a time
exec 9>"$LOCK_FILE"
flock -n 9 || { say "Another deploy is running."; exit 0; }
# if this script dies half way, the page must not say "deploying" forever
on_exit() {
  if [ "$DEPLOYING" = 1 ]; then
    say "Stopped unexpectedly while deploying."
    status state=failed step= result=failed reason=script_stopped "finishedAt=$(now)"
  fi
}
trap on_exit EXIT
if ! as_app git -C "$APP_DIR" fetch --quiet origin "$BRANCH"; then
  say "fetch failed (network?) - will try again"
  exit 0
fi
OLD="$(as_app git -C "$APP_DIR" rev-parse HEAD)"
NEW="$(as_app git -C "$APP_DIR" rev-parse "origin/$BRANCH")"
subject_of() { as_app git -C "$APP_DIR" log -1 --format=%s "$1" 2>/dev/null; }
date_of() { as_app git -C "$APP_DIR" log -1 --format=%cI "$1" 2>/dev/null; }
record_deployed() {
  status "deployed.sha=$1" "deployed.subject=$(subject_of "$1")" "deployed.date=$(date_of "$1")"
}
status "branch=$BRANCH" "checkedAt=$(now)"
if [ "$OLD" = "$NEW" ]; then
  record_deployed "$OLD"
  status state=idle step= target= skipped= result= reason= healthyAfterRollback=
  [ -t 1 ] && say "Already up to date ($OLD)."
  exit 0
fi
# this one failed before: wait for a newer commit
if [ -f "$BAD_FILE" ] && [ "$(cat "$BAD_FILE")" = "$NEW" ]; then
  record_deployed "$OLD"
  status "skipped.sha=$NEW" "skipped.subject=$(subject_of "$NEW")"
  [ -t 1 ] && say "$NEW failed its health check earlier and is skipped. Push a newer commit."
  exit 0
fi
deps_changed() { ! as_app git -C "$APP_DIR" diff --quiet "$OLD" "$NEW" -- package.json package-lock.json; }
install_deps() { as_app bash -c "cd '$APP_DIR' && npm ci --omit=dev --no-audit --no-fund"; }
healthy() {
  local i
  for i in $(seq 1 20); do
    if curl -fsS --max-time 3 "$HEALTH_URL" 2>/dev/null | grep -q '"status":"OK"'; then return 0; fi
    sleep 2
  done
  return 1
}
# rollback "<message>" <reason code>
rollback() {
  say "FAILED: $1 - going back to $OLD"
  echo "$NEW" > "$BAD_FILE"
  status step=rolling_back
  as_app git -C "$APP_DIR" reset --hard --quiet "$OLD"
  if deps_changed; then install_deps; fi
  systemctl restart prezenty
  local ok=false
  if healthy; then
    ok=true
    say "Rolled back; the app is healthy on $OLD."
  else
    say "Still unhealthy after the rollback - check: journalctl -u prezenty -n 50"
  fi
  record_deployed "$OLD"
  status state=rolled_back step= result=rolled_back "reason=$2" "healthyAfterRollback=$ok" \
    "skipped.sha=$NEW" "skipped.subject=$(subject_of "$NEW")" "finishedAt=$(now)"
  DEPLOYING=0
  exit 1
}
say "Deploying $NEW (was $OLD)"
DEPLOYING=1
status state=deploying step=pulling result= reason= healthyAfterRollback= skipped= \
  "target.sha=$NEW" "target.subject=$(subject_of "$NEW")" "startedAt=$(now)" finishedAt=
if ! as_app git -C "$APP_DIR" merge --ff-only --quiet "origin/$BRANCH"; then
  say "cannot fast-forward (local changes on the server?) - not deploying"
  status state=failed step= result=failed reason=not_fast_forward "finishedAt=$(now)"
  DEPLOYING=0
  exit 1
fi
if deps_changed; then
  say "dependencies changed - installing"
  status step=installing
  install_deps || rollback "npm ci failed" npm_failed
fi
status step=restarting
systemctl restart prezenty
status step=checking
if healthy; then
  rm -f "$BAD_FILE"
  say "Deployed $NEW."
  record_deployed "$NEW"
  status state=idle step= target= result=ok reason= "finishedAt=$(now)"
  DEPLOYING=0
else
  rollback "health check failed" health_failed
fi