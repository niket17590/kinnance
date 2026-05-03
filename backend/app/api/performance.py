"""
Performance API: filtered performance summary and breakdowns.
Uses the same circle/filter scoping model as holdings and dashboard.
"""
from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import text
from typing import Optional

from app.core.database import get_db
from app.core.security import get_current_db_user

router = APIRouter(prefix="/performance", tags=["performance"])


@router.get("")
def get_performance(
    circle_id: str = Query(...),
    member_ids: Optional[str] = Query(None),
    account_types: Optional[str] = Query(None),
    brokers: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_db_user),
):
    owner_id = str(current_user.id)
    member_id_list = [x.strip() for x in member_ids.split(",")] if member_ids else []
    account_type_list = [x.strip() for x in account_types.split(",")] if account_types else []
    broker_list = [x.strip() for x in brokers.split(",")] if brokers else []

    circle = db.execute(
        text("SELECT id, name FROM circles WHERE id=:cid AND owner_id=:oid AND is_active=TRUE"),
        {"cid": circle_id, "oid": owner_id},
    ).fetchone()
    if not circle:
        raise HTTPException(status_code=404, detail="Circle not found")

    where = ["m.owner_id = :oid"]
    params: dict = {"oid": owner_id, "cid": circle_id}
    where.append("""
        ma.id IN (
            SELECT account_id FROM circle_accounts
            WHERE circle_id = :cid
        )
    """)

    if member_id_list:
        ph = ", ".join(f":m{i}" for i in range(len(member_id_list)))
        where.append(f"ma.member_id::text IN ({ph})")
        for i, v in enumerate(member_id_list):
            params[f"m{i}"] = v
    if account_type_list:
        ph = ", ".join(f":at{i}" for i in range(len(account_type_list)))
        where.append(f"ma.account_type_code IN ({ph})")
        for i, v in enumerate(account_type_list):
            params[f"at{i}"] = v
    if broker_list:
        ph = ", ".join(f":b{i}" for i in range(len(broker_list)))
        where.append(f"ma.broker_code IN ({ph})")
        for i, v in enumerate(broker_list):
            params[f"b{i}"] = v

    where_sql = " AND ".join(where)

    # Open holdings rows (account-level), aggregated later by symbol.
    rows = db.execute(
        text(f"""
            SELECT
                h.symbol, h.asset_type, h.currency,
                h.quantity_total,
                h.total_acb,
                h.market_value,
                h.unrealized_gain_loss AS unrealized_gl,
                h.current_price,
                h.realized_gain_loss   AS realized_gl,
                h.day_change_pct,
                at.tax_category
            FROM holdings h
            JOIN member_accounts ma ON h.account_id = ma.id
            JOIN members m          ON ma.member_id = m.id
            JOIN account_types at   ON ma.account_type_code = at.code
            WHERE {where_sql}
              AND h.is_position_open = TRUE
              AND h.quantity_total > 0
              AND h.symbol IS NOT NULL
            ORDER BY h.market_value DESC NULLS LAST
        """),
        params,
    ).fetchall()

    # Aggregate by symbol to avoid duplicate symbol rows when symbol exists in many accounts.
    symbol_map: dict[str, dict] = {}
    for r in rows:
        sym = r.symbol
        if sym not in symbol_map:
            symbol_map[sym] = {
                "symbol": sym,
                "asset_type": r.asset_type,
                "currency": r.currency,
                "quantity": 0.0,
                "total_acb": 0.0,
                "market_value": 0.0,
                "unrealized_gl": 0.0,
                "realized_gl": 0.0,
                "current_price": None,
                "day_change_pct": None,
                "tax_categories": set(),
            }

        s = symbol_map[sym]
        s["quantity"] += float(r.quantity_total or 0)
        s["total_acb"] += float(r.total_acb or 0)
        s["market_value"] += float(r.market_value or 0)
        s["unrealized_gl"] += float(r.unrealized_gl or 0)
        s["realized_gl"] += float(r.realized_gl or 0)
        if s["current_price"] is None and r.current_price is not None:
            s["current_price"] = float(r.current_price)
            s["day_change_pct"] = float(r.day_change_pct) if r.day_change_pct is not None else None
        if r.tax_category:
            s["tax_categories"].add(r.tax_category)

    positions = []
    for s in symbol_map.values():
        acb = s["total_acb"]
        ugl = s["unrealized_gl"]
        if len(s["tax_categories"]) == 1:
            tax_category = next(iter(s["tax_categories"]))
        elif len(s["tax_categories"]) > 1:
            tax_category = "MIXED"
        else:
            tax_category = None
        positions.append({
            "symbol": s["symbol"],
            "asset_type": s["asset_type"],
            "currency": s["currency"],
            "tax_category": tax_category,
            "quantity": round(s["quantity"], 4),
            "total_acb": round(acb, 2),
            "market_value": round(s["market_value"], 2),
            "unrealized_gl": round(ugl, 2),
            "unrealized_gl_pct": round((ugl / acb * 100), 2) if acb > 0 else 0,
            "realized_gl": round(s["realized_gl"], 2),
            "weight_pct": 0,
            "current_price": s["current_price"],
            "day_change_pct": s["day_change_pct"],
        })

    positions.sort(key=lambda p: p["market_value"], reverse=True)
    total_mv = sum(float(p["market_value"] or 0) for p in positions)
    total_acb = sum(float(p["total_acb"] or 0) for p in positions)
    for p in positions:
        p["weight_pct"] = round((p["market_value"] / total_mv * 100), 2) if total_mv > 0 else 0

    # Tax buckets from account-level rows to preserve tax treatment split.
    tax_map: dict[str, dict] = {}
    for r in rows:
        cat = r.tax_category or "OTHER"
        if cat not in tax_map:
            tax_map[cat] = {
                "tax_category": cat,
                "market_value": 0.0,
                "total_acb": 0.0,
                "unrealized_gl": 0.0,
                "symbols": set(),
            }
        d = tax_map[cat]
        d["market_value"] += float(r.market_value or 0)
        d["total_acb"] += float(r.total_acb or 0)
        d["unrealized_gl"] += float(r.unrealized_gl or 0)
        if r.symbol:
            d["symbols"].add(r.symbol)

    by_tax = []
    for _, d in sorted(tax_map.items(), key=lambda x: -x[1]["market_value"]):
        by_tax.append({
            "tax_category": d["tax_category"],
            "market_value": round(d["market_value"], 2),
            "total_acb": round(d["total_acb"], 2),
            "unrealized_gl": round(d["unrealized_gl"], 2),
            "positions": len(d["symbols"]),
            "weight_pct": round(d["market_value"] / total_mv * 100, 2) if total_mv > 0 else 0,
            "unrealized_gl_pct": round(d["unrealized_gl"] / d["total_acb"] * 100, 2) if d["total_acb"] > 0 else 0,
        })

    # Asset buckets from symbol-aggregated positions.
    asset_map: dict[str, dict] = {}
    for p in positions:
        at = p["asset_type"] or "STOCK"
        if at not in asset_map:
            asset_map[at] = {"asset_type": at, "market_value": 0.0, "total_acb": 0.0, "unrealized_gl": 0.0, "positions": 0}
        d = asset_map[at]
        d["market_value"] += p["market_value"]
        d["total_acb"] += p["total_acb"]
        d["unrealized_gl"] += p["unrealized_gl"]
        d["positions"] += 1

    by_asset = []
    for _, d in sorted(asset_map.items(), key=lambda x: -x[1]["market_value"]):
        by_asset.append({
            "asset_type": d["asset_type"],
            "market_value": round(d["market_value"], 2),
            "total_acb": round(d["total_acb"], 2),
            "unrealized_gl": round(d["unrealized_gl"], 2),
            "positions": d["positions"],
            "weight_pct": round(d["market_value"] / total_mv * 100, 2) if total_mv > 0 else 0,
        })

    ph_check = db.execute(text("SELECT COUNT(*) AS cnt FROM price_history LIMIT 1")).fetchone()
    has_price_history = (ph_check.cnt if ph_check else 0) > 0

    # Realized summary uses the same scope filters (includes closed positions).
    realized_rows = db.execute(
        text(f"""
            SELECT
                h.symbol,
                SUM(h.realized_gain_loss) AS realized_gl,
                SUM(h.total_proceeds) AS total_proceeds,
                SUM(h.total_cost_sold) AS total_cost_sold
            FROM holdings h
            JOIN member_accounts ma ON h.account_id = ma.id
            JOIN members m          ON ma.member_id = m.id
            WHERE {where_sql}
              AND h.symbol IS NOT NULL
              AND h.realized_gain_loss != 0
            GROUP BY h.symbol
            ORDER BY ABS(SUM(h.realized_gain_loss)) DESC
            LIMIT 20
        """),
        params,
    ).fetchall()

    realized_summary = []
    for r in realized_rows:
        realized_gl = float(r.realized_gl or 0)
        total_cost_sold = float(r.total_cost_sold or 0)
        realized_summary.append({
            "symbol": r.symbol,
            "realized_gl": round(realized_gl, 2),
            "total_proceeds": round(float(r.total_proceeds or 0), 2),
            "total_cost_sold": round(total_cost_sold, 2),
            "realized_gl_pct": round(realized_gl / total_cost_sold * 100, 2) if total_cost_sold > 0 else 0,
        })

    total_unrealized = sum(float(p["unrealized_gl"] or 0) for p in positions)
    total_realized = sum(float(r["realized_gl"] or 0) for r in realized_summary)

    return {
        "circle_id": circle_id,
        "circle_name": circle.name,
        "has_price_history": has_price_history,
        "summary": {
            "total_market_value": round(total_mv, 2),
            "total_acb": round(total_acb, 2),
            "total_unrealized_gl": round(total_unrealized, 2),
            "total_unrealized_gl_pct": round(total_unrealized / total_acb * 100, 2) if total_acb > 0 else 0,
            "total_realized_gl": round(total_realized, 2),
            "open_positions": len(positions),
        },
        "positions": positions,
        "by_tax_category": by_tax,
        "by_asset_type": by_asset,
        "realized_summary": realized_summary,
    }
