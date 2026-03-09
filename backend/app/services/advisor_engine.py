from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.device import Device, DevicePort
from app.models.network import Subnet
from app.models.advisory import AdvisoryReport, AdvisoryFinding, Severity
from app.services.ollama_client import ollama_client


class AdvisorEngine:
    def __init__(self, db: AsyncSession):
        self.db = db
        self.findings: list[dict] = []

    async def run_analysis(self) -> AdvisoryReport:
        subnets = (await self.db.execute(select(Subnet))).scalars().all()
        devices = (await self.db.execute(select(Device))).scalars().all()

        # Fetch all ports for all devices
        all_ports = (await self.db.execute(select(DevicePort))).scalars().all()
        device_ports: dict[int, list[DevicePort]] = {}
        for port in all_ports:
            device_ports.setdefault(port.device_id, []).append(port)

        self._check_flat_network(subnets)
        self._check_vlan_segmentation(subnets)
        self._check_iot_isolation(subnets, devices)
        self._check_guest_network(subnets)
        self._check_management_vlan(subnets)
        self._check_server_segmentation(subnets, devices)
        self._check_open_ports(devices, device_ports)
        self._check_dns_filtering(subnets)
        self._check_default_credentials_risk(devices)
        self._check_unidentified_devices(devices)

        score = self._calculate_score()
        counts = self._count_severities()

        ai_summary = None
        if self.findings and ollama_client.is_configured:
            ai_summary = await self._generate_ai_summary(subnets, devices)

        report = AdvisoryReport(
            overall_score=score,
            total_findings=len(self.findings),
            **counts,
            ai_summary=ai_summary,
            created_at=datetime.now(timezone.utc),
        )
        self.db.add(report)
        await self.db.flush()

        for f in self.findings:
            finding = AdvisoryFinding(report_id=report.id, **f)
            self.db.add(finding)

        await self.db.commit()
        await self.db.refresh(report, ["findings"])
        return report

    def _check_flat_network(self, subnets: list[Subnet]):
        if len(subnets) <= 1:
            self.findings.append({
                "category": "segmentation",
                "title": "Flat network detected",
                "description": "Only one or no subnets are configured. A flat network means all devices share the same broadcast domain, increasing attack surface.",
                "severity": Severity.high,
                "recommendation": "Implement VLANs to segment your network into separate zones (e.g., servers, IoT, guest, management).",
                "details": {"subnet_count": len(subnets)},
            })

    def _check_vlan_segmentation(self, subnets: list[Subnet]):
        vlans = [s for s in subnets if s.vlan_id is not None]
        if subnets and not vlans:
            self.findings.append({
                "category": "segmentation",
                "title": "No VLANs configured",
                "description": "No subnets have VLAN IDs assigned. VLANs provide Layer 2 isolation between network segments.",
                "severity": Severity.medium,
                "recommendation": "Assign VLAN IDs to your subnets and configure your managed switch and router accordingly.",
                "details": None,
            })

    def _check_iot_isolation(self, subnets: list[Subnet], devices: list[Device]):
        iot_subnet = any("iot" in (s.name or "").lower() for s in subnets)
        iot_devices = [d for d in devices if d.device_type == "iot"]
        if iot_devices and not iot_subnet:
            self.findings.append({
                "category": "segmentation",
                "title": "IoT devices not isolated",
                "description": f"Found {len(iot_devices)} IoT device(s) but no dedicated IoT subnet/VLAN.",
                "severity": Severity.high,
                "recommendation": "Create a dedicated IoT VLAN with restricted access to your main network. IoT devices are frequently targeted and often have poor security.",
                "details": {"iot_device_count": len(iot_devices)},
            })

    def _check_guest_network(self, subnets: list[Subnet]):
        has_guest = any("guest" in (s.name or "").lower() for s in subnets)
        if not has_guest:
            self.findings.append({
                "category": "segmentation",
                "title": "No guest network",
                "description": "No dedicated guest network/VLAN found. Guest devices should be isolated from your internal network.",
                "severity": Severity.medium,
                "recommendation": "Create a guest VLAN with internet access only, blocking access to all internal subnets.",
                "details": None,
            })

    def _check_management_vlan(self, subnets: list[Subnet]):
        has_mgmt = any(
            "mgmt" in (s.name or "").lower() or "management" in (s.name or "").lower()
            for s in subnets
        )
        if subnets and not has_mgmt:
            self.findings.append({
                "category": "segmentation",
                "title": "No management VLAN",
                "description": "No dedicated management network found. Management interfaces (switch, AP, hypervisor) should be on a separate VLAN.",
                "severity": Severity.medium,
                "recommendation": "Create a management VLAN for infrastructure device admin interfaces and restrict access to authorized admin IPs only.",
                "details": None,
            })

    def _check_server_segmentation(self, subnets: list[Subnet], devices: list[Device]):
        server_subnet = any("server" in (s.name or "").lower() for s in subnets)
        servers = [d for d in devices if d.device_type == "server"]
        if servers and not server_subnet:
            self.findings.append({
                "category": "segmentation",
                "title": "Servers not in dedicated subnet",
                "description": f"Found {len(servers)} server(s) but no dedicated server subnet.",
                "severity": Severity.medium,
                "recommendation": "Create a dedicated server VLAN to isolate server workloads and apply stricter firewall rules.",
                "details": {"server_count": len(servers)},
            })

    def _check_open_ports(self, devices: list[Device], device_ports: dict[int, list[DevicePort]]):
        risky_ports = {21, 23, 445, 3389, 5900}
        flagged = []
        for device in devices:
            ports = device_ports.get(device.id, [])
            for p in ports:
                if p.port_number in risky_ports and p.state == "open":
                    flagged.append({"ip": device.ip_address, "port": p.port_number, "service": p.service_name})

        if flagged:
            self.findings.append({
                "category": "ports",
                "title": "Risky open ports detected",
                "description": f"Found {len(flagged)} potentially risky open port(s) (FTP, Telnet, SMB, RDP, VNC).",
                "severity": Severity.high,
                "recommendation": "Close unnecessary ports or restrict access via firewall rules. Replace insecure protocols (Telnet→SSH, FTP→SFTP).",
                "details": {"flagged_ports": flagged},
            })

    def _check_dns_filtering(self, subnets: list[Subnet]):
        known_dns_filters = ["1.1.1.2", "1.1.1.3", "9.9.9.9", "208.67.222.123"]
        has_filtering = False
        for s in subnets:
            if s.dns_servers:
                for dns in known_dns_filters:
                    if dns in s.dns_servers:
                        has_filtering = True
                        break
        if subnets and not has_filtering:
            self.findings.append({
                "category": "dns",
                "title": "No DNS filtering detected",
                "description": "None of your subnets appear to use a DNS filtering service.",
                "severity": Severity.low,
                "recommendation": "Consider using a filtering DNS provider (e.g., Quad9, Cloudflare Family, OpenDNS Family Shield) or run Pi-hole/AdGuard Home.",
                "details": None,
            })

    def _check_default_credentials_risk(self, devices: list[Device]):
        unknown = [d for d in devices if d.device_type in ("router", "switch", "ap", "camera") and not d.notes]
        if unknown:
            self.findings.append({
                "category": "credentials",
                "title": "Network devices may have default credentials",
                "description": f"{len(unknown)} network device(s) have no notes indicating credential changes.",
                "severity": Severity.info,
                "recommendation": "Verify that all routers, switches, access points, and cameras have had their default credentials changed.",
                "details": {"device_count": len(unknown)},
            })

    def _check_unidentified_devices(self, devices: list[Device]):
        unknown = [d for d in devices if d.device_type == "unknown" and d.is_online]
        if unknown:
            self.findings.append({
                "category": "inventory",
                "title": "Unidentified devices on network",
                "description": f"{len(unknown)} online device(s) have not been identified/classified.",
                "severity": Severity.low,
                "recommendation": "Review and classify unknown devices. Unidentified devices could be unauthorized.",
                "details": {"ips": [d.ip_address for d in unknown]},
            })

    async def _generate_ai_summary(self, subnets: list, devices: list) -> str | None:
        try:
            findings_text = "\n".join(
                f"- [{f['severity'].value.upper()}] {f['title']}: {f['description']}"
                for f in self.findings
            )
            device_summary = f"{len(devices)} devices discovered"
            subnet_summary = f"{len(subnets)} subnets configured"
            online_count = sum(1 for d in devices if d.is_online)

            prompt = (
                f"You are a homelab network security advisor. Analyze these findings and provide "
                f"a concise security assessment with prioritized recommendations.\n\n"
                f"Network overview: {device_summary}, {online_count} online, {subnet_summary}.\n\n"
                f"Findings:\n{findings_text}\n\n"
                f"Provide a brief overall assessment (2-3 paragraphs) with the most important "
                f"actions the homelab owner should take first. Be specific and practical."
            )

            return await ollama_client.generate(
                prompt=prompt,
                system="You are a network security expert specializing in homelab environments. Be concise and actionable.",
            )
        except Exception:
            return None

    def _calculate_score(self) -> float:
        if not self.findings:
            return 100.0
        penalty = {Severity.critical: 25, Severity.high: 15, Severity.medium: 8, Severity.low: 3, Severity.info: 0}
        total_penalty = sum(penalty.get(f["severity"], 0) for f in self.findings)
        return max(0.0, 100.0 - total_penalty)

    def _count_severities(self) -> dict:
        counts = {"critical_count": 0, "high_count": 0, "medium_count": 0, "low_count": 0, "info_count": 0}
        for f in self.findings:
            key = f"{f['severity'].value}_count"
            if key in counts:
                counts[key] += 1
        return counts
