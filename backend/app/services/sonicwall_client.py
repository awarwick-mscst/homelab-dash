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
            getCmd, bulkWalkCmd, CommunityData, UdpTransportTarget,
            ContextData, ObjectType, ObjectIdentity, SnmpEngine,
        )
        _pysnmp = {
            "get_cmd": getCmd, "bulk_walk_cmd": bulkWalkCmd,
            "CommunityData": CommunityData, "UdpTransportTarget": UdpTransportTarget,
            "ContextData": ContextData, "ObjectType": ObjectType,
            "ObjectIdentity": ObjectIdentity, "SnmpEngine": SnmpEngine,
        }
    except ImportError:
        logger.warning("pysnmp-lextudio not installed — SNMP mode will be unavailable")
        _pysnmp = {}
    return _pysnmp


def _require_pysnmp():
    snmp = _ensure_pysnmp()
    if not snmp:
        raise RuntimeError("pysnmp-lextudio is not installed")
    return snmp


class SonicWallClient:
    """Client for SonicOS REST API (Gen6 6.5.1+ / Gen7 7.0+).

    Uses HTTP Basic Auth. The API must be enabled in the SonicWall web UI:
    Device > Settings > Administration > SonicOS API
    Also enable "RFC-2617 HTTP Basic Access Authentication".

    IMPORTANT: SonicWall only allows one admin session at a time.
    We authenticate, query, and logout quickly to minimize disruption.
    """

    def __init__(self):
        self._host = ""
        self._username = ""
        self._password = ""
        self._verify_ssl = False
        self._port = 443

    def update_config(self, host: str, username: str = "", password: str = "",
                      verify_ssl: bool = False, port: int = 443):
        self._host = host.rstrip("/")
        self._username = username
        self._password = password
        self._verify_ssl = verify_ssl
        self._port = port

    @property
    def is_configured(self) -> bool:
        return bool(self._host and self._username and self._password)

    @property
    def base_url(self) -> str:
        host = self._host
        if host.startswith("http://") or host.startswith("https://"):
            return f"{host}/api/sonicos"
        return f"https://{host}:{self._port}/api/sonicos"

    def _build_client(self) -> httpx.AsyncClient:
        return httpx.AsyncClient(
            verify=self._verify_ssl,
            auth=(self._username, self._password),
            headers={"Accept": "application/json", "Content-Type": "application/json"},
            timeout=15,
        )

    async def _authenticated_request(self, method: str, path: str) -> dict | list:
        """Make an authenticated request with login/logout to minimize session locking."""
        if not self.is_configured:
            raise RuntimeError("SonicWall not configured")

        url = f"{self.base_url}{path}"
        async with self._build_client() as client:
            try:
                # Authenticate
                auth_resp = await client.post(f"{self.base_url}/auth",
                    headers={"Accept": "application/json", "Content-Type": "application/json"})
                if auth_resp.status_code not in (200, 204):
                    body = auth_resp.text[:500]
                    raise RuntimeError(f"SonicWall auth failed (HTTP {auth_resp.status_code}): {body}")

                # Make the actual request
                if method == "GET":
                    resp = await client.get(url)
                else:
                    resp = await client.post(url)

                if resp.status_code != 200:
                    body = resp.text[:500]
                    logger.error(f"SonicWall API {resp.status_code} from {url}: {body}")
                    resp.raise_for_status()

                result = resp.json()

                # Logout to free the session
                try:
                    await client.delete(f"{self.base_url}/auth")
                except Exception:
                    pass  # best effort logout

                return result
            except httpx.ConnectError as e:
                raise RuntimeError(f"Cannot connect to SonicWall at {url}") from e
            except httpx.TimeoutException as e:
                raise RuntimeError(f"SonicWall request timed out ({url})") from e

    async def _get(self, path: str) -> dict | list:
        return await self._authenticated_request("GET", path)

    # ---- Status/Reporting endpoints ----

    async def get_system_info(self) -> dict:
        data = await self._get("/reporting/system")
        return data if isinstance(data, dict) else {}

    async def get_version(self) -> dict:
        try:
            data = await self._get("/version")
            return data if isinstance(data, dict) else {}
        except Exception:
            return {}

    async def get_interfaces(self) -> list:
        data = await self._get("/interfaces/ipv4")
        if isinstance(data, dict):
            # SonicOS wraps interfaces in {"interfaces": [...]}
            return data.get("interfaces", []) if "interfaces" in data else list(data.values())
        return data if isinstance(data, list) else []

    async def get_interface_traffic(self) -> list:
        try:
            data = await self._get("/interfaces/display-traffic")
            if isinstance(data, dict):
                return data.get("interfaces", list(data.values()))
            return data if isinstance(data, list) else []
        except Exception:
            return []

    async def get_arp_table(self) -> list:
        try:
            data = await self._get("/reporting/arp-cache")
            if isinstance(data, dict):
                return data.get("arp_cache", data.get("entries", list(data.values())))
            return data if isinstance(data, list) else []
        except Exception:
            return []

    async def get_vpn_status(self) -> list:
        try:
            data = await self._get("/reporting/vpn")
            if isinstance(data, dict):
                return data.get("vpn", data.get("tunnels", list(data.values())))
            return data if isinstance(data, list) else []
        except Exception:
            return []

    async def get_security_services(self) -> dict:
        try:
            data = await self._get("/reporting/security-services")
            return data if isinstance(data, dict) else {}
        except Exception:
            return {}

    async def get_license(self) -> dict:
        try:
            data = await self._get("/reporting/license")
            return data if isinstance(data, dict) else {}
        except Exception:
            return {}

    async def test_connection(self) -> dict:
        """Test connectivity and return raw response for debugging."""
        if not self.is_configured:
            return {"ok": False, "error": "Not configured"}
        try:
            async with self._build_client() as client:
                auth_resp = await client.post(f"{self.base_url}/auth",
                    headers={"Accept": "application/json", "Content-Type": "application/json"})
                if auth_resp.status_code not in (200, 204):
                    return {
                        "ok": False, "url": f"{self.base_url}/auth",
                        "status_code": auth_resp.status_code,
                        "error": f"Authentication failed: {auth_resp.text[:500]}",
                    }
                # Try to get version info
                ver_resp = await client.get(f"{self.base_url}/version")
                result = {
                    "ok": True, "url": self.base_url,
                    "status_code": ver_resp.status_code,
                    "response_body": ver_resp.text[:2000],
                }
                # Logout
                try:
                    await client.delete(f"{self.base_url}/auth")
                except Exception:
                    pass
                return result
        except httpx.ConnectError as e:
            return {"ok": False, "url": self.base_url, "error": f"Connection failed: {e}"}
        except httpx.TimeoutException:
            return {"ok": False, "url": self.base_url, "error": "Connection timed out"}
        except Exception as e:
            return {"ok": False, "url": self.base_url, "error": str(e)}


class SonicWallSnmpClient:
    """SNMP client for SonicWall firewalls. Works on all models."""

    def __init__(self):
        self._host = ""
        self._community_string = "public"
        self._port = 161

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
        if not self.is_configured:
            raise RuntimeError("SonicWall SNMP not configured")
        snmp = _require_pysnmp()
        engine = snmp["SnmpEngine"]()
        obj_types = [snmp["ObjectType"](snmp["ObjectIdentity"](oid)) for oid in oids]
        transport = self._make_transport()
        error_indication, error_status, _error_index, var_binds = await snmp["get_cmd"](
            engine, snmp["CommunityData"](self._community_string),
            transport, snmp["ContextData"](), *obj_types,
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
        if not self.is_configured:
            raise RuntimeError("SonicWall SNMP not configured")
        snmp = _require_pysnmp()
        engine = snmp["SnmpEngine"]()
        transport = self._make_transport()
        results = []
        async for error_indication, error_status, _error_index, var_binds in snmp["bulk_walk_cmd"](
            engine, snmp["CommunityData"](self._community_string),
            transport, snmp["ContextData"](), 0, 25,
            snmp["ObjectType"](snmp["ObjectIdentity"](oid)),
        ):
            if error_indication or error_status:
                break
            for oid_obj, val in var_binds:
                results.append((str(oid_obj), val.prettyPrint()))
        engine.closeDispatcher()
        return results

    async def get_system_info(self) -> dict:
        oids = {
            "1.3.6.1.2.1.1.1.0": "description",
            "1.3.6.1.2.1.1.3.0": "uptime",
            "1.3.6.1.2.1.1.4.0": "contact",
            "1.3.6.1.2.1.1.5.0": "hostname",
            "1.3.6.1.2.1.1.6.0": "location",
        }
        raw = await self._get_scalar(*oids.keys())
        result = {}
        for oid_str, field_name in oids.items():
            result[field_name] = raw.get(oid_str, "")

        # Convert uptime timeticks
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

        # SonicWall-specific OIDs
        sw_oids = {
            "1.3.6.1.4.1.8741.1.3.1.3.0": "cpu_percent",      # CPU utilization
            "1.3.6.1.4.1.8741.1.3.1.4.0": "mem_percent",       # Memory utilization
            "1.3.6.1.4.1.8741.1.3.1.2.0": "current_connections",
            "1.3.6.1.4.1.8741.1.3.1.1.0": "max_connections",
            "1.3.6.1.4.1.8741.2.1.1.2.0": "serial_number",
            "1.3.6.1.4.1.8741.2.1.1.3.0": "firmware_version",
        }
        try:
            ext_raw = await self._get_scalar(*sw_oids.keys())
            for oid_str, field_name in sw_oids.items():
                val = ext_raw.get(oid_str, "")
                if val and "No Such" not in str(val) and "noSuch" not in str(val):
                    result[field_name] = val
        except Exception:
            pass

        return result

    async def get_interfaces(self) -> list[dict]:
        prefixes = {
            "1.3.6.1.2.1.2.2.1.2":  "name",
            "1.3.6.1.2.1.2.2.1.4":  "mtu",
            "1.3.6.1.2.1.2.2.1.5":  "speed",
            "1.3.6.1.2.1.2.2.1.7":  "admin_status",
            "1.3.6.1.2.1.2.2.1.8":  "oper_status",
            "1.3.6.1.2.1.2.2.1.10": "in_octets",
            "1.3.6.1.2.1.2.2.1.14": "in_errors",
            "1.3.6.1.2.1.2.2.1.16": "out_octets",
            "1.3.6.1.2.1.2.2.1.20": "out_errors",
        }
        interfaces: dict[str, dict] = {}
        for oid_prefix, field in prefixes.items():
            rows = await self._walk_table(oid_prefix)
            for oid_str, val in rows:
                idx = oid_str[len(oid_prefix) + 1:]
                if idx not in interfaces:
                    interfaces[idx] = {"index": idx}
                interfaces[idx][field] = val

        # HC counters + alias
        hc_prefixes = {
            "1.3.6.1.2.1.31.1.1.1.6":  "in_octets",
            "1.3.6.1.2.1.31.1.1.1.10": "out_octets",
            "1.3.6.1.2.1.31.1.1.1.18": "alias",
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

        # IP addresses
        ip_map: dict[str, list[str]] = {}
        try:
            ip_addr_rows = await self._walk_table("1.3.6.1.2.1.4.20.1.1")
            ip_ifidx_rows = await self._walk_table("1.3.6.1.2.1.4.20.1.2")
            ip_mask_rows = await self._walk_table("1.3.6.1.2.1.4.20.1.3")
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


# Module-level instances
sonicwall_mode: str = ""  # "" | "api" | "snmp"
sonicwall_client = SonicWallClient()
sonicwall_snmp_client = SonicWallSnmpClient()
