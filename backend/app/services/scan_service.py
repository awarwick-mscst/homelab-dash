import asyncio
import re
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
    ScanProfile.ping_sweep: ["-sn", "-T4", "-R"],
    ScanProfile.port_scan: ["-sT", "-T4", "--top-ports", "1000", "-R"],
    ScanProfile.os_detect: ["-sT", "-O", "-T4", "--top-ports", "1000", "-R"],
    ScanProfile.full: ["-sT", "-sV", "-O", "-T4", "-p-", "-R"],
}

# Matches nmap progress lines like: "About 45.12% done; ETC: 12:34 (0:05:23 remaining)"
_PROGRESS_RE = re.compile(r"About\s+([\d.]+)%\s+done")
# Matches nmap verbose lines like: "Discovered open port 22/tcp on 192.168.1.1"
_DISCOVERED_RE = re.compile(r"Discovered open port (\d+/\w+) on ([\d.]+)")
# Matches task lines like: "SYN Stealth Scan Timing: About 45.12% done"
_TASK_RE = re.compile(r"^([\w\s]+?)\s*(?:Timing:|:)\s*About", re.MULTILINE)


async def _read_stderr(stream, scan_id: int, db, scan: ScanJob):
    """Read nmap stderr line-by-line and broadcast progress updates."""
    last_progress = 0
    buffer = ""
    while True:
        chunk = await stream.read(1024)
        if not chunk:
            break
        buffer += chunk.decode(errors="replace")
        while "\n" in buffer or "\r" in buffer:
            # Split on either \n or \r
            for sep in ("\r\n", "\n", "\r"):
                if sep in buffer:
                    line, buffer = buffer.split(sep, 1)
                    break
            line = line.strip()
            if not line:
                continue

            progress_match = _PROGRESS_RE.search(line)
            if progress_match:
                pct = int(float(progress_match.group(1)))
                if pct != last_progress:
                    last_progress = pct
                    scan.progress = pct
                    await db.commit()
                    await ws_manager.broadcast({
                        "type": "scan_status",
                        "scan_id": scan_id,
                        "status": "running",
                        "progress": pct,
                        "message": line,
                    })
            elif _DISCOVERED_RE.search(line) or line.startswith("Scanning") or line.startswith("Completed") or line.startswith("Initiating"):
                await ws_manager.broadcast({
                    "type": "scan_status",
                    "scan_id": scan_id,
                    "status": "running",
                    "progress": last_progress,
                    "message": line,
                })


async def run_scan(scan_id: int):
    async with async_session() as db:
        scan = await db.get(ScanJob, scan_id)
        if not scan or scan.status == ScanStatus.cancelled:
            return

        scan.status = ScanStatus.running
        scan.started_at = datetime.now(timezone.utc)
        await db.commit()
        await ws_manager.broadcast(
            {"type": "scan_status", "scan_id": scan_id, "status": "running", "progress": 0, "message": "Starting scan..."}
        )

        try:
            args = list(SCAN_ARGS.get(scan.profile, SCAN_ARGS[ScanProfile.ping_sweep]))
            # If custom ports were specified, replace the default port args
            if scan.custom_ports and scan.profile != ScanProfile.ping_sweep:
                # Remove existing port arguments (--top-ports N or -p-)
                filtered_args = []
                skip_next = False
                for i, a in enumerate(args):
                    if skip_next:
                        skip_next = False
                        continue
                    if a == "--top-ports":
                        skip_next = True  # skip the number after --top-ports
                        continue
                    if a == "-p-":
                        continue
                    filtered_args.append(a)
                args = filtered_args + ["-p", scan.custom_ports]
            needs_sudo = scan.profile in (ScanProfile.os_detect, ScanProfile.full)
            cmd = [
                *(["sudo"] if needs_sudo else []),
                settings.nmap_path, "-oX", "-",
                "--stats-every", "5s", "-v",
                *args, scan.target,
            ]
            process = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )

            # Read stderr for progress while nmap runs
            stderr_task = asyncio.create_task(
                _read_stderr(process.stderr, scan_id, db, scan)
            )
            stdout, _ = await asyncio.gather(
                process.stdout.read(),
                stderr_task,
            )
            await process.wait()

            if process.returncode != 0:
                scan.status = ScanStatus.failed
                scan.error_message = "nmap exited with code " + str(process.returncode)
                scan.completed_at = datetime.now(timezone.utc)
                await db.commit()
                await ws_manager.broadcast(
                    {"type": "scan_status", "scan_id": scan_id, "status": "failed", "message": scan.error_message}
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
                    "message": f"Scan complete — {len(hosts)} hosts found",
                }
            )

        except Exception as e:
            scan.status = ScanStatus.failed
            scan.error_message = str(e)
            scan.completed_at = datetime.now(timezone.utc)
            await db.commit()
            await ws_manager.broadcast(
                {"type": "scan_status", "scan_id": scan_id, "status": "failed", "message": str(e)}
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
            if not host["os"]:
                osclass = os_el.find(".//osclass")
                if osclass is not None:
                    family = osclass.get("osfamily", "")
                    gen = osclass.get("osgen", "")
                    host["os"] = f"{family} {gen}".strip() or None

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
                os_str = host_data["os"]
                device.os_family = os_str
                # Try to extract version (e.g. "Linux 5.10 - 5.19" -> family="Linux", version="5.10 - 5.19")
                parts = os_str.split(" ", 1)
                if len(parts) == 2:
                    device.os_family = parts[0]
                    device.os_version = parts[1]
        else:
            os_family = host_data.get("os")
            os_version = None
            if os_family:
                parts = os_family.split(" ", 1)
                if len(parts) == 2:
                    os_family = parts[0]
                    os_version = parts[1]
            device = Device(
                ip_address=host_data["ip"],
                hostname=host_data.get("hostname"),
                mac_address=host_data.get("mac"),
                vendor=host_data.get("vendor"),
                os_family=os_family,
                os_version=os_version,
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
