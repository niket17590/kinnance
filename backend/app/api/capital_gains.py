from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from sqlalchemy import text
from typing import Optional
from app.core.database import get_db
from app.core.security import get_current_db_user

router = APIRouter(prefix="/capital-gains", tags=["capital-gains"])


@router.get("/tax-years")
def get_available_tax_years(
    circle_id: Optional[str] = Query(None),
    member_ids: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_db_user)
):
    """
    Returns distinct tax years that have realized gains data
    for the members in the selected circle.
    Used to populate the year tabs on the Capital Gains page.
    """
    owner_id = str(current_user.id)
    member_id_list = [m.strip() for m in member_ids.split(",")] if member_ids else []

    where_clauses = ["m.owner_id = :owner_id"]
    params = {"owner_id": owner_id}

    if circle_id:
        where_clauses.append("""
            m.id IN (
                SELECT m2.id FROM members m2
                JOIN member_accounts ma2 ON ma2.member_id = m2.id
                JOIN circle_accounts ca ON ca.account_id = ma2.id
                WHERE ca.circle_id = :circle_id
            )
        """)
        params["circle_id"] = circle_id

    if member_id_list:
        placeholders = ", ".join(f":member_{i}" for i in range(len(member_id_list)))
        where_clauses.append(f"m.id::text IN ({placeholders})")
        for i, mid in enumerate(member_id_list):
            params[f"member_{i}"] = mid

    where_sql = " AND ".join(where_clauses)

    rows = db.execute(
        text(f"""
            SELECT DISTINCT rg.tax_year
            FROM realized_gains rg
            JOIN member_accounts ma ON rg.account_id = ma.id
            JOIN members m ON ma.member_id = m.id
            WHERE {where_sql}
            ORDER BY rg.tax_year DESC
        """),
        params
    ).fetchall()

    return [r.tax_year for r in rows]


@router.get("")
def get_capital_gains(
    tax_year:     int            = Query(...),
    circle_id:    Optional[str]  = Query(None),
    member_ids:   Optional[str]  = Query(None),
    account_types: Optional[str] = Query(None),
    brokers:      Optional[str]  = Query(None),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_db_user)
):
    """
    Capital gains for a specific tax year.

    Returns per member:
      - broker_view: per broker → per account → per sell transaction
      - consolidated_view: per symbol (cross-broker CPA calculation)

    Only TAXABLE accounts are included in broker_view.
    Consolidated view is pre-computed in realized_gains_consolidated.
    FilterBar filters (circle, member, account_type, broker) are all respected.
    """
    owner_id = str(current_user.id)
    member_id_list    = [m.strip() for m in member_ids.split(",")]    if member_ids    else []
    account_type_list = [a.strip() for a in account_types.split(",")] if account_types else []
    broker_list       = [b.strip() for b in brokers.split(",")]       if brokers       else []

    # ── Build base WHERE for realized_gains ──────────────────
    where_clauses = [
        "m.owner_id = :owner_id",
        "rg.tax_year = :tax_year",
        "at.tax_category = 'TAXABLE'",   # capital gains only on taxable accounts
    ]
    params: dict = {"owner_id": owner_id, "tax_year": tax_year}

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

    # ── Fetch all broker-view sell rows ───────────────────────
    rows = db.execute(
        text(f"""
            SELECT
                rg.id,
                rg.symbol,
                rg.trade_date,
                rg.quantity_sold,
                rg.proceeds,
                rg.acb_per_share,
                rg.acb_total,
                rg.realized_gl,
                rg.currency,
                ma.id               AS account_id,
                ma.account_type_code,
                ma.nickname         AS account_nickname,
                ma.broker_code,
                b.name              AS broker_name,
                at.name             AS account_type_name,
                at.tax_category,
                m.id                AS member_id,
                m.display_name      AS member_name,
                m.member_type
            FROM realized_gains rg
            JOIN member_accounts ma ON rg.account_id = ma.id
            JOIN members m          ON ma.member_id = m.id
            JOIN brokers b          ON ma.broker_code = b.code
            JOIN account_types at   ON ma.account_type_code = at.code
            WHERE {where_sql}
            ORDER BY m.display_name ASC, b.name ASC, ma.id ASC, rg.trade_date ASC
        """),
        params
    ).fetchall()

    # ── Fetch consolidated rows for same members + year ───────
    # Derive member IDs from the broker rows we got
    member_ids_found = list({str(r.member_id) for r in rows})

    consolidated_rows = []
    if member_ids_found:
        consolidated_rows = db.execute(
            text("""
                SELECT
                    rgc.member_id,
                    rgc.symbol,
                    rgc.currency,
                    rgc.total_quantity_sold,
                    rgc.total_proceeds,
                    rgc.total_acb,
                    rgc.total_realized_gl,
                    rgc.sell_count
                FROM realized_gains_consolidated rgc
                WHERE rgc.member_id = ANY(CAST(:member_ids AS uuid[]))
                AND rgc.tax_year = :tax_year
                ORDER BY rgc.total_realized_gl DESC
            """),
            {"member_ids": member_ids_found, "tax_year": tax_year}
        ).fetchall()

    # ── Aggregate in Python ───────────────────────────────────
    # Structure: member → broker → account → sells
    members_map: dict[str, dict] = {}

    for row in rows:
        mid = str(row.member_id)
        if mid not in members_map:
            members_map[mid] = {
                "member_id":   mid,
                "member_name": row.member_name,
                "member_type": row.member_type,
                "brokers":     {},
                "consolidated": [],
                # Summary totals for broker view
                "total_proceeds":   0.0,
                "total_acb":        0.0,
                "total_realized_gl": 0.0,
            }

        m = members_map[mid]
        broker_key = row.broker_code

        if broker_key not in m["brokers"]:
            m["brokers"][broker_key] = {
                "broker_code": row.broker_code,
                "broker_name": row.broker_name,
                "accounts":    {},
                "total_proceeds":    0.0,
                "total_acb":         0.0,
                "total_realized_gl": 0.0,
            }

        bk = m["brokers"][broker_key]
        acct_key = str(row.account_id)

        if acct_key not in bk["accounts"]:
            bk["accounts"][acct_key] = {
                "account_id":        acct_key,
                "account_type_code": row.account_type_code,
                "account_type_name": row.account_type_name,
                "account_nickname":  row.account_nickname,
                "sells":             [],
                "total_proceeds":    0.0,
                "total_acb":         0.0,
                "total_realized_gl": 0.0,
            }

        acct = bk["accounts"][acct_key]
        gl   = float(row.realized_gl)
        proc = float(row.proceeds)
        acb  = float(row.acb_total)

        acct["sells"].append({
            "id":            str(row.id),
            "symbol":        row.symbol,
            "trade_date":    str(row.trade_date),
            "quantity_sold": float(row.quantity_sold),
            "proceeds":      proc,
            "acb_per_share": float(row.acb_per_share),
            "acb_total":     acb,
            "realized_gl":   gl,
            "currency":      row.currency,
        })

        # Roll up totals
        acct["total_proceeds"]    += proc
        acct["total_acb"]         += acb
        acct["total_realized_gl"] += gl
        bk["total_proceeds"]      += proc
        bk["total_acb"]           += acb
        bk["total_realized_gl"]   += gl
        m["total_proceeds"]       += proc
        m["total_acb"]            += acb
        m["total_realized_gl"]    += gl

    # Attach consolidated view to each member
    for row in consolidated_rows:
        mid = str(row.member_id)
        if mid in members_map:
            members_map[mid]["consolidated"].append({
                "symbol":              row.symbol,
                "currency":            row.currency,
                "total_quantity_sold": float(row.total_quantity_sold),
                "total_proceeds":      float(row.total_proceeds),
                "total_acb":           float(row.total_acb),
                "total_realized_gl":   float(row.total_realized_gl),
                "sell_count":          row.sell_count,
            })

    # Convert broker/account dicts to lists for JSON response
    result = []
    for m in members_map.values():
        brokers_list = []
        for bk in m["brokers"].values():
            accounts_list = list(bk["accounts"].values())
            brokers_list.append({**bk, "accounts": accounts_list})
        result.append({**m, "brokers": brokers_list})

    return {
        "tax_year": tax_year,
        "members":  result,
    }
