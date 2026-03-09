import logging
from fastapi import APIRouter, Depends, HTTPException
from app.dependencies import get_current_user
from app.models.user import User
from app.services.switch_client import switch_client

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/switch", tags=["switch"])


def _require_configured():
    if not switch_client.is_configured:
        raise HTTPException(status_code=400, detail="Switch not configured — set the host in Settings.")


@router.get("/test")
async def test_connection(_: User = Depends(get_current_user)):
    """Try to connect and return detailed success/error info."""
    if not switch_client.is_configured:
        return {"ok": False, "host": "", "error": "Switch not configured — set the host in Settings."}
    host = switch_client._host
    try:
        system = await switch_client.get_system_info()
        logger.info("Switch test connection to %s succeeded", host)
        return {"ok": True, "host": host, "system": system}
    except Exception as e:
        logger.error("Switch test connection to %s failed: %s", host, e)
        return {"ok": False, "host": host, "error": str(e)}


@router.get("/overview")
async def get_overview(_: User = Depends(get_current_user)):
    """Gather system + interfaces + mac + vlans in one call, catching individual failures."""
    _require_configured()

    result: dict = {"system": None, "interfaces": [], "mac_table": [], "vlans": []}

    try:
        result["system"] = await switch_client.get_system_info()
    except Exception as e:
        logger.error("Switch overview: failed to get system info: %s", e)
        result["error"] = f"System info failed: {e}"

    try:
        result["interfaces"] = await switch_client.get_interfaces()
    except Exception as e:
        logger.error("Switch overview: failed to get interfaces: %s", e)

    try:
        result["mac_table"] = await switch_client.get_mac_table()
    except Exception as e:
        logger.error("Switch overview: failed to get MAC table: %s", e)

    try:
        result["vlans"] = await switch_client.get_vlans()
    except Exception as e:
        logger.error("Switch overview: failed to get VLANs: %s", e)

    return result


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
