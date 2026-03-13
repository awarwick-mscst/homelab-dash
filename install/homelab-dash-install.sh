#!/usr/bin/env bash

# ==============================================================================
# Homelab Dashboard - LXC Install Script
#
# This script runs INSIDE the Debian 12 LXC container.
# It is called automatically by ct/homelab-dash.sh, or can be run manually:
#
#   curl -fsSL https://raw.githubusercontent.com/awarwick-mscst/homelab-dash/main/install/homelab-dash-install.sh | bash
# ==============================================================================

set -euo pipefail

REPO="${1:-awarwick-mscst/homelab-dash}"
INSTALL_DIR="/opt/homelab-dash"
SERVICE_USER="homelab"
NODE_MAJOR=20

# --- Colors ---
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

msg_info()  { echo -e " ${BLUE}[i]${NC} $1"; }
msg_ok()    { echo -e " ${GREEN}[✓]${NC} $1"; }
msg_error() { echo -e " ${RED}[✗]${NC} $1"; }

# --- Check root ---
if [[ $EUID -ne 0 ]]; then
    msg_error "This script must be run as root."
    exit 1
fi

echo ""
echo -e "${GREEN}Installing Homelab Dashboard...${NC}"
echo ""

# --- 1. System update and dependencies ---
msg_info "Updating system packages..."
apt-get update -qq >/dev/null 2>&1
apt-get upgrade -y -qq >/dev/null 2>&1
msg_ok "System updated"

msg_info "Installing dependencies..."
apt-get install -y -qq \
    python3 python3-venv python3-pip \
    nginx nmap curl sudo git \
    ca-certificates gnupg \
    >/dev/null 2>&1
msg_ok "Dependencies installed"

# --- 2. Install Node.js (for building frontend) ---
msg_info "Installing Node.js ${NODE_MAJOR}..."
if ! command -v node &>/dev/null; then
    mkdir -p /etc/apt/keyrings
    curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg
    echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_${NODE_MAJOR}.x nodistro main" > /etc/apt/sources.list.d/nodesource.list
    apt-get update -qq >/dev/null 2>&1
    apt-get install -y -qq nodejs >/dev/null 2>&1
fi
msg_ok "Node.js $(node --version) installed"

# --- 3. Download app from GitHub ---
msg_info "Downloading Homelab Dashboard from GitHub..."

# Try to get latest release, fall back to main branch
LATEST_TAG=$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" 2>/dev/null | grep '"tag_name"' | sed -E 's/.*"([^"]+)".*/\1/' || true)

if [[ -n "$LATEST_TAG" ]]; then
    DOWNLOAD_URL="https://github.com/${REPO}/archive/refs/tags/${LATEST_TAG}.tar.gz"
    VERSION="$LATEST_TAG"
else
    DOWNLOAD_URL="https://github.com/${REPO}/archive/refs/heads/main.tar.gz"
    VERSION="main"
fi

cd /tmp
curl -fsSL "$DOWNLOAD_URL" -o homelab-dash.tar.gz
tar -xzf homelab-dash.tar.gz
EXTRACTED_DIR=$(ls -d homelab-dash-* | head -1)

mkdir -p "$INSTALL_DIR"
cp -r "/tmp/$EXTRACTED_DIR/backend" "$INSTALL_DIR/"
cp -r "/tmp/$EXTRACTED_DIR/deploy" "$INSTALL_DIR/"
cp -r "/tmp/$EXTRACTED_DIR/frontend" "$INSTALL_DIR/"

# Save version
echo "$VERSION" > "$INSTALL_DIR/version.txt"

# Cleanup
rm -rf "/tmp/$EXTRACTED_DIR" /tmp/homelab-dash.tar.gz
msg_ok "Downloaded ($VERSION)"

# --- 4. Build frontend ---
msg_info "Building frontend (this may take a minute)..."
cd "$INSTALL_DIR/frontend"
npm install --silent 2>/dev/null
npm run build 2>/dev/null
msg_ok "Frontend built"

# --- 5. Setup Python backend ---
msg_info "Setting up Python backend..."
cd "$INSTALL_DIR/backend"
python3 -m venv .venv
.venv/bin/pip install --quiet --upgrade pip
.venv/bin/pip install --quiet .
msg_ok "Backend dependencies installed"

# --- 6. Create .env ---
if [[ ! -f "$INSTALL_DIR/backend/.env" ]]; then
    SECRET=$(openssl rand -hex 32)
    cat > "$INSTALL_DIR/backend/.env" <<EOF
SECRET_KEY=$SECRET
DATABASE_URL=sqlite+aiosqlite:///./homelab.db
NMAP_PATH=/usr/bin/nmap
EOF
    msg_ok "Generated .env with secret key"
else
    msg_info ".env already exists, keeping it"
fi

# --- 7. Create service user ---
msg_info "Creating service user..."
if ! id "$SERVICE_USER" &>/dev/null; then
    useradd --system --home-dir "$INSTALL_DIR" --shell /usr/sbin/nologin "$SERVICE_USER"
fi
msg_ok "Service user ready"

# --- 8. Setup nmap permissions ---
msg_info "Configuring nmap permissions..."
setcap cap_net_raw,cap_net_admin+eip /usr/bin/nmap 2>/dev/null || true
echo "$SERVICE_USER ALL=(root) NOPASSWD: /usr/bin/nmap" > /etc/sudoers.d/homelab-nmap
chmod 0440 /etc/sudoers.d/homelab-nmap
msg_ok "Nmap permissions set"

# --- 9. Install systemd service ---
msg_info "Creating systemd service..."
cp "$INSTALL_DIR/deploy/homelab-dash-backend.service" /etc/systemd/system/
chown -R "$SERVICE_USER":"$SERVICE_USER" "$INSTALL_DIR"
systemctl daemon-reload
systemctl enable -q homelab-dash-backend
systemctl start homelab-dash-backend
msg_ok "Service created and started"

# --- 10. Configure nginx ---
msg_info "Configuring nginx..."
cp "$INSTALL_DIR/deploy/homelab-dash.nginx.conf" /etc/nginx/sites-available/homelab-dash
ln -sf /etc/nginx/sites-available/homelab-dash /etc/nginx/sites-enabled/homelab-dash
rm -f /etc/nginx/sites-enabled/default
nginx -t >/dev/null 2>&1 && systemctl reload nginx
msg_ok "Nginx configured"

# --- 11. Create update helper ---
msg_info "Creating update command..."
cat > /usr/bin/update <<'UPDATEEOF'
#!/usr/bin/env bash
set -euo pipefail
REPO="awarwick-mscst/homelab-dash"
echo "Fetching update script..."
curl -fsSL "https://raw.githubusercontent.com/${REPO}/main/install/update.sh" -o /tmp/homelab-dash-update.sh
bash /tmp/homelab-dash-update.sh "$REPO"
rm -f /tmp/homelab-dash-update.sh
UPDATEEOF
chmod +x /usr/bin/update
msg_ok "Update command created (run 'update' to update)"

# --- 12. Set MOTD ---
cat > /etc/motd <<'MOTDEOF'

  ╦ ╦╔═╗╔╦╗╔═╗╦  ╔═╗╔╗   ╔╦╗╔═╗╔═╗╦ ╦
  ╠═╣║ ║║║║║╣ ║  ╠═╣╠╩╗   ║║╠═╣╚═╗╠═╣
  ╩ ╩╚═╝╩ ╩╚═╝╩═╝╩ ╩╚═╝  ═╩╝╩ ╩╚═╝╩ ╩

  Dashboard:  https://github.com/awarwick-mscst/homelab-dash
  Update:     run 'update' as root

MOTDEOF
msg_ok "MOTD set"

# --- 13. Cleanup ---
msg_info "Cleaning up..."
apt-get autoremove -y -qq >/dev/null 2>&1
apt-get clean >/dev/null 2>&1
rm -rf /var/lib/apt/lists/*
# Remove frontend source/node_modules (keep only dist)
rm -rf "$INSTALL_DIR/frontend/node_modules" \
       "$INSTALL_DIR/frontend/src" \
       "$INSTALL_DIR/frontend/package.json" \
       "$INSTALL_DIR/frontend/package-lock.json" \
       "$INSTALL_DIR/frontend/tsconfig*.json" \
       "$INSTALL_DIR/frontend/vite.config.ts" \
       "$INSTALL_DIR/frontend/index.html" \
       "$INSTALL_DIR/frontend/postcss.config.js" \
       "$INSTALL_DIR/frontend/tailwind.config.js" \
       "$INSTALL_DIR/frontend/components.json" \
       "$INSTALL_DIR/frontend/eslint.config.js" 2>/dev/null || true
msg_ok "Cleaned up"

# --- Done ---
echo ""
sleep 2
if systemctl is-active --quiet homelab-dash-backend; then
    IP=$(hostname -I | awk '{print $1}')
    msg_ok "Installation complete!"
    echo ""
    echo -e "  Dashboard: ${GREEN}http://${IP}${NC}"
    echo "  Create your admin account by visiting the dashboard."
    echo ""
else
    msg_error "Backend service failed to start."
    echo "  Check logs: journalctl -u homelab-dash-backend -n 50"
fi
