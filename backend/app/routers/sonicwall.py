import logging
import asyncio
import httpx
from fastapi import APIRouter, Depends, HTTPException
from app.dependencies import get_current_user
from app.models.user import User
from app.services import sonicwall_client as sw_mod

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/sonicwall", tags=["sonicwall"])


def _get_mode() -> str:
    return sw_mod.sonicwall_mode


def _require_configured():
    mode = _get_mode()
    if mode == "snmp":
        if not sw_mod.sonicwall_snmp_client.is_configured:
            raise HTTPException(status_code=400, detail="SonicWall SNMP not configured")
    elif mode == "api":
        if not sw_mod.sonicwall_client.is_configured:
            raise HTTPException(status_code=400, detail="SonicWall API not configured")
    else:
        raise HTTPException(status_code=400, detail="SonicWall not configured")


def _sonicwall_error(e: Exception) -> HTTPException:
    msg = str(e)
    if isinstance(e, httpx.HTTPStatusError):
        status = e.response.status_code
        if status == 401:
            return HTTPException(status_code=502, detail="SonicWall authentication failed — check username/password")
        if status == 403:
            return HTTPException(status_code=502, detail="SonicWall access denied — check user privileges")
        return HTTPException(status_code=502, detail=f"SonicWall returned HTTP {status}: {e.response.text[:200]}")
    if isinstance(e, (httpx.ConnectError, httpx.TimeoutException, ConnectionError)):
        return HTTPException(status_code=502, detail=f"Cannot reach SonicWall: {msg}")
    if isinstance(e, RuntimeError):
        return HTTPException(status_code=502, detail=msg)
    return HTTPException(status_code=502, detail=f"SonicWall error: {msg}")


@router.get("/mode")
async def get_mode(_: User = Depends(get_current_user)):
    return {"mode": _get_mode()}


@router.get("/test")
async def test_connection(_: User = Depends(get_current_user)):
    _require_configured()
    mode = _get_mode()
    if mode == "snmp":
        try:
            info = await sw_mod.sonicwall_snmp_client.get_system_info()
            return {"ok": True, "mode": "snmp", "data": info}
        except Exception as e:
            return {"ok": False, "mode": "snmp", "error": str(e)}

    try:
        result = await sw_mod.sonicwall_client.test_connection()
        return result
    except Exception as e:
        return {"ok": False, "mode": "api", "error": str(e)}


@router.get("/system")
async def get_system_info(_: User = Depends(get_current_user)):
    _require_configured()
    try:
        if _get_mode() == "snmp":
            return await sw_mod.sonicwall_snmp_client.get_system_info()
        data = await sw_mod.sonicwall_client.get_system_info()
        return _normalize_api_system(data)
    except Exception as e:
        raise _sonicwall_error(e)


@router.get("/interfaces")
async def get_interfaces(_: User = Depends(get_current_user)):
    _require_configured()
    try:
        if _get_mode() == "snmp":
            return await sw_mod.sonicwall_snmp_client.get_interfaces()
        ifaces = await sw_mod.sonicwall_client.get_interfaces()
        return _normalize_api_interfaces(ifaces)
    except Exception as e:
        raise _sonicwall_error(e)


@router.get("/arp")
async def get_arp_table(_: User = Depends(get_current_user)):
    _require_configured()
    try:
        if _get_mode() == "snmp":
            return await sw_mod.sonicwall_snmp_client.get_arp_table()
        return await sw_mod.sonicwall_client.get_arp_table()
    except Exception as e:
        raise _sonicwall_error(e)


@router.get("/vpn")
async def get_vpn_status(_: User = Depends(get_current_user)):
    _require_configured()
    try:
        if _get_mode() == "snmp":
            return {"data": [], "notice": "VPN status is not available via SNMP. Use API mode."}
        return await sw_mod.sonicwall_client.get_vpn_status()
    except Exception as e:
        raise _sonicwall_error(e)


@router.get("/security-services")
async def get_security_services(_: User = Depends(get_current_user)):
    _require_configured()
    try:
        if _get_mode() == "snmp":
            return {"notice": "Security services not available via SNMP. Use API mode."}
        return await sw_mod.sonicwall_client.get_security_services()
    except Exception as e:
        raise _sonicwall_error(e)


@router.get("/license")
async def get_license(_: User = Depends(get_current_user)):
    _require_configured()
    try:
        if _get_mode() == "snmp":
            return {"notice": "License info not available via SNMP. Use API mode."}
        return await sw_mod.sonicwall_client.get_license()
    except Exception as e:
        raise _sonicwall_error(e)


@router.get("/overview")
async def get_overview(_: User = Depends(get_current_user)):
    """Combined overview: system + interfaces + ARP."""
    _require_configured()
    mode = _get_mode()

    try:
        if mode == "snmp":
            system, interfaces, arp = await asyncio.gather(
                sw_mod.sonicwall_snmp_client.get_system_info(),
                sw_mod.sonicwall_snmp_client.get_interfaces(),
                sw_mod.sonicwall_snmp_client.get_arp_table(),
            )
            up_count = sum(1 for i in interfaces if i.get("oper_status") == "up")
            down_count = sum(1 for i in interfaces if i.get("oper_status") == "down")
            return {
                "system": system,
                "interfaces": interfaces,
                "arp_table": arp,
                "interface_counts": {"up": up_count, "down": down_count, "total": len(interfaces)},
            }

        # API mode
        results = await asyncio.gather(
            sw_mod.sonicwall_client.get_system_info(),
            sw_mod.sonicwall_client.get_interfaces(),
            sw_mod.sonicwall_client.get_arp_table(),
            return_exceptions=True,
        )

        if isinstance(results[0], Exception):
            raise results[0]

        system = results[0] if not isinstance(results[0], Exception) else {}
        interfaces = results[1] if not isinstance(results[1], Exception) else []
        arp = results[2] if not isinstance(results[2], Exception) else []

        norm_system = _normalize_api_system(system)
        norm_ifs = _normalize_api_interfaces(interfaces)
        up_count = sum(1 for i in norm_ifs if i.get("oper_status") == "up")
        down_count = sum(1 for i in norm_ifs if i.get("oper_status") == "down")

        return {
            "system": norm_system,
            "interfaces": norm_ifs,
            "arp_table": arp,
            "interface_counts": {"up": up_count, "down": down_count, "total": len(norm_ifs)},
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"SonicWall overview failed: {e}", exc_info=True)
        raise _sonicwall_error(e)


# ---------------------------------------------------------------------------
# Normalization helpers
# ---------------------------------------------------------------------------

def _first_of(d: dict, *keys, default=""):
    for k in keys:
        v = d.get(k)
        if v is not None and v != "":
            return v
    return default


def _safe_int(val, default=0) -> int:
    if val is None:
        return default
    try:
        if isinstance(val, str):
            val = val.replace(",", "")
        return int(val)
    except (ValueError, TypeError):
        return default


def _normalize_api_system(data: dict) -> dict:
    if not data:
        return {}
    result = dict(data)

    # Hostname
    if "hostname" not in result or not result["hostname"]:
        result["hostname"] = _first_of(data, "hostname", "name", "firewall_name", "system_name")

    # Model / firmware
    result["model"] = _first_of(data, "model", "product_name", "platform")
    result["firmware"] = _first_of(data, "firmware_version", "firmware", "version", "sonicos_version")
    result["serial_number"] = _first_of(data, "serial_number", "serial")

    # Uptime
    raw_uptime = _first_of(data, "uptime", "uptime_seconds", "system_uptime")
    if raw_uptime is not None and str(raw_uptime).replace(".", "").isdigit():
        secs = int(float(str(raw_uptime)))
        days, rem = divmod(secs, 86400)
        hours, rem = divmod(rem, 3600)
        minutes, _ = divmod(rem, 60)
        result["uptime"] = f"{days}d {hours}h {minutes}m"
        result["uptime_seconds"] = secs

    # CPU / Memory
    cpu = _first_of(data, "cpu_percent", "cpu_utilization", "cpu", default=None)
    if cpu is not None:
        result["cpu_percent"] = cpu

    mem = _first_of(data, "mem_percent", "memory_utilization", "memory", default=None)
    if mem is not None:
        result["mem_percent"] = mem

    # Connections
    conns = _first_of(data, "current_connections", "connections", "active_connections", default=None)
    if conns is not None:
        result["current_connections"] = conns
    max_conns = _first_of(data, "max_connections", "maximum_connections", default=None)
    if max_conns is not None:
        result["max_connections"] = max_conns

    return result


def _normalize_api_interfaces(interfaces: list) -> list:
    result = []
    for idx, iface in enumerate(interfaces):
        if not isinstance(iface, dict):
            continue
        name = iface.get("name") or iface.get("interface") or f"if{idx}"
        normalized = {
            "index": str(idx),
            "name": name,
            "alias": iface.get("comment") or iface.get("alias") or "",
            "oper_status": "up" if iface.get("link", "").lower() == "up" or iface.get("status", "").lower() == "up" else "down",
            "admin_status": "up" if iface.get("management", "") != "disabled" else "down",
            "speed": _safe_int(iface.get("speed", 0)),
            "mtu": _safe_int(iface.get("mtu", 1500)),
            "in_octets": _safe_int(iface.get("rx_bytes") or iface.get("in_bytes", 0)),
            "out_octets": _safe_int(iface.get("tx_bytes") or iface.get("out_bytes", 0)),
            "in_errors": _safe_int(iface.get("rx_errors", 0)),
            "out_errors": _safe_int(iface.get("tx_errors", 0)),
            "ip_addresses": [],
            "zone": iface.get("zone") or "",
        }

        ip = iface.get("ip_address") or iface.get("ip")
        mask = iface.get("netmask") or iface.get("subnet_mask")
        if ip and ip not in ("", "0.0.0.0"):
            normalized["ip_addresses"].append(f"{ip}/{mask}" if mask else ip)

        result.append(normalized)
    return result
