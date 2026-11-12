#!/usr/bin/env bash
# One-time setup of a fresh Ubuntu 22.04/24.04 VM (Oracle Cloud, Arm or AMD):
# Node.js, MariaDB (localhost only), Caddy (automatic HTTPS), the app as a
# systemd service, a nightly database backup.
#
# Usage (as root, from anywhere):
#   sudo bash setup-vm.sh prezenty.example.com
#
# It is safe to run again: it skips what already exists and never overwrites
# the env file. NOT yet run on a real Oracle VM - read the output of the first
# run and stop at the first error (set -e does this for you).
set -euo pipefail

DOMAIN="${1:?usage: sudo bash setup-vm.sh <domain, e.g. prezenty.example.com>}"
NODE_MAJOR="${NODE_MAJOR:-24}"
REPO_URL="${REPO_URL:-https://github.com/monolaurynian/prezenty.git}"
APP_USER=prezenty
BASE_DIR=/opt/prezenty
APP_DIR="$BASE_DIR/app"
ENV_DIR=/etc/prezenty
ENV_FILE="$ENV_DIR/prezenty.env"
DB_NAME=prezenty
DB_USER=prezenty

if [ "$(id -u)" -ne 0 ]; then echo "Run as root (sudo)." >&2; exit 1; fi
export DEBIAN_FRONTEND=noninteractive

echo "==> Base tools (Minimal images leave out free, cron, sudo, curl)"
apt-get update
apt-get install -y procps cron sudo curl ca-certificates

echo "==> Swap (npm and MariaDB need headroom on a 1 GB machine)"
if [ "$(free -m | awk '/^Mem:/ {print $2}')" -lt 2000 ] && ! swapon --show | grep -q .; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

echo "==> Packages"
apt-get update
apt-get install -y ca-certificates curl gnupg git openssl iptables-persistent \
  debian-keyring debian-archive-keyring apt-transport-https unattended-upgrades

# Same MariaDB series as Hostinger's (11.8): Ubuntu's own package is 10.11, and a
# dump from 11.x can use collations (utf8mb4_uca1400_*) that 10.11 does not know.
if ! command -v mariadb >/dev/null; then
  curl -LsSf https://r.mariadb.com/downloads/mariadb_repo_setup | bash -s -- --mariadb-server-version="mariadb-${MARIADB_SERIES:-11.8}"
  apt-get install -y mariadb-server
fi

if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" != "$NODE_MAJOR" ]; then
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
  apt-get install -y nodejs
fi

if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update
  apt-get install -y caddy
fi

echo "==> Firewall: let ports 80 and 443 in (Oracle's Ubuntu image rejects everything but SSH)"
for port in 80 443; do
  if ! iptables -C INPUT -p tcp --dport "$port" -j ACCEPT 2>/dev/null; then
    line="$(iptables -L INPUT --line-numbers -n | awk '/REJECT/ {print $1; exit}')"
    iptables -I INPUT "${line:-1}" -p tcp --dport "$port" -j ACCEPT
  fi
done
netfilter-persistent save

echo "==> App user and code"
id "$APP_USER" >/dev/null 2>&1 || useradd --system --create-home --home-dir "$BASE_DIR" --shell /usr/sbin/nologin "$APP_USER"
if [ ! -d "$APP_DIR/.git" ]; then
  sudo -H -u "$APP_USER" git clone "$REPO_URL" "$APP_DIR"
fi
sudo -H -u "$APP_USER" bash -c "cd '$APP_DIR' && npm ci --omit=dev"

echo "==> Database (listens on localhost only)"
# On a 1 GB machine (the AMD micro shape) keep MariaDB small: this app's
# database is a few MB. Skipped on bigger machines.
if [ "$(free -m | awk '/^Mem:/ {print $2}')" -lt 2000 ]; then
  mkdir -p /etc/mysql/mariadb.conf.d
  cat > /etc/mysql/mariadb.conf.d/99-prezenty-small.cnf <<'CNF'
[mysqld]
innodb_buffer_pool_size = 64M
performance_schema = OFF
max_connections = 30
key_buffer_size = 8M
CNF
fi
systemctl enable --now mariadb
systemctl restart mariadb
if [ ! -f "$ENV_FILE" ]; then
  DB_PASSWORD="$(openssl rand -base64 24 | tr -d '/+=')"
  mariadb <<SQL
CREATE DATABASE IF NOT EXISTS \`$DB_NAME\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS '$DB_USER'@'localhost' IDENTIFIED BY '$DB_PASSWORD';
ALTER USER '$DB_USER'@'localhost' IDENTIFIED BY '$DB_PASSWORD';
GRANT ALL PRIVILEGES ON \`$DB_NAME\`.* TO '$DB_USER'@'localhost';
FLUSH PRIVILEGES;
SQL
  install -d -m 750 -o root -g "$APP_USER" "$ENV_DIR"
  sed -e "s|__DB_PASSWORD__|$DB_PASSWORD|" \
      -e "s|__SESSION_SECRET__|$(openssl rand -hex 32)|" \
      "$APP_DIR/deploy/oracle/prezenty.env.example" > "$ENV_FILE"
  chown root:"$APP_USER" "$ENV_FILE"
  chmod 640 "$ENV_FILE"
  echo "    Created $ENV_FILE (database password and session secret generated)."
else
  echo "    $ENV_FILE exists - left alone."
fi

echo "==> systemd service"
install -m 644 "$APP_DIR/deploy/oracle/prezenty.service" /etc/systemd/system/prezenty.service
systemctl daemon-reload
systemctl enable prezenty

echo "==> Caddy (HTTPS for $DOMAIN)"
sed "s|__DOMAIN__|$DOMAIN|g" "$APP_DIR/deploy/oracle/Caddyfile" > /etc/caddy/Caddyfile
systemctl enable caddy
systemctl reload caddy || systemctl restart caddy

echo "==> Nightly backup (03:17, kept 14 days in /var/backups/prezenty)"
chmod +x "$APP_DIR/deploy/oracle/backup.sh" "$APP_DIR/deploy/oracle/update.sh"
echo "17 3 * * * root $APP_DIR/deploy/oracle/backup.sh" > /etc/cron.d/prezenty-backup
chmod 644 /etc/cron.d/prezenty-backup

cat <<DONE

Setup finished. The app is NOT started yet - the database is empty.
Next:
  1. Import your dump:   mariadb $DB_NAME < /path/to/dump.sql
  2. Start the app:      systemctl start prezenty
  3. Check:              curl -s http://127.0.0.1:3000/health ; journalctl -u prezenty -n 40 --no-pager
  4. Edit optional keys: nano $ENV_FILE   (KLIPY_API_KEY ...), then: systemctl restart prezenty
  5. Point DNS ($DOMAIN) at this VM's public IP; Caddy gets the certificate by itself.
DONE
