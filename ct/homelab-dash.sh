#!/usr/bin/env bash

# ==============================================================================
# Homelab Dashboard - Proxmox LXC Installer
#
# Creates a Debian 12 LXC container on Proxmox and installs Homelab Dashboard.
#
# Usage (run on your Proxmox host):
#   bash -c "$(curl -fsSL https://raw.githubusercontent.com/awarwick-mscst/homelab-dash/main/ct/homelab-dash.sh)"
#
# Or clone and run:
#   git clone https://github.com/awarwick-mscst/homelab-dash.git
#   bash homelab-dash/ct/homelab-dash.sh
# ==============================================================================

set -euo pipefail

# --- App metadata ---
APP="Homelab Dashboard"
APP_SLUG="homelab-dash"
REPO="awarwick-mscst/homelab-dash"
INSTALL_DIR="/opt/homelab-dash"

# --- Default container resources ---
DEFAULT_CPU=2
DEFAULT_RAM=2048      # MB
DEFAULT_DISK=8        # GB
DEFAULT_STORAGE="local-lvm"
DEFAULT_BRIDGE="vmbr0"
DEFAULT_HOSTNAME="homelab-dash"
DEFAULT_OS_TEMPLATE="debian-12-standard"

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

header() {
    echo -e "${CYAN}${BOLD}"
    echo "  ╦ ╦╔═╗╔╦╗╔═╗╦  ╔═╗╔╗   ╔╦╗╔═╗╔═╗╦ ╦"
    echo "  ╠═╣║ ║║║║║╣ ║  ╠═╣╠╩╗   ║║╠═╣╚═╗╠═╣"
    echo "  ╩ ╩╚═╝╩ ╩╚═╝╩═╝╩ ╩╚═╝  ═╩╝╩ ╩╚═╝╩ ╩"
    echo -e "${NC}"
    echo -e "  ${BOLD}Proxmox LXC Installer${NC}"
    echo -e "  ${BLUE}https://github.com/${REPO}${NC}"
    echo ""
}

# --- Detect if running inside an existing LXC (update mode) ---
if [[ ! -f /usr/bin/pveversion ]] 2>/dev/null; then
    if [[ -d "$INSTALL_DIR" ]]; then
        # Fetch and run the dedicated update script
        UPDATE_URL="https://raw.githubusercontent.com/${REPO}/main/install/update.sh"
        curl -fsSL "$UPDATE_URL" -o /tmp/homelab-dash-update.sh
        bash /tmp/homelab-dash-update.sh "$REPO"
        rm -f /tmp/homelab-dash-update.sh
        exit 0
    else
        msg_error "This script must be run on a Proxmox host or inside an existing Homelab Dashboard LXC."
        exit 1
    fi
fi

# ==============================================================================
# Running on Proxmox host — create LXC and install
# ==============================================================================

header

# Check that we're root on a Proxmox host
if [[ $EUID -ne 0 ]]; then
    msg_error "This script must be run as root on the Proxmox host."
    exit 1
fi

if ! command -v pct &>/dev/null; then
    msg_error "pct command not found. This script must be run on a Proxmox VE host."
    exit 1
fi

# --- Gather settings ---
echo -e "${BOLD}Container Settings${NC} (press Enter for defaults)"
echo ""

read -rp "  Hostname [${DEFAULT_HOSTNAME}]: " INPUT_HOSTNAME
HOSTNAME="${INPUT_HOSTNAME:-$DEFAULT_HOSTNAME}"

read -rp "  CPU cores [${DEFAULT_CPU}]: " INPUT_CPU
CPU="${INPUT_CPU:-$DEFAULT_CPU}"

read -rp "  RAM in MB [${DEFAULT_RAM}]: " INPUT_RAM
RAM="${INPUT_RAM:-$DEFAULT_RAM}"

read -rp "  Disk in GB [${DEFAULT_DISK}]: " INPUT_DISK
DISK="${INPUT_DISK:-$DEFAULT_DISK}"

# Detect available storages
echo ""
msg_info "Available storages:"
pvesm status -content rootdir 2>/dev/null | awk 'NR>1 {print "    " $1}' || true
read -rp "  Storage [${DEFAULT_STORAGE}]: " INPUT_STORAGE
STORAGE="${INPUT_STORAGE:-$DEFAULT_STORAGE}"

# Detect available bridges
msg_info "Available bridges:"
ip -br link show type bridge 2>/dev/null | awk '{print "    " $1}' || brctl show 2>/dev/null | awk 'NR>1 {print "    " $1}' || true
read -rp "  Network bridge [${DEFAULT_BRIDGE}]: " INPUT_BRIDGE
BRIDGE="${INPUT_BRIDGE:-$DEFAULT_BRIDGE}"

echo ""
read -rp "  Use DHCP for IP? [Y/n]: " USE_DHCP
if [[ "${USE_DHCP,,}" == "n" ]]; then
    read -rp "  Static IP (CIDR, e.g. 192.168.1.100/24): " STATIC_IP
    read -rp "  Gateway: " GATEWAY
    NET_CONFIG="name=eth0,bridge=${BRIDGE},ip=${STATIC_IP},gw=${GATEWAY}"
else
    NET_CONFIG="name=eth0,bridge=${BRIDGE},ip=dhcp"
fi

# Set password
echo ""
read -rsp "  Container root password (leave blank for auto-generated): " ROOT_PASS
echo ""
if [[ -z "$ROOT_PASS" ]]; then
    ROOT_PASS=$(openssl rand -base64 12)
    echo -e "  ${YELLOW}Generated password: ${ROOT_PASS}${NC}"
    echo -e "  ${YELLOW}Save this password!${NC}"
fi

echo ""
echo -e "${BOLD}Summary:${NC}"
echo "  Hostname:  $HOSTNAME"
echo "  CPU:       $CPU cores"
echo "  RAM:       ${RAM}MB"
echo "  Disk:      ${DISK}GB"
echo "  Storage:   $STORAGE"
echo "  Network:   $NET_CONFIG"
echo ""
read -rp "Proceed with installation? [Y/n]: " CONFIRM
if [[ "${CONFIRM,,}" == "n" ]]; then
    echo "Aborted."
    exit 0
fi

echo ""

# --- Find the next available CT ID ---
CTID=$(pvesh get /cluster/nextid)
msg_info "Using CT ID: $CTID"

# --- Download Debian 12 template if needed ---
msg_info "Checking for Debian 12 template..."
TEMPLATE_STORAGE="local"
TEMPLATE=$(pveam list "$TEMPLATE_STORAGE" 2>/dev/null | grep -oP "debian-12-standard_[^\s]+" | sort -V | tail -1 || true)

if [[ -z "$TEMPLATE" ]]; then
    msg_info "Downloading Debian 12 template..."
    pveam update >/dev/null 2>&1
    TEMPLATE_NAME=$(pveam available --section system 2>/dev/null | grep "debian-12-standard" | awk '{print $2}' | sort -V | tail -1)
    if [[ -z "$TEMPLATE_NAME" ]]; then
        msg_error "Could not find Debian 12 template. Please download it manually via the Proxmox UI."
        exit 1
    fi
    pveam download "$TEMPLATE_STORAGE" "$TEMPLATE_NAME" >/dev/null 2>&1
    TEMPLATE="$TEMPLATE_NAME"
fi
msg_ok "Template: $TEMPLATE"

# --- Create the LXC container ---
msg_info "Creating LXC container $CTID..."
pct create "$CTID" "${TEMPLATE_STORAGE}:vztmpl/${TEMPLATE}" \
    --hostname "$HOSTNAME" \
    --cores "$CPU" \
    --memory "$RAM" \
    --rootfs "${STORAGE}:${DISK}" \
    --net0 "$NET_CONFIG" \
    --ostype debian \
    --unprivileged 1 \
    --features nesting=1 \
    --password "$ROOT_PASS" \
    --start 0 \
    >/dev/null 2>&1
msg_ok "Container $CTID created"

# --- Start the container ---
msg_info "Starting container..."
pct start "$CTID"

# Wait for network
msg_info "Waiting for network..."
for i in $(seq 1 30); do
    if pct exec "$CTID" -- ping -c1 -W1 8.8.8.8 &>/dev/null; then
        break
    fi
    sleep 1
done
msg_ok "Network is up"

# --- Run the install script inside the container ---
msg_info "Running installer inside container (this may take a few minutes)..."

INSTALL_SCRIPT_URL="https://raw.githubusercontent.com/${REPO}/main/install/homelab-dash-install.sh"

pct exec "$CTID" -- bash -c "
    curl -fsSL '${INSTALL_SCRIPT_URL}' -o /tmp/install.sh
    bash /tmp/install.sh '${REPO}'
    rm -f /tmp/install.sh
"

# --- Get the container IP ---
sleep 2
CT_IP=$(pct exec "$CTID" -- hostname -I 2>/dev/null | awk '{print $1}')

echo ""
echo -e "${GREEN}${BOLD}╔══════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}${BOLD}║          Homelab Dashboard installed successfully!       ║${NC}"
echo -e "${GREEN}${BOLD}╚══════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "  ${BOLD}Dashboard URL:${NC}     http://${CT_IP}"
echo -e "  ${BOLD}Container ID:${NC}      ${CTID}"
echo -e "  ${BOLD}Container IP:${NC}      ${CT_IP}"
echo -e "  ${BOLD}Root Password:${NC}     (as entered above)"
echo ""
echo -e "  Create your admin account by visiting the dashboard."
echo ""
echo -e "  ${BOLD}To update later:${NC}"
echo -e "    pct exec ${CTID} -- bash -c \"\$(curl -fsSL https://raw.githubusercontent.com/${REPO}/main/ct/homelab-dash.sh)\""
echo -e "    ${CYAN}or run 'update' inside the container${NC}"
echo ""
