"""
Dashboard API — single endpoint returning all data needed for the dashboard page.
Designed to be one fast query round-trip.
"""
import logging
from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import text
from typing import Optional

from app.core.database import get_db
from app.core.security import get_current_db_user

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/dashboard", tags=["dashboard"])


@router.get("")
def get_dashboard(
    circle_id: str = Query(...),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_db_user)
):
    owner_id = str(current_user.id)

    circle = db.execute(
        text("SELECT id, name FROM circles WHERE id=:cid AND owner_id=:oid AND is_active=TRUE"),
        {"cid": circle_id, "oid": owner_id}
    ).fetchone()
    if not circle:
        raise HTTPException(status_code=404, detail="Circle not found")

    # ── 1. Holdings snapshot ─────────────────────────────────
    holdings_rows = db.execute(text("""
        SELECT
            h.symbol, h.asset_type, h.currency,
            h.quantity_total, h.current_price,
            h.market_value, h.total_acb,
            h.unrealized_gain_loss, h.unrealized_gain_loss_pct,
            h.realized_gain_loss,
            h.day_change, h.day_change_pct,
            at.tax_category,
            ma.account_type_code,
            m.id AS member_id,
            m.display_name AS member_name,
            m.member_type
        FROM holdings h
        JOIN member_accounts ma ON h.account_id = ma.id
        JOIN members m          ON ma.member_id  = m.id
        JOIN circle_accounts ca ON ca.account_id = ma.id
        JOIN account_types at   ON ma.account_type_code = at.code
        WHERE ca.circle_id = :cid AND m.owner_id = :oid
          AND h.is_position_open = TRUE AND h.quantity_total > 0
        ORDER BY h.market_value DESC NULLS LAST
    """), {"cid": circle_id, "oid": owner_id}).fetchall()

    # Portfolio totals
    total_mv       = sum(float(r.market_value or 0) for r in holdings_rows)
    total_acb      = sum(float(r.total_acb or 0)    for r in holdings_rows)
    total_unrealized = sum(float(r.unrealized_gain_loss or 0) for r in holdings_rows if r.unrealized_gain_loss is not None)
    total_realized = sum(float(r.realized_gain_loss or 0) for r in holdings_rows)
    has_prices     = any(r.current_price is not None for r in holdings_rows)
    total_unrealized_pct = (total_unrealized / total_acb * 100) if total_acb > 0 else None

    # Daily change (sum of day_change * qty)
    total_daily_gl = sum(
        float(r.day_change) * float(r.quantity_total)
        for r in holdings_rows
        if r.day_change is not None and r.quantity_total
    ) if has_prices else None
    _daily_prev_mv = total_mv - total_daily_gl if total_daily_gl is not None else None
    total_daily_gl_pct = (total_daily_gl / _daily_prev_mv * 100) \
        if total_daily_gl is not None and _daily_prev_mv and _daily_prev_mv != 0 else None

    # Top holdings (up to 10 by MV)
    top_holdings = []
    for r in holdings_rows[:10]:
        weight = float(r.market_value or 0) / total_mv * 100 if total_mv > 0 else 0
        top_holdings.append({
            "symbol":            r.symbol,
            "asset_type":        r.asset_type,
            "currency":          r.currency,
            "market_value":      round(float(r.market_value or 0), 2),
            "total_acb":         round(float(r.total_acb or 0), 2),
            "unrealized_gl":     round(float(r.unrealized_gain_loss or 0), 2),
            "unrealized_gl_pct": round(float(r.unrealized_gain_loss_pct or 0), 2),
            "weight_pct":        round(weight, 2),
            "tax_category":      r.tax_category,
            "current_price":     float(r.current_price) if r.current_price else None,
            "day_change_pct":    float(r.day_change_pct) if r.day_change_pct else None,
        })

    # All holdings for donut (symbol + weight)
    all_holdings_donut = []
    for r in holdings_rows:
        weight = float(r.market_value or 0) / total_mv * 100 if total_mv > 0 else 0
        all_holdings_donut.append({
            "symbol":      r.symbol,
            "market_value": round(float(r.market_value or 0), 2),
            "weight_pct":  round(weight, 2),
        })

    # ── 2. Allocation by tax bucket ──────────────────────────
    tax_buckets: dict[str, float] = {}
    for r in holdings_rows:
        cat = r.tax_category or "OTHER"
        tax_buckets[cat] = tax_buckets.get(cat, 0) + float(r.market_value or 0)

    allocation_by_tax = [
        {"tax_category": cat, "market_value": round(mv, 2),
         "weight_pct": round(mv / total_mv * 100, 2) if total_mv > 0 else 0}
        for cat, mv in sorted(tax_buckets.items(), key=lambda x: -x[1])
    ]

    # ── 3. Allocation by currency ────────────────────────────
    currency_buckets: dict[str, float] = {}
    for r in holdings_rows:
        cur = r.currency or "USD"
        currency_buckets[cur] = currency_buckets.get(cur, 0) + float(r.market_value or 0)

    allocation_by_currency = [
        {"currency": cur, "market_value": round(mv, 2),
         "weight_pct": round(mv / total_mv * 100, 2) if total_mv > 0 else 0}
        for cur, mv in sorted(currency_buckets.items(), key=lambda x: -x[1])
    ]

    # ── 4. Recent transactions (last 10) ─────────────────────
    recent_txns = db.execute(text("""
        SELECT
            t.id, t.trade_date, t.transaction_type,
            t.symbol_normalized AS symbol,
            t.quantity, t.price_per_unit,
            t.net_amount, t.net_amount_cad, t.trade_currency,
            m.display_name AS member_name,
            ma.account_type_code,
            at.name AS account_type_name,
            ma.nickname AS account_nickname,
            b.name AS broker_name
        FROM transactions t
        JOIN member_accounts ma ON t.account_id = ma.id
        JOIN members m          ON ma.member_id  = m.id
        JOIN circle_accounts ca ON ca.account_id = ma.id
        JOIN account_types at   ON ma.account_type_code = at.code
        JOIN brokers b          ON ma.broker_code = b.code
        WHERE ca.circle_id = :cid AND m.owner_id = :oid
        ORDER BY t.trade_date DESC, t.created_at DESC
        LIMIT 8
    """), {"cid": circle_id, "oid": owner_id}).fetchall()

    recent_transactions = [
        {
            "id":               str(r.id),
            "trade_date":       str(r.trade_date),
            "transaction_type": r.transaction_type,
            "symbol":           r.symbol,
            "quantity":         float(r.quantity) if r.quantity else None,
            "price_per_unit":   float(r.price_per_unit) if r.price_per_unit else None,
            "net_amount":       float(r.net_amount),
            "net_amount_cad":   float(r.net_amount_cad),
            "trade_currency":   r.trade_currency,
            "member_name":      r.member_name,
            "account_label":    r.account_nickname or r.account_type_name,
            "broker_name":      r.broker_name,
        }
        for r in recent_txns
    ]

    # ── 5. Gains summary (winners/losers) ────────────────────
    winners = sorted(
        [r for r in holdings_rows if (r.unrealized_gain_loss or 0) > 0],
        key=lambda r: -float(r.unrealized_gain_loss or 0)
    )[:5]
    losers = sorted(
        [r for r in holdings_rows if (r.unrealized_gain_loss or 0) < 0],
        key=lambda r: float(r.unrealized_gain_loss or 0)
    )[:5]

    def holding_summary(r):
        return {
            "symbol":            r.symbol,
            "unrealized_gl":     round(float(r.unrealized_gain_loss or 0), 2),
            "unrealized_gl_pct": round(float(r.unrealized_gain_loss_pct or 0), 2),
            "market_value":      round(float(r.market_value or 0), 2),
        }

    # ── 6. Member breakdown — derived from holdings_rows (no extra query) ──
    _member_map: dict[str, dict] = {}
    for r in holdings_rows:
        mid = str(r.member_id)
        if mid not in _member_map:
            _member_map[mid] = {
                "member_id":   mid,
                "member_name": r.member_name,
                "member_type": r.member_type,
                "symbols":     set(),
                "market_value": 0.0,
                "total_acb":   0.0,
                "unrealized_gl": 0.0,
            }
        m = _member_map[mid]
        m["symbols"].add(r.symbol)
        m["market_value"]  += float(r.market_value or 0)
        m["total_acb"]     += float(r.total_acb or 0)
        m["unrealized_gl"] += float(r.unrealized_gain_loss or 0)

    member_breakdown = sorted([
        {
            "member_id":    m["member_id"],
            "member_name":  m["member_name"],
            "member_type":  m["member_type"],
            "positions":    len(m["symbols"]),
            "market_value": round(m["market_value"], 2),
            "total_acb":    round(m["total_acb"], 2),
            "unrealized_gl": round(m["unrealized_gl"], 2),
            "weight_pct":   round(m["market_value"] / total_mv * 100, 2) if total_mv > 0 else 0,
        }
        for m in _member_map.values()
    ], key=lambda x: -x["market_value"])

    return {
        "circle_id":   circle_id,
        "circle_name": circle.name,
        "summary": {
            "total_market_value":   round(total_mv, 2),
            "total_acb":            round(total_acb, 2),
            "total_unrealized_gl":  round(total_unrealized, 2),
            "total_unrealized_gl_pct": round(total_unrealized_pct, 2) if total_unrealized_pct else None,
            "total_realized_gl":    round(total_realized, 2),
            "total_daily_gl":       round(total_daily_gl, 2) if total_daily_gl is not None else None,
            "total_daily_gl_pct":   round(total_daily_gl_pct, 2) if total_daily_gl_pct is not None else None,
            "open_positions":       len(holdings_rows),
            "has_prices":           has_prices,
        },
        "top_holdings":          top_holdings,
        "all_holdings":          all_holdings_donut,
        "allocation_by_tax":     allocation_by_tax,
        "allocation_by_currency": allocation_by_currency,
        "recent_transactions":   recent_transactions,
        "winners":               [holding_summary(r) for r in winners],
        "losers":                [holding_summary(r) for r in losers],
        "member_breakdown":      member_breakdown,
    }
