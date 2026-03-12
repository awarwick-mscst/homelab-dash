import asyncio
import json
import logging
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.device import Device, DevicePort
from app.models.network import Subnet
from app.models.advisory import AdvisoryReport, AdvisoryFinding, Severity
from app.models.app_settings import AppSetting
from app.services.ollama_client import ollama_client

DEFAULT_SYSTEM_PROMPT = "You are a network security expert specializing in homelab environments. Be concise and actionable."

logger = logging.getLogger(__name__)


class AdvisorEngine:
    def __init__(self, db: AsyncSession):
        self.db = db
        self.findings: list[dict] = []
        self._pfsense_data: dict = {}
        self._proxmox_data: dict = {}

    async def _fetch_pfsense_data(self) -> dict:
        """Fetch data from pfSense if configured."""
        try:
            from app.services.pfsense_client import pfsense_client, pfsense_mode
            if pfsense_mode != "api" or not pfsense_client.is_configured:
                return {}
            results = await asyncio.gather(
                pfsense_client.get_system_info(),
                pfsense_client.get_firewall_rules(),
                pfsense_client.get_interfaces(),
                pfsense_client.get_services(),
                pfsense_client.get_gateways(),
                return_exceptions=True,
            )
            data = {}
            keys = ["system", "firewall_rules", "interfaces", "services", "gateways"]
            for key, result in zip(keys, results):
                if isinstance(result, Exception):
                    logger.warning(f"Advisor: pfSense {key} fetch failed: {result}")
                    data[key] = [] if key != "system" else {}
                else:
                    data[key] = result
            return data
        except Exception as e:
            logger.warning(f"Advisor: pfSense import/fetch failed: {e}")
            return {}

    async def _fetch_proxmox_data(self) -> dict:
        """Fetch data from Proxmox if configured."""
        try:
            from app.services.proxmox_client import proxmox_client
            if not proxmox_client.servers:
                return {}
            all_vms = []
            all_nodes = []
            for server in proxmox_client.servers:
                try:
                    nodes = await proxmox_client.get_nodes(server["id"])
                    all_nodes.extend(nodes)
                    for node in nodes:
                        vms = await proxmox_client.get_vms(server["id"], node.get("node", ""))
                        all_vms.extend(vms)
                except Exception as e:
                    logger.warning(f"Advisor: Proxmox {server['id']} fetch failed: {e}")
            return {"nodes": all_nodes, "vms": all_vms}
        except Exception as e:
            logger.warning(f"Advisor: Proxmox import/fetch failed: {e}")
            return {}

    async def run_analysis(self) -> AdvisoryReport:
        subnets = (await self.db.execute(select(Subnet))).scalars().all()
        devices = (await self.db.execute(select(Device))).scalars().all()

        # Fetch all ports for all devices
        all_ports = (await self.db.execute(select(DevicePort))).scalars().all()
        device_ports: dict[int, list[DevicePort]] = {}
        for port in all_ports:
            device_ports.setdefault(port.device_id, []).append(port)

        # Fetch external data sources in parallel
        pf_result, px_result = await asyncio.gather(
            self._fetch_pfsense_data(),
            self._fetch_proxmox_data(),
            return_exceptions=True,
        )
        self._pfsense_data = pf_result if isinstance(pf_result, dict) else {}
        self._proxmox_data = px_result if isinstance(px_result, dict) else {}

        # Existing checks
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

        # New checks from pfSense and Proxmox
        if self._pfsense_data:
            self._check_firewall_rules()
            self._check_pfsense_services()
            self._check_gateway_redundancy()
        if self._proxmox_data:
            self._check_proxmox_security()

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

    # --- pfSense-based checks ---

    def _check_firewall_rules(self):
        rules = self._pfsense_data.get("firewall_rules", [])
        if not rules:
            return

        # Check for overly permissive rules (allow any-any)
        permissive = []
        for rule in rules:
            if not isinstance(rule, dict):
                continue
            # pfrest fields vary; check common patterns for "allow all"
            src = str(rule.get("source", rule.get("src", ""))).lower()
            dst = str(rule.get("destination", rule.get("dst", ""))).lower()
            action = str(rule.get("type", rule.get("action", ""))).lower()
            proto = str(rule.get("protocol", rule.get("ipprotocol", ""))).lower()

            if action == "pass" and "any" in src and "any" in dst:
                iface = rule.get("interface", rule.get("floating", ""))
                permissive.append({"interface": str(iface), "protocol": proto})

        if permissive:
            self.findings.append({
                "category": "firewall",
                "title": "Overly permissive firewall rules",
                "description": f"Found {len(permissive)} firewall rule(s) that allow traffic from any source to any destination.",
                "severity": Severity.high,
                "recommendation": "Review pass-any rules and restrict them to specific sources, destinations, and ports. Follow the principle of least privilege.",
                "details": {"permissive_rules": permissive[:10]},
            })

        # Check for rules with logging disabled on important interfaces
        rules_without_log = [r for r in rules if isinstance(r, dict)
                             and str(r.get("type", r.get("action", ""))).lower() == "pass"
                             and not r.get("log")]
        if len(rules_without_log) > len(rules) * 0.7 and len(rules) >= 5:
            self.findings.append({
                "category": "firewall",
                "title": "Most firewall rules lack logging",
                "description": f"{len(rules_without_log)} of {len(rules)} pass rules don't have logging enabled.",
                "severity": Severity.low,
                "recommendation": "Enable logging on key firewall rules to maintain an audit trail and detect suspicious traffic.",
                "details": {"total_rules": len(rules), "without_log": len(rules_without_log)},
            })

    def _check_pfsense_services(self):
        services = self._pfsense_data.get("services", [])
        system = self._pfsense_data.get("system", {})
        if not services and not system:
            return

        # Check for stopped critical services
        stopped = []
        for svc in services:
            if not isinstance(svc, dict):
                continue
            name = str(svc.get("name", svc.get("description", "")))
            status = str(svc.get("status", "")).lower()
            if status in ("stopped", "not running", "dead"):
                stopped.append(name)

        if stopped:
            self.findings.append({
                "category": "services",
                "title": "pfSense services not running",
                "description": f"{len(stopped)} service(s) are stopped on the firewall: {', '.join(stopped[:5])}.",
                "severity": Severity.medium,
                "recommendation": "Review stopped services. If they should be running, start them. If not needed, disable them to reduce attack surface.",
                "details": {"stopped_services": stopped},
            })

        # Check pfSense system info for high resource usage
        if isinstance(system, dict):
            cpu = system.get("cpu_usage")
            mem = system.get("mem_usage")
            try:
                if cpu is not None and float(cpu) > 80:
                    self.findings.append({
                        "category": "performance",
                        "title": "Firewall CPU usage high",
                        "description": f"pfSense CPU usage is at {cpu}%. High CPU on the firewall can cause packet loss and network degradation.",
                        "severity": Severity.medium,
                        "recommendation": "Investigate CPU-intensive services (Snort/Suricata, pfBlockerNG). Consider hardware upgrade if sustained.",
                        "details": {"cpu_usage": cpu},
                    })
            except (ValueError, TypeError):
                pass
            try:
                if mem is not None and float(mem) > 85:
                    self.findings.append({
                        "category": "performance",
                        "title": "Firewall memory usage high",
                        "description": f"pfSense memory usage is at {mem}%. Low memory can cause instability.",
                        "severity": Severity.medium,
                        "recommendation": "Review memory-heavy packages. Consider adding RAM or reducing state table size.",
                        "details": {"mem_usage": mem},
                    })
            except (ValueError, TypeError):
                pass

    def _check_gateway_redundancy(self):
        gateways = self._pfsense_data.get("gateways", [])
        if not gateways:
            return

        active_gws = [g for g in gateways if isinstance(g, dict)
                       and str(g.get("status", "")).lower() not in ("down", "offline", "")]
        down_gws = [g for g in gateways if isinstance(g, dict)
                     and str(g.get("status", "")).lower() in ("down", "offline")]

        if down_gws:
            names = [str(g.get("name", g.get("gateway", "unknown"))) for g in down_gws]
            self.findings.append({
                "category": "connectivity",
                "title": "Gateway(s) down",
                "description": f"{len(down_gws)} gateway(s) are down: {', '.join(names[:5])}.",
                "severity": Severity.high,
                "recommendation": "Check WAN connectivity and ISP status. If using multi-WAN, verify failover is working.",
                "details": {"down_gateways": names},
            })

        if len(gateways) <= 1:
            self.findings.append({
                "category": "connectivity",
                "title": "No WAN redundancy",
                "description": "Only one gateway is configured. If your ISP goes down, you lose all connectivity.",
                "severity": Severity.info,
                "recommendation": "Consider adding a secondary WAN connection (e.g., LTE failover) for redundancy.",
                "details": {"gateway_count": len(gateways)},
            })

    # --- Proxmox-based checks ---

    def _check_proxmox_security(self):
        vms = self._proxmox_data.get("vms", [])
        nodes = self._proxmox_data.get("nodes", [])
        if not vms and not nodes:
            return

        # Check for VMs running without backups (we can't check backup config,
        # but we can flag running VMs with no snapshots as a reminder)
        running_vms = [v for v in vms if isinstance(v, dict)
                       and str(v.get("status", "")).lower() == "running"]
        if running_vms:
            # General backup reminder based on VM count
            self.findings.append({
                "category": "backup",
                "title": "Verify VM/container backup schedule",
                "description": f"{len(running_vms)} VM(s)/container(s) are running on Proxmox. Ensure they are included in your backup schedule.",
                "severity": Severity.info,
                "recommendation": "Configure Proxmox Backup Server or built-in vzdump schedules. Verify backups are running and test restores periodically.",
                "details": {"running_count": len(running_vms),
                            "vms": [v.get("name", v.get("vmid", "")) for v in running_vms[:10]]},
            })

        # Check for stopped VMs that might be wasting resources
        stopped_vms = [v for v in vms if isinstance(v, dict)
                       and str(v.get("status", "")).lower() == "stopped"]
        if len(stopped_vms) > 3:
            self.findings.append({
                "category": "hygiene",
                "title": "Multiple stopped VMs/containers",
                "description": f"{len(stopped_vms)} VM(s)/container(s) are stopped. Unused VMs can be security liabilities if not patched.",
                "severity": Severity.low,
                "recommendation": "Review stopped VMs. Delete those no longer needed, or ensure they are patched before starting.",
                "details": {"stopped_vms": [v.get("name", v.get("vmid", "")) for v in stopped_vms[:10]]},
            })

        # Check Proxmox node health
        for node in nodes:
            if not isinstance(node, dict):
                continue
            status = str(node.get("status", "")).lower()
            if status != "online":
                name = node.get("node", "unknown")
                self.findings.append({
                    "category": "infrastructure",
                    "title": f"Proxmox node '{name}' is {status}",
                    "description": f"Proxmox node '{name}' is not online (status: {status}). This may affect VM availability.",
                    "severity": Severity.high,
                    "recommendation": "Check the node's status in Proxmox web UI. Verify network connectivity and hardware health.",
                    "details": {"node": name, "status": status},
                })

    async def _load_system_prompt(self) -> str:
        try:
            result = await self.db.execute(
                select(AppSetting).where(AppSetting.key == "advisor_system_prompt")
            )
            setting = result.scalar_one_or_none()
            if setting and setting.value:
                return json.loads(setting.value)
        except Exception:
            pass
        return DEFAULT_SYSTEM_PROMPT

    async def _generate_ai_summary(self, subnets: list, devices: list) -> str | None:
        try:
            findings_text = "\n".join(
                f"- [{f['severity'].value.upper()}] {f['title']}: {f['description']}"
                for f in self.findings
            )
            device_summary = f"{len(devices)} devices discovered"
            subnet_summary = f"{len(subnets)} subnets configured"
            online_count = sum(1 for d in devices if d.is_online)

            # Include pfSense and Proxmox context
            extra_context = []
            if self._pfsense_data:
                fw_rules = self._pfsense_data.get("firewall_rules", [])
                gw_count = len(self._pfsense_data.get("gateways", []))
                svc_count = len(self._pfsense_data.get("services", []))
                extra_context.append(f"pfSense: {len(fw_rules)} firewall rules, {gw_count} gateways, {svc_count} services")
            if self._proxmox_data:
                vm_count = len(self._proxmox_data.get("vms", []))
                node_count = len(self._proxmox_data.get("nodes", []))
                extra_context.append(f"Proxmox: {node_count} nodes, {vm_count} VMs/containers")

            infra_line = ""
            if extra_context:
                infra_line = f"\nInfrastructure: {'. '.join(extra_context)}.\n"

            prompt = (
                f"You are a homelab network security advisor. Analyze these findings and provide "
                f"a concise security assessment with prioritized recommendations.\n\n"
                f"Network overview: {device_summary}, {online_count} online, {subnet_summary}.\n"
                f"{infra_line}\n"
                f"Findings:\n{findings_text}\n\n"
                f"Provide a brief overall assessment (2-3 paragraphs) with the most important "
                f"actions the homelab owner should take first. Be specific and practical."
            )

            system_prompt = await self._load_system_prompt()

            return await ollama_client.generate(
                prompt=prompt,
                system=system_prompt,
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
