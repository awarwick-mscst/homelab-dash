from fastapi import APIRouter, Depends, HTTPException
from app.dependencies import get_current_user
from app.models.user import User
from app.services.unifi_client import unifi_client

router = APIRouter(prefix="/api/unifi", tags=["unifi"])


def _require_configured():
    if not unifi_client.is_configured:
        raise HTTPException(status_code=400, detail="UniFi not configured")


@router.get("/devices")
async def get_devices(_: User = Depends(get_current_user)):
    _require_configured()
    return await unifi_client.get_devices()


@router.get("/clients")
async def get_clients(_: User = Depends(get_current_user)):
    _require_configured()
    return await unifi_client.get_clients()


@router.get("/wlan")
async def get_wlan_networks(_: User = Depends(get_current_user)):
    _require_configured()
    return await unifi_client.get_wlan_networks()


@router.get("/health")
async def get_health(_: User = Depends(get_current_user)):
    _require_configured()
    return await unifi_client.get_health()


@router.get("/sites")
async def get_sites(_: User = Depends(get_current_user)):
    _require_configured()
    return await unifi_client.get_sites()
