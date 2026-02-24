#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# Deploy Homelab Dashboard to a Debian 12 LXC from Windows
# Usage: ./deploy-to-lxc.sh <host> [user] [port]
#   host  - IP or hostname of the LXC container
#   user  - SSH user (default: root)
#   port  - SSH port (default: 22)
# ============================================================

HOST="${1:-}"
USER="${2:-root}"
PORT="${3:-22}"
REMOTE_DIR="/opt/homelab-dash"

if [[ -z "$HOST" ]]; then
    echo "Usage: ./deploy-to-lxc.sh <host> [user] [port]"
    echo "  e.g. ./deploy-to-lxc.sh 192.168.1.50"
    exit 1
fi

SSH_OPTS="-o StrictHostKeyChecking=accept-new -p $PORT"
SSH="ssh $SSH_OPTS $USER@$HOST"
SCP="scp $SSH_OPTS -r"

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "=== Deploying Homelab Dashboard ==="
echo "Target: $USER@$HOST:$PORT"
echo ""

# --- 1. Build frontend locally ---
echo "[1/5] Building frontend..."
if [[ ! -d "$ROOT_DIR/frontend/node_modules" ]]; then
    npm install --prefix "$ROOT_DIR/frontend" --silent
fi
npm run build --prefix "$ROOT_DIR/frontend"

# --- 2. Create a clean staging archive to avoid sending node_modules/.venv ---
echo "[2/5] Packaging project..."
STAGING=$(mktemp -d)
trap 'rm -rf "$STAGING"' EXIT

mkdir -p "$STAGING/homelab-dash"
cp -r "$ROOT_DIR/backend" "$STAGING/homelab-dash/"
cp -r "$ROOT_DIR/deploy" "$STAGING/homelab-dash/"

# Only copy the built frontend dist + package files (skip node_modules/src)
mkdir -p "$STAGING/homelab-dash/frontend"
cp -r "$ROOT_DIR/frontend/dist" "$STAGING/homelab-dash/frontend/"

# Remove local dev artifacts from backend copy
rm -rf "$STAGING/homelab-dash/backend/.venv" \
       "$STAGING/homelab-dash/backend/__pycache__" \
       "$STAGING/homelab-dash/backend/app/__pycache__" \
       "$STAGING/homelab-dash/backend/*.db"
find "$STAGING/homelab-dash" -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null || true

# Create tarball
ARCHIVE="$STAGING/homelab-dash.tar.gz"
tar -czf "$ARCHIVE" -C "$STAGING" homelab-dash

# --- 3. Upload to LXC ---
echo "[3/5] Uploading to $HOST..."
$SSH "mkdir -p $REMOTE_DIR"
$SCP "$ARCHIVE" "$USER@$HOST:/tmp/homelab-dash.tar.gz"

# --- 4. Extract on remote ---
echo "[4/5] Extracting on remote..."
$SSH "tar -xzf /tmp/homelab-dash.tar.gz -C /opt/ && rm /tmp/homelab-dash.tar.gz"

# --- 5. Run installer ---
echo "[5/5] Running installer on remote..."
$SSH "chmod +x $REMOTE_DIR/deploy/install.sh && bash $REMOTE_DIR/deploy/install.sh"

echo ""
echo "=== Deployment complete! ==="
echo "Dashboard: http://$HOST"
