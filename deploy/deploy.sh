#!/usr/bin/env bash
# Deploy the committed state of main to the internal server.
# First run also creates the user, systemd unit and nginx site.
# Render keeps deploying itself on push to main; this script is only for the internal copy.
set -euo pipefail

HOST="${DEPLOY_HOST:-r.gavrilin@10.83.24.22}"
REF="${1:-main}"
cd "$(dirname "$0")/.."

echo "Deploying $(git rev-parse --short "$REF") to $HOST"
git archive --format=tar "$REF" | ssh "$HOST" 'rm -rf /tmp/creo-click-check.new && mkdir -p /tmp/creo-click-check.new && tar -x -C /tmp/creo-click-check.new'

ssh "$HOST" 'bash -s' <<'REMOTE'
set -euo pipefail
NEW=/tmp/creo-click-check.new
APP=/opt/creo-click-check/app

id creo >/dev/null 2>&1 || sudo useradd --system --home /opt/creo-click-check --shell /usr/sbin/nologin creo
sudo mkdir -p /opt/creo-click-check
sudo rm -rf "$APP.prev"
[ -d "$APP" ] && sudo mv "$APP" "$APP.prev"
sudo mv "$NEW" "$APP"
sudo chown -R creo:creo /opt/creo-click-check
sudo -u creo bash -c "cd $APP && npm ci --omit=dev --no-audit --no-fund --silent"

sudo install -m 644 "$APP/deploy/creo-click-check.service" /etc/systemd/system/creo-click-check.service
sudo install -m 644 "$APP/deploy/nginx-creo-click-check.conf" /etc/nginx/sites-available/creo-click-check
sudo ln -sf /etc/nginx/sites-available/creo-click-check /etc/nginx/sites-enabled/creo-click-check
sudo nginx -t
sudo systemctl daemon-reload
sudo systemctl enable --quiet creo-click-check
sudo systemctl restart creo-click-check
sudo systemctl reload nginx

for i in $(seq 1 20); do
  if curl -fsS -o /dev/null http://127.0.0.1:8091/; then echo "OK: http://10.83.24.22:8091/"; exit 0; fi
  sleep 1
done
echo "Service did not come up; last logs:" >&2
sudo journalctl -u creo-click-check -n 30 --no-pager >&2
exit 1
REMOTE
