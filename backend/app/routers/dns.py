import logging
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user
from app.models.user import User
from app.models.dns import DnsMonitoredDomain, DnsSnapshot, DnsChange
from app.schemas.dns import (
    DnsDomainCreate, DnsDomainUpdate, DnsDomainResponse,
    DnsSnapshotResponse, DnsChangeResponse,
)
from app.services.dns_monitor import check_single_domain

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/dns", tags=["dns"])


# --- Domains CRUD ---

@router.get("/domains", response_model=list[DnsDomainResponse])
async def list_domains(
    db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user)
):
    result = await db.execute(
        select(DnsMonitoredDomain).order_by(DnsMonitoredDomain.domain)
    )
    return result.scalars().all()


@router.post("/domains", response_model=DnsDomainResponse, status_code=201)
async def add_domain(
    data: DnsDomainCreate,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    # Check for duplicates
    result = await db.execute(
        select(DnsMonitoredDomain).where(DnsMonitoredDomain.domain == data.domain)
    )
    if result.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Domain already monitored")

    domain = DnsMonitoredDomain(
        domain=data.domain,
        check_interval_seconds=data.check_interval_seconds,
    )
    db.add(domain)
    await db.commit()
    await db.refresh(domain)

    # Run first check immediately in background
    background_tasks.add_task(check_single_domain, domain.id)

    return domain


@router.get("/domains/{domain_id}", response_model=DnsDomainResponse)
async def get_domain(
    domain_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    domain = await db.get(DnsMonitoredDomain, domain_id)
    if not domain:
        raise HTTPException(status_code=404, detail="Domain not found")
    return domain


@router.put("/domains/{domain_id}", response_model=DnsDomainResponse)
async def update_domain(
    domain_id: int,
    data: DnsDomainUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    domain = await db.get(DnsMonitoredDomain, domain_id)
    if not domain:
        raise HTTPException(status_code=404, detail="Domain not found")
    for key, value in data.model_dump(exclude_unset=True).items():
        setattr(domain, key, value)
    await db.commit()
    await db.refresh(domain)
    return domain


@router.delete("/domains/{domain_id}", status_code=204)
async def delete_domain(
    domain_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    domain = await db.get(DnsMonitoredDomain, domain_id)
    if not domain:
        raise HTTPException(status_code=404, detail="Domain not found")
    await db.delete(domain)
    await db.commit()


# --- Trigger check ---

@router.post("/domains/{domain_id}/check")
async def trigger_check(
    domain_id: int,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    domain = await db.get(DnsMonitoredDomain, domain_id)
    if not domain:
        raise HTTPException(status_code=404, detail="Domain not found")
    background_tasks.add_task(check_single_domain, domain.id)
    return {"status": "check_queued", "domain": domain.domain}


# --- Snapshots ---

@router.get("/domains/{domain_id}/snapshots", response_model=list[DnsSnapshotResponse])
async def list_snapshots(
    domain_id: int,
    limit: int = Query(50, le=200),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    result = await db.execute(
        select(DnsSnapshot)
        .where(DnsSnapshot.domain_id == domain_id)
        .order_by(DnsSnapshot.created_at.desc())
        .limit(limit)
    )
    return result.scalars().all()


@router.get("/domains/{domain_id}/snapshots/latest", response_model=DnsSnapshotResponse | None)
async def get_latest_snapshot(
    domain_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    result = await db.execute(
        select(DnsSnapshot)
        .where(DnsSnapshot.domain_id == domain_id)
        .order_by(DnsSnapshot.created_at.desc())
        .limit(1)
    )
    return result.scalar_one_or_none()


# --- Changes ---

@router.get("/domains/{domain_id}/changes", response_model=list[DnsChangeResponse])
async def list_domain_changes(
    domain_id: int,
    limit: int = Query(100, le=500),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    result = await db.execute(
        select(DnsChange)
        .where(DnsChange.domain_id == domain_id)
        .order_by(DnsChange.created_at.desc())
        .limit(limit)
    )
    return result.scalars().all()


@router.get("/changes", response_model=list[DnsChangeResponse])
async def list_all_changes(
    limit: int = Query(100, le=500),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    result = await db.execute(
        select(DnsChange)
        .order_by(DnsChange.created_at.desc())
        .limit(limit)
    )
    return result.scalars().all()
