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
#                                  Set false in .env.development
# PRICE_UPDATE_INTERVAL_MINUTES  — how often scheduler runs (default: 10)
# PRICE_BATCH_SIZE               — symbols per API call (default: 8, free tier limit)
# NIGHTLY_CLOSE_CRON             — cron for daily close snapshot (default: "0 21 * * 1-5")
# ============================================================

SCHEDULER_ENABLED         = os.getenv("SCHEDULER_ENABLED", "true").lower() == "true"
PRICE_INTERVAL_MINUTES    = int(os.getenv("PRICE_UPDATE_INTERVAL_MINUTES", "10"))
PRICE_BATCH_SIZE          = int(os.getenv("PRICE_BATCH_SIZE", "8"))
NIGHTLY_CRON              = os.getenv("NIGHTLY_CLOSE_CRON", "0 21 * * 1-5")

_scheduler: BackgroundScheduler | None = None


def _get_db():
    from app.core.database import SessionLocal
    return SessionLocal()


# ============================================================
# SCHEDULER JOBS
# ============================================================

def _price_update_job():
    """
    Rolling price update job.
    1. Safety net — ensure any open-position symbols missing from
       security_master are fetched and added (then pushed to queue)
    2. Pop next batch from queue
    3. Fetch prices from Twelve Data
    4. Update price_cache + holdings unrealized G/L
    """
    db = _get_db()
    try:
        from app.services.price_service import (
            ensure_securities_exist,
            refresh_prices,
            pop_next_batch,
            push_to_queue,
            queue_size
        )
        from sqlalchemy import text

        # Safety net — find open holdings symbols not in security_master
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
            logger.info(f"Scheduler: {len(missing_symbols)} symbols missing from security_master — fetching")
            ensure_securities_exist(db, missing_symbols)
            push_to_queue(missing_symbols)

        # Pop next batch from rolling queue
        batch = pop_next_batch(PRICE_BATCH_SIZE)
        if not batch:
            logger.info("Scheduler: price queue is empty — nothing to update")
            return

        logger.info(f"Scheduler: fetching prices for {batch} (queue size: {queue_size()})")
        refresh_prices(db, batch)

    except Exception as e:
        logger.error(f"Scheduler price update failed: {e}")
    finally:
        db.close()


def _nightly_close_job():
    """Store today's closing prices from price_cache to price_history."""
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
    """
    Initialize queue and start APScheduler.
    Called once on app startup from main.py lifespan.
    """
    global _scheduler

    if not SCHEDULER_ENABLED:
        logger.info("Scheduler disabled via SCHEDULER_ENABLED=false")
        return

    if _scheduler and _scheduler.running:
        logger.warning("Scheduler already running")
        return

    # Load queue from DB before starting
    db = _get_db()
    try:
        from app.services.price_service import load_queue_from_db
        load_queue_from_db(db)
    except Exception as e:
        logger.error(f"Failed to load price queue: {e}")
    finally:
        db.close()

    _scheduler = BackgroundScheduler(
        job_defaults={
            'coalesce': True,
            'max_instances': 1,
            'misfire_grace_time': 60
        }
    )

    # Rolling price update
    _scheduler.add_job(
        _price_update_job,
        trigger=IntervalTrigger(minutes=PRICE_INTERVAL_MINUTES),
        id="price_update",
        name=f"Price update every {PRICE_INTERVAL_MINUTES} min",
        replace_existing=True
    )

    # Nightly close snapshot
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
    else:
        logger.error(f"Invalid NIGHTLY_CLOSE_CRON: {NIGHTLY_CRON}")

    _scheduler.start()
    logger.info(
        f"Scheduler started — "
        f"price update every {PRICE_INTERVAL_MINUTES} min, "
        f"batch size: {PRICE_BATCH_SIZE}, "
        f"nightly cron: {NIGHTLY_CRON}"
    )


def stop_scheduler():
    """Stop scheduler gracefully on app shutdown."""
    global _scheduler
    if _scheduler and _scheduler.running:
        _scheduler.shutdown(wait=False)
        logger.info("Scheduler stopped")


def push_to_queue(symbols: list[str]):
    """
    Public entry point for import flow to push new symbols to queue.
    Delegates to price_service queue.
    """
    from app.services.price_service import push_to_queue as _push
    _push(symbols)
