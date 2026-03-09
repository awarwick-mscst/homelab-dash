#!/usr/bin/env bash
set -euo pipefail

INSTALL_DIR="/opt/homelab-dash"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SERVICE_USER="homelab"

echo "=== Homelab Dashboard Installer ==="
echo "Target: Debian LXC on Proxmox"
echo ""

# Check root
if [[ $EUID -ne 0 ]]; then
    echo "Error: This script must be run as root."
    exit 1
fi

# Install system dependencies
echo "[1/7] Installing system dependencies..."
apt-get update -qq
apt-get install -y -qq python3 python3-venv python3-pip nginx nmap curl sudo >/dev/null

# Create service user
echo "[2/7] Creating service user..."
if ! id "$SERVICE_USER" &>/dev/null; then
    useradd --system --home-dir "$INSTALL_DIR" --shell /usr/sbin/nologin "$SERVICE_USER"
fi

# Backend setup
echo "[3/7] Setting up Python backend..."
cd "$INSTALL_DIR/backend"
python3 -m venv .venv
.venv/bin/pip install --quiet --upgrade pip
.venv/bin/pip install --quiet .

# Create .env if not exists
if [[ ! -f .env ]]; then
    SECRET=$(openssl rand -hex 32)
    cat > .env <<EOF
SECRET_KEY=$SECRET
DATABASE_URL=sqlite+aiosqlite:///./homelab.db
NMAP_PATH=/usr/bin/nmap
EOF
    echo "  Generated .env with random secret key"
fi

# Allow nmap to run with elevated privileges (OS detection needs raw sockets)
echo "[4/7] Setting nmap permissions..."
setcap cap_net_raw,cap_net_admin+eip /usr/bin/nmap 2>/dev/null || true
echo "$SERVICE_USER ALL=(root) NOPASSWD: /usr/bin/nmap" > /etc/sudoers.d/homelab-nmap
chmod 0440 /etc/sudoers.d/homelab-nmap

# Install systemd service
echo "[5/7] Installing systemd service..."
cp "$SCRIPT_DIR/homelab-dash-backend.service" /etc/systemd/system/

# Fix permissions
chown -R "$SERVICE_USER":"$SERVICE_USER" "$INSTALL_DIR"

systemctl daemon-reload
systemctl enable homelab-dash-backend
systemctl restart homelab-dash-backend

# Install nginx config
echo "[6/7] Configuring nginx..."
cp "$SCRIPT_DIR/homelab-dash.nginx.conf" /etc/nginx/sites-available/homelab-dash
ln -sf /etc/nginx/sites-available/homelab-dash /etc/nginx/sites-enabled/homelab-dash
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

echo ""
echo "[7/7] Verifying..."
sleep 2
if systemctl is-active --quiet homelab-dash-backend; then
    echo "Backend: running"
else
    echo "Backend: FAILED — check 'journalctl -u homelab-dash-backend'"
fi

echo ""
echo "=== Installation complete! ==="
echo "Dashboard: http://$(hostname -I | awk '{print $1}')"
echo "Create your admin account by visiting the dashboard."
