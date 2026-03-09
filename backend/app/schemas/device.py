from pydantic import BaseModel
from datetime import datetime


class DevicePortResponse(BaseModel):
    id: int
    port_number: int
    protocol: str
    state: str
    service_name: str | None
    service_version: str | None
    last_seen: datetime

    model_config = {"from_attributes": True}


class DeviceCreate(BaseModel):
    hostname: str | None = None
    ip_address: str
    mac_address: str | None = None
    device_type: str = "unknown"
    os_family: str | None = None
    os_version: str | None = None
    vendor: str | None = None
    subnet_id: int | None = None
    location: str | None = None
    notes: str | None = None
    proxmox_vmid: int | None = None
    proxmox_server_id: str | None = None
    proxmox_node: str | None = None
    proxmox_type: str | None = None


class DeviceUpdate(BaseModel):
    hostname: str | None = None
    ip_address: str | None = None
    mac_address: str | None = None
    device_type: str | None = None
    os_family: str | None = None
    os_version: str | None = None
    vendor: str | None = None
    subnet_id: int | None = None
    location: str | None = None
    notes: str | None = None
    proxmox_vmid: int | None = None
    proxmox_server_id: str | None = None
    proxmox_node: str | None = None
    proxmox_type: str | None = None


class DevicePinUpdate(BaseModel):
    is_pinned: bool
    pinned_port: int | None = None


class DeviceMonitorUpdate(BaseModel):
    is_monitored: bool
    monitor_url: str | None = None


class DeviceResponse(BaseModel):
    id: int
    hostname: str | None
    ip_address: str
    mac_address: str | None
    device_type: str
    os_family: str | None
    os_version: str | None
    vendor: str | None
    subnet_id: int | None
    location: str | None
    notes: str | None
    proxmox_vmid: int | None
    proxmox_server_id: str | None
    proxmox_node: str | None
    proxmox_type: str | None
    is_online: bool
    is_pinned: bool
    pinned_port: int | None
    is_monitored: bool
    monitor_url: str | None
    monitor_status: str | None
    response_time_ms: int | None
    last_seen: datetime | None
    first_seen: datetime
    ports: list[DevicePortResponse] = []

    model_config = {"from_attributes": True}
