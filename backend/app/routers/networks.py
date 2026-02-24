from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user
from app.models.user import User
from app.models.network import Subnet, NetworkLink, TopologyLayout
from app.schemas.network import (
    SubnetCreate, SubnetUpdate, SubnetResponse,
    NetworkLinkCreate, NetworkLinkResponse,
    TopologyLayoutUpdate, TopologyLayoutResponse,
)

router = APIRouter(prefix="/api/networks", tags=["networks"])


# --- Subnets ---
@router.get("/subnets", response_model=list[SubnetResponse])
async def list_subnets(
    db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user)
):
    result = await db.execute(select(Subnet).order_by(Subnet.cidr))
    return result.scalars().all()


@router.post("/subnets", response_model=SubnetResponse, status_code=201)
async def create_subnet(
    data: SubnetCreate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    subnet = Subnet(**data.model_dump())
    db.add(subnet)
    await db.commit()
    await db.refresh(subnet)
    return subnet


@router.put("/subnets/{subnet_id}", response_model=SubnetResponse)
async def update_subnet(
    subnet_id: int,
    data: SubnetUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    subnet = await db.get(Subnet, subnet_id)
    if not subnet:
        raise HTTPException(status_code=404, detail="Subnet not found")
    for key, value in data.model_dump(exclude_unset=True).items():
        setattr(subnet, key, value)
    await db.commit()
    await db.refresh(subnet)
    return subnet


@router.delete("/subnets/{subnet_id}", status_code=204)
async def delete_subnet(
    subnet_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    subnet = await db.get(Subnet, subnet_id)
    if not subnet:
        raise HTTPException(status_code=404, detail="Subnet not found")
    await db.delete(subnet)
    await db.commit()


# --- Network Links ---
@router.get("/links", response_model=list[NetworkLinkResponse])
async def list_links(
    db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user)
):
    result = await db.execute(select(NetworkLink))
    return result.scalars().all()


@router.post("/links", response_model=NetworkLinkResponse, status_code=201)
async def create_link(
    data: NetworkLinkCreate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    link = NetworkLink(**data.model_dump())
    db.add(link)
    await db.commit()
    await db.refresh(link)
    return link


@router.delete("/links/{link_id}", status_code=204)
async def delete_link(
    link_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    link = await db.get(NetworkLink, link_id)
    if not link:
        raise HTTPException(status_code=404, detail="Link not found")
    await db.delete(link)
    await db.commit()


# --- Topology Layout ---
@router.get("/topology", response_model=TopologyLayoutResponse | None)
async def get_topology(
    db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user)
):
    result = await db.execute(
        select(TopologyLayout).where(TopologyLayout.name == "default")
    )
    return result.scalar_one_or_none()


@router.put("/topology", response_model=TopologyLayoutResponse)
async def save_topology(
    data: TopologyLayoutUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    result = await db.execute(
        select(TopologyLayout).where(TopologyLayout.name == data.name)
    )
    layout = result.scalar_one_or_none()
    if layout:
        layout.layout_data = data.layout_data
    else:
        layout = TopologyLayout(name=data.name, layout_data=data.layout_data)
        db.add(layout)
    await db.commit()
    await db.refresh(layout)
    return layout
