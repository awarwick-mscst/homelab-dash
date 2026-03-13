# Homelab Dashboard

**v0.3.0**

A self-hosted dashboard for managing and monitoring your homelab. Service monitoring, device inventory, interactive network topology map, nmap scanning, Proxmox & pfSense integration, DNS monitoring, managed switch support, and a network security advisor — all in one place.

## Install on Proxmox

Run this one-liner on your **Proxmox host** to create a Debian 12 LXC and install everything automatically:

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/awarwick-mscst/homelab-dash/main/ct/homelab-dash.sh)"
```

The installer will prompt you for container settings (hostname, CPU, RAM, disk, storage, network) and handle the rest. Once complete, visit the dashboard URL and create your admin account.

### Update

SSH into the LXC container and run:

```bash
update
```

Or from the Proxmox host:

```bash
pct exec <CTID> -- update
```

This pulls the latest code from GitHub, rebuilds the frontend, updates Python dependencies, and restarts services. Your database and configuration are preserved.

## Features

- **Service Monitoring** — Track uptime and response times for all your self-hosted services with automatic health checks
- **Device Inventory** — Maintain a catalog of every device on your network with hostname, IP, MAC, OS, open ports, and switch port associations
- **Network Topology Map** — Interactive drag-and-drop network diagram built with React Flow, with persistent layout saving and automatic switch port linking
- **Network Scanner** — Run nmap scans (ping sweep, port scan, full) from the browser with real-time progress via WebSocket
- **Proxmox Integration** — View nodes, VMs, and containers; monitor CPU/memory/disk usage; start/stop/reboot guests. Supports both username/password and API token auth.
- **pfSense Integration** — System info, interfaces, ARP table, and gateway status via SNMP or REST API
- **Managed Switch** — Cisco SG250 (and similar) support via SSH — view ports, MAC address table, VLANs, and system info
- **DNS Monitoring** — Track DNS records (A, CNAME, MX, TXT) for your domains and subdomains with change detection and history. Queries public DNS directly (Cloudflare, Google, OpenDNS).
- **Network Advisor** — Rules engine that scores your network security posture with downloadable PDF reports and optional AI-enhanced analysis via Ollama
- **Internet Monitoring** — Dashboard status card showing internet connectivity
- **Dark Mode** — Dark by default, toggle via sidebar

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Python 3.11+ (tested on 3.13), FastAPI, SQLAlchemy 2.0 (async), SQLite (aiosqlite) |
| Frontend | React 18, TypeScript, Vite, Tailwind CSS, shadcn/ui, TanStack Query, Zustand, React Flow |
| Auth | JWT (python-jose), bcrypt |
| Scanning | nmap (async subprocess, XML parsing) |
| DNS | dnspython (async resolver) |
| Switch | asyncssh (SSH), pysnmp (SNMP) |
| PDF Reports | fpdf2 |
| Background Tasks | APScheduler |
| Real-time | WebSocket |

## Development

### Prerequisites

- Python 3.11+
- Node.js 18+
- nmap (for scanning features)

### Quick Start

```bash
# One command — starts both backend and frontend
./start-dev.sh
```

Or manually:

```bash
# Backend
cd backend
python -m venv .venv
.venv/bin/pip install -e .
uvicorn app.main:app --reload    # http://localhost:8000

# Frontend (separate terminal)
cd frontend
npm install
npm run dev                       # http://localhost:5173
```

On first visit, you'll be prompted to create an admin account.

### Manual Deploy (without Proxmox installer)

If you prefer to deploy manually to any Debian 12 server or LXC:

```bash
# Initial deployment (from Git Bash on Windows or any bash shell)
./deploy-to-lxc.sh <host-ip> [user] [port]

# Subsequent updates (preserves database and config)
./update-lxc.sh <host-ip> [user] [port]
```

## Project Structure

```
homelab-dash/
├── ct/
│   └── homelab-dash.sh              # Proxmox LXC creator (run on PVE host)
├── install/
│   ├── homelab-dash-install.sh      # Fresh install script (runs inside LXC)
│   └── update.sh                    # Update script (runs inside LXC)
├── backend/
│   ├── pyproject.toml
│   └── app/
│       ├── main.py                  # FastAPI app, lifespan, CORS
│       ├── config.py                # Pydantic Settings (.env)
│       ├── database.py              # Async SQLAlchemy engine + session
│       ├── dependencies.py          # get_db, get_current_user
│       ├── models/                  # SQLAlchemy models
│       ├── schemas/                 # Pydantic request/response schemas
│       ├── routers/                 # API route handlers
│       ├── services/                # Business logic + external clients
│       └── tasks/                   # APScheduler jobs
├── frontend/
│   ├── package.json
│   ├── vite.config.ts
│   └── src/
│       ├── api/                     # Axios client + per-resource modules
│       ├── hooks/                   # useAuth, useWebSocket
│       ├── stores/                  # Zustand state management
│       ├── components/              # UI components + layout
│       ├── pages/                   # Route pages
│       └── types/                   # TypeScript interfaces
├── deploy/
│   ├── install.sh                   # Legacy Debian LXC installer
│   ├── homelab-dash-backend.service # systemd unit
│   ├── homelab-dash.nginx.conf      # nginx reverse proxy
│   └── .env.example                 # All config options
├── start-dev.sh                     # Local dev launcher
├── deploy-to-lxc.sh                # Manual deployment (from dev machine)
└── update-lxc.sh                   # Manual update (from dev machine)
```

## Configuration

All configuration is via environment variables or a `.env` file in `backend/`. See [`deploy/.env.example`](deploy/.env.example) for all options.

| Variable | Description | Default |
|----------|-------------|---------|
| `SECRET_KEY` | JWT signing key | (auto-generated on install) |
| `DATABASE_URL` | SQLite connection string | `sqlite+aiosqlite:///./homelab.db` |
| `PROXMOX_HOST` | Proxmox VE IP/hostname | (optional) |
| `PROXMOX_TOKEN_ID` | PVE API token ID | (optional) |
| `PROXMOX_TOKEN_SECRET` | PVE API token secret | (optional) |
| `PFSENSE_HOST` | pfSense IP/hostname | (optional) |
| `PFSENSE_API_KEY` | pfSense REST API key | (optional) |
| `PFSENSE_API_SECRET` | pfSense REST API secret | (optional) |
| `NMAP_PATH` | Path to nmap binary | `/usr/bin/nmap` |
| `HEALTH_CHECK_INTERVAL` | Service check interval (seconds) | `60` |

Proxmox, pfSense, switch, and DNS settings can also be configured at runtime via the Settings page.

## License

MIT
