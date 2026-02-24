from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from datetime import datetime, timezone

from app.database import get_db
from app.dependencies import get_current_user
from app.models.user import User
from app.models.advisory import AdvisoryReport, AdvisoryFinding
from app.schemas.advisory import AdvisoryReportResponse
from app.services.advisor_engine import AdvisorEngine

router = APIRouter(prefix="/api/advisor", tags=["advisor"])


@router.post("/analyze", response_model=AdvisoryReportResponse)
async def run_analysis(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    engine = AdvisorEngine(db)
    report = await engine.run_analysis()
    return report


@router.get("/reports", response_model=list[AdvisoryReportResponse])
async def list_reports(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    result = await db.execute(
        select(AdvisoryReport)
        .options(selectinload(AdvisoryReport.findings))
        .order_by(AdvisoryReport.created_at.desc())
        .limit(20)
    )
    return result.scalars().all()


@router.get("/reports/{report_id}", response_model=AdvisoryReportResponse)
async def get_report(
    report_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    result = await db.execute(
        select(AdvisoryReport)
        .options(selectinload(AdvisoryReport.findings))
        .where(AdvisoryReport.id == report_id)
    )
    report = result.scalar_one_or_none()
    if not report:
        raise HTTPException(status_code=404, detail="Report not found")
    return report


@router.post("/findings/{finding_id}/resolve")
async def resolve_finding(
    finding_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    finding = await db.get(AdvisoryFinding, finding_id)
    if not finding:
        raise HTTPException(status_code=404, detail="Finding not found")
    finding.is_resolved = True
    finding.resolved_at = datetime.now(timezone.utc)
    await db.commit()
    return {"status": "resolved"}
