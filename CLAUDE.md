# homelab-dash

## Project Overview
Full-featured homelab dashboard — service monitoring, device inventory, network topology map, nmap scanning, Proxmox & pfSense integration, and network security advisor.

## Development

### Quick Start
```bash
./start-dev.sh   # starts both backend and frontend
```

### Backend
```bash
cd backend
python -m venv .venv
.venv/bin/pip install -e .
uvicorn app.main:app --reload    # http://localhost:8000
```
Database auto-creates on first startup.

### Frontend
```bash
cd frontend
npm install
npm run dev    # http://localhost:5173, proxies /api and /ws to backend
```

### Build
```bash
cd frontend && npm run build   # TypeScript check + production build
```

### Deploy
```bash
./deploy-to-lxc.sh <ip>    # first-time deploy to Debian 12 LXC
./update-lxc.sh <ip>       # update (preserves .env and database)
```

## Code Style & Conventions
- Backend: Python 3.11+, FastAPI, async SQLAlchemy 2.0, Pydantic v2
- Frontend: React 18 + TypeScript, Vite, Tailwind CSS + shadcn/ui patterns
- Auth: JWT tokens via python-jose, bcrypt via passlib
- API prefix: `/api/` for all REST routes, `/ws` for WebSocket
- First-user registration: `/api/auth/register` only works when no users exist
- All backend routes require JWT auth except `/api/auth/login`, `/api/auth/register`, `/api/auth/setup-required`, `/api/health`

## Git Workflow
- `.gitignore` excludes: `__pycache__`, `.venv`, `node_modules`, `dist`, `.env`, `*.db`
- Never commit `.env` files or database files
- Frontend `dist/` is built locally during deploy, not checked in

## Project Structure
```
backend/app/
  main.py, config.py, database.py, dependencies.py
  models/    — SQLAlchemy models (user, service, device, network, scan, advisory)
  schemas/   — Pydantic request/response models
  routers/   — auth, services, devices, networks, scans, proxmox, pfsense, advisor, settings, ws
  services/  — health_checker, scan_service, proxmox_client, pfsense_client, advisor_engine, ws_manager
  tasks/     — APScheduler (scheduler.py)

frontend/src/
  api/        — Axios client + per-resource API modules
  hooks/      — useAuth, useWebSocket
  stores/     — Zustand (authStore, notificationStore)
  components/ — ui/ (button, card, input, badge, select, tabs, dialog), layout/ (AppShell, ProtectedRoute)
  pages/      — Login, Dashboard, DeviceInventory, NetworkMap, Scanner, Proxmox, PfSense, Advisor, Settings
  types/      — TypeScript interfaces

deploy/
  install.sh                      — Debian 12 LXC installer
  homelab-dash-backend.service    — systemd unit
  homelab-dash.nginx.conf         — nginx reverse proxy
  .env.example                    — all config options

Root scripts:
  start-dev.sh       — local dev launcher (both servers)
  deploy-to-lxc.sh   — initial deployment via SCP+SSH
  update-lxc.sh      — update deployment (preserves data)
```
