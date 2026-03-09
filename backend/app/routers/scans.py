from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user
from app.models.user import User
from app.models.scan import ScanJob, ScanSchedule, ScanStatus
from app.schemas.scan import (
    ScanCreate, ScanResponse,
    ScanScheduleCreate, ScanScheduleResponse,
)

router = APIRouter(prefix="/api/scans", tags=["scans"])


@router.get("", response_model=list[ScanResponse])
async def list_scans(
    db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user)
):
    result = await db.execute(select(ScanJob).order_by(ScanJob.created_at.desc()))
    return result.scalars().all()


@router.post("", response_model=ScanResponse, status_code=201)
async def create_scan(
    data: ScanCreate,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    scan = ScanJob(target=data.target, profile=data.profile, custom_ports=data.custom_ports)
    db.add(scan)
    await db.commit()
    await db.refresh(scan)
    # Scan execution is handled by the scan service via WebSocket
    from app.services.scan_service import run_scan
    background_tasks.add_task(run_scan, scan.id)
    return scan


@router.get("/{scan_id}", response_model=ScanResponse)
async def get_scan(
    scan_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    scan = await db.get(ScanJob, scan_id)
    if not scan:
        raise HTTPException(status_code=404, detail="Scan not found")
    return scan


@router.post("/{scan_id}/cancel", response_model=ScanResponse)
async def cancel_scan(
    scan_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    scan = await db.get(ScanJob, scan_id)
    if not scan:
        raise HTTPException(status_code=404, detail="Scan not found")
    if scan.status in (ScanStatus.pending, ScanStatus.running):
        scan.status = ScanStatus.cancelled
        await db.commit()
        await db.refresh(scan)
    return scan


@router.delete("/{scan_id}", status_code=204)
async def delete_scan(
    scan_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    scan = await db.get(ScanJob, scan_id)
    if not scan:
        raise HTTPException(status_code=404, detail="Scan not found")
    if scan.status == ScanStatus.running:
        raise HTTPException(status_code=400, detail="Cannot delete a running scan — cancel it first")
    await db.delete(scan)
    await db.commit()


# --- Schedules ---
@router.get("/schedules/", response_model=list[ScanScheduleResponse])
async def list_schedules(
    db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user)
):
    result = await db.execute(select(ScanSchedule).order_by(ScanSchedule.name))
    return result.scalars().all()


@router.post("/schedules/", response_model=ScanScheduleResponse, status_code=201)
async def create_schedule(
    data: ScanScheduleCreate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    schedule = ScanSchedule(**data.model_dump())
    db.add(schedule)
    await db.commit()
    await db.refresh(schedule)
    return schedule


@router.delete("/schedules/{schedule_id}", status_code=204)
async def delete_schedule(
    schedule_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    schedule = await db.get(ScanSchedule, schedule_id)
    if not schedule:
        raise HTTPException(status_code=404, detail="Schedule not found")
    await db.delete(schedule)
    await db.commit()
