from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from sqlalchemy import text
from typing import Optional
from app.core.database import get_db
from app.core.security import get_current_db_user

router = APIRouter(prefix="/holdings", tags=["holdings"])


@router.get("")
def get_holdings(
    circle_id: Optional[str] = Query(None),
    member_ids: Optional[str] = Query(None),
    account_types: Optional[str] = Query(None),
    brokers: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_db_user)
):
    """
    Get holdings grouped by account, filtered by circle/member/account type/broker.
    Joins with price_cache for current price, market value, unrealized gain/loss.
    Returns null for price fields if no price data available.
    """
    owner_id = str(current_user.id)

    member_id_list = [m.strip() for m in member_ids.split(",")] if member_ids else []
    account_type_list = [a.strip() for a in account_types.split(",")] if account_types else []
    broker_list = [b.strip() for b in brokers.split(",")] if brokers else []

    where_clauses = ["m.owner_id = :owner_id", "h.quantity_total > 0"]
    params = {"owner_id": owner_id}

    if circle_id:
        where_clauses.append("""
            ma.id IN (
                SELECT account_id FROM circle_accounts
                WHERE circle_id = :circle_id
            )
        """)
        params["circle_id"] = circle_id

    if member_id_list:
        placeholders = ", ".join(f":member_{i}" for i in range(len(member_id_list)))
        where_clauses.append(f"ma.member_id::text IN ({placeholders})")
        for i, mid in enumerate(member_id_list):
            params[f"member_{i}"] = mid

    if account_type_list:
        placeholders = ", ".join(f":acct_{i}" for i in range(len(account_type_list)))
        where_clauses.append(f"ma.account_type_code IN ({placeholders})")
        for i, at in enumerate(account_type_list):
            params[f"acct_{i}"] = at

    if broker_list:
        placeholders = ", ".join(f":broker_{i}" for i in range(len(broker_list)))
        where_clauses.append(f"ma.broker_code IN ({placeholders})")
        for i, b in enumerate(broker_list):
            params[f"broker_{i}"] = b

    where_sql = " AND ".join(where_clauses)

    rows = db.execute(
        text(f"""
            SELECT
                h.id,
                h.symbol,
                h.asset_type,
                h.quantity_total,
                h.quantity_free,
                h.quantity_pledged,
                h.acb_per_share,
                h.total_acb,
                h.currency,
                h.last_calculated_at,

                -- Account info
                ma.id               AS account_id,
                ma.account_type_code,
                ma.nickname         AS account_nickname,
                ma.broker_code,

                -- Member info
                m.id                AS member_id,
                m.display_name      AS member_name,

                -- Broker + account type names
                b.name              AS broker_name,
                at.name             AS account_type_name,
                at.tax_category,

                -- Price from cache (null if not available)
                pc.price            AS current_price,
                pc.day_change_pct,
                pc.fetched_at       AS price_fetched_at,

                -- Computed fields
                CASE
                    WHEN pc.price IS NOT NULL
                    THEN ROUND(pc.price * h.quantity_total, 2)
                    ELSE NULL
                END AS market_value,

                CASE
                    WHEN pc.price IS NOT NULL
                    THEN ROUND((pc.price * h.quantity_total) - h.total_acb, 2)
                    ELSE NULL
                END AS unrealized_gain_loss,

                CASE
                    WHEN pc.price IS NOT NULL AND h.total_acb > 0
                    THEN ROUND(
                        ((pc.price * h.quantity_total - h.total_acb) / h.total_acb) * 100,
                        2
                    )
                    ELSE NULL
                END AS unrealized_gain_loss_pct

            FROM holdings h
            JOIN member_accounts ma ON h.account_id = ma.id
            JOIN members m ON ma.member_id = m.id
            JOIN brokers b ON ma.broker_code = b.code
            JOIN account_types at ON ma.account_type_code = at.code
            LEFT JOIN price_cache pc
                ON pc.symbol = h.symbol
                AND pc.currency = h.currency
            WHERE {where_sql}
            ORDER BY
                m.display_name,
                ma.account_type_code,
                h.quantity_total * COALESCE(pc.price, h.acb_per_share) DESC
        """),
        params
    ).fetchall()

    # Group by account
    accounts = {}
    for row in rows:
        acct_id = str(row.account_id)
        if acct_id not in accounts:
            accounts[acct_id] = {
                'account_id': acct_id,
                'account_type_code': row.account_type_code,
                'account_type_name': row.account_type_name,
                'account_nickname': row.account_nickname,
                'broker_code': row.broker_code,
                'broker_name': row.broker_name,
                'member_id': str(row.member_id),
                'member_name': row.member_name,
                'tax_category': row.tax_category,
                'holdings': [],
                'total_acb': 0,
                'total_market_value': None,
                'total_unrealized': None,
            }

        h = dict(row._mapping)

        # Convert decimals to float for JSON
        for field in ['quantity_total', 'quantity_free', 'quantity_pledged',
                      'acb_per_share', 'total_acb', 'current_price',
                      'market_value', 'unrealized_gain_loss',
                      'unrealized_gain_loss_pct', 'day_change_pct']:
            if h.get(field) is not None:
                h[field] = float(h[field])

        accounts[acct_id]['holdings'].append(h)

        # Accumulate account totals
        accounts[acct_id]['total_acb'] += float(row.total_acb or 0)
        if row.market_value is not None:
            prev = accounts[acct_id]['total_market_value'] or 0
            accounts[acct_id]['total_market_value'] = round(prev + float(row.market_value), 2)
        if row.unrealized_gain_loss is not None:
            prev = accounts[acct_id]['total_unrealized'] or 0
            accounts[acct_id]['total_unrealized'] = round(prev + float(row.unrealized_gain_loss), 2)

    return {
        'accounts': list(accounts.values()),
        'total_accounts': len(accounts),
        'total_holdings': len(rows)
    }