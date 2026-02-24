from fastapi import APIRouter, Depends
from app.dependencies import get_current_user
from app.models.user import User
from app.config import settings
from app.schemas.settings import ProxmoxSettings, PfSenseSettings, SettingsResponse
from app.services.proxmox_client import proxmox_client
from app.services.pfsense_client import pfsense_client

router = APIRouter(prefix="/api/settings", tags=["settings"])


@router.get("", response_model=SettingsResponse)
async def get_settings(_: User = Depends(get_current_user)):
    return SettingsResponse(
        proxmox_host=settings.proxmox_host,
        proxmox_token_id=settings.proxmox_token_id,
        proxmox_configured=proxmox_client.is_configured,
        pfsense_host=settings.pfsense_host,
        pfsense_configured=pfsense_client.is_configured,
        health_check_interval=settings.health_check_interval,
        proxmox_poll_interval=settings.proxmox_poll_interval,
    )


@router.put("/proxmox")
async def update_proxmox_settings(
    data: ProxmoxSettings, _: User = Depends(get_current_user)
):
    proxmox_client.update_config(
        host=data.host,
        token_id=data.token_id,
        token_secret=data.token_secret,
        username=data.username,
        password=data.password,
        verify_ssl=data.verify_ssl,
    )
    return {"status": "updated"}


@router.put("/pfsense")
async def update_pfsense_settings(
    data: PfSenseSettings, _: User = Depends(get_current_user)
):
    pfsense_client.update_config(
        host=data.host,
        api_key=data.api_key,
        api_secret=data.api_secret,
        verify_ssl=data.verify_ssl,
    )
    return {"status": "updated"}
