import logging
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, delete, and_, or_
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

    # Collect all AP device IDs so we know which links are WiFi auto-links
    ap_device_ids: set[int] = set()
    for ud in unifi_devices:
        if ud.get("type") in ("uap",):
            mac = (ud.get("mac") or "").lower()
            ip = ud.get("ip", "")
            ap_dev = dev_by_mac.get(mac) or dev_by_ip.get(ip)
            if ap_dev:
                ap_device_ids.add(ap_dev.id)

    # Build the latest connection for each wireless client (most recent wins)
    # UniFi returns currently-connected clients, so each client appears once
    # with their current AP — this is already the "latest" connection
    desired_links: dict[int, dict] = {}  # client_device_id -> link info

    skipped = 0
    for client in unifi_clients:
        if client.get("is_wired", False):
            continue

        client_mac = (client.get("mac") or "").lower()
        client_ip = client.get("ip", "")
        ap_id = client.get("ap_mac", "")

        ap_mac_lower = ap_id.lower() if ap_id else ""
        ap_device = dev_by_mac.get(ap_mac_lower)
        if not ap_device:
            for ud in unifi_devices:
                if ud.get("mac", "").lower() == ap_mac_lower and ud.get("ip"):
                    ap_device = dev_by_ip.get(ud["ip"])
                    break

        if not ap_device:
            skipped += 1
            continue

        client_device = dev_by_mac.get(client_mac)
        if not client_device and client_ip:
            client_device = dev_by_ip.get(client_ip)

        if not client_device:
            skipped += 1
            continue

        if ap_device.id == client_device.id:
            continue

        essid = client.get("essid", "")
        signal = client.get("signal")
        signal_note = f", signal: {signal} dBm" if signal else ""

        desired_links[client_device.id] = {
            "ap_device_id": ap_device.id,
            "essid": essid,
            "notes": f"Auto-linked from UniFi{signal_note}",
        }

    # Remove ALL old auto-created WiFi links (notes start with "Auto-linked from UniFi")
    # This cleans up stale connections to old APs
    result = await db.execute(select(NetworkLink).where(
        NetworkLink.link_type == "wifi",
        NetworkLink.notes.like("Auto-linked from UniFi%"),
    ))
    old_wifi_links = result.scalars().all()
    removed = 0
    for old_link in old_wifi_links:
        client_id = old_link.target_device_id
        # Keep if the desired link is exactly the same AP
        desired = desired_links.get(client_id)
        if desired and desired["ap_device_id"] == old_link.source_device_id:
            continue  # same AP, keep it
        await db.delete(old_link)
        removed += 1

    # Now create links for clients that don't already have the correct one
    # Reload existing links after deletions
    result = await db.execute(select(NetworkLink))
    existing_links = result.scalars().all()
    existing_pairs: set[tuple[int, int]] = set()
    for link in existing_links:
        existing_pairs.add((link.source_device_id, link.target_device_id))
        existing_pairs.add((link.target_device_id, link.source_device_id))

    created = 0
    for client_id, info in desired_links.items():
        ap_id = info["ap_device_id"]
        if (ap_id, client_id) in existing_pairs:
            continue

        link = NetworkLink(
            source_device_id=ap_id,
            target_device_id=client_id,
            link_type="wifi",
            source_port_label=info["essid"] or None,
            target_port_label="WiFi",
            notes=info["notes"],
        )
        db.add(link)
        existing_pairs.add((ap_id, client_id))
        created += 1

    if created > 0 or removed > 0:
        await db.commit()

    return {
        "created": created,
        "removed_stale": removed,
        "skipped": skipped,
        "total_wireless_clients": sum(1 for c in unifi_clients if not c.get("is_wired", False)),
        "total_aps": len([u for u in unifi_devices if u.get("type") == "uap"]),
    }


# --- Auto-connect devices to switch using MAC table ---
@router.post("/links/auto-switch")
async def auto_link_switch(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Match device MACs against the switch MAC table to create links with correct port assignments.

    Falls back to unlinked-device assignment when MAC table is unavailable.
    Also removes stale auto-created switch links for devices that now have WiFi.
    """
    from app.services.switch_client import switch_client

    result = await db.execute(select(Device))
    all_devices = result.scalars().all()

    # Find switches
    switches = [d for d in all_devices if d.device_type in ("switch", "switch_large")]
    if not switches:
        return {"created": 0, "message": "No switch device found"}

    switch = switches[0]  # primary switch

    # Build device lookup by MAC address (normalized to uppercase colon-separated)
    def _normalize_mac(mac: str) -> str:
        mac = mac.upper().replace("-", ":").replace(".", "")
        # Handle Cisco dot format (already stripped dots above)
        if len(mac) == 12 and ":" not in mac:
            mac = ":".join(mac[i:i+2] for i in range(0, 12, 2))
        return mac

    dev_by_mac: dict[str, Device] = {}
    for d in all_devices:
        if d.mac_address:
            dev_by_mac[_normalize_mac(d.mac_address)] = d

    # Try to get MAC table from switch
    mac_table: list[dict] = []
    if switch_client.is_configured:
        try:
            mac_table = await switch_client.get_mac_table()
            logger.info("Switch auto-link: got %d MAC table entries", len(mac_table))
        except Exception as e:
            logger.warning("Switch auto-link: MAC table fetch failed: %s", e)

    # Build port assignments: device_id -> switch port name
    port_assignments: dict[int, str] = {}
    for entry in mac_table:
        mac = _normalize_mac(entry.get("mac", ""))
        port = entry.get("if_index") or entry.get("bridge_port") or ""
        if not mac or not port:
            continue
        device = dev_by_mac.get(mac)
        if device and device.id != switch.id:
            port_assignments[device.id] = port

    # Load existing links
    result = await db.execute(select(NetworkLink))
    existing_links = result.scalars().all()

    wifi_linked_ids: set[int] = set()
    existing_switch_links: dict[int, NetworkLink] = {}  # target_device_id -> link
    existing_pairs: set[tuple[int, int]] = set()
    linked_device_ids: set[int] = set()

    for link in existing_links:
        linked_device_ids.add(link.source_device_id)
        linked_device_ids.add(link.target_device_id)
        existing_pairs.add((link.source_device_id, link.target_device_id))
        existing_pairs.add((link.target_device_id, link.source_device_id))
        if link.link_type == "wifi":
            wifi_linked_ids.add(link.target_device_id)
            wifi_linked_ids.add(link.source_device_id)
        if (link.notes or "").startswith("Auto-linked to switch"):
            existing_switch_links[link.target_device_id] = link

    # Remove stale auto-switch links for devices that now have WiFi
    removed = 0
    for dev_id, link in list(existing_switch_links.items()):
        if dev_id in wifi_linked_ids:
            await db.delete(link)
            existing_pairs.discard((link.source_device_id, link.target_device_id))
            existing_pairs.discard((link.target_device_id, link.source_device_id))
            del existing_switch_links[dev_id]
            removed += 1

    # Update existing auto-switch links with correct port info
    updated = 0
    for dev_id, link in existing_switch_links.items():
        port = port_assignments.get(dev_id)
        if port and link.source_port_label != port:
            device = next((d for d in all_devices if d.id == dev_id), None)
            link.source_port_label = port
            link.target_port_label = device.mac_address if device and device.mac_address else None
            updated += 1

    # Create new links
    created = 0
    skip_types = ("internet",)

    for device in all_devices:
        if device.id == switch.id:
            continue
        if device.device_type in skip_types:
            continue
        if device.id in wifi_linked_ids:
            continue
        if (switch.id, device.id) in existing_pairs:
            continue

        port = port_assignments.get(device.id)
        # If we have MAC table data, only link devices we found in the table
        # If no MAC table, fall back to linking all unlinked devices
        if mac_table and not port:
            continue
        if not mac_table and device.id in linked_device_ids:
            continue

        link = NetworkLink(
            source_device_id=switch.id,
            target_device_id=device.id,
            link_type="ethernet",
            source_port_label=port,
            target_port_label=device.mac_address if port else None,
            notes="Auto-linked to switch",
        )
        db.add(link)
        existing_pairs.add((switch.id, device.id))
        linked_device_ids.add(device.id)
        created += 1

    if created > 0 or removed > 0 or updated > 0:
        await db.commit()

    return {
        "created": created,
        "updated": updated,
        "removed_stale": removed,
        "mac_table_entries": len(mac_table),
        "port_matches": len(port_assignments),
        "switch": switch.hostname or switch.ip_address,
    }


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
