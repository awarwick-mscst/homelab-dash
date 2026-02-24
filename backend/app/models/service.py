from sqlalchemy import String, Integer, Text, Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column
from datetime import datetime
import enum

from app.database import Base


class ServiceStatus(str, enum.Enum):
    online = "online"
    offline = "offline"
    degraded = "degraded"
    unknown = "unknown"


class MonitoredService(Base):
    __tablename__ = "monitored_services"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100))
    url: Mapped[str] = mapped_column(String(500))
    icon: Mapped[str | None] = mapped_column(String(50), nullable=True)
    category: Mapped[str] = mapped_column(String(50), default="general")
    status: Mapped[ServiceStatus] = mapped_column(
        SAEnum(ServiceStatus), default=ServiceStatus.unknown
    )
    response_time_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    last_checked: Mapped[datetime | None] = mapped_column(nullable=True)
    check_interval: Mapped[int] = mapped_column(Integer, default=60)
    expected_status_code: Mapped[int] = mapped_column(Integer, default=200)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        default=datetime.utcnow, onupdate=datetime.utcnow
    )
