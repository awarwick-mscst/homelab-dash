from sqlalchemy import String, Integer, Text, JSON
from sqlalchemy.orm import Mapped, mapped_column
from datetime import datetime

from app.database import Base


class Subnet(Base):
    __tablename__ = "subnets"

    id: Mapped[int] = mapped_column(primary_key=True)
    cidr: Mapped[str] = mapped_column(String(18), unique=True)
    name: Mapped[str] = mapped_column(String(100))
    vlan_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    gateway: Mapped[str | None] = mapped_column(String(45), nullable=True)
    dns_servers: Mapped[str | None] = mapped_column(String(200), nullable=True)
    dhcp_enabled: Mapped[bool] = mapped_column(default=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(default=datetime.utcnow)


class NetworkLink(Base):
    __tablename__ = "network_links"

    id: Mapped[int] = mapped_column(primary_key=True)
    source_device_id: Mapped[int] = mapped_column(Integer)
    target_device_id: Mapped[int] = mapped_column(Integer)
    link_type: Mapped[str] = mapped_column(String(50), default="ethernet")
    bandwidth: Mapped[str | None] = mapped_column(String(20), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)


class TopologyLayout(Base):
    __tablename__ = "topology_layouts"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100), default="default")
    layout_data: Mapped[dict] = mapped_column(JSON, default=dict)
    updated_at: Mapped[datetime] = mapped_column(
        default=datetime.utcnow, onupdate=datetime.utcnow
    )
