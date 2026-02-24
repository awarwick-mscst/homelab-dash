#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# Update Homelab Dashboard on a running Debian 12 LXC
# Usage: ./update-lxc.sh <host> [user] [port]
#
# Preserves: .env, homelab.db, nmap capabilities, service user
# Updates:   backend code, frontend build, pip deps, systemd/nginx
# ============================================================

HOST="${1:-}"
USER="${2:-root}"
PORT="${3:-22}"
REMOTE_DIR="/opt/homelab-dash"

if [[ -z "$HOST" ]]; then
    echo "Usage: ./update-lxc.sh <host> [user] [port]"
    exit 1
fi

SSH="ssh -o StrictHostKeyChecking=accept-new -p $PORT $USER@$HOST"
SCP="scp -o StrictHostKeyChecking=accept-new -P $PORT -r"

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "=== Updating Homelab Dashboard ==="
echo "Target: $USER@$HOST:$PORT"
echo ""

# --- 1. Build frontend locally ---
echo "[1/5] Building frontend..."
if [[ ! -d "$ROOT_DIR/frontend/node_modules" ]]; then
    npm install --prefix "$ROOT_DIR/frontend" --silent
fi
npm run build --prefix "$ROOT_DIR/frontend"

# --- 2. Package (skip node_modules, .venv, db, .env) ---
echo "[2/5] Packaging project..."
STAGING=$(mktemp -d)
trap 'rm -rf "$STAGING"' EXIT

mkdir -p "$STAGING/homelab-dash"
cp -r "$ROOT_DIR/backend" "$STAGING/homelab-dash/"
cp -r "$ROOT_DIR/deploy" "$STAGING/homelab-dash/"

mkdir -p "$STAGING/homelab-dash/frontend"
cp -r "$ROOT_DIR/frontend/dist" "$STAGING/homelab-dash/frontend/"

rm -rf "$STAGING/homelab-dash/backend/.venv" \
       "$STAGING/homelab-dash/backend/*.db"
find "$STAGING/homelab-dash" -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null || true

ARCHIVE="$STAGING/homelab-dash.tar.gz"
tar -czf "$ARCHIVE" --owner=0 --group=0 -C "$STAGING" homelab-dash

# --- 3. Upload ---
echo "[3/5] Uploading to $HOST..."
$SCP "$ARCHIVE" "$USER@$HOST:/tmp/homelab-dash.tar.gz"

# --- 4. Extract preserving .env and db, then reinstall deps ---
echo "[4/5] Updating remote..."
$SSH bash <<'REMOTE_SCRIPT'
set -euo pipefail
INSTALL_DIR="/opt/homelab-dash"
SERVICE_USER="homelab"

# Stop service
systemctl stop homelab-dash-backend 2>/dev/null || true

# Preserve user data
cp "$INSTALL_DIR/backend/.env" /tmp/homelab-dash-env.bak 2>/dev/null || true
cp "$INSTALL_DIR/backend/homelab.db" /tmp/homelab-dash-db.bak 2>/dev/null || true

# Extract new code
tar -xzf /tmp/homelab-dash.tar.gz --no-same-owner -C /opt/
rm /tmp/homelab-dash.tar.gz

# Restore user data
cp /tmp/homelab-dash-env.bak "$INSTALL_DIR/backend/.env" 2>/dev/null || true
cp /tmp/homelab-dash-db.bak "$INSTALL_DIR/backend/homelab.db" 2>/dev/null || true
rm -f /tmp/homelab-dash-env.bak /tmp/homelab-dash-db.bak

# Reinstall Python deps (picks up new packages)
cd "$INSTALL_DIR/backend"
python3 -m venv .venv
.venv/bin/pip install --quiet --upgrade pip
.venv/bin/pip install --quiet .

# Update systemd/nginx in case they changed
cp "$INSTALL_DIR/deploy/homelab-dash-backend.service" /etc/systemd/system/
cp "$INSTALL_DIR/deploy/homelab-dash.nginx.conf" /etc/nginx/sites-available/homelab-dash
ln -sf /etc/nginx/sites-available/homelab-dash /etc/nginx/sites-enabled/homelab-dash

# Fix permissions and restart
chown -R "$SERVICE_USER":"$SERVICE_USER" "$INSTALL_DIR"
systemctl daemon-reload
systemctl start homelab-dash-backend
nginx -t && systemctl reload nginx
REMOTE_SCRIPT

# --- 5. Verify ---
echo "[5/5] Verifying..."
sleep 2
$SSH "systemctl is-active homelab-dash-backend && echo 'Backend: running' || echo 'Backend: FAILED'"

echo ""
echo "=== Update complete! ==="
echo "Dashboard: http://$HOST"
