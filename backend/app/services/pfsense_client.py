import logging
import httpx
from app.config import settings

logger = logging.getLogger(__name__)

# Lazy-load pysnmp so the app starts even if the package is missing
_pysnmp = None

def _ensure_pysnmp():
    global _pysnmp
    if _pysnmp is not None:
        return _pysnmp
    try:
        from pysnmp.hlapi.asyncio import (
            getCmd,
            bulkWalkCmd,
            CommunityData,
            UdpTransportTarget,
            ContextData,
            ObjectType,
            ObjectIdentity,
            SnmpEngine,
        )
        _pysnmp = {
            "get_cmd": getCmd,
            "bulk_walk_cmd": bulkWalkCmd,
            "CommunityData": CommunityData,
            "UdpTransportTarget": UdpTransportTarget,
            "ContextData": ContextData,
            "ObjectType": ObjectType,
            "ObjectIdentity": ObjectIdentity,
            "SnmpEngine": SnmpEngine,
        }
    except ImportError:
        logger.warning("pysnmp-lextudio not installed — SNMP mode will be unavailable")
        _pysnmp = {}
    return _pysnmp


def _require_pysnmp():
    snmp = _ensure_pysnmp()
    if not snmp:
        raise RuntimeError("pysnmp-lextudio is not installed. Install it with: pip install pysnmp-lextudio>=7.0.0")
    return snmp


class PfSenseClient:
    def __init__(self):
        self._host = ""
        self._api_key = ""
        self._api_secret = ""
        self._verify_ssl = False
        self._api_version = ""  # auto-detected: "v1" or "v2"
        self._configure()

    def _configure(self):
        if settings.pfsense_host:
            self._host = settings.pfsense_host
            self._api_key = settings.pfsense_api_key
            self._api_secret = settings.pfsense_api_secret
            self._verify_ssl = settings.pfsense_verify_ssl

    def update_config(self, host: str, api_key: str, api_secret: str = "", verify_ssl: bool = False):
        self._host = host
        self._api_key = api_key
        self._api_secret = api_secret
        self._verify_ssl = verify_ssl
        self._api_version = ""  # reset so we re-detect

    @property
    def is_configured(self) -> bool:
        return bool(self._host and self._api_key)

    def _build_headers(self) -> dict:
        headers = {"Content-Type": "application/json"}
        if self._api_key and self._api_secret:
            headers["Authorization"] = f"{self._api_key} {self._api_secret}"
        elif self._api_key:
            headers["Authorization"] = self._api_key
        return headers

    def _base_url(self, version: str = "") -> str:
        v = version or self._api_version or "v2"
        scheme = "https"
        host = self._host
        # Strip any existing scheme
        if host.startswith("http://"):
            scheme = "http"
            host = host[7:]
        elif host.startswith("https://"):
            host = host[8:]
        return f"{scheme}://{host}/api/{v}"

    async def _detect_api_version(self):
        """Try v2 first, fall back to v1."""
        if self._api_version:
            return
        headers = self._build_headers()
        async with httpx.AsyncClient(verify=self._verify_ssl) as client:
            for ver in ("v2", "v1"):
                try:
                    resp = await client.get(
                        f"{self._base_url(ver)}/status/system",
                        headers=headers, timeout=10,
                    )
                    if resp.status_code < 500:
                        self._api_version = ver
                        logger.info(f"pfSense REST API detected version: {ver}")
                        return
                except Exception:
                    continue
        # Default to v2 if detection fails
        self._api_version = "v2"
        logger.warning("pfSense API version detection failed, defaulting to v2")

    async def _get(self, path: str) -> dict:
        if not self.is_configured:
            raise RuntimeError("pfSense not configured")
        await self._detect_api_version()
        headers = self._build_headers()
        url = f"{self._base_url()}{path}"
        logger.debug(f"pfSense API GET {url}")
        async with httpx.AsyncClient(verify=self._verify_ssl) as client:
            resp = await client.get(url, headers=headers, timeout=15)
            resp.raise_for_status()
            body = resp.json()
        # pfSense REST API wraps responses in {"data": ...}
        if isinstance(body, dict) and "data" in body:
            return body["data"]
        return body

    async def get_interfaces(self) -> list:
        data = await self._get("/interface")
        # v2 returns a list, v1 might return a dict keyed by interface name
        if isinstance(data, dict):
            return list(data.values()) if data else []
        return data if isinstance(data, list) else []

    async def get_firewall_rules(self) -> list:
        data = await self._get("/firewall/rule")
        if isinstance(data, dict):
            return list(data.values()) if data else []
        return data if isinstance(data, list) else []

    async def get_dhcp_leases(self) -> list:
        # Try different endpoints for DHCP leases
        for path in ("/services/dhcpd/lease", "/dhcp/lease", "/services/dhcpd"):
            try:
                data = await self._get(path)
                if isinstance(data, dict):
                    return list(data.values()) if data else []
                return data if isinstance(data, list) else []
            except httpx.HTTPStatusError as e:
                if e.response.status_code == 404:
                    continue
                raise
        return []

    async def get_gateways(self) -> list:
        data = await self._get("/routing/gateway")
        if isinstance(data, dict):
            return list(data.values()) if data else []
        return data if isinstance(data, list) else []

    async def get_openvpn_status(self) -> list:
        try:
            data = await self._get("/openvpn/server")
            if isinstance(data, dict):
                return list(data.values()) if data else []
            return data if isinstance(data, list) else []
        except httpx.HTTPStatusError:
            return []

    async def get_system_info(self) -> dict:
        # Try status/system first (more info), fall back to system/info
        for path in ("/status/system", "/system/info"):
            try:
                data = await self._get(path)
                if isinstance(data, dict):
                    return data
            except httpx.HTTPStatusError as e:
                if e.response.status_code == 404:
                    continue
                raise
        return {}


class PfSenseSnmpClient:
    def __init__(self):
        self._host = ""
        self._community_string = "public"
        self._port = 161
        self._configure()

    def _configure(self):
        if settings.pfsense_host and settings.pfsense_mode == "snmp":
            self._host = settings.pfsense_host
            self._community_string = settings.pfsense_snmp_community
            self._port = settings.pfsense_snmp_port

    def update_config(self, host: str, community: str = "public", port: int = 161):
        self._host = host
        self._community_string = community
        self._port = port

    @property
    def is_configured(self) -> bool:
        return bool(self._host)

    def _make_transport(self):
        snmp = _require_pysnmp()
        return snmp["UdpTransportTarget"]((self._host, self._port), timeout=10, retries=2)

    async def _get_scalar(self, *oids: str) -> dict[str, str]:
        """Get one or more scalar OID values."""
        if not self.is_configured:
            raise RuntimeError("pfSense SNMP not configured")
        snmp = _require_pysnmp()
        engine = snmp["SnmpEngine"]()
        obj_types = [snmp["ObjectType"](snmp["ObjectIdentity"](oid)) for oid in oids]
        transport = self._make_transport()
        error_indication, error_status, _error_index, var_binds = await snmp["get_cmd"](
            engine,
            snmp["CommunityData"](self._community_string),
            transport,
            snmp["ContextData"](),
            *obj_types,
        )
        engine.closeDispatcher()
        if error_indication:
            raise RuntimeError(f"SNMP error: {error_indication}")
        if error_status:
            raise RuntimeError(f"SNMP error: {error_status.prettyPrint()}")
        result = {}
        for oid, val in var_binds:
            result[str(oid)] = val.prettyPrint()
        return result

    async def _walk_table(self, oid: str) -> list[tuple[str, str]]:
        """Walk an SNMP table and return list of (oid, value) pairs."""
        if not self.is_configured:
            raise RuntimeError("pfSense SNMP not configured")
        snmp = _require_pysnmp()
        engine = snmp["SnmpEngine"]()
        transport = self._make_transport()
        results = []
        async for error_indication, error_status, _error_index, var_binds in snmp["bulk_walk_cmd"](
            engine,
            snmp["CommunityData"](self._community_string),
            transport,
            snmp["ContextData"](),
            0, 25,  # non-repeaters, max-repetitions
            snmp["ObjectType"](snmp["ObjectIdentity"](oid)),
        ):
            if error_indication:
                break
            if error_status:
                break
            for oid_obj, val in var_binds:
                results.append((str(oid_obj), val.prettyPrint()))
        engine.closeDispatcher()
        return results

    async def get_system_info(self) -> dict:
        """Get system info from SNMPv2-MIB system group + CPU/memory/PF states."""
        oids = {
            "1.3.6.1.2.1.1.1.0": "description",   # sysDescr
            "1.3.6.1.2.1.1.3.0": "uptime",         # sysUpTime
            "1.3.6.1.2.1.1.4.0": "contact",        # sysContact
            "1.3.6.1.2.1.1.5.0": "hostname",        # sysName
            "1.3.6.1.2.1.1.6.0": "location",        # sysLocation
        }
        raw = await self._get_scalar(*oids.keys())
        result = {}
        for oid_str, field_name in oids.items():
            result[field_name] = raw.get(oid_str, "")
        # Convert uptime from timeticks (hundredths of a second) to human-readable
        try:
            ticks = int(result.get("uptime", "0"))
            seconds = ticks // 100
            days, rem = divmod(seconds, 86400)
            hours, rem = divmod(rem, 3600)
            minutes, _ = divmod(rem, 60)
            result["uptime"] = f"{days}d {hours}h {minutes}m"
            result["uptime_seconds"] = seconds
        except (ValueError, TypeError):
            pass

        # Try to get extended stats (CPU, memory, PF states, TCP connections)
        extended_oids = {
            "1.3.6.1.4.1.2021.10.1.3.1": "cpu_load_1",        # laLoad.1  (1-min load avg)
            "1.3.6.1.4.1.2021.10.1.3.2": "cpu_load_5",        # laLoad.2  (5-min load avg)
            "1.3.6.1.4.1.2021.10.1.3.3": "cpu_load_15",       # laLoad.3  (15-min load avg)
            "1.3.6.1.4.1.2021.4.5.0": "mem_total_kb",          # memTotalReal
            "1.3.6.1.4.1.2021.4.6.0": "mem_avail_kb",          # memAvailReal
            "1.3.6.1.4.1.2021.4.11.0": "mem_free_kb",          # memTotalFree
            "1.3.6.1.4.1.2021.4.14.0": "mem_buffer_kb",        # memBuffer
            "1.3.6.1.4.1.2021.4.15.0": "mem_cached_kb",        # memCached
            "1.3.6.1.2.1.6.9.0": "tcp_established",            # tcpCurrEstab
            "1.3.6.1.4.1.12325.1.200.1.2.1.0": "pf_states",   # begemotPfStatesCount (FreeBSD PF)
        }
        try:
            ext_raw = await self._get_scalar(*extended_oids.keys())
            for oid_str, field_name in extended_oids.items():
                val = ext_raw.get(oid_str, "")
                if val and "No Such" not in str(val) and "noSuch" not in str(val):
                    result[field_name] = val
        except Exception:
            pass  # Extended stats are optional

        # Compute memory percentage if available
        try:
            total = int(result.get("mem_total_kb", 0))
            avail = int(result.get("mem_avail_kb", 0))
            if total > 0:
                result["mem_used_kb"] = total - avail
                result["mem_percent"] = round((total - avail) / total * 100, 1)
        except (ValueError, TypeError):
            pass

        return result

    async def get_interfaces(self) -> list[dict]:
        """Get interface table from IF-MIB with IP addresses."""
        prefixes = {
            "1.3.6.1.2.1.2.2.1.2":  "name",        # ifDescr
            "1.3.6.1.2.1.2.2.1.4":  "mtu",         # ifMtu
            "1.3.6.1.2.1.2.2.1.5":  "speed",       # ifSpeed
            "1.3.6.1.2.1.2.2.1.7":  "admin_status", # ifAdminStatus
            "1.3.6.1.2.1.2.2.1.8":  "oper_status",  # ifOperStatus
            "1.3.6.1.2.1.2.2.1.10": "in_octets",   # ifInOctets
            "1.3.6.1.2.1.2.2.1.14": "in_errors",   # ifInErrors
            "1.3.6.1.2.1.2.2.1.16": "out_octets",  # ifOutOctets
            "1.3.6.1.2.1.2.2.1.20": "out_errors",  # ifOutErrors
        }
        interfaces: dict[str, dict] = {}
        for oid_prefix, field in prefixes.items():
            rows = await self._walk_table(oid_prefix)
            for oid_str, val in rows:
                idx = oid_str[len(oid_prefix) + 1:]
                if idx not in interfaces:
                    interfaces[idx] = {"index": idx}
                interfaces[idx][field] = val

        # Try to get 64-bit HC counters (more accurate for high-traffic interfaces)
        hc_prefixes = {
            "1.3.6.1.2.1.31.1.1.1.6":  "in_octets",   # ifHCInOctets
            "1.3.6.1.2.1.31.1.1.1.10": "out_octets",  # ifHCOutOctets
            "1.3.6.1.2.1.31.1.1.1.18": "alias",       # ifAlias (interface description)
        }
        for oid_prefix, field in hc_prefixes.items():
            try:
                rows = await self._walk_table(oid_prefix)
                for oid_str, val in rows:
                    idx = oid_str[len(oid_prefix) + 1:]
                    if idx in interfaces and val and "noSuch" not in str(val):
                        interfaces[idx][field] = val
            except Exception:
                pass

        # Get IP addresses for interfaces from ipAddrTable
        ip_map: dict[str, list[str]] = {}  # ifIndex -> list of IPs
        try:
            ip_addr_rows = await self._walk_table("1.3.6.1.2.1.4.20.1.1")   # ipAdEntAddr
            ip_ifidx_rows = await self._walk_table("1.3.6.1.2.1.4.20.1.2")  # ipAdEntIfIndex
            ip_mask_rows = await self._walk_table("1.3.6.1.2.1.4.20.1.3")   # ipAdEntNetMask
            # Build IP -> ifIndex mapping
            addr_list = [(oid.split("1.3.6.1.2.1.4.20.1.1.")[-1], val) for oid, val in ip_addr_rows]
            idx_list = [(oid.split("1.3.6.1.2.1.4.20.1.2.")[-1], val) for oid, val in ip_ifidx_rows]
            mask_list = [(oid.split("1.3.6.1.2.1.4.20.1.3.")[-1], val) for oid, val in ip_mask_rows]
            idx_map = {k: v for k, v in idx_list}
            mask_map = {k: v for k, v in mask_list}
            for key, ip_addr in addr_list:
                if_index = idx_map.get(key, "")
                mask = mask_map.get(key, "")
                if if_index:
                    ip_str = f"{ip_addr}/{mask}" if mask else ip_addr
                    ip_map.setdefault(if_index, []).append(ip_str)
        except Exception:
            pass

        status_map = {"1": "up", "2": "down", "3": "testing"}
        result = []
        for iface in interfaces.values():
            iface["admin_status"] = status_map.get(iface.get("admin_status", ""), iface.get("admin_status", ""))
            iface["oper_status"] = status_map.get(iface.get("oper_status", ""), iface.get("oper_status", ""))
            for num_field in ("mtu", "speed", "in_octets", "out_octets", "in_errors", "out_errors"):
                try:
                    iface[num_field] = int(iface.get(num_field, 0))
                except (ValueError, TypeError):
                    iface[num_field] = 0
            iface["ip_addresses"] = ip_map.get(iface["index"], [])
            result.append(iface)
        return result

    async def get_arp_table(self) -> list[dict]:
        """Get ARP table from ipNetToMediaTable."""
        prefix_base = "1.3.6.1.2.1.4.22.1"
        columns = {
            f"{prefix_base}.1": "if_index",
            f"{prefix_base}.2": "mac",
            f"{prefix_base}.3": "ip",
            f"{prefix_base}.4": "type",
        }
        entries: dict[str, dict] = {}
        for oid_prefix, field in columns.items():
            rows = await self._walk_table(oid_prefix)
            for oid_str, val in rows:
                idx = oid_str[len(oid_prefix) + 1:]
                if idx not in entries:
                    entries[idx] = {}
                entries[idx][field] = val

        type_map = {"1": "other", "2": "invalid", "3": "dynamic", "4": "static"}
        result = []
        for entry in entries.values():
            mac = entry.get("mac", "")
            if mac.startswith("0x") and len(mac) == 14:
                mac = ":".join(mac[2:][i:i+2] for i in range(0, 12, 2))
            result.append({
                "ip": entry.get("ip", ""),
                "mac": mac,
                "interface": entry.get("if_index", ""),
                "type": type_map.get(entry.get("type", ""), entry.get("type", "")),
            })
        return result

    async def get_gateways(self) -> list[dict]:
        """Get routing table from ipRouteTable."""
        prefix_base = "1.3.6.1.2.1.4.21.1"
        columns = {
            f"{prefix_base}.1":  "destination",  # ipRouteDest
            f"{prefix_base}.2":  "if_index",     # ipRouteIfIndex
            f"{prefix_base}.3":  "metric",       # ipRouteMetric1
            f"{prefix_base}.7":  "gateway",      # ipRouteNextHop
            f"{prefix_base}.11": "mask",         # ipRouteMask
        }
        entries: dict[str, dict] = {}
        for oid_prefix, field in columns.items():
            rows = await self._walk_table(oid_prefix)
            for oid_str, val in rows:
                idx = oid_str[len(oid_prefix) + 1:]
                if idx not in entries:
                    entries[idx] = {}
                entries[idx][field] = val

        result = []
        for entry in entries.values():
            try:
                metric = int(entry.get("metric", 0))
            except (ValueError, TypeError):
                metric = 0
            result.append({
                "destination": entry.get("destination", ""),
                "gateway": entry.get("gateway", ""),
                "mask": entry.get("mask", ""),
                "metric": metric,
                "interface": entry.get("if_index", ""),
            })
        return result


# Module-level mode tracker
pfsense_mode: str = settings.pfsense_mode  # "" | "api" | "snmp"

pfsense_client = PfSenseClient()
pfsense_snmp_client = PfSenseSnmpClient()
