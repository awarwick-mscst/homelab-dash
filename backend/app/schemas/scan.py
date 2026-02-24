from pydantic import BaseModel
from datetime import datetime
from app.models.scan import ScanStatus, ScanProfile


class ScanCreate(BaseModel):
    target: str
    profile: ScanProfile


class ScanResponse(BaseModel):
    id: int
    target: str
    profile: ScanProfile
    status: ScanStatus
    progress: int
    hosts_found: int
    results: dict | None
    error_message: str | None
    started_at: datetime | None
    completed_at: datetime | None
    created_at: datetime

    model_config = {"from_attributes": True}


class ScanScheduleCreate(BaseModel):
    name: str
    target: str
    profile: ScanProfile
    cron_expression: str
    is_active: bool = True


class ScanScheduleResponse(BaseModel):
    id: int
    name: str
    target: str
    profile: ScanProfile
    cron_expression: str
    is_active: bool
    last_run: datetime | None
    created_at: datetime

    model_config = {"from_attributes": True}
