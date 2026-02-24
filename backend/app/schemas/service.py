from pydantic import BaseModel
from datetime import datetime
from app.models.service import ServiceStatus


class ServiceCreate(BaseModel):
    name: str
    url: str
    icon: str | None = None
    category: str = "general"
    check_interval: int = 60
    expected_status_code: int = 200
    notes: str | None = None


class ServiceUpdate(BaseModel):
    name: str | None = None
    url: str | None = None
    icon: str | None = None
    category: str | None = None
    check_interval: int | None = None
    expected_status_code: int | None = None
    notes: str | None = None


class ServiceResponse(BaseModel):
    id: int
    name: str
    url: str
    icon: str | None
    category: str
    status: ServiceStatus
    response_time_ms: int | None
    last_checked: datetime | None
    check_interval: int
    expected_status_code: int
    notes: str | None
    created_at: datetime

    model_config = {"from_attributes": True}
