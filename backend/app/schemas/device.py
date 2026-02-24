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
    is_online: bool
    last_seen: datetime | None
    first_seen: datetime
    ports: list[DevicePortResponse] = []

    model_config = {"from_attributes": True}
