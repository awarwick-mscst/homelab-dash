from fastapi import APIRouter, Depends, HTTPException
from app.dependencies import get_current_user
from app.models.user import User
from app.services.pfsense_client import pfsense_client

router = APIRouter(prefix="/api/pfsense", tags=["pfsense"])


def _require_configured():
    if not pfsense_client.is_configured:
        raise HTTPException(status_code=400, detail="pfSense not configured")


@router.get("/interfaces")
async def get_interfaces(_: User = Depends(get_current_user)):
    _require_configured()
    return await pfsense_client.get_interfaces()


@router.get("/firewall/rules")
async def get_firewall_rules(_: User = Depends(get_current_user)):
    _require_configured()
    return await pfsense_client.get_firewall_rules()


@router.get("/dhcp/leases")
async def get_dhcp_leases(_: User = Depends(get_current_user)):
    _require_configured()
    return await pfsense_client.get_dhcp_leases()


@router.get("/gateways")
async def get_gateways(_: User = Depends(get_current_user)):
    _require_configured()
    return await pfsense_client.get_gateways()


@router.get("/vpn/openvpn")
async def get_openvpn_status(_: User = Depends(get_current_user)):
    _require_configured()
    return await pfsense_client.get_openvpn_status()


@router.get("/system")
async def get_system_info(_: User = Depends(get_current_user)):
    _require_configured()
    return await pfsense_client.get_system_info()
