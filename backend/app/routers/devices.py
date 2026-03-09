from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.dependencies import get_current_user
from app.models.user import User
from app.models.device import Device
from app.schemas.device import DeviceCreate, DeviceUpdate, DeviceResponse, DeviceMonitorUpdate, DevicePinUpdate

router = APIRouter(prefix="/api/devices", tags=["devices"])


@router.get("", response_model=list[DeviceResponse])
async def list_devices(
    device_type: str | None = Query(None),
    subnet_id: int | None = Query(None),
    online_only: bool = Query(False),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    query = select(Device).options(selectinload(Device.ports))
    if device_type:
        query = query.where(Device.device_type == device_type)
    if subnet_id:
        query = query.where(Device.subnet_id == subnet_id)
    if online_only:
        query = query.where(Device.is_online == True)
    query = query.order_by(Device.ip_address)
    result = await db.execute(query)
    return result.scalars().all()


@router.post("", response_model=DeviceResponse, status_code=201)
async def create_device(
    data: DeviceCreate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    device = Device(**data.model_dump())
    db.add(device)
    await db.commit()
    await db.refresh(device, ["ports"])
    return device


@router.get("/{device_id}", response_model=DeviceResponse)
async def get_device(
    device_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    result = await db.execute(
        select(Device).options(selectinload(Device.ports)).where(Device.id == device_id)
    )
    device = result.scalar_one_or_none()
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")
    return device


@router.put("/{device_id}", response_model=DeviceResponse)
async def update_device(
    device_id: int,
    data: DeviceUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    device = await db.get(Device, device_id)
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")
    for key, value in data.model_dump(exclude_unset=True).items():
        setattr(device, key, value)
    await db.commit()
    await db.refresh(device, ["ports"])
    return device


@router.get("/monitored/list", response_model=list[DeviceResponse])
async def list_monitored_devices(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    result = await db.execute(
        select(Device).options(selectinload(Device.ports))
        .where(Device.is_monitored == True)
        .order_by(Device.ip_address)
    )
    return result.scalars().all()


@router.put("/{device_id}/monitor", response_model=DeviceResponse)
async def toggle_device_monitor(
    device_id: int,
    data: DeviceMonitorUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    result = await db.execute(
        select(Device).options(selectinload(Device.ports)).where(Device.id == device_id)
    )
    device = result.scalar_one_or_none()
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")
    device.is_monitored = data.is_monitored
    device.monitor_url = data.monitor_url
    if not data.is_monitored:
        device.monitor_status = None
        device.response_time_ms = None
    await db.commit()
    await db.refresh(device, ["ports"])
    return device


@router.put("/{device_id}/pin", response_model=DeviceResponse)
async def toggle_device_pin(
    device_id: int,
    data: DevicePinUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    result = await db.execute(
        select(Device).options(selectinload(Device.ports)).where(Device.id == device_id)
    )
    device = result.scalar_one_or_none()
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")
    device.is_pinned = data.is_pinned
    device.pinned_port = data.pinned_port if data.is_pinned else None
    await db.commit()
    await db.refresh(device, ["ports"])
    return device


@router.delete("/{device_id}", status_code=204)
async def delete_device(
    device_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    device = await db.get(Device, device_id)
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")
    await db.delete(device)
    await db.commit()
