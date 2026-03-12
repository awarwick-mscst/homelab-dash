import logging
import asyncio
import httpx
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


def _pfsense_error(e: Exception) -> HTTPException:
    """Convert pfSense client exceptions to proper HTTP errors."""
    msg = str(e)
    if isinstance(e, httpx.HTTPStatusError):
        status = e.response.status_code
        if status == 401:
            return HTTPException(status_code=502, detail="pfSense API authentication failed — check your API key")
        if status == 403:
            return HTTPException(status_code=502, detail="pfSense API access denied — key may lack required privileges")
        if status == 404:
            return HTTPException(status_code=502, detail=f"pfSense API endpoint not found — check REST API plugin is installed")
        return HTTPException(status_code=502, detail=f"pfSense returned HTTP {status}: {e.response.text[:200]}")
    if isinstance(e, (httpx.ConnectError, httpx.TimeoutException, ConnectionError)):
        return HTTPException(status_code=502, detail=f"Cannot reach pfSense: {msg}")
    if isinstance(e, RuntimeError):
        return HTTPException(status_code=502, detail=msg)
    return HTTPException(status_code=502, detail=f"pfSense error: {msg}")


@router.get("/mode")
async def get_mode(_: User = Depends(get_current_user)):
    return {"mode": _get_mode()}


@router.get("/test")
async def test_connection(_: User = Depends(get_current_user)):
    """Test pfSense API connectivity — returns raw response for debugging."""
    _require_configured()
    mode = _get_mode()
    if mode == "snmp":
        try:
            info = await pfsense_mod.pfsense_snmp_client.get_system_info()
            return {"ok": True, "mode": "snmp", "data": info}
        except Exception as e:
            return {"ok": False, "mode": "snmp", "error": str(e)}

    # API mode — auto-detect scheme then do a raw request
    client = pfsense_mod.pfsense_client
    scheme, host = client._parse_host()

    # If no scheme specified, try both http and https
    if not scheme:
        schemes_to_try = ["http", "https"]
    else:
        schemes_to_try = [scheme]

    headers = client._build_headers()
    for try_scheme in schemes_to_try:
        url = f"{try_scheme}://{host}/api/v2/status/system"
        try:
            async with httpx.AsyncClient(verify=client._verify_ssl) as http:
                resp = await http.get(url, headers=headers, timeout=8)
                if resp.status_code == 200:
                    # Cache the working scheme
                    client._detected_scheme = try_scheme
                return {
                    "ok": resp.status_code == 200,
                    "mode": "api",
                    "scheme_detected": try_scheme,
                    "url": url,
                    "status_code": resp.status_code,
                    "headers_sent": {k: v[:8] + "..." if k == "X-API-Key" else v for k, v in headers.items()},
                    "response_body": resp.text[:2000],
                }
        except httpx.TimeoutException:
            continue  # try next scheme
        except Exception as e:
            return {
                "ok": False,
                "mode": "api",
                "url": url,
                "error": f"{type(e).__name__}: {e}",
            }

    return {
        "ok": False,
        "mode": "api",
        "url": f"http(s)://{host}/api/v2/status/system",
        "error": "Connection timed out on both HTTP and HTTPS. Verify pfSense is reachable from this server and the REST API plugin is installed.",
    }


@router.get("/debug/raw")
async def debug_raw(_: User = Depends(get_current_user)):
    """Return raw pfrest API responses for debugging field names."""
    _require_configured()
    if _get_mode() != "api":
        return {"error": "Debug only available in API mode"}
    client = pfsense_mod.pfsense_client
    results = {}
    for name, path in [("system", "/status/system"), ("interfaces", "/status/interfaces"), ("arp", "/diagnostics/arp_table"), ("gateways", "/status/gateways")]:
        try:
            data = await client._get(path)
            # Show first 3 items if list, or first 3 keys if dict
            if isinstance(data, list):
                results[name] = {"type": "list", "count": len(data), "sample": data[:3]}
            elif isinstance(data, dict):
                keys = list(data.keys())[:10]
                sample = {k: data[k] for k in keys[:3]}
                results[name] = {"type": "dict", "keys": keys, "sample": sample}
            else:
                results[name] = {"type": type(data).__name__, "value": str(data)[:500]}
        except Exception as e:
            results[name] = {"error": f"{type(e).__name__}: {e}"}
    return results


@router.get("/interfaces")
async def get_interfaces(_: User = Depends(get_current_user)):
    _require_configured()
    try:
        if _get_mode() == "snmp":
            return await pfsense_mod.pfsense_snmp_client.get_interfaces()
        ifaces = await pfsense_mod.pfsense_client.get_interfaces()
        return _normalize_api_interfaces(ifaces)
    except Exception as e:
        raise _pfsense_error(e)


@router.get("/firewall/rules")
async def get_firewall_rules(_: User = Depends(get_current_user)):
    _require_configured()
    try:
        if _get_mode() == "snmp":
            return {"data": [], "notice": "Firewall rules are not available via SNMP. Use API mode for full access."}
        return await pfsense_mod.pfsense_client.get_firewall_rules()
    except Exception as e:
        raise _pfsense_error(e)


@router.get("/dhcp/leases")
async def get_dhcp_leases(_: User = Depends(get_current_user)):
    _require_configured()
    try:
        if _get_mode() == "snmp":
            return {"data": [], "notice": "DHCP leases are not available via SNMP. Use API mode for full access."}
        return await pfsense_mod.pfsense_client.get_dhcp_leases()
    except Exception as e:
        raise _pfsense_error(e)


@router.get("/gateways")
async def get_gateways(_: User = Depends(get_current_user)):
    _require_configured()
    try:
        if _get_mode() == "snmp":
            return await pfsense_mod.pfsense_snmp_client.get_gateways()
        gw_data = await pfsense_mod.pfsense_client.get_gateways()
        return _normalize_api_gateways(gw_data)
    except Exception as e:
        raise _pfsense_error(e)


@router.get("/vpn/openvpn")
async def get_openvpn_status(_: User = Depends(get_current_user)):
    _require_configured()
    try:
        if _get_mode() == "snmp":
            return {"data": [], "notice": "VPN status is not available via SNMP. Use API mode for full access."}
        return await pfsense_mod.pfsense_client.get_openvpn_status()
    except Exception as e:
        raise _pfsense_error(e)


@router.get("/system")
async def get_system_info(_: User = Depends(get_current_user)):
    _require_configured()
    try:
        if _get_mode() == "snmp":
            return await pfsense_mod.pfsense_snmp_client.get_system_info()
        data = await pfsense_mod.pfsense_client.get_system_info()
        return _normalize_api_system(data)
    except Exception as e:
        raise _pfsense_error(e)


@router.get("/arp")
async def get_arp_table(_: User = Depends(get_current_user)):
    _require_configured()
    try:
        if _get_mode() == "snmp":
            return await pfsense_mod.pfsense_snmp_client.get_arp_table()
        arp_data = await pfsense_mod.pfsense_client.get_arp_table()
        return _normalize_api_arp(arp_data)
    except Exception as e:
        raise _pfsense_error(e)


@router.get("/services")
async def get_services(_: User = Depends(get_current_user)):
    _require_configured()
    try:
        if _get_mode() == "snmp":
            return []
        return await pfsense_mod.pfsense_client.get_services()
    except Exception as e:
        raise _pfsense_error(e)


@router.get("/overview")
async def get_overview(_: User = Depends(get_current_user)):
    """Combined overview: system + interfaces + ARP + gateway stats."""
    _require_configured()
    mode = _get_mode()

    try:
        if mode == "snmp":
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

        # API mode — pfrest endpoints
        # Use return_exceptions so one failing endpoint doesn't kill all three
        results = await asyncio.gather(
            pfsense_mod.pfsense_client.get_system_info(),
            pfsense_mod.pfsense_client.get_interfaces(),
            pfsense_mod.pfsense_client.get_arp_table(),
            return_exceptions=True,
        )

        # If system info failed, that's the critical one — raise it
        if isinstance(results[0], Exception):
            logger.error(f"pfSense system info failed: {results[0]}")
            raise results[0]

        system = results[0] if not isinstance(results[0], Exception) else {}
        interfaces = results[1] if not isinstance(results[1], Exception) else []
        arp = results[2] if not isinstance(results[2], Exception) else []

        if isinstance(results[1], Exception):
            logger.warning(f"pfSense interfaces failed (non-fatal): {results[1]}")
        if isinstance(results[2], Exception):
            logger.warning(f"pfSense ARP failed (non-fatal): {results[2]}")

        logger.info(f"pfSense raw system type={type(system).__name__}, keys={list(system.keys())[:10] if isinstance(system, dict) else 'N/A'}")
        logger.info(f"pfSense raw interfaces type={type(interfaces).__name__}, len={len(interfaces) if isinstance(interfaces, (list, dict)) else 'N/A'}")
        if isinstance(interfaces, list) and interfaces:
            logger.info(f"pfSense first interface keys: {list(interfaces[0].keys()) if isinstance(interfaces[0], dict) else interfaces[0]}")
        elif isinstance(interfaces, dict) and interfaces:
            first_key = next(iter(interfaces))
            logger.info(f"pfSense interfaces is dict, first key={first_key}, value keys={list(interfaces[first_key].keys()) if isinstance(interfaces[first_key], dict) else 'N/A'}")

        norm_system = _normalize_api_system(system)
        norm_ifs = _normalize_api_interfaces(interfaces)
        norm_arp = _normalize_api_arp(arp)
        up_count = sum(1 for i in norm_ifs if i.get("oper_status") == "up")
        down_count = sum(1 for i in norm_ifs if i.get("oper_status") == "down")

        # Include raw field names for debugging via "Show Raw Data"
        debug_info = {}
        if isinstance(system, dict):
            debug_info["system_keys"] = list(system.keys())
        if isinstance(arp, list) and arp and isinstance(arp[0], dict):
            debug_info["arp_entry_keys"] = list(arp[0].keys())
            debug_info["arp_entry_sample"] = arp[0]
        if isinstance(interfaces, list) and interfaces and isinstance(interfaces[0], dict):
            debug_info["interface_keys"] = list(interfaces[0].keys())

        return {
            "system": norm_system,
            "interfaces": norm_ifs,
            "arp_table": norm_arp,
            "interface_counts": {"up": up_count, "down": down_count, "total": len(norm_ifs)},
            "_debug": debug_info,
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"pfSense overview failed: {e}", exc_info=True)
        raise _pfsense_error(e)


# ---------------------------------------------------------------------------
# Normalization helpers — map pfrest JSON to the format our frontend expects
# ---------------------------------------------------------------------------

def _first_of(d: dict, *keys, default=""):
    """Return the value of the first key found in d, or default."""
    for k in keys:
        v = d.get(k)
        if v is not None and v != "":
            return v
    return default


def _normalize_api_system(data: dict) -> dict:
    """Normalize pfrest /api/v2/status/system response."""
    if not data:
        return {}
    logger.info(f"pfSense raw system keys: {list(data.keys())}")
    result = dict(data)

    # Hostname — try many possible field names
    if "hostname" not in result or not result["hostname"]:
        result["hostname"] = _first_of(data,
            "hostname", "system_hostname", "platform_hostname", "host_name",
            "netgate_host_name", "name", "host")

    # Uptime — pfrest may return seconds as int
    raw_uptime = _first_of(data, "uptime", "uptime_seconds", "system_uptime")
    if raw_uptime is not None and str(raw_uptime).replace(".", "").isdigit():
        secs = int(float(str(raw_uptime)))
        days, rem = divmod(secs, 86400)
        hours, rem = divmod(rem, 3600)
        minutes, _ = divmod(rem, 60)
        result["uptime"] = f"{days}d {hours}h {minutes}m"
        result["uptime_seconds"] = secs

    # CPU — pfrest uses various field names
    cpu_usage = _first_of(data, "cpu_usage", "cpu_util", "cpu_percent", "cpu_load", default=None)
    if cpu_usage is not None and "cpu_load_1" not in result:
        result["cpu_load_1"] = f"{cpu_usage}%"
    load_avg = data.get("cpu_load_avg") or data.get("load_avg") or data.get("load_average")
    if isinstance(load_avg, list) and len(load_avg) >= 3:
        result["cpu_load_1"] = str(load_avg[0])
        result["cpu_load_5"] = str(load_avg[1])
        result["cpu_load_15"] = str(load_avg[2])

    # Memory — pfrest uses various field names
    mem_usage = _first_of(data, "mem_usage", "mem_percent", "memory_usage", "mem_util", default=None)
    if mem_usage is not None and "mem_percent" not in result:
        try:
            result["mem_percent"] = round(float(mem_usage), 1)
        except (ValueError, TypeError):
            pass

    # PF states
    for key in ("pfstate_count", "pf_states", "pfstates", "state_table_count", "states"):
        val = data.get(key)
        if val is not None:
            result["pf_states"] = val
            break

    # TCP connections
    if "tcp_established" not in result:
        tcp = _first_of(data, "tcp_connections", "tcp_established", "tcp_count", default=None)
        if tcp is not None:
            result["tcp_established"] = tcp

    return result


def _safe_int(val, default=0) -> int:
    if val is None:
        return default
    try:
        if isinstance(val, str):
            val = val.replace(",", "")
        return int(val)
    except (ValueError, TypeError):
        return default


def _normalize_api_interfaces(interfaces: list) -> list:
    """Normalize pfrest /api/v2/status/interfaces response."""
    if interfaces and isinstance(interfaces[0], dict):
        logger.info(f"pfSense raw interface keys: {list(interfaces[0].keys())}")
        logger.info(f"pfSense raw interface[0]: {interfaces[0]}")
    result = []
    for idx, iface in enumerate(interfaces):
        if not isinstance(iface, dict):
            continue
        name = iface.get("descr") or iface.get("name") or iface.get("if") or f"if{idx}"
        status = iface.get("status", "")

        normalized = {
            "index": str(idx),
            "name": name,
            "alias": iface.get("descr") or iface.get("name") or "",
            "oper_status": "up" if status in ("up", "associated", "active") or iface.get("enable") == "true" else "down",
            "admin_status": "up" if iface.get("enable") in (True, "true", "1", 1, None) else "down",
            "speed": _safe_int(iface.get("speed", 0)),
            "mtu": _safe_int(iface.get("mtu", 1500)),
            "in_octets": _safe_int(iface.get("inbytes") or iface.get("inbytes_frmt")),
            "out_octets": _safe_int(iface.get("outbytes") or iface.get("outbytes_frmt")),
            "in_errors": _safe_int(iface.get("inerrs")),
            "out_errors": _safe_int(iface.get("outerrs")),
            "ip_addresses": [],
            "macaddr": iface.get("macaddr", ""),
        }

        ipaddr = iface.get("ipaddr") or iface.get("ip")
        subnet = iface.get("subnet")
        if ipaddr and ipaddr not in ("", "none", "0.0.0.0"):
            normalized["ip_addresses"].append(f"{ipaddr}/{subnet}" if subnet else ipaddr)
        ipaddr6 = iface.get("ipaddrv6")
        subnetv6 = iface.get("subnetv6")
        if ipaddr6 and ipaddr6 not in ("", "none"):
            normalized["ip_addresses"].append(f"{ipaddr6}/{subnetv6}" if subnetv6 else ipaddr6)

        result.append(normalized)
    return result


def _normalize_api_gateways(gateways: list) -> list:
    """Normalize pfrest gateway data for the frontend."""
    result = []
    for gw in gateways:
        if not isinstance(gw, dict):
            continue
        result.append({
            "name": gw.get("name", ""),
            "destination": gw.get("network", gw.get("destination", "")),
            "gateway": gw.get("gateway", gw.get("nexthop", "")),
            "mask": gw.get("mask", ""),
            "metric": _safe_int(gw.get("weight") or gw.get("metric")),
            "interface": gw.get("interface", gw.get("friendlyiface", "")),
            "monitor": gw.get("monitor", ""),
            "status": gw.get("status", ""),
            "delay": gw.get("delay", ""),
            "stddev": gw.get("stddev", ""),
            "loss": gw.get("loss", ""),
        })
    return result


def _normalize_api_arp(arp_data: list) -> list:
    """Normalize pfrest /api/v2/diagnostics/arp_table response."""
    if arp_data and isinstance(arp_data[0], dict):
        logger.info(f"pfSense raw ARP entry keys: {list(arp_data[0].keys())}")
        logger.info(f"pfSense raw ARP entry[0] values: {arp_data[0]}")
    result = []
    for entry in arp_data:
        if not isinstance(entry, dict):
            continue
        result.append({
            "ip": _first_of(entry, "ip", "ip_address", "ipaddr", "ip-address",
                            "address", "hostname", "host"),
            "mac": _first_of(entry, "mac", "mac_address", "macaddr", "mac-address",
                             "ether", "hwaddr", "hw_address", "ethernet"),
            "interface": _first_of(entry, "interface", "if", "iface", "intf",
                                   "dnsresolve", "port"),
            "type": _first_of(entry, "type", "expires", "status", "state", default="dynamic"),
            # Pass through all raw fields so frontend "Show Raw Data" reveals them
            "_raw": entry,
        })
    return result
