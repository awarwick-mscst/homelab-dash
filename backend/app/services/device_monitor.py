import asyncio
import time
import platform
from datetime import datetime, timezone

import httpx
from sqlalchemy import select

from app.database import async_session
from app.models.device import Device
from app.services.ws_manager import ws_manager


async def _ping(ip: str) -> tuple[bool, int | None]:
    """Ping a device and return (is_alive, rtt_ms)."""
    param = "-n" if platform.system().lower() == "windows" else "-c"
    timeout_flag = "-w" if platform.system().lower() == "windows" else "-W"
    cmd = ["ping", param, "1", timeout_flag, "2", ip]
    try:
        start = time.monotonic()
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        await proc.communicate()
        elapsed = int((time.monotonic() - start) * 1000)
        return proc.returncode == 0, elapsed
    except Exception:
        return False, None


async def check_monitored_devices():
    async with async_session() as db:
        result = await db.execute(
            select(Device).where(Device.is_monitored == True)
        )
        devices = result.scalars().all()

        for device in devices:
            old_status = device.monitor_status

            # Ping check
            alive, ping_ms = await _ping(device.ip_address)

            if not alive:
                device.monitor_status = "offline"
                device.is_online = False
                device.response_time_ms = None
            elif device.monitor_url:
                # HTTP health check
                try:
                    async with httpx.AsyncClient(verify=False) as client:
                        start = time.monotonic()
                        resp = await client.get(
                            device.monitor_url, timeout=10, follow_redirects=True
                        )
                        elapsed = int((time.monotonic() - start) * 1000)
                        if resp.status_code < 400:
                            device.monitor_status = "online"
                        else:
                            device.monitor_status = "degraded"
                        device.response_time_ms = elapsed
                except Exception:
                    device.monitor_status = "degraded"
                    device.response_time_ms = ping_ms
                device.is_online = True
            else:
                device.monitor_status = "online"
                device.is_online = True
                device.response_time_ms = ping_ms

            device.last_seen = datetime.now(timezone.utc)

            if old_status != device.monitor_status:
                await ws_manager.broadcast({
                    "type": "device_monitor",
                    "device_id": device.id,
                    "hostname": device.hostname,
                    "ip": device.ip_address,
                    "status": device.monitor_status,
                    "response_time_ms": device.response_time_ms,
                })

        await db.commit()
