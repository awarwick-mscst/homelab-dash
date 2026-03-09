import logging
from app.services.pfsense_client import _ensure_pysnmp, _require_pysnmp

logger = logging.getLogger(__name__)


class SwitchSnmpClient:
    """SNMP client for Cisco SF300/SG300 managed switches."""

    def __init__(self):
        self._host = ""
        self._community = "public"
        self._port = 161

    def update_config(self, host: str, community: str = "public", port: int = 161):
        self._host = host
        self._community = community or "public"
        self._port = port

    @property
    def is_configured(self) -> bool:
        return bool(self._host)

    def _make_transport(self):
        snmp = _require_pysnmp()
        return snmp["UdpTransportTarget"]((self._host, self._port), timeout=10, retries=2)

    async def _get_scalar(self, *oids: str) -> dict[str, str]:
        if not self.is_configured:
            raise RuntimeError("Switch not configured")
        snmp = _require_pysnmp()
        engine = snmp["SnmpEngine"]()
        obj_types = [snmp["ObjectType"](snmp["ObjectIdentity"](oid)) for oid in oids]
        transport = self._make_transport()
        error_indication, error_status, _error_index, var_binds = await snmp["get_cmd"](
            engine,
            snmp["CommunityData"](self._community),
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
        if not self.is_configured:
            raise RuntimeError("Switch not configured")
        snmp = _require_pysnmp()
        engine = snmp["SnmpEngine"]()
        transport = self._make_transport()
        results = []
        async for error_indication, error_status, _error_index, var_binds in snmp["bulk_walk_cmd"](
            engine,
            snmp["CommunityData"](self._community),
            transport,
            snmp["ContextData"](),
            0, 25,
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
        # Convert uptime timeticks to human-readable
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
        return result

    async def get_interfaces(self) -> list[dict]:
        """Get interface table from IF-MIB."""
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

        # Also get interface aliases (descriptions set by user)
        alias_rows = await self._walk_table("1.3.6.1.2.1.31.1.1.1.18")
        for oid_str, val in alias_rows:
            idx = oid_str.split(".")[-1]
            if idx in interfaces and val:
                interfaces[idx]["alias"] = val

        # Get high-capacity counters (64-bit) if available
        for oid_prefix, field in [
            ("1.3.6.1.2.1.31.1.1.1.6", "in_octets_hc"),
            ("1.3.6.1.2.1.31.1.1.1.10", "out_octets_hc"),
        ]:
            rows = await self._walk_table(oid_prefix)
            for oid_str, val in rows:
                idx = oid_str[len(oid_prefix) + 1:]
                if idx in interfaces:
                    try:
                        interfaces[idx][field] = int(val)
                    except (ValueError, TypeError):
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
            # Use HC counters if available
            if "in_octets_hc" in iface:
                iface["in_octets"] = iface.pop("in_octets_hc")
            if "out_octets_hc" in iface:
                iface["out_octets"] = iface.pop("out_octets_hc")
            result.append(iface)
        return result

    async def get_mac_table(self) -> list[dict]:
        """Get MAC address table from BRIDGE-MIB (dot1dTpFdbTable)."""
        # dot1dTpFdbAddress -> MAC, dot1dTpFdbPort -> port index
        mac_rows = await self._walk_table("1.3.6.1.2.1.17.4.3.1.1")
        port_rows = await self._walk_table("1.3.6.1.2.1.17.4.3.1.2")
        status_rows = await self._walk_table("1.3.6.1.2.1.17.4.3.1.3")

        # Build port index -> interface index mapping
        bridge_port_map: dict[str, str] = {}
        bp_rows = await self._walk_table("1.3.6.1.2.1.17.1.4.1.2")
        for oid_str, val in bp_rows:
            bp_idx = oid_str.split(".")[-1]
            bridge_port_map[bp_idx] = val

        entries: dict[str, dict] = {}
        prefix_len = len("1.3.6.1.2.1.17.4.3.1.1.")
        for oid_str, val in mac_rows:
            idx = oid_str[prefix_len:]
            mac = val
            if mac.startswith("0x") and len(mac) >= 14:
                mac = ":".join(mac[2:][i:i+2] for i in range(0, 12, 2))
            entries[idx] = {"mac": mac.upper()}

        prefix_len = len("1.3.6.1.2.1.17.4.3.1.2.")
        for oid_str, val in port_rows:
            idx = oid_str[prefix_len:]
            if idx in entries:
                entries[idx]["bridge_port"] = val
                entries[idx]["if_index"] = bridge_port_map.get(val, val)

        status_map = {"1": "other", "2": "invalid", "3": "learned", "4": "self", "5": "mgmt"}
        prefix_len = len("1.3.6.1.2.1.17.4.3.1.3.")
        for oid_str, val in status_rows:
            idx = oid_str[prefix_len:]
            if idx in entries:
                entries[idx]["status"] = status_map.get(val, val)

        return list(entries.values())

    async def get_vlans(self) -> list[dict]:
        """Get VLAN table from Q-BRIDGE-MIB."""
        # dot1qVlanStaticName
        name_rows = await self._walk_table("1.3.6.1.2.1.17.7.1.4.3.1.1")
        vlans = []
        prefix_len = len("1.3.6.1.2.1.17.7.1.4.3.1.1.")
        for oid_str, val in name_rows:
            vlan_id = oid_str[prefix_len:]
            try:
                vid = int(vlan_id)
            except ValueError:
                continue
            vlans.append({"id": vid, "name": val or f"VLAN {vid}"})
        # If Q-BRIDGE didn't return results, try dot1dStpPort for basic VLAN IDs
        if not vlans:
            vlan_rows = await self._walk_table("1.3.6.1.2.1.17.7.1.4.2.1.3")
            seen = set()
            for oid_str, val in vlan_rows:
                try:
                    vid = int(oid_str.split(".")[-1])
                    if vid not in seen:
                        seen.add(vid)
                        vlans.append({"id": vid, "name": f"VLAN {vid}"})
                except ValueError:
                    pass
        vlans.sort(key=lambda v: v["id"])
        return vlans

    async def get_poe_status(self) -> list[dict]:
        """Get PoE port status from POWER-ETHERNET-MIB (if supported)."""
        # pethPsePortAdminEnable, pethPsePortDetectionStatus, pethPsePortPowerPairs
        admin_rows = await self._walk_table("1.3.6.1.2.1.105.1.1.1.3")
        detect_rows = await self._walk_table("1.3.6.1.2.1.105.1.1.1.6")
        power_rows = await self._walk_table("1.3.6.1.2.1.105.1.1.1.7")

        if not admin_rows:
            return []

        entries: dict[str, dict] = {}
        for oid_str, val in admin_rows:
            parts = oid_str.split(".")
            idx = ".".join(parts[-2:])
            entries[idx] = {"port": parts[-1], "admin": "enabled" if val == "1" else "disabled"}

        detect_map = {
            "1": "disabled", "2": "searching", "3": "deliveringPower",
            "4": "fault", "5": "test", "6": "otherFault",
        }
        for oid_str, val in detect_rows:
            parts = oid_str.split(".")
            idx = ".".join(parts[-2:])
            if idx in entries:
                entries[idx]["detection"] = detect_map.get(val, val)

        for oid_str, val in power_rows:
            parts = oid_str.split(".")
            idx = ".".join(parts[-2:])
            if idx in entries:
                try:
                    entries[idx]["power_mw"] = int(val)
                except (ValueError, TypeError):
                    pass

        return list(entries.values())


switch_client = SwitchSnmpClient()
