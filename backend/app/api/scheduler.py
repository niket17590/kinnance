import os
import logging
from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.interval import IntervalTrigger

logger = logging.getLogger(__name__)

# ============================================================
# CONFIG FROM ENV
#
# SCHEDULER_ENABLED              — true/false (default: true)
# PRICE_UPDATE_INTERVAL_MINUTES  — how often scheduler runs (default: 10)
# PRICE_BATCH_SIZE               — US symbols per Twelve Data call (default: 8)
# CA_PRICE_BATCH_SIZE            — CA symbols per yfinance call (default: 20)
# NIGHTLY_CLOSE_CRON             — cron for daily close (default: "0 21 * * 1-5")
# ============================================================

SCHEDULER_ENABLED        = os.getenv("SCHEDULER_ENABLED", "true").lower() == "true"
PRICE_INTERVAL_MINUTES   = int(os.getenv("PRICE_UPDATE_INTERVAL_MINUTES", "10"))
PRICE_BATCH_SIZE         = int(os.getenv("PRICE_BATCH_SIZE", "8"))
CA_PRICE_BATCH_SIZE      = int(os.getenv("CA_PRICE_BATCH_SIZE", "20"))
NIGHTLY_CRON             = os.getenv("NIGHTLY_CLOSE_CRON", "0 21 * * 1-5")

_scheduler: BackgroundScheduler | None = None


def _get_db():
    from app.core.database import SessionLocal
    return SessionLocal()


# ============================================================
# SCHEDULER JOBS
# ============================================================

def _price_update_job():
    """
    Rolling price update — runs sequentially:
    1. Safety net: ensure open-position symbols exist in security_master
    2. Pop US batch → Twelve Data
    3. Pop CA batch → yfinance
    """
    db = _get_db()
    try:
        from app.services.price_service import (
            ensure_securities_exist,
            refresh_prices,
            pop_next_batch,
            push_to_queue,
            queue_sizes,
            _us_queue,
            _ca_queue,
            _is_canadian
        )
        from sqlalchemy import text

        # Safety net — find open holdings symbols missing from security_master
        missing_rows = db.execute(text("""
            SELECT DISTINCT h.symbol
            FROM holdings h
            WHERE h.is_position_open = TRUE
            AND h.quantity_total > 0
            AND NOT EXISTS (
                SELECT 1 FROM security_master sm WHERE sm.symbol = h.symbol
            )
        """)).fetchall()

        missing_symbols = [row.symbol for row in missing_rows]
        if missing_symbols:
            logger.info(f"Scheduler: {len(missing_symbols)} symbols missing from security_master")
            ensure_securities_exist(db, missing_symbols)
            push_to_queue(missing_symbols)

        sizes = queue_sizes()
        logger.info(f"Scheduler: queue sizes — US: {sizes['us']}, CA: {sizes['ca']}")

        # Pop US batch → Twelve Data
        us_batch = pop_next_batch(_us_queue, PRICE_BATCH_SIZE)

        # Pop CA batch → yfinance (no strict rate limit)
        ca_batch = pop_next_batch(_ca_queue, CA_PRICE_BATCH_SIZE)

        if not us_batch and not ca_batch:
            logger.info("Scheduler: both queues empty — nothing to update")
            return

        refresh_prices(db, us_batch, ca_batch)

    except Exception as e:
        logger.error(f"Scheduler price update failed: {e}")
    finally:
        db.close()


def _nightly_close_job():
    """Store today's closing prices to price_history."""
    db = _get_db()
    try:
        from app.services.price_service import store_daily_close
        logger.info("Scheduler: storing daily close to price_history")
        store_daily_close(db)
    except Exception as e:
        logger.error(f"Scheduler nightly close failed: {e}")
    finally:
        db.close()


# ============================================================
# START / STOP
# ============================================================

def start_scheduler():
    """Initialize queues and start APScheduler."""
    global _scheduler

    if not SCHEDULER_ENABLED:
        logger.info("Scheduler disabled via SCHEDULER_ENABLED=false")
        return

    if _scheduler and _scheduler.running:
        logger.warning("Scheduler already running")
        return

    # Load queues from DB
    db = _get_db()
    try:
        from app.services.price_service import load_queue_from_db
        load_queue_from_db(db)
    except Exception as e:
        logger.error(f"Failed to load price queues: {e}")
    finally:
        db.close()

    _scheduler = BackgroundScheduler(
        job_defaults={
            'coalesce': True,
            'max_instances': 1,
            'misfire_grace_time': 60
        }
    )

    _scheduler.add_job(
        _price_update_job,
        trigger=IntervalTrigger(minutes=PRICE_INTERVAL_MINUTES),
        id="price_update",
        name=f"Price update every {PRICE_INTERVAL_MINUTES} min",
        replace_existing=True
    )

    nightly_parts = NIGHTLY_CRON.split()
    if len(nightly_parts) == 5:
        minute, hour, day, month, day_of_week = nightly_parts
        _scheduler.add_job(
            _nightly_close_job,
            trigger=CronTrigger(
                minute=minute, hour=hour,
                day=day, month=month,
                day_of_week=day_of_week
            ),
            id="nightly_close",
            name="Nightly close to price_history",
            replace_existing=True
        )

    _scheduler.start()
    logger.info(
        f"Scheduler started — "
        f"interval: {PRICE_INTERVAL_MINUTES} min, "
        f"US batch: {PRICE_BATCH_SIZE}, "
        f"CA batch: {CA_PRICE_BATCH_SIZE}, "
        f"nightly: {NIGHTLY_CRON}"
    )


def stop_scheduler():
    global _scheduler
    if _scheduler and _scheduler.running:
        _scheduler.shutdown(wait=False)
        logger.info("Scheduler stopped")


def push_to_queue(symbols: list[str], priority: bool = False):
    """Public entry point for import flow to push symbols to correct queue."""
    from app.services.price_service import push_to_queue as _push
    _push(symbols, priority=priority)
