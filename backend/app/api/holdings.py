from fastapi import APIRouter, Depends, Query, BackgroundTasks
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
    Get holdings aggregated by symbol across all filtered accounts.

    Aggregation rules:
    - Fetch ALL holdings rows (open + closed) for filtered accounts
    - Group by symbol
    - qty / acb / unrealized → from open rows only
    - realized → from ALL rows (open + closed)
    - Symbol is open if aggregated qty > 0
    - holding_pct = symbol_market_value / total_portfolio_market_value
    - All % figures calculated from aggregated numbers, never from stored DB %
    """
    owner_id = str(current_user.id)

    member_id_list = [m.strip() for m in member_ids.split(",")] if member_ids else []
    account_type_list = [a.strip() for a in account_types.split(",")] if account_types else []
    broker_list = [b.strip() for b in brokers.split(",")] if brokers else []

    where_clauses = ["m.owner_id = :owner_id"]
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

    # Fetch ALL rows — open AND closed — for filtered accounts
    rows = db.execute(
        text(f"""
            SELECT
                h.id,
                h.symbol,
                h.asset_type,
                h.is_position_open,
                h.quantity_total,
                h.quantity_free,
                h.quantity_pledged,
                h.acb_per_share,
                h.total_acb,
                h.currency,
                h.realized_gain_loss,
                h.total_proceeds,
                h.total_cost_sold,
                h.current_price,
                h.previous_close,
                h.day_change,
                h.day_change_pct,
                h.market_value,
                h.unrealized_gain_loss,
                h.unrealized_gain_loss_pct,
                h.price_updated_at,
                h.last_calculated_at,

                ma.id                   AS account_id,
                ma.account_type_code,
                ma.nickname             AS account_nickname,
                ma.broker_code,

                m.id                    AS member_id,
                m.display_name          AS member_name,

                b.name                  AS broker_name,
                at.name                 AS account_type_name,
                at.tax_category

            FROM holdings h
            JOIN member_accounts ma ON h.account_id = ma.id
            JOIN members m ON ma.member_id = m.id
            JOIN brokers b ON ma.broker_code = b.code
            JOIN account_types at ON ma.account_type_code = at.code
            WHERE {where_sql}
            ORDER BY h.symbol, h.is_position_open DESC
        """),
        params
    ).fetchall()

    # ── Aggregate by symbol ───────────────────────────────────
    symbol_map = {}

    for row in rows:
        sym = row.symbol
        if sym not in symbol_map:
            symbol_map[sym] = {
                'symbol': sym,
                'asset_type': row.asset_type,
                'currency': row.currency,
                # Open position aggregates
                'qty': 0.0,
                'total_acb': 0.0,
                'market_value': None,
                'unrealized_gl': None,
                'current_price': row.current_price,
                'day_change': row.day_change,
                'day_change_pct': row.day_change_pct,
                # Realized — from ALL rows
                'realized_gl': 0.0,
                'total_cost_sold': 0.0,
                # Breakdowns for expand view
                'breakdowns': []
            }

        s = symbol_map[sym]

        # Realized accumulates from ALL rows (open + closed)
        s['realized_gl'] += float(row.realized_gain_loss or 0)
        s['total_cost_sold'] += float(row.total_cost_sold or 0)

        # Open position fields — only from open rows
        if row.is_position_open:
            s['qty'] += float(row.quantity_total or 0)
            s['total_acb'] += float(row.total_acb or 0)

            if row.market_value is not None:
                s['market_value'] = (s['market_value'] or 0) + float(row.market_value)

            if row.unrealized_gain_loss is not None:
                s['unrealized_gl'] = (s['unrealized_gl'] or 0) + float(row.unrealized_gain_loss)

            # Use latest price found
            if row.current_price is not None and s['current_price'] is None:
                s['current_price'] = float(row.current_price)
                s['day_change'] = float(row.day_change) if row.day_change else None
                s['day_change_pct'] = float(row.day_change_pct) if row.day_change_pct else None

        # Per-account breakdown
        s['breakdowns'].append({
            'account_id': str(row.account_id),
            'member_name': row.member_name,
            'account_nickname': row.account_nickname,
            'account_type_code': row.account_type_code,
            'account_type_name': row.account_type_name,
            'broker_name': row.broker_name,
            'tax_category': row.tax_category,
            'is_position_open': row.is_position_open,
            'quantity_total': float(row.quantity_total or 0),
            'acb_per_share': float(row.acb_per_share or 0),
            'total_acb': float(row.total_acb or 0),
            'market_value': float(row.market_value) if row.market_value else None,
            'unrealized_gl': float(row.unrealized_gain_loss) if row.unrealized_gain_loss else None,
            'unrealized_gl_pct': float(row.unrealized_gain_loss_pct) if row.unrealized_gain_loss_pct else None,
            'realized_gl': float(row.realized_gain_loss or 0),
            'total_cost_sold': float(row.total_cost_sold or 0),
        })

    # ── Post-process each symbol ──────────────────────────────
    symbols = list(symbol_map.values())

    # Total portfolio market value — denominator for holding %
    # Only symbols that have a current price contribute
    total_portfolio_mv = sum(
        s['market_value'] for s in symbols
        if s['market_value'] is not None and s['qty'] > 0
    )

    result_open = []
    result_closed = []

    for s in symbols:
        qty = s['qty']
        total_acb = s['total_acb']
        is_open = qty > 0

        # ACB per share — weighted average from aggregated numbers
        acb_per_share = total_acb / qty if qty > 0 else 0

        # Unrealized % — recalculated from aggregated numbers
        unrealized_gl = s['unrealized_gl']
        unrealized_gl_pct = None
        if unrealized_gl is not None and total_acb > 0:
            unrealized_gl_pct = round((unrealized_gl / total_acb) * 100, 4)

        # Realized % — recalculated from aggregated cost_sold
        realized_gl = s['realized_gl']
        realized_gl_pct = None
        total_cost_sold = s['total_cost_sold']
        if realized_gl and total_cost_sold > 0:
            realized_gl_pct = round((realized_gl / total_cost_sold) * 100, 4)

        # Holding % — only if we have market value and total is non-zero
        holding_pct = None
        if s['market_value'] is not None and total_portfolio_mv > 0 and is_open:
            holding_pct = round((s['market_value'] / total_portfolio_mv) * 100, 2)

        # Sort breakdowns — open accounts first, then by ACB desc
        s['breakdowns'].sort(
            key=lambda b: (not b['is_position_open'], -b['total_acb'])
        )

        symbol_data = {
            'symbol': s['symbol'],
            'asset_type': s['asset_type'],
            'currency': s['currency'],
            'is_open': is_open,
            # Open position fields
            'quantity_total': round(qty, 8) if is_open else 0,
            'acb_per_share': round(acb_per_share, 6) if is_open else None,
            'total_acb': round(total_acb, 2) if is_open else None,
            'current_price': s['current_price'],
            'day_change': s['day_change'],
            'day_change_pct': s['day_change_pct'],
            'market_value': round(s['market_value'], 2) if s['market_value'] else None,
            'unrealized_gl': round(unrealized_gl, 2) if unrealized_gl is not None else None,
            'unrealized_gl_pct': unrealized_gl_pct,
            'holding_pct': holding_pct,
            # Realized — always present
            'realized_gl': round(realized_gl, 2),
            'realized_gl_pct': realized_gl_pct,
            'total_cost_sold': round(total_cost_sold, 2),
            # Breakdowns
            'breakdowns': s['breakdowns'],
        }

        if is_open:
            result_open.append(symbol_data)
        else:
            result_closed.append(symbol_data)

    # Sort open — by market value desc (or ACB if no price)
    result_open.sort(
        key=lambda s: s['market_value'] if s['market_value'] else s['total_acb'] or 0,
        reverse=True
    )
    # Sort closed — by realized G/L desc
    result_closed.sort(key=lambda s: s['realized_gl'], reverse=True)

    return {
        'open_positions': result_open,
        'closed_positions': result_closed,
        'total_open': len(result_open),
        'total_closed': len(result_closed),
        'summary': {
            'total_market_value': round(total_portfolio_mv, 2) if total_portfolio_mv else None,
            'total_invested': round(sum(s['total_acb'] for s in result_open if s['total_acb']), 2),
            'total_unrealized_gl': round(
                sum(s['unrealized_gl'] for s in result_open if s['unrealized_gl'] is not None), 2
            ) if any(s['unrealized_gl'] is not None for s in result_open) else None,
            'total_unrealized_gl_pct': round(
                sum(s['unrealized_gl'] for s in result_open if s['unrealized_gl'] is not None)
                / sum(s['total_acb'] for s in result_open if s['total_acb']) * 100, 2
            ) if any(s['unrealized_gl'] is not None for s in result_open)
            and sum(s['total_acb'] for s in result_open if s['total_acb']) > 0 else None,
            'total_daily_gl': round(
                sum(float(s['day_change']) * s['quantity_total'] for s in result_open
                    if s['day_change'] is not None and s['quantity_total'] > 0), 2
            ) if any(s['day_change'] is not None for s in result_open) else None,
            'total_daily_gl_pct': (lambda dgl: round(
                dgl / (total_portfolio_mv - dgl) * 100, 2
            ) if total_portfolio_mv and (total_portfolio_mv - dgl) != 0 else None)(
                sum(float(s['day_change']) * s['quantity_total'] for s in result_open
                    if s['day_change'] is not None and s['quantity_total'] > 0)
            ) if any(s['day_change'] is not None for s in result_open) else None,
            'has_prices': any(s['current_price'] is not None for s in result_open),
        }
    }


@router.post("/refresh-prices")
async def refresh_prices(
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_db_user)
):
    """
    Manually trigger a price refresh for all symbols.
    Runs in background — returns immediately.
    """
    from app.services.price_service import refresh_prices

    def _run(db_session):
        try:
            refresh_prices(db_session)
        finally:
            db_session.close()

    from app.core.database import SessionLocal
    bg_db = SessionLocal()
    background_tasks.add_task(_run, bg_db)

    return {"status": "refreshing", "message": "Price refresh started in background"}
