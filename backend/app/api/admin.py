import logging
import yfinance as yf
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import text
from pydantic import BaseModel

from app.core.database import get_db
from app.core.security import get_current_db_user

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/admin", tags=["admin"])


class VerifyRenameRequest(BaseModel):
    old_symbol: str
    new_symbol_input: str


class SymbolRenameRequest(BaseModel):
    old_symbol: str
    new_symbol: str  # canonical — already verified


# ============================================================
# GET /admin/securities
# ============================================================

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


# ============================================================
# POST /admin/securities/verify-rename
# ============================================================

@router.post("/securities/verify-rename")
def verify_rename(
    request: VerifyRenameRequest,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_db_user)
):
    """
    Verify a proposed rename before committing.
    Resolves new symbol via: security_master -> symbol_aliases -> yfinance
    Returns stock info + impact data. No DB writes.
    """
    old_sym = request.old_symbol.upper().strip()
    new_input = request.new_symbol_input.upper().strip()

    if not old_sym or not new_input:
        raise HTTPException(status_code=400, detail="Both symbols are required")
    if old_sym == new_input:
        raise HTTPException(status_code=400, detail="Old and new symbols are the same")

    # Validate old symbol exists
    old_row = db.execute(
        text("SELECT symbol, name FROM security_master WHERE symbol = :sym"),
        {"sym": old_sym}
    ).fetchone()
    if not old_row:
        raise HTTPException(status_code=404, detail=f"{old_sym} not found in security master")

    # ── Resolve new symbol ────────────────────────────────────
    # Priority 1: exact match in security_master
    stock_info = None

    sm_row = db.execute(
        text("SELECT symbol, name, exchange, currency, country FROM security_master WHERE symbol = :sym"),
        {"sym": new_input}
    ).fetchone()
    if sm_row:
        stock_info = {
            "symbol":   sm_row.symbol,
            "name":     sm_row.name,
            "exchange": sm_row.exchange,
            "currency": sm_row.currency,
            "country":  sm_row.country,
        }

    # Priority 2: check symbol_aliases -> resolve canonical -> look up in security_master
    if not stock_info:
        alias_row = db.execute(
            text("SELECT canonical_symbol FROM symbol_aliases WHERE bare_symbol = :sym"),
            {"sym": new_input}
        ).fetchone()
        if alias_row:
            sm_row = db.execute(
                text("SELECT symbol, name, exchange, currency, country FROM security_master WHERE symbol = :sym"),
                {"sym": alias_row.canonical_symbol}
            ).fetchone()
            if sm_row:
                stock_info = {
                    "symbol":   sm_row.symbol,
                    "name":     sm_row.name,
                    "exchange": sm_row.exchange,
                    "currency": sm_row.currency,
                    "country":  sm_row.country,
                }

    # Priority 3: yfinance as last resort (completely new symbol)
    if not stock_info:
        try:
            ticker = yf.Ticker(new_input)
            info = ticker.info or {}
            name = info.get("longName") or info.get("shortName")
            if not name:
                raise HTTPException(
                    status_code=404,
                    detail=f"Could not find '{new_input}'. Please enter the exact ticker symbol."
                )
            stock_info = {
                "symbol":   new_input,
                "name":     name,
                "exchange": info.get("exchange"),
                "currency": info.get("currency"),
                "country":  info.get("country"),
            }
        except HTTPException:
            raise
        except Exception:
            raise HTTPException(
                status_code=404,
                detail=f"Could not find '{new_input}'. Please enter the exact ticker symbol."
            )

    # ── Fetch impact from DB ──────────────────────────────────
    txn_row = db.execute(
        text("""
            SELECT COUNT(*) as count FROM transactions
            WHERE symbol = :sym OR symbol_normalized = :sym
        """),
        {"sym": old_sym}
    ).fetchone()
    txn_count = txn_row.count if txn_row else 0

    account_row = db.execute(
        text("SELECT COUNT(DISTINCT account_id) as count FROM holdings WHERE symbol = :sym"),
        {"sym": old_sym}
    ).fetchone()
    account_count = account_row.count if account_row else 0

    holding_row = db.execute(
        text("""
            SELECT
                COALESCE(SUM(quantity_total), 0) as total_qty,
                COALESCE(SUM(market_value), 0)   as total_value,
                COALESCE(SUM(total_acb), 0)      as total_acb,
                MAX(currency)                    as currency
            FROM holdings
            WHERE symbol = :sym AND is_position_open = TRUE
        """),
        {"sym": old_sym}
    ).fetchone()

    return {
        "old_symbol": old_sym,
        "old_name":   old_row.name,
        "new_symbol": stock_info,
        "impact": {
            "transaction_count":  txn_count,
            "account_count":      account_count,
            "total_quantity":     float(holding_row.total_qty)   if holding_row else 0,
            "total_market_value": float(holding_row.total_value) if holding_row else 0,
            "total_acb":          float(holding_row.total_acb)   if holding_row else 0,
            "currency":           holding_row.currency           if holding_row else "CAD",
        }
    }


# ============================================================
# POST /admin/securities/rename
# ============================================================

@router.post("/securities/rename")
def rename_security(
    request: SymbolRenameRequest,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_db_user)
):
    """
    Execute symbol rename. Call verify-rename first.
    Updates transactions, holdings, security_master, price_cache, symbol_aliases.
    """
    old_sym = request.old_symbol.upper().strip()
    new_sym = request.new_symbol.upper().strip()

    if old_sym == new_sym:
        raise HTTPException(status_code=400, detail="Old and new symbols are the same")

    existing = db.execute(
        text("SELECT symbol FROM security_master WHERE symbol = :sym"),
        {"sym": old_sym}
    ).fetchone()
    if not existing:
        raise HTTPException(status_code=404, detail=f"{old_sym} not found in security master")

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
            text("SELECT DISTINCT account_id FROM holdings WHERE symbol = :old"),
            {"old": old_sym}
        ).fetchall()
        affected_ids = [str(r.account_id) for r in affected_rows]

        # Step 3 — Delete old holding rows
        db.execute(text("DELETE FROM holdings WHERE symbol = :old"), {"old": old_sym})
        db.commit()

        # Step 4 — Recalculate holdings
        if affected_ids:
            from app.services.acb_service import recalculate_holdings_for_accounts
            recalculate_holdings_for_accounts(db, affected_ids)
            logger.info(f"Rename: recalculated holdings for {len(affected_ids)} accounts")

        # Step 5 — Disable old symbol
        from app.services.price_service import disable_symbol, ensure_securities_exist, push_to_queue
        disable_symbol(db, old_sym)

        # Step 6 — Ensure new symbol exists + push to queue
        ensure_securities_exist(db, [new_sym])
        push_to_queue([new_sym], priority=True)

        # Step 7 — Update symbol_aliases
        db.execute(
            text("UPDATE symbol_aliases SET canonical_symbol = :new WHERE canonical_symbol = :old"),
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