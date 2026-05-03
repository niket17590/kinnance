"""
Dashboard API: single endpoint for dashboard widgets.
Respects selected circle + top filter bar selections, and aggregates holdings by symbol.
"""
from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import text
from typing import Optional

from app.core.database import get_db
from app.core.security import get_current_db_user

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


@router.get("")
def get_dashboard(
    circle_id: str = Query(...),
    member_ids: Optional[str] = Query(None),
    account_types: Optional[str] = Query(None),
    brokers: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_db_user),
):
    owner_id = str(current_user.id)
    member_id_list = [m.strip() for m in member_ids.split(",")] if member_ids else []
    account_type_list = [a.strip() for a in account_types.split(",")] if account_types else []
    broker_list = [b.strip() for b in brokers.split(",")] if brokers else []

    circle = db.execute(
        text("SELECT id, name FROM circles WHERE id=:cid AND owner_id=:oid AND is_active=TRUE"),
        {"cid": circle_id, "oid": owner_id},
    ).fetchone()
    if not circle:
        raise HTTPException(status_code=404, detail="Circle not found")

    where_clauses = ["m.owner_id = :oid"]
    params = {"cid": circle_id, "oid": owner_id}

    where_clauses.append("""
        ma.id IN (
            SELECT account_id FROM circle_accounts
            WHERE circle_id = :cid
        )
    """)

    if member_id_list:
        placeholders = ", ".join(f":member_{i}" for i in range(len(member_id_list)))
        where_clauses.append(f"ma.member_id::text IN ({placeholders})")
        for i, member_id in enumerate(member_id_list):
            params[f"member_{i}"] = member_id

    if account_type_list:
        placeholders = ", ".join(f":acct_{i}" for i in range(len(account_type_list)))
        where_clauses.append(f"ma.account_type_code IN ({placeholders})")
        for i, account_type in enumerate(account_type_list):
            params[f"acct_{i}"] = account_type

    if broker_list:
        placeholders = ", ".join(f":broker_{i}" for i in range(len(broker_list)))
        where_clauses.append(f"ma.broker_code IN ({placeholders})")
        for i, broker_code in enumerate(broker_list):
            params[f"broker_{i}"] = broker_code

    where_sql = " AND ".join(where_clauses)

    # 1) Holdings snapshot (account rows), then aggregate by symbol for dashboard widgets.
    holdings_rows = db.execute(
        text(f"""
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
            JOIN members m          ON ma.member_id = m.id
            JOIN account_types at   ON ma.account_type_code = at.code
            WHERE {where_sql}
              AND h.is_position_open = TRUE
              AND h.quantity_total > 0
            ORDER BY h.market_value DESC NULLS LAST
        """),
        params,
    ).fetchall()

    symbol_map = {}
    for row in holdings_rows:
        symbol = row.symbol
        if symbol not in symbol_map:
            symbol_map[symbol] = {
                "symbol": symbol,
                "asset_type": row.asset_type,
                "currency": row.currency,
                "quantity_total": 0.0,
                "market_value": 0.0,
                "total_acb": 0.0,
                "unrealized_gl": 0.0,
                "realized_gl": 0.0,
                "current_price": None,
                "day_change_pct": None,
                "tax_categories": set(),
            }

        s = symbol_map[symbol]
        s["quantity_total"] += float(row.quantity_total or 0)
        s["market_value"] += float(row.market_value or 0)
        s["total_acb"] += float(row.total_acb or 0)
        s["unrealized_gl"] += float(row.unrealized_gain_loss or 0)
        s["realized_gl"] += float(row.realized_gain_loss or 0)
        if s["current_price"] is None and row.current_price is not None:
            s["current_price"] = float(row.current_price)
            s["day_change_pct"] = float(row.day_change_pct) if row.day_change_pct is not None else None
        if row.tax_category:
            s["tax_categories"].add(row.tax_category)

    aggregated_holdings = []
    for s in symbol_map.values():
        if len(s["tax_categories"]) == 1:
            tax_category = next(iter(s["tax_categories"]))
        elif len(s["tax_categories"]) > 1:
            tax_category = "MIXED"
        else:
            tax_category = None

        unrealized_gl_pct = (s["unrealized_gl"] / s["total_acb"] * 100) if s["total_acb"] > 0 else None

        aggregated_holdings.append({
            "symbol": s["symbol"],
            "asset_type": s["asset_type"],
            "currency": s["currency"],
            "quantity_total": s["quantity_total"],
            "market_value": s["market_value"],
            "total_acb": s["total_acb"],
            "unrealized_gl": s["unrealized_gl"],
            "unrealized_gl_pct": unrealized_gl_pct,
            "realized_gl": s["realized_gl"],
            "current_price": s["current_price"],
            "day_change_pct": s["day_change_pct"],
            "tax_category": tax_category,
        })

    aggregated_holdings.sort(key=lambda h: h["market_value"], reverse=True)

    total_mv = sum(h["market_value"] for h in aggregated_holdings)
    total_acb = sum(h["total_acb"] for h in aggregated_holdings)
    total_unrealized = sum(h["unrealized_gl"] for h in aggregated_holdings)
    total_realized = sum(h["realized_gl"] for h in aggregated_holdings)
    has_prices = any(h["current_price"] is not None for h in aggregated_holdings)
    total_unrealized_pct = (total_unrealized / total_acb * 100) if total_acb > 0 else None

    total_daily_gl = sum(
        float(row.day_change) * float(row.quantity_total)
        for row in holdings_rows
        if row.day_change is not None and row.quantity_total
    ) if has_prices else None

    daily_prev_mv = total_mv - total_daily_gl if total_daily_gl is not None else None
    total_daily_gl_pct = (
        total_daily_gl / daily_prev_mv * 100
        if total_daily_gl is not None and daily_prev_mv and daily_prev_mv != 0
        else None
    )

    top_holdings = []
    for h in aggregated_holdings[:10]:
        weight = (h["market_value"] / total_mv * 100) if total_mv > 0 else 0
        top_holdings.append({
            "symbol": h["symbol"],
            "asset_type": h["asset_type"],
            "currency": h["currency"],
            "market_value": round(h["market_value"], 2),
            "total_acb": round(h["total_acb"], 2),
            "unrealized_gl": round(h["unrealized_gl"], 2),
            "unrealized_gl_pct": round(float(h["unrealized_gl_pct"] or 0), 2),
            "weight_pct": round(weight, 2),
            "tax_category": h["tax_category"],
            "current_price": h["current_price"],
            "day_change_pct": h["day_change_pct"],
        })

    all_holdings_donut = []
    for h in aggregated_holdings:
        weight = (h["market_value"] / total_mv * 100) if total_mv > 0 else 0
        all_holdings_donut.append({
            "symbol": h["symbol"],
            "market_value": round(h["market_value"], 2),
            "weight_pct": round(weight, 2),
        })

    # 2) Allocation by tax bucket (account-level totals to preserve tax treatment split).
    tax_buckets = {}
    for row in holdings_rows:
        cat = row.tax_category or "OTHER"
        tax_buckets[cat] = tax_buckets.get(cat, 0) + float(row.market_value or 0)

    allocation_by_tax = [
        {
            "tax_category": cat,
            "market_value": round(mv, 2),
            "weight_pct": round(mv / total_mv * 100, 2) if total_mv > 0 else 0,
        }
        for cat, mv in sorted(tax_buckets.items(), key=lambda item: -item[1])
    ]

    # 3) Allocation by currency.
    currency_buckets = {}
    for h in aggregated_holdings:
        cur = h["currency"] or "USD"
        currency_buckets[cur] = currency_buckets.get(cur, 0) + h["market_value"]

    allocation_by_currency = [
        {
            "currency": cur,
            "market_value": round(mv, 2),
            "weight_pct": round(mv / total_mv * 100, 2) if total_mv > 0 else 0,
        }
        for cur, mv in sorted(currency_buckets.items(), key=lambda item: -item[1])
    ]

    # 4) Recent transactions using the same circle + top filter bar criteria.
    recent_txns = db.execute(
        text(f"""
            SELECT
                t.id, t.trade_date, t.transaction_type,
                t.symbol_normalized AS symbol,
                t.quantity, t.price_per_unit,
                t.net_amount, t.net_amount_cad, t.trade_currency, t.gross_amount,
                m.display_name AS member_name,
                at.name AS account_type_name,
                ma.nickname AS account_nickname,
                b.name AS broker_name
            FROM transactions t
            JOIN member_accounts ma ON t.account_id = ma.id
            JOIN members m          ON ma.member_id = m.id
            JOIN account_types at   ON ma.account_type_code = at.code
            JOIN brokers b          ON ma.broker_code = b.code
            WHERE {where_sql}
            ORDER BY t.trade_date DESC, t.created_at DESC
            LIMIT 8
        """),
        params,
    ).fetchall()

    recent_transactions = []
    for row in recent_txns:
        net_amount = float(row.net_amount or 0)
        net_amount_cad = float(row.net_amount_cad or 0)
        gross_amount = float(row.gross_amount or 0)
        trade_currency = row.trade_currency or "CAD"
        quantity = float(row.quantity) if row.quantity is not None else None
        price_per_unit = float(row.price_per_unit) if row.price_per_unit is not None else None
        txn_type = row.transaction_type

        if abs(net_amount_cad) >= 0.005 or trade_currency == "CAD":
            amount_value = net_amount_cad
            amount_currency = "CAD"
        else:
            amount_value = net_amount
            amount_currency = trade_currency

        # Some broker rows store BUY/SELL cash amount as 0.
        # For dashboard display only, fallback to signed trade notional.
        if (
            abs(amount_value) < 0.005
            and txn_type in ("BUY", "SELL")
            and quantity is not None
            and price_per_unit is not None
            and quantity > 0
            and price_per_unit > 0
        ):
            sign = -1 if txn_type == "BUY" else 1
            amount_value = sign * quantity * price_per_unit
            amount_currency = trade_currency
        elif abs(amount_value) < 0.005 and abs(gross_amount) >= 0.005:
            amount_value = gross_amount
            amount_currency = trade_currency

        recent_transactions.append({
            "id": str(row.id),
            "trade_date": str(row.trade_date),
            "transaction_type": txn_type,
            "symbol": row.symbol,
            "quantity": quantity,
            "price_per_unit": price_per_unit,
            "net_amount": net_amount,
            "net_amount_cad": net_amount_cad,
            "trade_currency": trade_currency,
            "amount_value": amount_value,
            "amount_currency": amount_currency,
            "member_name": row.member_name,
            "account_label": row.account_nickname or row.account_type_name,
            "broker_name": row.broker_name,
        })

    # 5) Gains summary.
    winners = sorted(
        [h for h in aggregated_holdings if h["unrealized_gl"] > 0],
        key=lambda h: -h["unrealized_gl"],
    )[:5]
    losers = sorted(
        [h for h in aggregated_holdings if h["unrealized_gl"] < 0],
        key=lambda h: h["unrealized_gl"],
    )[:5]

    def holding_summary(h):
        return {
            "symbol": h["symbol"],
            "unrealized_gl": round(h["unrealized_gl"], 2),
            "unrealized_gl_pct": round(float(h["unrealized_gl_pct"] or 0), 2),
            "market_value": round(h["market_value"], 2),
        }

    # 6) Member breakdown.
    member_map = {}
    for row in holdings_rows:
        member_id = str(row.member_id)
        if member_id not in member_map:
            member_map[member_id] = {
                "member_id": member_id,
                "member_name": row.member_name,
                "member_type": row.member_type,
                "symbols": set(),
                "market_value": 0.0,
                "total_acb": 0.0,
                "unrealized_gl": 0.0,
            }
        m = member_map[member_id]
        m["symbols"].add(row.symbol)
        m["market_value"] += float(row.market_value or 0)
        m["total_acb"] += float(row.total_acb or 0)
        m["unrealized_gl"] += float(row.unrealized_gain_loss or 0)

    member_breakdown = sorted(
        [
            {
                "member_id": m["member_id"],
                "member_name": m["member_name"],
                "member_type": m["member_type"],
                "positions": len(m["symbols"]),
                "market_value": round(m["market_value"], 2),
                "total_acb": round(m["total_acb"], 2),
                "unrealized_gl": round(m["unrealized_gl"], 2),
                "weight_pct": round(m["market_value"] / total_mv * 100, 2) if total_mv > 0 else 0,
            }
            for m in member_map.values()
        ],
        key=lambda x: -x["market_value"],
    )

    return {
        "circle_id": circle_id,
        "circle_name": circle.name,
        "summary": {
            "total_market_value": round(total_mv, 2),
            "total_acb": round(total_acb, 2),
            "total_unrealized_gl": round(total_unrealized, 2),
            "total_unrealized_gl_pct": round(total_unrealized_pct, 2) if total_unrealized_pct else None,
            "total_realized_gl": round(total_realized, 2),
            "total_daily_gl": round(total_daily_gl, 2) if total_daily_gl is not None else None,
            "total_daily_gl_pct": round(total_daily_gl_pct, 2) if total_daily_gl_pct is not None else None,
            "open_positions": len(aggregated_holdings),
            "has_prices": has_prices,
        },
        "top_holdings": top_holdings,
        "all_holdings": all_holdings_donut,
        "allocation_by_tax": allocation_by_tax,
        "allocation_by_currency": allocation_by_currency,
        "recent_transactions": recent_transactions,
        "winners": [holding_summary(h) for h in winners],
        "losers": [holding_summary(h) for h in losers],
        "member_breakdown": member_breakdown,
    }
