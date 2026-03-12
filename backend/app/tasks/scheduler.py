from apscheduler.schedulers.asyncio import AsyncIOScheduler

from app.config import settings
from app.services.health_checker import check_all_services
from app.services.device_monitor import check_monitored_devices
from app.services.dns_monitor import check_all_domains

scheduler = AsyncIOScheduler()


def start_scheduler():
    scheduler.add_job(
        check_all_services,
        "interval",
        seconds=settings.health_check_interval,
        id="health_check",
        replace_existing=True,
    )
    scheduler.add_job(
        check_monitored_devices,
        "interval",
        seconds=60,
        id="device_monitor",
        replace_existing=True,
    )
    scheduler.add_job(
        check_all_domains,
        "interval",
        seconds=300,
        id="dns_monitor",
        replace_existing=True,
    )
    scheduler.start()


def stop_scheduler():
    scheduler.shutdown(wait=False)
