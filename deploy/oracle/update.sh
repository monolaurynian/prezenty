#!/usr/bin/env bash
# Deploy the latest code now: sudo /opt/prezenty/app/deploy/oracle/update.sh
# (The timer does the same every 5 minutes; see auto-deploy.sh.)
exec "$(dirname "$(readlink -f "$0")")/auto-deploy.sh"
