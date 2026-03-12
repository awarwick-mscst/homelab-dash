import logging
from fastapi import APIRouter, Depends, HTTPException
from app.dependencies import get_current_user
from app.models.user import User
from app.services.switch_client import switch_client

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/switch", tags=["switch"])


def _require_configured():
    if not switch_client.is_configured:
        mode = switch_client.mode
        if mode == "ssh":
            raise HTTPException(status_code=400, detail="Switch SSH not configured — enter host, username, and password in Settings and press Save.")
        raise HTTPException(status_code=400, detail="Switch SNMP not configured — enter the host and community string in Settings and press Save.")


@router.get("/test")
async def test_connection(_: User = Depends(get_current_user)):
    """Try to connect and return detailed success/error info."""
    if not switch_client.is_configured:
        mode = switch_client.mode
        if mode == "ssh":
            return {"ok": False, "host": "", "error": "Switch SSH not configured — enter the host, username, and password, then press Save before testing."}
        return {"ok": False, "host": "", "error": "Switch SNMP not configured — enter the host and community string, then press Save before testing."}
    try:
        result = await switch_client.test_connection()
        if result.get("ok"):
            logger.info("Switch test connection to %s succeeded (mode=%s)", switch_client._host, switch_client.mode)
        else:
            logger.error("Switch test connection to %s failed: %s", switch_client._host, result.get("error"))
        return result
    except Exception as e:
        logger.error("Switch test connection to %s failed: %s", switch_client._host, e)
        return {"ok": False, "host": switch_client._host, "error": str(e)}


@router.get("/overview")
async def get_overview(_: User = Depends(get_current_user)):
    """Gather system + interfaces + mac + vlans in one call."""
    _require_configured()
    try:
        result = await switch_client.get_overview_data()
        # Log what we got back so we can diagnose empty results
        sys_ok = result.get("system") is not None and bool(result["system"].get("hostname") or result["system"].get("description"))
        iface_count = len(result.get("interfaces", []))
        mac_count = len(result.get("mac_table", []))
        vlan_count = len(result.get("vlans", []))
        errors = result.get("_errors", [])
        logger.info("Switch overview: mode=%s system=%s interfaces=%d macs=%d vlans=%d errors=%s",
                     switch_client.mode, sys_ok, iface_count, mac_count, vlan_count, errors)
        return result
    except Exception as e:
        logger.error("Switch overview failed: %s", e, exc_info=True)
        raise HTTPException(status_code=502, detail=str(e))


@router.get("/system")
async def get_system_info(_: User = Depends(get_current_user)):
    _require_configured()
    try:
        return await switch_client.get_system_info()
    except Exception as e:
        logger.error("Switch get_system_info failed: %s", e)
        raise HTTPException(status_code=502, detail=str(e))


@router.get("/interfaces")
async def get_interfaces(_: User = Depends(get_current_user)):
    _require_configured()
    try:
        return await switch_client.get_interfaces()
    except Exception as e:
        logger.error("Switch get_interfaces failed: %s", e)
        raise HTTPException(status_code=502, detail=str(e))


@router.get("/mac-table")
async def get_mac_table(_: User = Depends(get_current_user)):
    _require_configured()
    try:
        return await switch_client.get_mac_table()
    except Exception as e:
        logger.error("Switch get_mac_table failed: %s", e)
        raise HTTPException(status_code=502, detail=str(e))


@router.get("/vlans")
async def get_vlans(_: User = Depends(get_current_user)):
    _require_configured()
    try:
        return await switch_client.get_vlans()
    except Exception as e:
        logger.error("Switch get_vlans failed: %s", e)
        raise HTTPException(status_code=502, detail=str(e))


@router.get("/poe")
async def get_poe_status(_: User = Depends(get_current_user)):
    _require_configured()
    try:
        return await switch_client.get_poe_status()
    except Exception as e:
        logger.error("Switch get_poe_status failed: %s", e)
        raise HTTPException(status_code=502, detail=str(e))


@router.get("/debug-raw")
async def debug_raw_output(_: User = Depends(get_current_user)):
    """Run switch commands and return raw output for debugging parsers."""
    _require_configured()
    commands = [
        "show version",
        "show system",
        "show interface status",
        "show mac address-table",
    ]
    try:
        raw = await switch_client._active()._run(commands)
        return {"ok": True, "raw": raw}
    except Exception as e:
        logger.error("Switch debug-raw failed: %s", e)
        return {"ok": False, "error": str(e)}
