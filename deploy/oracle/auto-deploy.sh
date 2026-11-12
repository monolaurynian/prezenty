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
set -uo pipefail

APP_DIR="${APP_DIR:-/opt/prezenty/app}"
APP_USER="${APP_USER:-prezenty}"
BRANCH="${DEPLOY_BRANCH:-main}"
STATE_DIR="${STATE_DIR:-/var/lib/prezenty-deploy}"
LOCK_FILE="${LOCK_FILE:-/run/prezenty-deploy.lock}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:3000/health}"
BAD_FILE="$STATE_DIR/bad-commit"

say() { echo "[deploy] $*"; }
as_app() { sudo -H -u "$APP_USER" "$@"; }

if [ "$(id -u)" -ne 0 ]; then echo "Run as root (sudo)." >&2; exit 1; fi
mkdir -p "$STATE_DIR"

# one deploy at a time
exec 9>"$LOCK_FILE"
flock -n 9 || { say "Another deploy is running."; exit 0; }

if ! as_app git -C "$APP_DIR" fetch --quiet origin "$BRANCH"; then
  say "fetch failed (network?) - will try again"
  exit 0
fi

OLD="$(as_app git -C "$APP_DIR" rev-parse HEAD)"
NEW="$(as_app git -C "$APP_DIR" rev-parse "origin/$BRANCH")"

if [ "$OLD" = "$NEW" ]; then
  [ -t 1 ] && say "Already up to date ($OLD)."
  exit 0
fi
# this one failed before: wait for a newer commit
if [ -f "$BAD_FILE" ] && [ "$(cat "$BAD_FILE")" = "$NEW" ]; then
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

rollback() {
  say "FAILED: $1 - going back to $OLD"
  echo "$NEW" > "$BAD_FILE"
  as_app git -C "$APP_DIR" reset --hard --quiet "$OLD"
  if deps_changed; then install_deps; fi
  systemctl restart prezenty
  if healthy; then
    say "Rolled back; the app is healthy on $OLD."
  else
    say "Still unhealthy after the rollback - check: journalctl -u prezenty -n 50"
  fi
  exit 1
}

say "Deploying $NEW (was $OLD)"
if ! as_app git -C "$APP_DIR" merge --ff-only --quiet "origin/$BRANCH"; then
  say "cannot fast-forward (local changes on the server?) - not deploying"
  exit 1
fi

if deps_changed; then
  say "dependencies changed - installing"
  install_deps || rollback "npm ci failed"
fi

systemctl restart prezenty
if healthy; then
  rm -f "$BAD_FILE"
  say "Deployed $NEW."
else
  rollback "health check failed"
fi
