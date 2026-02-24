from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.database import engine, Base
from app.tasks.scheduler import start_scheduler, stop_scheduler
from app.routers import auth, services, devices, networks, scans, proxmox, pfsense, advisor, settings, ws


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: create tables and start scheduler
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
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
app.include_router(advisor.router)
app.include_router(settings.router)
app.include_router(ws.router)


@app.get("/api/health")
async def health_check():
    return {"status": "ok"}
