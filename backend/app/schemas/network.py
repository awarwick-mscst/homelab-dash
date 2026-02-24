from pydantic import BaseModel
from datetime import datetime


class SubnetCreate(BaseModel):
    cidr: str
    name: str
    vlan_id: int | None = None
    gateway: str | None = None
    dns_servers: str | None = None
    dhcp_enabled: bool = True
    description: str | None = None


class SubnetUpdate(BaseModel):
    cidr: str | None = None
    name: str | None = None
    vlan_id: int | None = None
    gateway: str | None = None
    dns_servers: str | None = None
    dhcp_enabled: bool | None = None
    description: str | None = None


class SubnetResponse(BaseModel):
    id: int
    cidr: str
    name: str
    vlan_id: int | None
    gateway: str | None
    dns_servers: str | None
    dhcp_enabled: bool
    description: str | None
    created_at: datetime

    model_config = {"from_attributes": True}


class NetworkLinkCreate(BaseModel):
    source_device_id: int
    target_device_id: int
    link_type: str = "ethernet"
    bandwidth: str | None = None
    notes: str | None = None


class NetworkLinkResponse(BaseModel):
    id: int
    source_device_id: int
    target_device_id: int
    link_type: str
    bandwidth: str | None
    notes: str | None

    model_config = {"from_attributes": True}


class TopologyLayoutUpdate(BaseModel):
    name: str = "default"
    layout_data: dict


class TopologyLayoutResponse(BaseModel):
    id: int
    name: str
    layout_data: dict
    updated_at: datetime

    model_config = {"from_attributes": True}
