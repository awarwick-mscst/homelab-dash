import asyncio
import xml.etree.ElementTree as ET
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import async_session
from app.models.scan import ScanJob, ScanStatus, ScanProfile
from app.models.device import Device, DevicePort
from app.services.ws_manager import ws_manager

SCAN_ARGS = {
    ScanProfile.ping_sweep: ["-sn", "-T4"],
    ScanProfile.port_scan: ["-sS", "-T4", "--top-ports", "1000"],
    ScanProfile.os_detect: ["-sS", "-O", "-T4", "--top-ports", "1000"],
    ScanProfile.full: ["-sS", "-sV", "-O", "-T4", "-p-"],
}


async def run_scan(scan_id: int):
    async with async_session() as db:
        scan = await db.get(ScanJob, scan_id)
        if not scan or scan.status == ScanStatus.cancelled:
            return

        scan.status = ScanStatus.running
        scan.started_at = datetime.now(timezone.utc)
        await db.commit()
        await ws_manager.broadcast(
            {"type": "scan_status", "scan_id": scan_id, "status": "running", "progress": 0}
        )

        try:
            args = SCAN_ARGS.get(scan.profile, SCAN_ARGS[ScanProfile.ping_sweep])
            cmd = [settings.nmap_path, "-oX", "-", *args, scan.target]
            process = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, stderr = await process.communicate()

            if process.returncode != 0:
                scan.status = ScanStatus.failed
                scan.error_message = stderr.decode() if stderr else "nmap failed"
                scan.completed_at = datetime.now(timezone.utc)
                await db.commit()
                await ws_manager.broadcast(
                    {"type": "scan_status", "scan_id": scan_id, "status": "failed"}
                )
                return

            hosts = parse_nmap_xml(stdout.decode())
            scan.results = {"hosts": hosts}
            scan.hosts_found = len(hosts)
            scan.status = ScanStatus.completed
            scan.completed_at = datetime.now(timezone.utc)
            scan.progress = 100
            await db.commit()

            await upsert_devices(db, hosts)
            await ws_manager.broadcast(
                {
                    "type": "scan_status",
                    "scan_id": scan_id,
                    "status": "completed",
                    "progress": 100,
                    "hosts_found": len(hosts),
                }
            )

        except Exception as e:
            scan.status = ScanStatus.failed
            scan.error_message = str(e)
            scan.completed_at = datetime.now(timezone.utc)
            await db.commit()
            await ws_manager.broadcast(
                {"type": "scan_status", "scan_id": scan_id, "status": "failed"}
            )


def parse_nmap_xml(xml_data: str) -> list[dict]:
    hosts = []
    try:
        root = ET.fromstring(xml_data)
    except ET.ParseError:
        return hosts

    for host_el in root.findall("host"):
        if host_el.find("status") is not None and host_el.find("status").get("state") != "up":
            continue

        host: dict = {"ip": "", "hostname": None, "mac": None, "vendor": None, "os": None, "ports": []}

        for addr in host_el.findall("address"):
            if addr.get("addrtype") == "ipv4":
                host["ip"] = addr.get("addr", "")
            elif addr.get("addrtype") == "mac":
                host["mac"] = addr.get("addr")
                host["vendor"] = addr.get("vendor")

        hostnames = host_el.find("hostnames")
        if hostnames is not None:
            hn = hostnames.find("hostname")
            if hn is not None:
                host["hostname"] = hn.get("name")

        os_el = host_el.find("os")
        if os_el is not None:
            osmatch = os_el.find("osmatch")
            if osmatch is not None:
                host["os"] = osmatch.get("name")

        ports_el = host_el.find("ports")
        if ports_el is not None:
            for port_el in ports_el.findall("port"):
                state_el = port_el.find("state")
                service_el = port_el.find("service")
                port_info = {
                    "port": int(port_el.get("portid", 0)),
                    "protocol": port_el.get("protocol", "tcp"),
                    "state": state_el.get("state", "unknown") if state_el is not None else "unknown",
                    "service": service_el.get("name") if service_el is not None else None,
                    "version": service_el.get("version") if service_el is not None else None,
                }
                host["ports"].append(port_info)

        if host["ip"]:
            hosts.append(host)

    return hosts


async def upsert_devices(db: AsyncSession, hosts: list[dict]):
    now = datetime.now(timezone.utc)
    for host_data in hosts:
        result = await db.execute(
            select(Device).where(Device.ip_address == host_data["ip"])
        )
        device = result.scalar_one_or_none()
        if device:
            device.is_online = True
            device.last_seen = now
            if host_data.get("hostname"):
                device.hostname = host_data["hostname"]
            if host_data.get("mac"):
                device.mac_address = host_data["mac"]
            if host_data.get("vendor"):
                device.vendor = host_data["vendor"]
            if host_data.get("os"):
                device.os_family = host_data["os"]
        else:
            device = Device(
                ip_address=host_data["ip"],
                hostname=host_data.get("hostname"),
                mac_address=host_data.get("mac"),
                vendor=host_data.get("vendor"),
                os_family=host_data.get("os"),
                is_online=True,
                last_seen=now,
                first_seen=now,
            )
            db.add(device)
            await db.flush()

        # Update ports
        for port_data in host_data.get("ports", []):
            existing_port = None
            if device.id:
                port_result = await db.execute(
                    select(DevicePort).where(
                        DevicePort.device_id == device.id,
                        DevicePort.port_number == port_data["port"],
                        DevicePort.protocol == port_data["protocol"],
                    )
                )
                existing_port = port_result.scalar_one_or_none()

            if existing_port:
                existing_port.state = port_data["state"]
                existing_port.service_name = port_data.get("service")
                existing_port.service_version = port_data.get("version")
                existing_port.last_seen = now
            else:
                db.add(DevicePort(
                    device_id=device.id,
                    port_number=port_data["port"],
                    protocol=port_data["protocol"],
                    state=port_data["state"],
                    service_name=port_data.get("service"),
                    service_version=port_data.get("version"),
                    last_seen=now,
                ))

    await db.commit()
