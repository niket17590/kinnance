import logging
import json
from uuid import UUID

from fastapi import APIRouter, Depends, UploadFile, File, Form, HTTPException, status, BackgroundTasks
from sqlalchemy.orm import Session
from sqlalchemy import text

from app.core.database import get_db, SessionLocal
from app.core.security import get_current_db_user
from app.services import import_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/imports", tags=["imports"])

ALLOWED_BROKERS = {'WEALTHSIMPLE', 'QUESTRADE', 'IBKR'}
MAX_FILE_SIZE = 10 * 1024 * 1024  # 10MB


# ============================================================
# BACKGROUND TASK
# Runs after import completes — does NOT block the response.
# 1. Fetch company info for new symbols (yfinance)
# 2. Push new symbols to FRONT of price queue (priority fetch)
#    Scheduler handles actual price fetching in controlled batches
# ============================================================

def _post_import_task(symbols: list[str], renamed_symbols: dict = None):
    """
    Background task fired after a successful import.
    - Fetches security info for new symbols (yfinance)
    - Pushes new symbols to front of price queue
    - Handles symbol renames: disables old symbol, adds new one
      renamed_symbols = {old_symbol: new_symbol}
    """
    bg_db = SessionLocal()
    try:
        from app.services.price_service import ensure_securities_exist, push_to_queue

        # Handle symbol renames — disable old, enable new
        if renamed_symbols:
            for old_sym, new_sym in renamed_symbols.items():
                # Disable old symbol in security_master and price_cache
                bg_db.execute(
                    text("UPDATE security_master SET is_active = FALSE, updated_at = NOW() WHERE symbol = :sym"),
                    {"sym": old_sym}
                )
                bg_db.execute(
                    text("DELETE FROM price_cache WHERE symbol = :sym"),
                    {"sym": old_sym}
                )
                bg_db.commit()
                logger.info(f"Disabled old symbol {old_sym} → renamed to {new_sym}")

        # Fetch company info for new symbols
        ensure_securities_exist(bg_db, symbols)
        # Push to front of queue — scheduler fetches prices on next run
        push_to_queue(symbols, priority=True)
        logger.info(f"Post-import task complete for {len(symbols)} symbols")
    except Exception as e:
        logger.error(f"Post-import background task failed: {e}")
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
    current_user=Depends(get_current_db_user)
):
    """
    Step 1: Parse file and check account mappings. Does NOT import.
    Returns NEEDS_MAPPING or READY status.
    """
    broker_code = broker_code.upper()
    if broker_code not in ALLOWED_BROKERS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unsupported broker: {broker_code}"
        )

    content = await file.read()
    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="File too large — maximum 10MB"
        )

    result = import_service.parse_and_match(
        db=db,
        owner_id=UUID(str(current_user.id)),
        broker_code=broker_code,
        file_content=content,
        filename=file.filename or 'upload',
        member_id=member_id
    )
    return result


@router.post("/import")
async def do_import(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    broker_code: str = Form(...),
    member_id: str = Form(...),
    confirmed_mappings: str = Form(default='{}'),
    skipped_accounts: str = Form(default='[]'),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_db_user)
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
            detail="Invalid JSON in confirmed_mappings or skipped_accounts"
        )

    content = await file.read()
    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="File too large — maximum 10MB"
        )

    result = import_service.run_import(
        db=db,
        owner_id=UUID(str(current_user.id)),
        broker_code=broker_code,
        file_content=content,
        filename=file.filename or 'upload',
        confirmed_mappings=mappings,
        skipped_accounts=skipped
    )

    # Fire background task for new symbols
    imported_symbols = result.get("imported_symbols", [])
    renamed_symbols = result.get("renamed_symbols", {})
    if (imported_symbols or renamed_symbols) and result.get("status") == "COMPLETE":
        background_tasks.add_task(_post_import_task, imported_symbols, renamed_symbols)

    return result


@router.get("/batches")
def get_import_batches(
    db: Session = Depends(get_db),
    current_user=Depends(get_current_db_user)
):
    """Get all import batches for the current user."""
    result = db.execute(
        text("""
            SELECT ib.*, b.name as broker_name
            FROM import_batches ib
            JOIN brokers b ON ib.broker_code = b.code
            WHERE ib.owner_id = :owner_id
            ORDER BY ib.created_at DESC
            LIMIT 50
        """),
        {'owner_id': str(current_user.id)}
    ).fetchall()
    return [dict(r._mapping) for r in result]


@router.delete("/batches/{batch_id}")
def delete_import_batch(
    batch_id: str,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_db_user)
):
    """Delete an import batch and all its transactions, then recalculate holdings."""
    batch = db.execute(
        text("SELECT id FROM import_batches WHERE id = :id AND owner_id = :owner_id"),
        {'id': batch_id, 'owner_id': str(current_user.id)}
    ).fetchone()

    if not batch:
        raise HTTPException(status_code=404, detail="Import batch not found")

    affected = db.execute(
        text("SELECT DISTINCT account_id FROM transactions WHERE import_batch_id = :id"),
        {'id': batch_id}
    ).fetchall()
    affected_ids = [str(r.account_id) for r in affected]

    db.execute(text("DELETE FROM transactions WHERE import_batch_id = :id"), {'id': batch_id})
    db.execute(text("DELETE FROM import_batches WHERE id = :id"), {'id': batch_id})
    db.commit()

    from app.services.acb_service import recalculate_holdings_for_accounts
    recalculate_holdings_for_accounts(db, affected_ids)

    return {"message": "Import batch deleted and holdings recalculated"}
