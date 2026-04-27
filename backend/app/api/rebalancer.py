from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import text
from typing import Optional
from pydantic import BaseModel
from app.core.database import get_db
from app.core.security import get_current_db_user

router = APIRouter(prefix="/rebalancer", tags=["rebalancer"])


class UpsertTargetRequest(BaseModel):
    target_weight_pct: float


# ============================================================
# GET /rebalancer
# Returns open holdings merged with saved targets for a circle.
# All calculations done on frontend.
# ============================================================

@router.get("")
def get_rebalancer(
    circle_id: str = Query(...),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_db_user)
):
    """
    Returns open positions for the circle merged with saved target weights.
    Frontend does all rebalancing calculations.
    """
    owner_id = str(current_user.id)

    # Verify circle belongs to user
    circle = db.execute(
        text("""
            SELECT id, name FROM circles
            WHERE id = :circle_id AND owner_id = :owner_id AND is_active = TRUE
        """),
        {"circle_id": circle_id, "owner_id": owner_id}
    ).fetchone()

    if not circle:
        raise HTTPException(status_code=404, detail="Circle not found")

    # Fetch aggregated open holdings for circle (same logic as holdings endpoint)
    rows = db.execute(
        text("""
            SELECT
                h.symbol,
                h.asset_type,
                h.currency,
                SUM(h.quantity_total)       AS quantity_total,
                SUM(h.total_acb)            AS total_acb,
                SUM(h.market_value)         AS market_value,
                AVG(h.current_price)        AS current_price,
                MAX(h.price_updated_at)     AS price_updated_at
            FROM holdings h
            JOIN member_accounts ma ON h.account_id = ma.id
            JOIN members m ON ma.member_id = m.id
            JOIN circle_accounts ca ON ca.account_id = ma.id
            WHERE ca.circle_id = :circle_id
            AND m.owner_id = :owner_id
            AND h.is_position_open = TRUE
            AND h.quantity_total > 0
            GROUP BY h.symbol, h.asset_type, h.currency
            ORDER BY SUM(h.market_value) DESC NULLS LAST
        """),
        {"circle_id": circle_id, "owner_id": owner_id}
    ).fetchall()

    # Fetch saved targets for this circle
    target_rows = db.execute(
        text("""
            SELECT symbol, target_weight_pct
            FROM rebalancer_targets
            WHERE circle_id = :circle_id
        """),
        {"circle_id": circle_id}
    ).fetchall()

    targets = {r.symbol: float(r.target_weight_pct) for r in target_rows}

    # Total portfolio market value
    total_mv = sum(
        float(r.market_value) for r in rows if r.market_value is not None
    )

    positions = []
    for r in rows:
        mv = float(r.market_value) if r.market_value is not None else None
        current_weight = round((mv / total_mv * 100), 2) if mv and total_mv > 0 else None
        positions.append({
            "symbol":           r.symbol,
            "asset_type":       r.asset_type,
            "currency":         r.currency,
            "quantity_total":   float(r.quantity_total or 0),
            "total_acb":        float(r.total_acb or 0),
            "market_value":     round(mv, 2) if mv is not None else None,
            "current_price":    float(r.current_price) if r.current_price else None,
            "current_weight_pct": current_weight,
            "target_weight_pct":  targets.get(r.symbol, 0.0),
            "price_updated_at": str(r.price_updated_at) if r.price_updated_at else None,
        })

    # Auto-insert 0% target rows for new symbols not yet in DB
    existing_symbols = set(targets.keys())
    new_symbols = [p["symbol"] for p in positions if p["symbol"] not in existing_symbols]
    if new_symbols:
        insert_rows = [
            {"circle_id": circle_id, "symbol": sym, "weight": 0.0}
            for sym in new_symbols
        ]
        db.execute(
            text("""
                INSERT INTO rebalancer_targets (circle_id, symbol, target_weight_pct)
                VALUES (:circle_id, :symbol, :weight)
                ON CONFLICT (circle_id, symbol) DO NOTHING
            """),
            insert_rows
        )
        db.commit()

    return {
        "circle_id":   circle_id,
        "circle_name": circle.name,
        "total_market_value": round(total_mv, 2) if total_mv else None,
        "has_prices":  any(p["current_price"] is not None for p in positions),
        "positions":   positions,
    }


# ============================================================
# PUT /rebalancer/{circle_id}/{symbol}
# Upsert a single target weight.
# ============================================================

@router.put("/{circle_id}/{symbol}")
def upsert_target(
    circle_id: str,
    symbol: str,
    body: UpsertTargetRequest,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_db_user)
):
    """
    Save target weight for one symbol in a circle.
    Called on blur/enter after user edits the target % field.
    """
    owner_id = str(current_user.id)

    if body.target_weight_pct < 0 or body.target_weight_pct > 100:
        raise HTTPException(status_code=400, detail="Target weight must be between 0 and 100")

    # Verify circle ownership
    circle = db.execute(
        text("SELECT id FROM circles WHERE id = :id AND owner_id = :owner_id"),
        {"id": circle_id, "owner_id": owner_id}
    ).fetchone()
    if not circle:
        raise HTTPException(status_code=404, detail="Circle not found")

    # Check total would not exceed 100%
    current_total = db.execute(
        text("""
            SELECT COALESCE(SUM(target_weight_pct), 0) as total
            FROM rebalancer_targets
            WHERE circle_id = :circle_id AND UPPER(symbol) != UPPER(:symbol)
        """),
        {"circle_id": circle_id, "symbol": symbol.upper()}
    ).fetchone()

    new_total = float(current_total.total) + body.target_weight_pct
    if new_total > 100:
        raise HTTPException(
            status_code=400,
            detail=f"Total target weight would exceed 100% ({new_total:.1f}%)"
        )

    db.execute(
        text("""
            INSERT INTO rebalancer_targets (circle_id, symbol, target_weight_pct)
            VALUES (:circle_id, :symbol, :weight)
            ON CONFLICT (circle_id, symbol) DO UPDATE SET
                target_weight_pct = EXCLUDED.target_weight_pct,
                updated_at = NOW()
        """),
        {
            "circle_id": circle_id,
            "symbol":    symbol.upper(),
            "weight":    body.target_weight_pct,
        }
    )
    db.commit()

    return {"symbol": symbol.upper(), "target_weight_pct": body.target_weight_pct}
