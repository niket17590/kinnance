import logging
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import text
from pydantic import BaseModel

from app.core.database import get_db
from app.core.security import get_current_db_user

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/admin", tags=["admin"])


class SymbolRenameRequest(BaseModel):
    old_symbol: str
    new_symbol: str


@router.get("/securities")
def get_securities(
    db: Session = Depends(get_db),
    current_user=Depends(get_current_db_user)
):
    """Get all active securities from security_master."""
    rows = db.execute(
        text("""
            SELECT symbol, name, exchange, currency, asset_type,
                   sector, country, is_active, last_fetched_at
            FROM security_master
            ORDER BY symbol
        """)
    ).fetchall()
    return [dict(r._mapping) for r in rows]


@router.post("/securities/rename")
def rename_security(
    request: SymbolRenameRequest,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_db_user)
):
    """
    Rename a security symbol across the entire platform.

    Steps:
    1. Update all transactions (symbol + symbol_normalized)
    2. Delete old holding rows for affected accounts
    3. Recalculate holdings from transactions (rebuilds correctly)
    4. Disable old symbol in security_master
    5. Ensure new symbol exists in security_master
    6. Disable old symbol in price_cache, push new to queue
    """
    old_sym = request.old_symbol.upper().strip()
    new_sym = request.new_symbol.upper().strip()

    if old_sym == new_sym:
        raise HTTPException(status_code=400, detail="Old and new symbols are the same")

    # Check old symbol exists
    existing = db.execute(
        text("SELECT symbol FROM security_master WHERE symbol = :sym"),
        {"sym": old_sym}
    ).fetchone()
    if not existing:
        raise HTTPException(status_code=404, detail=f"Symbol {old_sym} not found in security master")

    try:
        # Step 1 — Update transactions
        result = db.execute(
            text("""
                UPDATE transactions
                SET symbol = CASE WHEN symbol = :old THEN :new ELSE symbol END,
                    symbol_normalized = CASE WHEN symbol_normalized = :old THEN :new ELSE symbol_normalized END,
                    updated_at = NOW()
                WHERE symbol = :old OR symbol_normalized = :old
            """),
            {"old": old_sym, "new": new_sym}
        )
        txn_count = result.rowcount
        db.commit()
        logger.info(f"Rename: updated {txn_count} transactions {old_sym} → {new_sym}")

        # Step 2 — Find affected accounts
        affected_rows = db.execute(
            text("""
                SELECT DISTINCT account_id FROM holdings
                WHERE symbol = :old
            """),
            {"old": old_sym}
        ).fetchall()
        affected_ids = [str(r.account_id) for r in affected_rows]

        # Step 3 — Delete old holding rows (will be rebuilt by recalculate)
        db.execute(
            text("DELETE FROM holdings WHERE symbol = :old"),
            {"old": old_sym}
        )
        db.commit()

        # Step 4 — Recalculate holdings for affected accounts
        if affected_ids:
            from app.services.acb_service import recalculate_holdings_for_accounts
            recalculate_holdings_for_accounts(db, affected_ids)
            logger.info(f"Rename: recalculated holdings for {len(affected_ids)} accounts")

        # Step 5 — Disable old symbol in security_master
        from app.services.price_service import disable_symbol, ensure_securities_exist, push_to_queue
        disable_symbol(db, old_sym)

        # Step 6 — Ensure new symbol exists in security_master + queue
        ensure_securities_exist(db, [new_sym])
        push_to_queue([new_sym], priority=True)

        # Step 7 — Update symbol_aliases if old symbol was a bare ticker
        db.execute(
            text("""
                UPDATE symbol_aliases
                SET canonical_symbol = :new, updated_at = NOW()
                WHERE canonical_symbol = :old
            """),
            {"old": old_sym, "new": new_sym}
        )
        db.commit()

        return {
            "status": "success",
            "old_symbol": old_sym,
            "new_symbol": new_sym,
            "transactions_updated": txn_count,
            "accounts_recalculated": len(affected_ids)
        }

    except Exception as e:
        db.rollback()
        logger.error(f"Security rename failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))
