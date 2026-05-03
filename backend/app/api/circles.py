import logging
from datetime import datetime, timedelta, UTC
from threading import Lock

from fastapi import APIRouter, Depends, BackgroundTasks
from sqlalchemy.orm import Session
from sqlalchemy import text
from typing import List
from uuid import UUID
from pydantic import BaseModel
from app.core.database import get_db, SessionLocal
from app.core.security import get_current_db_user
from app.schemas.circle import CircleCreate, CircleUpdate, CircleResponse
from app.services import circle_service

router = APIRouter(prefix="/circles", tags=["Circles"])
logger = logging.getLogger(__name__)

_RESYNC_STATUS_CACHE: dict[str, dict] = {}
_RESYNC_LOCK = Lock()
_FAILED_STATUS_TTL_SECONDS = 60 * 60


class BulkAccountsRequest(BaseModel):
    add: list[str] = []
    remove: list[str] = []


def _cleanup_resync_cache_locked():
    cutoff = datetime.now(UTC) - timedelta(seconds=_FAILED_STATUS_TTL_SECONDS)
    stale_circle_ids = [
        circle_id
        for circle_id, status in _RESYNC_STATUS_CACHE.items()
        if status["status"] != "PROCESSING" and status["updated_at"] < cutoff
    ]
    for circle_id in stale_circle_ids:
        _RESYNC_STATUS_CACHE.pop(circle_id, None)


def _set_resync_status(circle_id: str, status: str, error: str | None = None):
    with _RESYNC_LOCK:
        _cleanup_resync_cache_locked()
        if status == "COMPLETE":
            _RESYNC_STATUS_CACHE.pop(circle_id, None)
            return
        _RESYNC_STATUS_CACHE[circle_id] = {
            "status": status,
            "error": error,
            "updated_at": datetime.now(UTC),
        }


def _get_resync_status_map(circle_ids: list[str]) -> dict[str, dict]:
    with _RESYNC_LOCK:
        _cleanup_resync_cache_locked()
        status_map: dict[str, dict] = {}
        for circle_id in circle_ids:
            status = _RESYNC_STATUS_CACHE.get(circle_id)
            if not status:
                continue
            status_map[circle_id] = {
                "resync_status": status["status"],
                "resync_error": status["error"],
            }
        return status_map


def _run_circle_resync(circle_id: str, account_ids: list[str]):
    bg_db = SessionLocal()
    try:
        from app.services.acb_service import (
            recalculate_holdings_for_accounts,
            recalculate_realized_gains,
        )
        from app.services.price_service import update_holdings_unrealized_from_cache

        _set_resync_status(circle_id, "PROCESSING")

        member_rows = bg_db.execute(
            text("""
                SELECT DISTINCT member_id
                FROM member_accounts
                WHERE id = ANY(CAST(:ids AS uuid[]))
            """),
            {"ids": account_ids},
        ).fetchall()
        member_ids = [str(row.member_id) for row in member_rows]

        recalculate_holdings_for_accounts(bg_db, account_ids)
        recalculate_realized_gains(bg_db, account_ids, member_ids)
        update_holdings_unrealized_from_cache(bg_db)
        _set_resync_status(circle_id, "COMPLETE")
        logger.info(
            "Circle resync complete for %s (accounts=%s)",
            circle_id,
            len(account_ids),
        )
    except Exception as exc:
        logger.exception("Circle resync failed for %s: %s", circle_id, exc)
        _set_resync_status(circle_id, "FAILED", error=str(exc)[:500])
    finally:
        bg_db.close()


@router.get("", response_model=List[CircleResponse])
async def get_circles(
    db: Session = Depends(get_db),
    current_user=Depends(get_current_db_user)
):
    return circle_service.get_all(db, current_user.id)


@router.get("/with-accounts")
async def get_circles_with_accounts(
    db: Session = Depends(get_db),
    current_user=Depends(get_current_db_user)
):
    """
    Single endpoint — all circles with their tagged accounts embedded.
    Replaces GET /circles + N × GET /circles/{id}/accounts on the Circles page.
    """
    circles = circle_service.get_all_with_accounts(db, current_user.id)
    if not circles:
        return circles

    status_map = _get_resync_status_map([str(circle["id"]) for circle in circles])
    for circle in circles:
        status = status_map.get(str(circle["id"]))
        if status:
            circle.update(status)
    return circles


@router.get("/{circle_id}", response_model=CircleResponse)
async def get_circle(
    circle_id: UUID,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_db_user)
):
    return circle_service.get_by_id(db, circle_id, current_user.id)


@router.post("", response_model=CircleResponse, status_code=201)
async def create_circle(
    data: CircleCreate,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_db_user)
):
    return circle_service.create(db, data, current_user.id)


@router.put("/{circle_id}", response_model=CircleResponse)
async def update_circle(
    circle_id: UUID,
    data: CircleUpdate,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_db_user)
):
    return circle_service.update(db, circle_id, data, current_user.id)


@router.delete("/{circle_id}")
async def delete_circle(
    circle_id: UUID,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_db_user)
):
    return circle_service.delete(db, circle_id, current_user.id)


@router.get("/{circle_id}/accounts")
async def get_circle_accounts(
    circle_id: UUID,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_db_user)
):
    return circle_service.get_accounts(db, circle_id, current_user.id)


@router.post("/{circle_id}/accounts/bulk")
async def bulk_update_circle_accounts(
    circle_id: UUID,
    data: BulkAccountsRequest,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_db_user)
):
    """
    Add and/or remove multiple accounts atomically.
    Body: { "add": ["uuid", ...], "remove": ["uuid", ...] }
    """
    return circle_service.bulk_update_accounts(
        db, circle_id, current_user.id, data.add, data.remove
    )


@router.post("/{circle_id}/resync")
async def resync_circle(
    circle_id: UUID,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_db_user),
):
    circle_service.get_by_id(db, circle_id, current_user.id)

    account_rows = db.execute(
        text("""
            SELECT DISTINCT account_id
            FROM circle_accounts
            WHERE circle_id = :circle_id
        """),
        {"circle_id": str(circle_id)},
    ).fetchall()
    account_ids = [str(row.account_id) for row in account_rows]

    if not account_ids:
        _set_resync_status(str(circle_id), "COMPLETE")
        return {
            "status": "COMPLETE",
            "message": "No accounts in this circle to recalculate",
            "account_count": 0,
        }

    status_map = _get_resync_status_map([str(circle_id)])
    current_status = status_map.get(str(circle_id), {}).get("resync_status")
    if current_status == "PROCESSING":
        return {
            "status": "PROCESSING",
            "message": "Re-sync already in progress",
            "account_count": len(account_ids),
        }

    _set_resync_status(str(circle_id), "PROCESSING")
    background_tasks.add_task(_run_circle_resync, str(circle_id), account_ids)

    return {
        "status": "PROCESSING",
        "message": "Circle re-sync started",
        "account_count": len(account_ids),
    }
