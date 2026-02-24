from apscheduler.schedulers.asyncio import AsyncIOScheduler

from app.config import settings
from app.services.health_checker import check_all_services

scheduler = AsyncIOScheduler()


def start_scheduler():
    scheduler.add_job(
        check_all_services,
        "interval",
        seconds=settings.health_check_interval,
        id="health_check",
        replace_existing=True,
    )
    scheduler.start()


def stop_scheduler():
    scheduler.shutdown(wait=False)
