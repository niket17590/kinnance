"""
Performance API — per-symbol gain/loss breakdown, winners/losers,
asset type and tax category breakdown.
Time-series portfolio value deferred until price_history is populated.
"""
import logging
from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import text
from typing import Optional

from app.core.database import get_db
from app.core.security import get_current_db_user

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/performance", tags=["performance"])


@router.get("")
def get_performance(
    circle_id: str = Query(...),
    member_ids: Optional[str] = Query(None),
    account_types: Optional[str] = Query(None),
    brokers: Optional[str] = Query(None),
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

    # Build filters
    where = ["m.owner_id = :oid", "ca.circle_id = :cid",
             "h.is_position_open = TRUE", "h.quantity_total > 0"]
    params: dict = {"oid": owner_id, "cid": circle_id}

    member_id_list = [x.strip() for x in member_ids.split(",")] if member_ids else []
    account_type_list = [x.strip() for x in account_types.split(",")] if account_types else []
    broker_list = [x.strip() for x in brokers.split(",")] if brokers else []

    if member_id_list:
        ph = ", ".join(f":m{i}" for i in range(len(member_id_list)))
        where.append(f"ma.member_id::text IN ({ph})")
        for i, v in enumerate(member_id_list): params[f"m{i}"] = v
    if account_type_list:
        ph = ", ".join(f":at{i}" for i in range(len(account_type_list)))
        where.append(f"ma.account_type_code IN ({ph})")
        for i, v in enumerate(account_type_list): params[f"at{i}"] = v
    if broker_list:
        ph = ", ".join(f":b{i}" for i in range(len(broker_list)))
        where.append(f"ma.broker_code IN ({ph})")
        for i, v in enumerate(broker_list): params[f"b{i}"] = v

    where_sql = " AND ".join(where)

    # ── Open positions detail ────────────────────────────────
    rows = db.execute(text(f"""
        SELECT
            h.symbol, h.asset_type, h.currency,
            SUM(h.quantity_total)         AS quantity,
            SUM(h.total_acb)              AS total_acb,
            SUM(h.market_value)           AS market_value,
            SUM(h.unrealized_gain_loss)   AS unrealized_gl,
            AVG(h.current_price)          AS current_price,
            SUM(h.realized_gain_loss)     AS realized_gl,
            MAX(h.unrealized_gain_loss_pct) AS unrealized_gl_pct,
            MAX(h.day_change_pct)         AS day_change_pct,
            at.tax_category
        FROM holdings h
        JOIN member_accounts ma ON h.account_id = ma.id
        JOIN members m          ON ma.member_id  = m.id
        JOIN circle_accounts ca ON ca.account_id = ma.id
        JOIN account_types at   ON ma.account_type_code = at.code
        WHERE {where_sql}
        GROUP BY h.symbol, h.asset_type, h.currency, at.tax_category
        ORDER BY SUM(h.market_value) DESC NULLS LAST
    """), params).fetchall()

    total_mv = sum(float(r.market_value or 0) for r in rows)
    total_acb = sum(float(r.total_acb or 0) for r in rows)

    positions = []
    for r in rows:
        mv = float(r.market_value or 0)
        acb = float(r.total_acb or 0)
        ugl = float(r.unrealized_gl or 0)
        ugl_pct = (ugl / acb * 100) if acb > 0 else 0
        weight = (mv / total_mv * 100) if total_mv > 0 else 0
        positions.append({
            "symbol":            r.symbol,
            "asset_type":        r.asset_type,
            "currency":          r.currency,
            "tax_category":      r.tax_category,
            "quantity":          round(float(r.quantity or 0), 4),
            "total_acb":         round(acb, 2),
            "market_value":      round(mv, 2),
            "unrealized_gl":     round(ugl, 2),
            "unrealized_gl_pct": round(ugl_pct, 2),
            "realized_gl":       round(float(r.realized_gl or 0), 2),
            "weight_pct":        round(weight, 2),
            "current_price":     float(r.current_price) if r.current_price else None,
            "day_change_pct":    float(r.day_change_pct) if r.day_change_pct else None,
        })

    # ── Breakdown by tax category ────────────────────────────
    tax_map: dict[str, dict] = {}
    for p in positions:
        cat = p["tax_category"] or "OTHER"
        if cat not in tax_map:
            tax_map[cat] = {"tax_category": cat, "market_value": 0, "total_acb": 0,
                            "unrealized_gl": 0, "positions": 0}
        tax_map[cat]["market_value"] += p["market_value"]
        tax_map[cat]["total_acb"]    += p["total_acb"]
        tax_map[cat]["unrealized_gl"] += p["unrealized_gl"]
        tax_map[cat]["positions"]    += 1

    by_tax = []
    for cat, d in sorted(tax_map.items(), key=lambda x: -x[1]["market_value"]):
        d["weight_pct"] = round(d["market_value"] / total_mv * 100, 2) if total_mv > 0 else 0
        d["unrealized_gl_pct"] = round(d["unrealized_gl"] / d["total_acb"] * 100, 2) if d["total_acb"] > 0 else 0
        d["market_value"] = round(d["market_value"], 2)
        d["total_acb"] = round(d["total_acb"], 2)
        d["unrealized_gl"] = round(d["unrealized_gl"], 2)
        by_tax.append(d)

    # ── Breakdown by asset type ──────────────────────────────
    asset_map: dict[str, dict] = {}
    for p in positions:
        at = p["asset_type"] or "STOCK"
        if at not in asset_map:
            asset_map[at] = {"asset_type": at, "market_value": 0, "total_acb": 0,
                             "unrealized_gl": 0, "positions": 0}
        asset_map[at]["market_value"] += p["market_value"]
        asset_map[at]["total_acb"]    += p["total_acb"]
        asset_map[at]["unrealized_gl"] += p["unrealized_gl"]
        asset_map[at]["positions"]    += 1

    by_asset = []
    for at, d in sorted(asset_map.items(), key=lambda x: -x[1]["market_value"]):
        d["weight_pct"] = round(d["market_value"] / total_mv * 100, 2) if total_mv > 0 else 0
        d["market_value"] = round(d["market_value"], 2)
        d["total_acb"] = round(d["total_acb"], 2)
        d["unrealized_gl"] = round(d["unrealized_gl"], 2)
        by_asset.append(d)

    # ── Price history availability ───────────────────────────
    ph_check = db.execute(text("""
        SELECT COUNT(*) AS cnt FROM price_history LIMIT 1
    """)).fetchone()
    has_price_history = (ph_check.cnt if ph_check else 0) > 0

    # ── Realized gains summary (all time) ───────────────────
    # Include closed positions for realized
    realized_rows = db.execute(text(f"""
        SELECT
            h.symbol,
            SUM(h.realized_gain_loss) AS realized_gl,
            SUM(h.total_proceeds) AS total_proceeds,
            SUM(h.total_cost_sold) AS total_cost_sold
        FROM holdings h
        JOIN member_accounts ma ON h.account_id = ma.id
        JOIN members m          ON ma.member_id  = m.id
        JOIN circle_accounts ca ON ca.account_id = ma.id
        JOIN account_types at   ON ma.account_type_code = at.code
        WHERE m.owner_id = :oid AND ca.circle_id = :cid
          AND h.realized_gain_loss != 0
        GROUP BY h.symbol
        ORDER BY ABS(SUM(h.realized_gain_loss)) DESC
        LIMIT 20
    """), {"oid": owner_id, "cid": circle_id}).fetchall()

    realized_summary = [
        {
            "symbol":         r.symbol,
            "realized_gl":    round(float(r.realized_gl or 0), 2),
            "total_proceeds": round(float(r.total_proceeds or 0), 2),
            "total_cost_sold": round(float(r.total_cost_sold or 0), 2),
            "realized_gl_pct": round(float(r.realized_gl or 0) / float(r.total_cost_sold) * 100, 2)
                               if r.total_cost_sold and float(r.total_cost_sold) > 0 else 0,
        }
        for r in realized_rows
    ]

    total_realized = sum(r["realized_gl"] for r in realized_summary)

    return {
        "circle_id":   circle_id,
        "circle_name": circle.name,
        "has_price_history": has_price_history,
        "summary": {
            "total_market_value":   round(total_mv, 2),
            "total_acb":            round(total_acb, 2),
            "total_unrealized_gl":  round(sum(p["unrealized_gl"] for p in positions), 2),
            "total_unrealized_gl_pct": round(
                sum(p["unrealized_gl"] for p in positions) / total_acb * 100, 2
            ) if total_acb > 0 else 0,
            "total_realized_gl":    round(total_realized, 2),
            "open_positions":       len(positions),
        },
        "positions":        positions,
        "by_tax_category":  by_tax,
        "by_asset_type":    by_asset,
        "realized_summary": realized_summary,
    }
