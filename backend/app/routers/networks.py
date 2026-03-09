import logging
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, and_, or_
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user
from app.models.user import User
from app.models.device import Device
from app.models.network import Subnet, NetworkLink, TopologyLayout
from app.schemas.network import (
    SubnetCreate, SubnetUpdate, SubnetResponse,
    NetworkLinkCreate, NetworkLinkResponse,
    TopologyLayoutUpdate, TopologyLayoutResponse,
)
from app.services.unifi_client import unifi_client

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/networks", tags=["networks"])


# --- Subnets ---
@router.get("/subnets", response_model=list[SubnetResponse])
async def list_subnets(
    db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user)
):
    result = await db.execute(select(Subnet).order_by(Subnet.cidr))
    return result.scalars().all()


@router.post("/subnets", response_model=SubnetResponse, status_code=201)
async def create_subnet(
    data: SubnetCreate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    subnet = Subnet(**data.model_dump())
    db.add(subnet)
    await db.commit()
    await db.refresh(subnet)
    return subnet


@router.put("/subnets/{subnet_id}", response_model=SubnetResponse)
async def update_subnet(
    subnet_id: int,
    data: SubnetUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    subnet = await db.get(Subnet, subnet_id)
    if not subnet:
        raise HTTPException(status_code=404, detail="Subnet not found")
    for key, value in data.model_dump(exclude_unset=True).items():
        setattr(subnet, key, value)
    await db.commit()
    await db.refresh(subnet)
    return subnet


@router.delete("/subnets/{subnet_id}", status_code=204)
async def delete_subnet(
    subnet_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    subnet = await db.get(Subnet, subnet_id)
    if not subnet:
        raise HTTPException(status_code=404, detail="Subnet not found")
    await db.delete(subnet)
    await db.commit()


# --- Network Links ---
@router.get("/links", response_model=list[NetworkLinkResponse])
async def list_links(
    db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user)
):
    result = await db.execute(select(NetworkLink))
    return result.scalars().all()


@router.post("/links", response_model=NetworkLinkResponse, status_code=201)
async def create_link(
    data: NetworkLinkCreate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    link = NetworkLink(**data.model_dump())
    db.add(link)
    await db.commit()
    await db.refresh(link)
    return link


@router.delete("/links/{link_id}", status_code=204)
async def delete_link(
    link_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    link = await db.get(NetworkLink, link_id)
    if not link:
        raise HTTPException(status_code=404, detail="Link not found")
    await db.delete(link)
    await db.commit()


# --- Topology Layout ---
@router.get("/topology", response_model=TopologyLayoutResponse | None)
async def get_topology(
    db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user)
):
    result = await db.execute(
        select(TopologyLayout).where(TopologyLayout.name == "default")
    )
    return result.scalar_one_or_none()


@router.put("/topology", response_model=TopologyLayoutResponse)
async def save_topology(
    data: TopologyLayoutUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    result = await db.execute(
        select(TopologyLayout).where(TopologyLayout.name == data.name)
    )
    layout = result.scalar_one_or_none()
    if layout:
        layout.layout_data = data.layout_data
    else:
        layout = TopologyLayout(name=data.name, layout_data=data.layout_data)
        db.add(layout)
    await db.commit()
    await db.refresh(layout)
    return layout


# --- Auto-link from UniFi ---
@router.post("/links/auto-unifi")
async def auto_link_unifi(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Fetch UniFi APs and clients, match to devices, auto-create wireless links."""
    if not unifi_client.is_configured:
        raise HTTPException(status_code=400, detail="UniFi not configured")

    try:
        unifi_devices = await unifi_client.get_devices()
        unifi_clients = await unifi_client.get_clients()
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"UniFi fetch failed: {e}")

    # Build AP lookup: unifi _id -> AP dict
    ap_by_id: dict[str, dict] = {}
    for ud in unifi_devices:
        if ud.get("type") in ("uap", "usw", "ugw"):
            ap_by_id[ud["_id"]] = ud

    # Load all devices from DB for matching
    result = await db.execute(select(Device))
    all_devices = result.scalars().all()

    # Build lookup maps: MAC (lowercase) -> Device, IP -> Device
    dev_by_mac: dict[str, Device] = {}
    dev_by_ip: dict[str, Device] = {}
    for d in all_devices:
        if d.mac_address:
            dev_by_mac[d.mac_address.lower()] = d
        if d.ip_address:
            dev_by_ip[d.ip_address] = d

    # Load existing links to avoid duplicates
    result = await db.execute(select(NetworkLink))
    existing_links = result.scalars().all()
    existing_pairs: set[tuple[int, int]] = set()
    for link in existing_links:
        existing_pairs.add((link.source_device_id, link.target_device_id))
        existing_pairs.add((link.target_device_id, link.source_device_id))

    created = 0
    skipped = 0

    for client in unifi_clients:
        # Only auto-link wireless clients
        if client.get("is_wired", False):
            continue

        client_mac = (client.get("mac") or "").lower()
        client_ip = client.get("ip", "")
        ap_id = client.get("ap_mac", "")  # UniFi uses ap_mac field

        # Find the AP device in our DB
        ap_mac_lower = ap_id.lower() if ap_id else ""
        ap_device = dev_by_mac.get(ap_mac_lower)
        if not ap_device:
            # Try matching AP by its IP from UniFi device data
            for ud in unifi_devices:
                if ud.get("mac", "").lower() == ap_mac_lower and ud.get("ip"):
                    ap_device = dev_by_ip.get(ud["ip"])
                    break

        if not ap_device:
            skipped += 1
            continue

        # Find client device in our DB
        client_device = dev_by_mac.get(client_mac)
        if not client_device and client_ip:
            client_device = dev_by_ip.get(client_ip)

        if not client_device:
            skipped += 1
            continue

        # Don't link a device to itself
        if ap_device.id == client_device.id:
            continue

        # Skip if link already exists
        if (ap_device.id, client_device.id) in existing_pairs:
            skipped += 1
            continue

        essid = client.get("essid", "")
        signal = client.get("signal")
        signal_note = f", signal: {signal} dBm" if signal else ""

        link = NetworkLink(
            source_device_id=ap_device.id,
            target_device_id=client_device.id,
            link_type="wifi",
            source_port_label=essid or None,
            target_port_label="WiFi",
            notes=f"Auto-linked from UniFi{signal_note}",
        )
        db.add(link)
        existing_pairs.add((ap_device.id, client_device.id))
        created += 1

    if created > 0:
        await db.commit()

    return {
        "created": created,
        "skipped": skipped,
        "total_wireless_clients": sum(1 for c in unifi_clients if not c.get("is_wired", False)),
        "total_aps": len([u for u in unifi_devices if u.get("type") == "uap"]),
    }


# --- Auto-connect unlinked devices to switch ---
@router.post("/links/auto-switch")
async def auto_link_switch(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Connect devices that have no links to the first switch found."""
    result = await db.execute(select(Device))
    all_devices = result.scalars().all()

    # Find switches
    switches = [d for d in all_devices if d.device_type in ("switch", "switch_large")]
    if not switches:
        return {"created": 0, "message": "No switch device found"}

    switch = switches[0]  # primary switch

    # Load existing links
    result = await db.execute(select(NetworkLink))
    existing_links = result.scalars().all()

    # Build set of devices that already have at least one link
    linked_device_ids: set[int] = set()
    existing_pairs: set[tuple[int, int]] = set()
    for link in existing_links:
        linked_device_ids.add(link.source_device_id)
        linked_device_ids.add(link.target_device_id)
        existing_pairs.add((link.source_device_id, link.target_device_id))
        existing_pairs.add((link.target_device_id, link.source_device_id))

    created = 0
    skip_types = ("internet",)  # don't auto-connect internet nodes to switch

    for device in all_devices:
        if device.id == switch.id:
            continue
        if device.device_type in skip_types:
            continue
        # Skip devices that already have any link
        if device.id in linked_device_ids:
            continue
        # Skip if already linked to this switch
        if (switch.id, device.id) in existing_pairs:
            continue

        link = NetworkLink(
            source_device_id=switch.id,
            target_device_id=device.id,
            link_type="ethernet",
            notes="Auto-linked to switch",
        )
        db.add(link)
        existing_pairs.add((switch.id, device.id))
        linked_device_ids.add(device.id)
        created += 1

    if created > 0:
        await db.commit()

    return {"created": created, "switch": switch.hostname or switch.ip_address}


# --- Auto-link Proxmox VMs/CTs to their host node ---
@router.post("/links/auto-proxmox")
async def auto_link_proxmox(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Link VMs and containers to their Proxmox host node device."""
    result = await db.execute(select(Device))
    all_devices = result.scalars().all()

    # Find devices that are Proxmox VMs/containers (have proxmox_node set)
    proxmox_guests = [d for d in all_devices if d.proxmox_node]
    if not proxmox_guests:
        return {"created": 0, "message": "No Proxmox-linked devices found"}

    # Build a lookup for host nodes by hostname or node name
    # Proxmox host devices typically have hostname matching the node name
    dev_by_hostname: dict[str, Device] = {}
    dev_by_ip: dict[str, Device] = {}
    for d in all_devices:
        if d.hostname:
            dev_by_hostname[d.hostname.lower()] = d
        if d.ip_address:
            dev_by_ip[d.ip_address] = d

    # Load existing links
    result = await db.execute(select(NetworkLink))
    existing_links = result.scalars().all()
    existing_pairs: set[tuple[int, int]] = set()
    for link in existing_links:
        existing_pairs.add((link.source_device_id, link.target_device_id))
        existing_pairs.add((link.target_device_id, link.source_device_id))

    # Try to find the Proxmox host from settings
    from app.config import settings
    host_devices: dict[str, Device | None] = {}

    # Map server_id+node to a host device
    for guest in proxmox_guests:
        node_key = f"{guest.proxmox_server_id}:{guest.proxmox_node}"
        if node_key in host_devices:
            continue
        # Try matching by node name as hostname
        host = dev_by_hostname.get(guest.proxmox_node.lower())
        if not host:
            # Try with common suffixes
            for suffix in ("", ".local", ".lan"):
                host = dev_by_hostname.get(f"{guest.proxmox_node.lower()}{suffix}")
                if host:
                    break
        # Try matching Proxmox server host IP from settings
        if not host and guest.proxmox_server_id:
            for srv in getattr(settings, 'proxmox_servers', []):
                if isinstance(srv, dict) and srv.get('id') == guest.proxmox_server_id:
                    srv_host = srv.get('host', '')
                    # Strip port if present
                    srv_ip = srv_host.split(':')[0] if ':' in srv_host else srv_host
                    host = dev_by_ip.get(srv_ip)
                    break
        host_devices[node_key] = host

    created = 0
    for guest in proxmox_guests:
        node_key = f"{guest.proxmox_server_id}:{guest.proxmox_node}"
        host = host_devices.get(node_key)
        if not host or host.id == guest.id:
            continue
        if (host.id, guest.id) in existing_pairs:
            continue

        link_type = "virtual"
        label = f"VM {guest.proxmox_vmid}" if guest.proxmox_type == "qemu" else f"CT {guest.proxmox_vmid}"

        link = NetworkLink(
            source_device_id=host.id,
            target_device_id=guest.id,
            link_type=link_type,
            source_port_label=label,
            target_port_label=guest.proxmox_type or "vm",
            notes=f"Auto-linked from Proxmox ({guest.proxmox_node})",
        )
        db.add(link)
        existing_pairs.add((host.id, guest.id))
        created += 1

    if created > 0:
        await db.commit()

    return {"created": created}
