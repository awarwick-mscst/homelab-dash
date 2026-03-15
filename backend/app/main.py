from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.database import async_session, migrate_schema
from app.tasks.scheduler import start_scheduler, stop_scheduler
from app.routers import auth, services, devices, networks, scans, proxmox, pfsense, sonicwall, unifi, advisor, settings, ws, ollama, switch, dns
from app.routers.settings import restore_saved_settings


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: create tables + add any missing columns, restore settings, start scheduler
    await migrate_schema()
    async with async_session() as db:
        await restore_saved_settings(db)
    start_scheduler()
    yield
    # Shutdown
    stop_scheduler()


app = FastAPI(title="Homelab Dashboard", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(services.router)
app.include_router(devices.router)
app.include_router(networks.router)
app.include_router(scans.router)
app.include_router(proxmox.router)
app.include_router(pfsense.router)
app.include_router(sonicwall.router)
app.include_router(unifi.router)
app.include_router(switch.router)
app.include_router(advisor.router)
app.include_router(ollama.router)
app.include_router(dns.router)
app.include_router(settings.router)
app.include_router(ws.router)


@app.get("/api/health")
async def health_check():
    return {"status": "ok"}
