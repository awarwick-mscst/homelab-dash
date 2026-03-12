from sqlalchemy import String, Integer, Text, JSON, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column
from datetime import datetime

from app.database import Base


class DnsMonitoredDomain(Base):
    __tablename__ = "dns_monitored_domains"

    id: Mapped[int] = mapped_column(primary_key=True)
    domain: Mapped[str] = mapped_column(String(253), unique=True)
    subdomains: Mapped[list | None] = mapped_column(JSON, nullable=True)  # ["www", "mail", "home"]
    is_active: Mapped[bool] = mapped_column(default=True)
    check_interval_seconds: Mapped[int] = mapped_column(Integer, default=300)
    created_at: Mapped[datetime] = mapped_column(default=datetime.utcnow)


class DnsSnapshot(Base):
    __tablename__ = "dns_snapshots"

    id: Mapped[int] = mapped_column(primary_key=True)
    domain_id: Mapped[int] = mapped_column(ForeignKey("dns_monitored_domains.id", ondelete="CASCADE"))
    records: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(default=datetime.utcnow)


class DnsChange(Base):
    __tablename__ = "dns_changes"

    id: Mapped[int] = mapped_column(primary_key=True)
    domain_id: Mapped[int] = mapped_column(ForeignKey("dns_monitored_domains.id", ondelete="CASCADE"))
    snapshot_id: Mapped[int] = mapped_column(ForeignKey("dns_snapshots.id", ondelete="CASCADE"))
    host: Mapped[str | None] = mapped_column(String(253), nullable=True)  # which host changed
    record_type: Mapped[str] = mapped_column(String(10))
    change_type: Mapped[str] = mapped_column(String(10))  # added, removed, modified
    old_value: Mapped[str | None] = mapped_column(Text, nullable=True)
    new_value: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(default=datetime.utcnow)
