#!/usr/bin/env bash
# Deploy the latest code from GitHub: sudo /opt/prezenty/app/deploy/oracle/update.sh
set -euo pipefail
APP_DIR=/opt/prezenty/app
if [ "$(id -u)" -ne 0 ]; then echo "Run as root (sudo)." >&2; exit 1; fi
sudo -H -u prezenty git -C "$APP_DIR" pull --ff-only
sudo -H -u prezenty bash -c "cd '$APP_DIR' && npm ci --omit=dev"
systemctl restart prezenty
sleep 3
curl -fsS http://127.0.0.1:3000/health >/dev/null && echo "Up." || { echo "Health check failed - journalctl -u prezenty -n 50"; exit 1; }
