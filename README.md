# Homelab Dashboard

**v0.1.0**

A self-hosted dashboard for managing and monitoring your homelab. Service monitoring, device inventory, interactive network topology map, nmap scanning, Proxmox & pfSense integration, and a network security advisor — all in one place.

## Features

- **Service Monitoring** — Track uptime and response times for all your self-hosted services with automatic health checks
- **Device Inventory** — Maintain a catalog of every device on your network with hostname, IP, MAC, OS, and open ports
- **Network Topology Map** — Interactive drag-and-drop network diagram built with React Flow, with persistent layout saving
- **Network Scanner** — Run nmap scans (ping sweep, port scan, full) from the browser with real-time progress via WebSocket
- **Proxmox Integration** — View nodes, VMs, and containers; monitor CPU/memory/disk usage; start/stop/reboot guests. Supports both username/password and API token auth.
- **pfSense Integration** — Browse interfaces, firewall rules, DHCP leases, and VPN status (requires pfSense REST API package)
- **Network Advisor** — Deterministic rules engine that scores your network security posture and provides actionable recommendations (VLAN segmentation, IoT isolation, risky open ports, DNS filtering, and more)
- **Dark Mode** — Dark by default, toggle via sidebar. Preference persists across sessions.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Python 3.11+ (tested on 3.13), FastAPI, SQLAlchemy 2.0 (async), SQLite (aiosqlite), Alembic |
| Frontend | React 18, TypeScript, Vite, Tailwind CSS, shadcn/ui, TanStack Query, Zustand, React Flow |
| Auth | JWT (python-jose), bcrypt |
| Scanning | nmap (async subprocess, XML parsing, TCP connect scans) |
| Background Tasks | APScheduler |
| Real-time | WebSocket |

## Quick Start

### Prerequisites

- Python 3.11+
- Node.js 18+
- nmap (for scanning features)
- Git Bash or WSL (if developing on Windows)

### Development

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

### Deploy to Debian LXC

All deploy scripts must be run from **Git Bash** (not PowerShell) on Windows.

Initial deployment:

```bash
./deploy-to-lxc.sh <lxc-ip> [user] [port]
# e.g. ./deploy-to-lxc.sh 192.168.1.50
```

Subsequent updates (preserves database and config):

```bash
./update-lxc.sh <lxc-ip> [user] [port]
```

After updating, hard refresh the browser (Ctrl+Shift+R) to load the new frontend.

The deploy script handles everything: installs system packages, builds the frontend locally, creates a Python venv on the LXC, generates a `.env` with a random secret key, and sets up systemd + nginx.

## Project Structure

```
homelab-dash/
├── backend/
│   ├── pyproject.toml
│   ├── alembic.ini + alembic/
│   └── app/
│       ├── main.py              # FastAPI app, lifespan, CORS
│       ├── config.py             # Pydantic Settings (.env)
│       ├── database.py           # Async SQLAlchemy engine + session
│       ├── dependencies.py       # get_db, get_current_user
│       ├── models/               # SQLAlchemy models
│       ├── schemas/              # Pydantic request/response schemas
│       ├── routers/              # API route handlers
│       ├── services/             # Business logic + external clients
│       └── tasks/                # APScheduler jobs
├── frontend/
│   ├── package.json
│   ├── vite.config.ts
│   └── src/
│       ├── api/                  # Axios client + per-resource modules
│       ├── hooks/                # useAuth, useWebSocket
│       ├── stores/               # Zustand state management
│       ├── components/           # UI components + layout
│       ├── pages/                # Route pages
│       └── types/                # TypeScript interfaces
├── deploy/
│   ├── install.sh                # Debian LXC installer
│   ├── homelab-dash-backend.service
│   ├── homelab-dash.nginx.conf
│   └── .env.example
├── start-dev.sh                  # Local dev launcher
├── deploy-to-lxc.sh             # Initial deployment script (run from Git Bash)
└── update-lxc.sh                # Update script (preserves data, run from Git Bash)
```

## Configuration

All configuration is via environment variables or a `.env` file in `backend/`. See [`deploy/.env.example`](deploy/.env.example) for all options.

| Variable | Description | Default |
|----------|-------------|---------|
| `SECRET_KEY` | JWT signing key | (must change) |
| `DATABASE_URL` | SQLite connection string | `sqlite+aiosqlite:///./homelab.db` |
| `PROXMOX_HOST` | Proxmox VE IP/hostname | (optional) |
| `PROXMOX_TOKEN_ID` | PVE API token ID | (optional) |
| `PROXMOX_TOKEN_SECRET` | PVE API token secret | (optional) |
| `PFSENSE_HOST` | pfSense IP/hostname | (optional) |
| `PFSENSE_API_KEY` | pfSense REST API key | (optional) |
| `PFSENSE_API_SECRET` | pfSense REST API secret | (optional) |
| `NMAP_PATH` | Path to nmap binary | `/usr/bin/nmap` |
| `HEALTH_CHECK_INTERVAL` | Service check interval (seconds) | `60` |

Proxmox and pfSense credentials can also be configured at runtime via the Settings page. Proxmox supports both username/password and API token authentication. pfSense requires the REST API package — setup instructions are shown on the Settings page.

## License

MIT
