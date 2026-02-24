from fastapi import APIRouter, Depends, HTTPException
from app.dependencies import get_current_user
from app.models.user import User
from app.services.proxmox_client import proxmox_client

router = APIRouter(prefix="/api/proxmox", tags=["proxmox"])


def _require_configured():
    if not proxmox_client.is_configured:
        raise HTTPException(status_code=400, detail="Proxmox not configured")


@router.get("/nodes")
async def get_nodes(_: User = Depends(get_current_user)):
    _require_configured()
    return await proxmox_client.get_nodes()


@router.get("/nodes/{node}/status")
async def get_node_status(node: str, _: User = Depends(get_current_user)):
    _require_configured()
    return await proxmox_client.get_node_status(node)


@router.get("/nodes/{node}/vms")
async def get_vms(node: str, _: User = Depends(get_current_user)):
    _require_configured()
    return await proxmox_client.get_vms(node)


@router.get("/nodes/{node}/containers")
async def get_containers(node: str, _: User = Depends(get_current_user)):
    _require_configured()
    return await proxmox_client.get_containers(node)


@router.post("/nodes/{node}/qemu/{vmid}/{action}")
async def vm_action(
    node: str, vmid: int, action: str, _: User = Depends(get_current_user)
):
    _require_configured()
    if action not in ("start", "stop", "shutdown", "reboot", "reset"):
        raise HTTPException(status_code=400, detail="Invalid action")
    return await proxmox_client.vm_action(node, vmid, action)


@router.post("/nodes/{node}/lxc/{vmid}/{action}")
async def container_action(
    node: str, vmid: int, action: str, _: User = Depends(get_current_user)
):
    _require_configured()
    if action not in ("start", "stop", "shutdown", "reboot"):
        raise HTTPException(status_code=400, detail="Invalid action")
    return await proxmox_client.container_action(node, vmid, action)


@router.get("/resources")
async def get_resources(_: User = Depends(get_current_user)):
    _require_configured()
    return await proxmox_client.get_cluster_resources()
