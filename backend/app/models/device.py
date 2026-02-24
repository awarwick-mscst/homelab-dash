from sqlalchemy import String, Integer, Text, ForeignKey, JSON
from sqlalchemy.orm import Mapped, mapped_column, relationship
from datetime import datetime

from app.database import Base


class Device(Base):
    __tablename__ = "devices"

    id: Mapped[int] = mapped_column(primary_key=True)
    hostname: Mapped[str | None] = mapped_column(String(255), nullable=True)
    ip_address: Mapped[str] = mapped_column(String(45), index=True)
    mac_address: Mapped[str | None] = mapped_column(String(17), nullable=True)
    device_type: Mapped[str] = mapped_column(String(50), default="unknown")
    os_family: Mapped[str | None] = mapped_column(String(100), nullable=True)
    os_version: Mapped[str | None] = mapped_column(String(100), nullable=True)
    vendor: Mapped[str | None] = mapped_column(String(100), nullable=True)
    subnet_id: Mapped[int | None] = mapped_column(
        ForeignKey("subnets.id"), nullable=True
    )
    location: Mapped[str | None] = mapped_column(String(100), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_online: Mapped[bool] = mapped_column(default=False)
    last_seen: Mapped[datetime | None] = mapped_column(nullable=True)
    first_seen: Mapped[datetime] = mapped_column(default=datetime.utcnow)
    custom_fields: Mapped[dict | None] = mapped_column(JSON, nullable=True)

    ports: Mapped[list["DevicePort"]] = relationship(
        back_populates="device", cascade="all, delete-orphan"
    )


class DevicePort(Base):
    __tablename__ = "device_ports"

    id: Mapped[int] = mapped_column(primary_key=True)
    device_id: Mapped[int] = mapped_column(ForeignKey("devices.id"))
    port_number: Mapped[int] = mapped_column(Integer)
    protocol: Mapped[str] = mapped_column(String(10), default="tcp")
    state: Mapped[str] = mapped_column(String(20), default="open")
    service_name: Mapped[str | None] = mapped_column(String(100), nullable=True)
    service_version: Mapped[str | None] = mapped_column(String(200), nullable=True)
    last_seen: Mapped[datetime] = mapped_column(default=datetime.utcnow)

    device: Mapped["Device"] = relationship(back_populates="ports")
