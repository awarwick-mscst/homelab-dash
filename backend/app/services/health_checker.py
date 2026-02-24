import time
from datetime import datetime, timezone

import httpx
from sqlalchemy import select

from app.database import async_session
from app.models.service import MonitoredService, ServiceStatus
from app.services.ws_manager import ws_manager


async def check_all_services():
    async with async_session() as db:
        result = await db.execute(select(MonitoredService))
        services = result.scalars().all()

        for service in services:
            await check_service(db, service)

        await db.commit()


async def check_service(db, service: MonitoredService):
    try:
        async with httpx.AsyncClient(verify=False) as client:
            start = time.monotonic()
            resp = await client.get(service.url, timeout=10, follow_redirects=True)
            elapsed = int((time.monotonic() - start) * 1000)

            old_status = service.status
            if resp.status_code == service.expected_status_code:
                service.status = ServiceStatus.online
            else:
                service.status = ServiceStatus.degraded
            service.response_time_ms = elapsed
            service.last_checked = datetime.now(timezone.utc)

            if old_status != service.status:
                await ws_manager.broadcast({
                    "type": "service_status",
                    "service_id": service.id,
                    "name": service.name,
                    "status": service.status.value,
                    "response_time_ms": elapsed,
                })

    except Exception:
        old_status = service.status
        service.status = ServiceStatus.offline
        service.response_time_ms = None
        service.last_checked = datetime.now(timezone.utc)

        if old_status != service.status:
            await ws_manager.broadcast({
                "type": "service_status",
                "service_id": service.id,
                "name": service.name,
                "status": "offline",
            })
