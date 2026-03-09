import logging
from fastapi import APIRouter, Depends, HTTPException
from app.dependencies import get_current_user
from app.models.user import User
from app.services import pfsense_client as pfsense_mod

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/pfsense", tags=["pfsense"])


def _get_mode() -> str:
    return pfsense_mod.pfsense_mode


def _require_configured():
    mode = _get_mode()
    if mode == "snmp":
        if not pfsense_mod.pfsense_snmp_client.is_configured:
            raise HTTPException(status_code=400, detail="pfSense SNMP not configured")
    elif mode == "api":
        if not pfsense_mod.pfsense_client.is_configured:
            raise HTTPException(status_code=400, detail="pfSense API not configured")
    else:
        raise HTTPException(status_code=400, detail="pfSense not configured")


@router.get("/mode")
async def get_mode(_: User = Depends(get_current_user)):
    return {"mode": _get_mode()}


@router.get("/interfaces")
async def get_interfaces(_: User = Depends(get_current_user)):
    _require_configured()
    if _get_mode() == "snmp":
        return await pfsense_mod.pfsense_snmp_client.get_interfaces()
    ifaces = await pfsense_mod.pfsense_client.get_interfaces()
    return _normalize_api_interfaces(ifaces)


@router.get("/firewall/rules")
async def get_firewall_rules(_: User = Depends(get_current_user)):
    _require_configured()
    if _get_mode() == "snmp":
        return {"data": [], "notice": "Firewall rules are not available via SNMP. Use API mode for full access."}
    rules = await pfsense_mod.pfsense_client.get_firewall_rules()
    return rules


@router.get("/dhcp/leases")
async def get_dhcp_leases(_: User = Depends(get_current_user)):
    _require_configured()
    if _get_mode() == "snmp":
        return {"data": [], "notice": "DHCP leases are not available via SNMP. Use API mode for full access."}
    leases = await pfsense_mod.pfsense_client.get_dhcp_leases()
    return leases


@router.get("/gateways")
async def get_gateways(_: User = Depends(get_current_user)):
    _require_configured()
    if _get_mode() == "snmp":
        return await pfsense_mod.pfsense_snmp_client.get_gateways()
    gw_data = await pfsense_mod.pfsense_client.get_gateways()
    # Normalize gateway data for frontend
    result = []
    for gw in gw_data:
        if isinstance(gw, dict):
            result.append({
                "destination": gw.get("network", gw.get("destination", "")),
                "gateway": gw.get("gateway", gw.get("nexthop", "")),
                "mask": gw.get("mask", ""),
                "metric": int(gw.get("weight", gw.get("metric", 0)) or 0),
                "interface": gw.get("interface", gw.get("friendlyiface", "")),
                "name": gw.get("name", ""),
                "monitor": gw.get("monitor", ""),
                "status": gw.get("status", ""),
            })
    return result


@router.get("/vpn/openvpn")
async def get_openvpn_status(_: User = Depends(get_current_user)):
    _require_configured()
    if _get_mode() == "snmp":
        return {"data": [], "notice": "VPN status is not available via SNMP. Use API mode for full access."}
    return await pfsense_mod.pfsense_client.get_openvpn_status()


@router.get("/system")
async def get_system_info(_: User = Depends(get_current_user)):
    _require_configured()
    if _get_mode() == "snmp":
        return await pfsense_mod.pfsense_snmp_client.get_system_info()
    data = await pfsense_mod.pfsense_client.get_system_info()
    return _normalize_api_system(data)


@router.get("/arp")
async def get_arp_table(_: User = Depends(get_current_user)):
    _require_configured()
    if _get_mode() != "snmp":
        raise HTTPException(status_code=400, detail="ARP table is only available in SNMP mode")
    return await pfsense_mod.pfsense_snmp_client.get_arp_table()


@router.get("/overview")
async def get_overview(_: User = Depends(get_current_user)):
    """Get a combined overview for the dashboard: system + interfaces + stats."""
    _require_configured()
    mode = _get_mode()
    if mode == "snmp":
        import asyncio
        system, interfaces, arp = await asyncio.gather(
            pfsense_mod.pfsense_snmp_client.get_system_info(),
            pfsense_mod.pfsense_snmp_client.get_interfaces(),
            pfsense_mod.pfsense_snmp_client.get_arp_table(),
        )
        up_count = sum(1 for i in interfaces if i.get("oper_status") == "up")
        down_count = sum(1 for i in interfaces if i.get("oper_status") == "down")
        return {
            "system": system,
            "interfaces": interfaces,
            "arp_table": arp,
            "interface_counts": {"up": up_count, "down": down_count, "total": len(interfaces)},
        }
    # API mode - gather what we can
    import asyncio
    system, interfaces = await asyncio.gather(
        pfsense_mod.pfsense_client.get_system_info(),
        pfsense_mod.pfsense_client.get_interfaces(),
    )
    # Normalize API interface data for the frontend
    normalized_ifs = _normalize_api_interfaces(interfaces)
    up_count = sum(1 for i in normalized_ifs if i.get("oper_status") == "up")
    down_count = sum(1 for i in normalized_ifs if i.get("oper_status") == "down")
    # Normalize system info
    norm_system = _normalize_api_system(system)
    return {
        "system": norm_system,
        "interfaces": normalized_ifs,
        "arp_table": [],
        "interface_counts": {"up": up_count, "down": down_count, "total": len(normalized_ifs)},
    }


def _normalize_api_system(data: dict) -> dict:
    """Normalize pfSense REST API system info to match our frontend expectations."""
    if not data:
        return {}
    result = dict(data)
    # Map common fields
    if "hostname" not in result and "system_hostname" in result:
        result["hostname"] = result["system_hostname"]
    if "uptime" not in result:
        uptime_secs = result.get("uptime_seconds") or result.get("uptime")
        if uptime_secs and str(uptime_secs).isdigit():
            secs = int(uptime_secs)
            days, rem = divmod(secs, 86400)
            hours, rem = divmod(rem, 3600)
            minutes, _ = divmod(rem, 60)
            result["uptime"] = f"{days}d {hours}h {minutes}m"
            result["uptime_seconds"] = secs
    # CPU load
    if "cpu_load_1" not in result and "cpu_load_avg" in result:
        avgs = result["cpu_load_avg"]
        if isinstance(avgs, list) and len(avgs) >= 3:
            result["cpu_load_1"] = avgs[0]
            result["cpu_load_5"] = avgs[1]
            result["cpu_load_15"] = avgs[2]
    # Memory
    if "mem_percent" not in result:
        mem_usage = result.get("mem_usage")
        if mem_usage is not None:
            try:
                result["mem_percent"] = round(float(mem_usage), 1)
            except (ValueError, TypeError):
                pass
    # PF states
    if "pf_states" not in result and "pf_running" in result:
        result["pf_running"] = result["pf_running"]
    return result


def _normalize_api_interfaces(interfaces: list) -> list:
    """Normalize pfSense REST API interface data to match SNMP-style format."""
    result = []
    for idx, iface in enumerate(interfaces):
        if isinstance(iface, dict):
            normalized = {
                "index": str(idx),
                "name": iface.get("descr") or iface.get("if") or iface.get("name", f"if{idx}"),
                "alias": iface.get("descr") or iface.get("name", ""),
                "oper_status": "up" if iface.get("enable") or iface.get("status") == "up" else "down",
                "admin_status": "up" if iface.get("enable", True) else "down",
                "speed": int(iface.get("media", {}).get("speed", 0)) if isinstance(iface.get("media"), dict) else 0,
                "mtu": int(iface.get("mtu", 1500)),
                "in_octets": int(iface.get("inbytes") or iface.get("inbytes_frmt", "0").replace(",", "") or 0),
                "out_octets": int(iface.get("outbytes") or iface.get("outbytes_frmt", "0").replace(",", "") or 0),
                "in_errors": int(iface.get("inerrs", 0)),
                "out_errors": int(iface.get("outerrs", 0)),
                "ip_addresses": [],
            }
            # Collect IP addresses
            ipaddr = iface.get("ipaddr") or iface.get("ip")
            subnet = iface.get("subnet")
            if ipaddr and ipaddr not in ("", "none"):
                if subnet:
                    normalized["ip_addresses"].append(f"{ipaddr}/{subnet}")
                else:
                    normalized["ip_addresses"].append(ipaddr)
            # IPv6
            ipaddr6 = iface.get("ipaddrv6")
            subnetv6 = iface.get("subnetv6")
            if ipaddr6 and ipaddr6 not in ("", "none"):
                if subnetv6:
                    normalized["ip_addresses"].append(f"{ipaddr6}/{subnetv6}")
                else:
                    normalized["ip_addresses"].append(ipaddr6)
            result.append(normalized)
    return result
