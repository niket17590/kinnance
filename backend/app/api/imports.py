import logging
import json
from uuid import UUID

from fastapi import (
    APIRouter,
    Depends,
    UploadFile,
    File,
    Form,
    HTTPException,
    status,
    BackgroundTasks,
)
from sqlalchemy.orm import Session
from sqlalchemy import text

from app.core.database import get_db, SessionLocal
from app.core.security import get_current_db_user
from app.services import import_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/imports", tags=["imports"])

ALLOWED_BROKERS = {"WEALTHSIMPLE", "QUESTRADE", "IBKR"}
MAX_FILE_SIZE = 10 * 1024 * 1024  # 10MB


# ============================================================
# BACKGROUND TASK
# Runs after import completes — does NOT block the response.
# 1. Fetch company info for new symbols (yfinance)
# 2. Push new symbols to FRONT of price queue (priority fetch)
#    Scheduler handles actual price fetching in controlled batches
# ============================================================


def _post_import_task(
    batch_id: str,
    affected_account_ids: list[str],
    imported_symbols: list[str],
    renamed_symbols: dict,
):
    """
    Background task — runs after transactions are committed.
    Chain:
      1. recalculate_portfolio  (holdings + realized gains + rebalancer cleanup)
      2. disable renamed symbols
      3. ensure_securities_exist
      4. push_to_queue (priority price fetch)
    Sets recalc_status on import_batch so the UI can poll progress.
    """
    bg_db = SessionLocal()
    try:
        from app.services.import_service import set_recalc_status
        from app.services.acb_service import (
            recalculate_holdings_for_accounts, recalculate_realized_gains
        )
        from app.services.price_service import (
            ensure_securities_exist, push_to_queue, disable_symbol,
            update_holdings_unrealized_from_cache,
            sync_security_master_active_symbols,
        )

        if not affected_account_ids:
            set_recalc_status(bg_db, batch_id, "COMPLETE")
            return

        set_recalc_status(bg_db, batch_id, "PROCESSING")

        # Step 1 — recalculate holdings + realized gains + rebalancer
        member_rows = bg_db.execute(
            text("SELECT DISTINCT member_id FROM member_accounts WHERE id = ANY(CAST(:ids AS uuid[]))"),
            {"ids": affected_account_ids}
        ).fetchall()
        member_ids = [str(r.member_id) for r in member_rows]

        circle_rows = bg_db.execute(
            text("SELECT DISTINCT circle_id FROM circle_accounts WHERE account_id = ANY(CAST(:ids AS uuid[]))"),
            {"ids": affected_account_ids}
        ).fetchall()
        circle_ids = [str(r.circle_id) for r in circle_rows]

        logger.info(f"[batch {batch_id}] Starting recalc — accounts={len(affected_account_ids)}, members={len(member_ids)}, circles={len(circle_ids)}")
        recalculate_holdings_for_accounts(bg_db, affected_account_ids)
        recalculate_realized_gains(bg_db, affected_account_ids, member_ids)
        logger.info(f"[batch {batch_id}] Recalculation complete for {len(affected_account_ids)} accounts")

        # Step 2 — handle symbol renames
        if renamed_symbols:
            for old_sym in renamed_symbols:
                disable_symbol(bg_db, old_sym)
                logger.info(f"[batch {batch_id}] Disabled renamed symbol {old_sym}")

        # Step 3 — security master
        all_symbols = list(set(imported_symbols + list(renamed_symbols.values())))
        ensure_securities_exist(bg_db, all_symbols)

        # Step 4 — price queue
        push_to_queue(all_symbols, priority=True)
        update_holdings_unrealized_from_cache(bg_db)
        sync_security_master_active_symbols(bg_db, refresh_queue=True)

        set_recalc_status(bg_db, batch_id, "COMPLETE")
        logger.info(f"[batch {batch_id}] Post-import task complete")

    except Exception as e:
        logger.error(f"[batch {batch_id}] Post-import task failed: {e}")
        try:
            from app.services.import_service import set_recalc_status
            set_recalc_status(bg_db, batch_id, "FAILED", recalc_error=str(e)[:500])
        except Exception:
            pass
    finally:
        bg_db.close()


# ============================================================
# ROUTES
# ============================================================


@router.post("/parse")
async def parse_file(
    file: UploadFile = File(...),
    broker_code: str = Form(...),
    member_id: str = Form(...),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_db_user),
):
    """
    Step 1: Parse file and check account mappings. Does NOT import.
    Returns NEEDS_MAPPING or READY status.
    """
    broker_code = broker_code.upper()
    if broker_code not in ALLOWED_BROKERS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unsupported broker: {broker_code}",
        )

    content = await file.read()
    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="File too large — maximum 10MB",
        )

    result = import_service.parse_and_match(
        db=db,
        owner_id=UUID(str(current_user.id)),
        broker_code=broker_code,
        file_content=content,
        filename=file.filename or "upload",
        member_id=member_id,
    )
    return result


@router.post("/import")
async def do_import(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    broker_code: str = Form(...),
    member_id: str = Form(...),
    confirmed_mappings: str = Form(default="{}"),
    skipped_accounts: str = Form(default="[]"),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_db_user),
):
    """
    Step 2: Run the actual import.

    confirmed_mappings: JSON {broker_identifier: kinnance_account_id}
    skipped_accounts:   JSON [broker_identifier, ...]

    After import, fires a background task to fetch security info
    for new symbols and push them to the front of the price queue.
    Scheduler handles price fetching in controlled batches (respects API limits).
    """
    broker_code = broker_code.upper()

    try:
        mappings = json.loads(confirmed_mappings)
        skipped = json.loads(skipped_accounts)
    except json.JSONDecodeError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid JSON in confirmed_mappings or skipped_accounts",
        )

    content = await file.read()
    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="File too large — maximum 10MB",
        )

    result = import_service.import_transactions(
        db=db,
        owner_id=UUID(str(current_user.id)),
        broker_code=broker_code,
        file_content=content,
        filename=file.filename or "upload",
        confirmed_mappings=mappings,
        skipped_accounts=skipped,
    )

    # Fire background task — recalc chain runs async (even for duplicate-only uploads)
    if result.get("status") == "COMPLETE":
        affected_ids = result.get("affected_account_ids", [])
        if affected_ids:
            background_tasks.add_task(
                _post_import_task,
                result["batch_id"],
                affected_ids,
                result.get("imported_symbols", []),
                result.get("renamed_symbols", {}),
            )
        else:
            # No account context in this upload — nothing to recalc
            from app.services.import_service import set_recalc_status
            set_recalc_status(db, result["batch_id"], "COMPLETE")

    result.pop("affected_account_ids", None)
    return result


@router.get("/batches")
def get_import_batches(
    db: Session = Depends(get_db), current_user=Depends(get_current_db_user)
):
    """Get all import batches for the current user."""
    result = db.execute(
        text(
            """
            SELECT ib.*, b.name as broker_name
            FROM import_batches ib
            JOIN brokers b ON ib.broker_code = b.code
            WHERE ib.owner_id = :owner_id
            ORDER BY ib.created_at DESC
            LIMIT 50
        """
        ),
        {"owner_id": str(current_user.id)},
    ).fetchall()
    return [dict(r._mapping) for r in result]


@router.get("/batches/{batch_id}/recalc-status")
def get_recalc_status(
    batch_id: str,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_db_user),
):
    """Lightweight poll — returns recalc_status for a batch."""
    row = db.execute(
        text("""
            SELECT recalc_status, recalc_error
            FROM import_batches
            WHERE id = :id AND owner_id = :owner_id
        """),
        {"id": batch_id, "owner_id": str(current_user.id)},
    ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Batch not found")
    return {"recalc_status": row.recalc_status, "recalc_error": row.recalc_error}


@router.delete("/batches/{batch_id}")
def delete_import_batch(
    batch_id: str,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_db_user),
):
    """Delete an import batch and all its transactions, then recalculate holdings."""
    batch = db.execute(
        text("SELECT id FROM import_batches WHERE id = :id AND owner_id = :owner_id"),
        {"id": batch_id, "owner_id": str(current_user.id)},
    ).fetchone()

    if not batch:
        raise HTTPException(status_code=404, detail="Import batch not found")

    affected = db.execute(
        text(
            "SELECT DISTINCT account_id FROM transactions WHERE import_batch_id = :id"
        ),
        {"id": batch_id},
    ).fetchall()
    affected_ids = [str(r.account_id) for r in affected]

    db.execute(
        text("DELETE FROM transactions WHERE import_batch_id = :id"), {"id": batch_id}
    )
    db.execute(text("DELETE FROM import_batches WHERE id = :id"), {"id": batch_id})
    db.commit()

    if affected_ids:
        import threading
        def _recalc():
            _db = SessionLocal()
            try:
                from app.services.acb_service import (
                    recalculate_holdings_for_accounts, recalculate_realized_gains
                )
                from app.services.price_service import sync_security_master_active_symbols
                m_rows = _db.execute(
                    text("SELECT DISTINCT member_id FROM member_accounts WHERE id = ANY(CAST(:ids AS uuid[]))"),
                    {"ids": affected_ids}
                ).fetchall()
                c_rows = _db.execute(
                    text("SELECT DISTINCT circle_id FROM circle_accounts WHERE account_id = ANY(CAST(:ids AS uuid[]))"),
                    {"ids": affected_ids}
                ).fetchall()
                recalculate_holdings_for_accounts(_db, affected_ids)
                recalculate_realized_gains(_db, affected_ids, [str(r.member_id) for r in m_rows])
                sync_security_master_active_symbols(_db, refresh_queue=True)
            except Exception as e:
                logger.error(f"Delete batch recalc failed: {e}")
            finally:
                _db.close()
        threading.Thread(target=_recalc, daemon=True).start()

    return {"message": "Import batch deleted — holdings recalculating in background"}
