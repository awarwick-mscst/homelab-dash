import asyncio

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user
from app.models.user import User
from app.models.device import Device
from app.services.proxmox_client import proxmox_manager

router = APIRouter(prefix="/api/proxmox", tags=["proxmox"])


def _get_client(server_id: str):
    try:
        client = proxmox_manager.get_client(server_id)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"Proxmox server '{server_id}' not found")
    if not client.is_configured:
        raise HTTPException(status_code=400, detail=f"Proxmox server '{server_id}' not configured")
    return client


@router.get("/servers")
async def list_servers(_: User = Depends(get_current_user)):
    return proxmox_manager.list_servers()


@router.get("/{server_id}/nodes")
async def get_nodes(server_id: str, _: User = Depends(get_current_user)):
    client = _get_client(server_id)
    return await client.get_nodes()


@router.get("/{server_id}/nodes/{node}/status")
async def get_node_status(server_id: str, node: str, _: User = Depends(get_current_user)):
    client = _get_client(server_id)
    return await client.get_node_status(node)


@router.get("/{server_id}/nodes/{node}/vms")
async def get_vms(server_id: str, node: str, _: User = Depends(get_current_user)):
    client = _get_client(server_id)
    return await client.get_vms(node)


@router.get("/{server_id}/nodes/{node}/containers")
async def get_containers(server_id: str, node: str, _: User = Depends(get_current_user)):
    client = _get_client(server_id)
    return await client.get_containers(node)


@router.get("/{server_id}/nodes/{node}/guests")
async def get_guests(
    server_id: str, node: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Return VMs and CTs enriched with IP addresses and linked device info."""
    client = _get_client(server_id)
    raw_vms, raw_cts = await asyncio.gather(
        client.get_vms(node),
        client.get_containers(node),
    )

    guests = []
    for vm in raw_vms:
        guests.append({**vm, "_type": "qemu", "_node": node})
    for ct in raw_cts:
        guests.append({**ct, "_type": "lxc", "_node": node})

    # Fetch IPs for running guests in parallel
    async def _enrich(guest: dict) -> dict:
        ips: list[str] = []
        if guest.get("status") == "running":
            try:
                ips = await asyncio.wait_for(
                    client.get_guest_ips(node, guest["vmid"], guest["_type"]),
                    timeout=5,
                )
            except (asyncio.TimeoutError, Exception):
                pass
        guest["ip_addresses"] = ips
        return guest

    guests = await asyncio.gather(*[_enrich(g) for g in guests])

    # Look up linked devices
    for guest in guests:
        linked = None
        # Check by proxmox_vmid mapping
        result = await db.execute(
            select(Device).where(
                and_(
                    Device.proxmox_vmid == guest["vmid"],
                    Device.proxmox_server_id == server_id,
                )
            )
        )
        device = result.scalar_one_or_none()
        # Fallback: match by IP address
        if not device and guest["ip_addresses"]:
            for ip in guest["ip_addresses"]:
                result = await db.execute(
                    select(Device).where(Device.ip_address == ip)
                )
                device = result.scalar_one_or_none()
                if device:
                    break
        if device:
            linked = {
                "id": device.id,
                "hostname": device.hostname,
                "ip_address": device.ip_address,
            }
        guest["linked_device"] = linked

    return guests


@router.post("/{server_id}/nodes/{node}/qemu/{vmid}/{action}")
async def vm_action(
    server_id: str, node: str, vmid: int, action: str, _: User = Depends(get_current_user)
):
    client = _get_client(server_id)
    if action not in ("start", "stop", "shutdown", "reboot", "reset"):
        raise HTTPException(status_code=400, detail="Invalid action")
    return await client.vm_action(node, vmid, action)


@router.post("/{server_id}/nodes/{node}/lxc/{vmid}/{action}")
async def container_action(
    server_id: str, node: str, vmid: int, action: str, _: User = Depends(get_current_user)
):
    client = _get_client(server_id)
    if action not in ("start", "stop", "shutdown", "reboot"):
        raise HTTPException(status_code=400, detail="Invalid action")
    return await client.container_action(node, vmid, action)


@router.get("/{server_id}/resources")
async def get_resources(server_id: str, _: User = Depends(get_current_user)):
    client = _get_client(server_id)
    return await client.get_cluster_resources()


class LinkDeviceRequest(BaseModel):
    device_id: int
    server_id: str
    node: str
    vmid: int
    type: str  # "qemu" or "lxc"


@router.post("/link-device")
async def link_device(
    data: LinkDeviceRequest,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    device = await db.get(Device, data.device_id)
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")
    # Clear any existing link for this vmid
    result = await db.execute(
        select(Device).where(
            and_(
                Device.proxmox_vmid == data.vmid,
                Device.proxmox_server_id == data.server_id,
            )
        )
    )
    old = result.scalar_one_or_none()
    if old and old.id != data.device_id:
        old.proxmox_vmid = None
        old.proxmox_server_id = None
        old.proxmox_node = None
        old.proxmox_type = None
    device.proxmox_vmid = data.vmid
    device.proxmox_server_id = data.server_id
    device.proxmox_node = data.node
    device.proxmox_type = data.type
    await db.commit()
    return {"status": "linked"}


@router.delete("/link-device/{device_id}")
async def unlink_device(
    device_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    device = await db.get(Device, device_id)
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")
    device.proxmox_vmid = None
    device.proxmox_server_id = None
    device.proxmox_node = None
    device.proxmox_type = None
    await db.commit()
    return {"status": "unlinked"}


@router.post("/{server_id}/auto-link")
async def auto_link_devices(
    server_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Auto-link VMs/CTs to devices by matching IP addresses."""
    client = _get_client(server_id)
    nodes = await client.get_nodes()
    linked_count = 0

    for node_info in nodes:
        node = node_info["node"]
        vms, cts = await asyncio.gather(
            client.get_vms(node),
            client.get_containers(node),
        )

        guests = [(vm, "qemu") for vm in vms] + [(ct, "lxc") for ct in cts]

        for guest, guest_type in guests:
            if guest.get("status") != "running":
                continue
            try:
                ips = await asyncio.wait_for(
                    client.get_guest_ips(node, guest["vmid"], guest_type),
                    timeout=5,
                )
            except (asyncio.TimeoutError, Exception):
                continue

            for ip in ips:
                result = await db.execute(
                    select(Device).where(Device.ip_address == ip)
                )
                device = result.scalar_one_or_none()
                if device and not device.proxmox_vmid:
                    device.proxmox_vmid = guest["vmid"]
                    device.proxmox_server_id = server_id
                    device.proxmox_node = node
                    device.proxmox_type = guest_type
                    linked_count += 1
                    break

    await db.commit()
    return {"status": "ok", "linked": linked_count}
