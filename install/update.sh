#!/usr/bin/env bash

# ==============================================================================
# Homelab Dashboard - Update Script
#
# Run inside the LXC container to update to the latest version from GitHub.
#
# Usage:
#   update                    (if installed via the installer)
#   bash /opt/homelab-dash/install/update.sh
# ==============================================================================

set -euo pipefail

REPO="${1:-awarwick-mscst/homelab-dash}"
INSTALL_DIR="/opt/homelab-dash"
SERVICE_USER="homelab"

# --- Colors ---
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

msg_info()  { echo -e " ${BLUE}[i]${NC} $1"; }
msg_ok()    { echo -e " ${GREEN}[✓]${NC} $1"; }
msg_warn()  { echo -e " ${YELLOW}[!]${NC} $1"; }
msg_error() { echo -e " ${RED}[✗]${NC} $1"; }

# --- Check root ---
if [[ $EUID -ne 0 ]]; then
    msg_error "This script must be run as root."
    exit 1
fi

if [[ ! -d "$INSTALL_DIR" ]]; then
    msg_error "Homelab Dashboard not found at $INSTALL_DIR"
    exit 1
fi

echo ""
echo -e "${CYAN}${BOLD}  Homelab Dashboard Updater${NC}"
echo ""

# --- Current version ---
CURRENT=$(cat "$INSTALL_DIR/version.txt" 2>/dev/null || echo "unknown")
msg_info "Current version: $CURRENT"

# --- Determine download URL ---
# Try tagged release first, fall back to main branch
msg_info "Checking for latest version..."
LATEST_TAG=$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" 2>/dev/null | grep '"tag_name"' | sed -E 's/.*"([^"]+)".*/\1/' || true)

if [[ -n "$LATEST_TAG" ]]; then
    DOWNLOAD_URL="https://github.com/${REPO}/archive/refs/tags/${LATEST_TAG}.tar.gz"
    VERSION="$LATEST_TAG"
    msg_info "Latest release: $LATEST_TAG"
else
    # No releases — use main branch, get short commit hash as version
    DOWNLOAD_URL="https://github.com/${REPO}/archive/refs/heads/main.tar.gz"
    COMMIT_SHA=$(curl -fsSL "https://api.github.com/repos/${REPO}/commits/main" 2>/dev/null | grep '"sha"' | head -1 | sed -E 's/.*"([a-f0-9]{40})".*/\1/' || true)
    VERSION="main-${COMMIT_SHA:0:7}"
    msg_info "No releases found, using main branch ($VERSION)"
fi

if [[ "$VERSION" == "$CURRENT" ]]; then
    msg_ok "Already up to date ($VERSION)"
    exit 0
fi

# --- Stop service ---
msg_info "Stopping service..."
systemctl stop homelab-dash-backend 2>/dev/null || true

# --- Backup user data ---
msg_info "Backing up user data..."
cp "$INSTALL_DIR/backend/.env" /tmp/homelab-dash-env.bak 2>/dev/null || true
cp "$INSTALL_DIR/backend/homelab.db" /tmp/homelab-dash-db.bak 2>/dev/null || true

# --- Download latest code ---
msg_info "Downloading $VERSION..."
cd /tmp
rm -rf homelab-dash-update.tar.gz homelab-dash-*
curl -fsSL "$DOWNLOAD_URL" -o homelab-dash-update.tar.gz
tar -xzf homelab-dash-update.tar.gz
EXTRACTED_DIR=$(ls -d homelab-dash-* | head -1)

# --- Update backend ---
msg_info "Updating backend..."
rm -rf "$INSTALL_DIR/backend/app"
cp -r "$EXTRACTED_DIR/backend/app" "$INSTALL_DIR/backend/app"
cp "$EXTRACTED_DIR/backend/pyproject.toml" "$INSTALL_DIR/backend/"

# --- Update deploy configs ---
rm -rf "$INSTALL_DIR/deploy"
cp -r "$EXTRACTED_DIR/deploy" "$INSTALL_DIR/"

# --- Build frontend ---
msg_info "Building frontend (this may take a minute)..."
rm -rf /tmp/homelab-dash-frontend-build
cp -r "$EXTRACTED_DIR/frontend" /tmp/homelab-dash-frontend-build
cd /tmp/homelab-dash-frontend-build

# Install Node.js if not present
if ! command -v node &>/dev/null; then
    msg_info "Installing Node.js..."
    mkdir -p /etc/apt/keyrings
    curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg
    echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_20.x nodistro main" > /etc/apt/sources.list.d/nodesource.list
    apt-get update -qq >/dev/null 2>&1
    apt-get install -y -qq nodejs >/dev/null 2>&1
    msg_ok "Node.js installed"
fi

npm install --silent 2>/dev/null
npm run build 2>/dev/null
rm -rf "$INSTALL_DIR/frontend/dist"
mkdir -p "$INSTALL_DIR/frontend"
cp -r dist "$INSTALL_DIR/frontend/dist"
msg_ok "Frontend built"

# --- Cleanup downloads ---
cd /tmp
rm -rf homelab-dash-update.tar.gz "$EXTRACTED_DIR" homelab-dash-frontend-build

# --- Restore user data ---
msg_info "Restoring user data..."
cp /tmp/homelab-dash-env.bak "$INSTALL_DIR/backend/.env" 2>/dev/null || true
cp /tmp/homelab-dash-db.bak "$INSTALL_DIR/backend/homelab.db" 2>/dev/null || true
rm -f /tmp/homelab-dash-env.bak /tmp/homelab-dash-db.bak

# --- Update Python dependencies ---
msg_info "Updating Python dependencies..."
cd "$INSTALL_DIR/backend"
if [[ ! -d .venv ]]; then
    python3 -m venv .venv
fi
.venv/bin/pip install --quiet --upgrade pip
.venv/bin/pip install --quiet .
msg_ok "Dependencies updated"

# --- Update systemd and nginx configs ---
msg_info "Updating service configs..."
cp "$INSTALL_DIR/deploy/homelab-dash-backend.service" /etc/systemd/system/
cp "$INSTALL_DIR/deploy/homelab-dash.nginx.conf" /etc/nginx/sites-available/homelab-dash
ln -sf /etc/nginx/sites-available/homelab-dash /etc/nginx/sites-enabled/homelab-dash

# --- Save version ---
echo "$VERSION" > "$INSTALL_DIR/version.txt"

# --- Fix permissions and restart ---
chown -R "$SERVICE_USER":"$SERVICE_USER" "$INSTALL_DIR"
systemctl daemon-reload
systemctl start homelab-dash-backend
nginx -t >/dev/null 2>&1 && systemctl reload nginx

# --- Verify ---
sleep 2
echo ""
if systemctl is-active --quiet homelab-dash-backend; then
    msg_ok "Update complete! $CURRENT -> $VERSION"
    IP=$(hostname -I | awk '{print $1}')
    echo -e "  Dashboard: ${GREEN}http://${IP}${NC}"
else
    msg_error "Backend failed to start"
    echo "  Check logs: journalctl -u homelab-dash-backend -n 50"
fi
echo ""
