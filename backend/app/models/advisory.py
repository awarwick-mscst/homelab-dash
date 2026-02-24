from sqlalchemy import String, Integer, Text, Float, JSON, Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column, relationship
from datetime import datetime
import enum

from app.database import Base


class Severity(str, enum.Enum):
    critical = "critical"
    high = "high"
    medium = "medium"
    low = "low"
    info = "info"


class AdvisoryReport(Base):
    __tablename__ = "advisory_reports"

    id: Mapped[int] = mapped_column(primary_key=True)
    overall_score: Mapped[float] = mapped_column(Float, default=0.0)
    total_findings: Mapped[int] = mapped_column(Integer, default=0)
    critical_count: Mapped[int] = mapped_column(Integer, default=0)
    high_count: Mapped[int] = mapped_column(Integer, default=0)
    medium_count: Mapped[int] = mapped_column(Integer, default=0)
    low_count: Mapped[int] = mapped_column(Integer, default=0)
    info_count: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(default=datetime.utcnow)

    findings: Mapped[list["AdvisoryFinding"]] = relationship(
        back_populates="report", cascade="all, delete-orphan"
    )


class AdvisoryFinding(Base):
    __tablename__ = "advisory_findings"

    id: Mapped[int] = mapped_column(primary_key=True)
    report_id: Mapped[int] = mapped_column(Integer, index=True)
    category: Mapped[str] = mapped_column(String(50))
    title: Mapped[str] = mapped_column(String(200))
    description: Mapped[str] = mapped_column(Text)
    severity: Mapped[Severity] = mapped_column(SAEnum(Severity))
    recommendation: Mapped[str] = mapped_column(Text)
    is_resolved: Mapped[bool] = mapped_column(default=False)
    resolved_at: Mapped[datetime | None] = mapped_column(nullable=True)
    details: Mapped[dict | None] = mapped_column(JSON, nullable=True)

    report: Mapped["AdvisoryReport"] = relationship(back_populates="findings")
