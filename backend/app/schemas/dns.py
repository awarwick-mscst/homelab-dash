from pydantic import BaseModel
from datetime import datetime


class DnsDomainCreate(BaseModel):
    domain: str
    subdomains: list[str] | None = None
    check_interval_seconds: int = 300


class DnsDomainUpdate(BaseModel):
    is_active: bool | None = None
    subdomains: list[str] | None = None
    check_interval_seconds: int | None = None


class DnsDomainResponse(BaseModel):
    id: int
    domain: str
    subdomains: list[str] | None
    is_active: bool
    check_interval_seconds: int
    created_at: datetime
    model_config = {"from_attributes": True}


class DnsSnapshotResponse(BaseModel):
    id: int
    domain_id: int
    records: dict | None
    error_message: str | None
    created_at: datetime
    model_config = {"from_attributes": True}


class DnsChangeResponse(BaseModel):
    id: int
    domain_id: int
    snapshot_id: int
    host: str | None
    record_type: str
    change_type: str
    old_value: str | None
    new_value: str | None
    created_at: datetime
    model_config = {"from_attributes": True}
