from pydantic import BaseModel
from datetime import datetime
from app.models.advisory import Severity


class AdvisoryFindingResponse(BaseModel):
    id: int
    category: str
    title: str
    description: str
    severity: Severity
    recommendation: str
    is_resolved: bool
    resolved_at: datetime | None
    details: dict | None

    model_config = {"from_attributes": True}


class AdvisoryReportResponse(BaseModel):
    id: int
    overall_score: float
    total_findings: int
    critical_count: int
    high_count: int
    medium_count: int
    low_count: int
    info_count: int
    ai_summary: str | None = None
    created_at: datetime
    findings: list[AdvisoryFindingResponse] = []

    model_config = {"from_attributes": True}
