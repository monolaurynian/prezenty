#!/usr/bin/env bash
# Turns on automatic deploys from GitHub (safe to run again).
#   sudo bash /opt/prezenty/app/deploy/oracle/install-auto-deploy.sh
set -euo pipefail
APP_DIR=/opt/prezenty/app
if [ "$(id -u)" -ne 0 ]; then echo "Run as root (sudo)." >&2; exit 1; fi
chmod +x "$APP_DIR"/deploy/oracle/*.sh
install -m 644 "$APP_DIR/deploy/oracle/prezenty-deploy.service" /etc/systemd/system/prezenty-deploy.service
install -m 644 "$APP_DIR/deploy/oracle/prezenty-deploy.timer" /etc/systemd/system/prezenty-deploy.timer
systemctl daemon-reload
systemctl enable --now prezenty-deploy.timer
systemctl list-timers prezenty-deploy.timer --no-pager
echo "Auto-deploy is on. Watch it with: journalctl -u prezenty-deploy -f"
