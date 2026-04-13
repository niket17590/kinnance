from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from sqlalchemy import text
from typing import Optional
from app.core.database import get_db
from app.core.security import get_current_db_user

router = APIRouter(prefix="/transactions", tags=["transactions"])

# Allowlist for sort direction — prevents SQL injection
VALID_SORT_DIRS = {"asc", "desc"}


@router.get("")
def get_transactions(
    # Global filters (from FilterBar)
    circle_id:         Optional[str] = Query(None),
    member_ids:        Optional[str] = Query(None),   # comma-separated
    account_types:     Optional[str] = Query(None),   # comma-separated
    brokers:           Optional[str] = Query(None),   # comma-separated
    # Local transaction filters
    date_from:         Optional[str] = Query(None),   # YYYY-MM-DD
    date_to:           Optional[str] = Query(None),   # YYYY-MM-DD
    transaction_types: Optional[str] = Query(None),   # comma-separated
    symbol:            Optional[str] = Query(None),   # partial match
    # Pagination + sort
    page:              int = Query(1, ge=1),
    page_size:         int = Query(50, ge=1, le=200),
    sort_dir:          str = Query("desc"),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_db_user)
):
    owner_id = str(current_user.id)
    offset = (page - 1) * page_size

    # Sanitise sort direction
    order = "DESC" if sort_dir.lower() not in VALID_SORT_DIRS or sort_dir.lower() == "desc" else "ASC"

    # Parse comma-separated params
    member_id_list        = [m.strip() for m in member_ids.split(",")]        if member_ids        else []
    account_type_list     = [a.strip() for a in account_types.split(",")]     if account_types     else []
    broker_list           = [b.strip() for b in brokers.split(",")]           if brokers           else []
    transaction_type_list = [t.strip() for t in transaction_types.split(",")] if transaction_types else []

    # ── Build WHERE clauses ───────────────────────────────────
    where_clauses = ["m.owner_id = :owner_id"]
    params = {"owner_id": owner_id, "limit": page_size, "offset": offset}

    # Circle filter
    if circle_id:
        where_clauses.append("""
            ma.id IN (
                SELECT account_id FROM circle_accounts
                WHERE circle_id = :circle_id
            )
        """)
        params["circle_id"] = circle_id

    # Member filter
    if member_id_list:
        placeholders = ", ".join(f":member_{i}" for i in range(len(member_id_list)))
        where_clauses.append(f"ma.member_id::text IN ({placeholders})")
        for i, mid in enumerate(member_id_list):
            params[f"member_{i}"] = mid

    # Account type filter
    if account_type_list:
        placeholders = ", ".join(f":acct_{i}" for i in range(len(account_type_list)))
        where_clauses.append(f"ma.account_type_code IN ({placeholders})")
        for i, at in enumerate(account_type_list):
            params[f"acct_{i}"] = at

    # Broker filter
    if broker_list:
        placeholders = ", ".join(f":broker_{i}" for i in range(len(broker_list)))
        where_clauses.append(f"ma.broker_code IN ({placeholders})")
        for i, b in enumerate(broker_list):
            params[f"broker_{i}"] = b

    # Date range filter
    if date_from:
        where_clauses.append("t.trade_date >= :date_from")
        params["date_from"] = date_from

    if date_to:
        where_clauses.append("t.trade_date <= :date_to")
        params["date_to"] = date_to

    # Transaction type filter
    if transaction_type_list:
        placeholders = ", ".join(f":txn_type_{i}" for i in range(len(transaction_type_list)))
        where_clauses.append(f"t.transaction_type IN ({placeholders})")
        for i, tt in enumerate(transaction_type_list):
            params[f"txn_type_{i}"] = tt

    # Symbol filter — case-insensitive partial match on normalised symbol
    if symbol:
        where_clauses.append("t.symbol_normalized ILIKE :symbol")
        params["symbol"] = f"%{symbol.strip().upper()}%"

    where_sql = " AND ".join(where_clauses)

    # ── Main query ────────────────────────────────────────────
    rows = db.execute(
        text(f"""
            SELECT
                t.id,
                t.trade_date,
                t.settlement_date,
                t.transaction_type,
                t.symbol,
                t.symbol_normalized,
                t.asset_type,
                t.description,
                t.quantity,
                t.price_per_unit,
                t.trade_currency,
                t.gross_amount,
                t.commission,
                t.net_amount,
                t.net_amount_cad,
                t.fx_rate_to_cad,
                t.notes,
                ma.id                AS account_id,
                ma.account_type_code,
                ma.nickname          AS account_nickname,
                ma.broker_code,
                m.id                 AS member_id,
                m.display_name       AS member_name,
                b.name               AS broker_name,
                at.name              AS account_type_name
            FROM transactions t
            JOIN member_accounts ma ON t.account_id = ma.id
            JOIN members m          ON ma.member_id = m.id
            JOIN brokers b          ON ma.broker_code = b.code
            JOIN account_types at   ON ma.account_type_code = at.code
            WHERE {where_sql}
            ORDER BY t.trade_date {order}, t.created_at {order}
            LIMIT :limit OFFSET :offset
        """),
        params
    ).fetchall()

    # ── Count query (reuses same WHERE, excludes pagination params) ──
    count_row = db.execute(
        text(f"""
            SELECT COUNT(*) as total
            FROM transactions t
            JOIN member_accounts ma ON t.account_id = ma.id
            JOIN members m          ON ma.member_id = m.id
            JOIN brokers b          ON ma.broker_code = b.code
            JOIN account_types at   ON ma.account_type_code = at.code
            WHERE {where_sql}
        """),
        {k: v for k, v in params.items() if k not in ("limit", "offset")}
    ).fetchone()

    total = count_row.total if count_row else 0
    total_pages = (total + page_size - 1) // page_size

    return {
        "transactions": [dict(r._mapping) for r in rows],
        "pagination": {
            "page": page,
            "page_size": page_size,
            "total": total,
            "total_pages": total_pages,
            "has_next": page < total_pages,
            "has_prev": page > 1,
        }
    }
