import logging
from sqlalchemy.orm import Session
from sqlalchemy import text
from decimal import Decimal

logger = logging.getLogger(__name__)

ZERO = Decimal('0')
TINY = Decimal('0.00000001')


# ============================================================
# HOLDINGS RECALCULATION
# ============================================================

def recalculate_holdings_for_accounts(db: Session, account_ids: list[str]):
    """
    Entry point — recalculate holdings and cash balances for a list of accounts.
    Called after every import.
    """
    for account_id in account_ids:
        recalculate_holdings(db, account_id)
        recalculate_cash_balances(db, account_id)


def recalculate_holdings(db: Session, account_id: str):
    """
    Recalculate all holdings for one account from scratch.
    Uses executemany for bulk upsert — one DB round trip for all symbols.
    """
    transactions = db.execute(
        text("""
            SELECT
                id, transaction_type, trade_date,
                symbol_normalized, asset_type,
                quantity, price_per_unit,
                net_amount, net_amount_cad,
                trade_currency, commission,
                fx_rate_to_cad, description, notes
            FROM transactions
            WHERE account_id = :account_id
            AND transaction_type IN (
                'BUY', 'SELL', 'STOCK_SPLIT',
                'RETURN_OF_CAPITAL', 'NORBERT_GAMBIT'
            )
            AND symbol_normalized IS NOT NULL
            AND quantity IS NOT NULL
            ORDER BY trade_date ASC, created_at ASC,
            CASE transaction_type
                WHEN 'BUY'              THEN 0
                WHEN 'STOCK_SPLIT'      THEN 1
                WHEN 'RETURN_OF_CAPITAL' THEN 2
                WHEN 'SELL'             THEN 3
                ELSE 4
            END ASC
        """),
        {'account_id': account_id}
    ).fetchall()

    holdings_calc: dict[str, dict] = {}

    for txn in transactions:
        symbol   = txn.symbol_normalized
        qty      = Decimal(str(txn.quantity or 0))
        currency = txn.trade_currency or 'USD'

        if symbol not in holdings_calc:
            holdings_calc[symbol] = {
                'qty': ZERO, 'total_acb': ZERO, 'acb_per_share': ZERO,
                'currency': currency, 'asset_type': txn.asset_type or 'STOCK',
                'realized_gain_loss': ZERO, 'total_proceeds': ZERO,
                'total_cost_sold': ZERO, 'is_open': False
            }

        h = holdings_calc[symbol]

        if txn.transaction_type == 'BUY':
            cost = abs(Decimal(str(txn.net_amount or 0)))
            h['qty'] += qty
            h['total_acb'] += cost
            if h['qty'] > TINY:
                h['acb_per_share'] = h['total_acb'] / h['qty']
            h['is_open'] = True

        elif txn.transaction_type == 'SELL':
            if h['qty'] > TINY:
                acb_per_share = h['acb_per_share']
                sell_qty      = min(abs(qty), h['qty'])
                proceeds      = Decimal(str(txn.net_amount or 0))
                cost_basis    = acb_per_share * sell_qty
                gain          = proceeds - cost_basis

                h['realized_gain_loss'] += gain
                h['total_proceeds']     += proceeds
                h['total_cost_sold']    += cost_basis
                h['total_acb']          -= cost_basis
                h['qty']                -= sell_qty

                if h['qty'] <= TINY:
                    h['qty']       = ZERO
                    h['total_acb'] = ZERO
                    h['is_open']   = False

        elif txn.transaction_type == 'RETURN_OF_CAPITAL':
            if h['qty'] > TINY:
                roc_total = abs(Decimal(str(txn.net_amount or 0)))
                h['total_acb']     = max(ZERO, h['total_acb'] - roc_total)
                h['acb_per_share'] = h['total_acb'] / h['qty']

        elif txn.transaction_type == 'STOCK_SPLIT':
            if h['qty'] > TINY and qty > TINY:
                h['qty']           = qty
                h['acb_per_share'] = h['total_acb'] / h['qty']

        elif txn.transaction_type == 'NORBERT_GAMBIT':
            pass

    # Pledged quantities from open CALL options
    pledged_rows = db.execute(
        text("""
            SELECT underlying_symbol, COALESCE(SUM(shares_pledged), 0) as pledged
            FROM option_contracts
            WHERE account_id = :account_id
            AND status = 'OPEN'
            AND contract_type = 'CALL'
            GROUP BY underlying_symbol
        """),
        {'account_id': account_id}
    ).fetchall()
    pledged_map = {row.underlying_symbol: Decimal(str(row.pledged)) for row in pledged_rows}

    # ── Bulk upsert all holdings in one executemany call ─────
    upsert_rows = []
    for symbol, data in holdings_calc.items():
        qty          = data['qty']
        total_acb    = data['total_acb']
        acb_per_share = data['acb_per_share']
        qty_pledged  = pledged_map.get(symbol, ZERO)
        qty_free     = max(ZERO, qty - qty_pledged)

        upsert_rows.append({
            'account_id':    account_id,
            'symbol':        symbol,
            'asset_type':    data['asset_type'],
            'is_open':       data['is_open'],
            'qty_total':     str(qty),
            'qty_free':      str(qty_free),
            'qty_pledged':   str(qty_pledged),
            'acb_per_share': str(acb_per_share),
            'total_acb':     str(total_acb),
            'currency':      data['currency'],
            'realized_gl':   str(data['realized_gain_loss']),
            'total_proceeds': str(data['total_proceeds']),
            'total_cost_sold': str(data['total_cost_sold']),
        })

    db.execute(
        text("DELETE FROM holdings WHERE account_id = :account_id"),
        {'account_id': account_id}
    )

    if upsert_rows:
        db.execute(
            text("""
                INSERT INTO holdings (
                    account_id, symbol, asset_type,
                    is_position_open,
                    quantity_total, quantity_free, quantity_pledged,
                    acb_per_share, total_acb, currency,
                    realized_gain_loss, total_proceeds, total_cost_sold,
                    last_calculated_at
                ) VALUES (
                    :account_id, :symbol, :asset_type,
                    :is_open,
                    :qty_total, :qty_free, :qty_pledged,
                    :acb_per_share, :total_acb, :currency,
                    :realized_gl, :total_proceeds, :total_cost_sold,
                    NOW()
                )
                ON CONFLICT (account_id, symbol) DO UPDATE SET
                    asset_type           = EXCLUDED.asset_type,
                    is_position_open     = EXCLUDED.is_position_open,
                    quantity_total       = EXCLUDED.quantity_total,
                    quantity_free        = EXCLUDED.quantity_free,
                    quantity_pledged     = EXCLUDED.quantity_pledged,
                    acb_per_share        = EXCLUDED.acb_per_share,
                    total_acb            = EXCLUDED.total_acb,
                    currency             = EXCLUDED.currency,
                    realized_gain_loss   = EXCLUDED.realized_gain_loss,
                    total_proceeds       = EXCLUDED.total_proceeds,
                    total_cost_sold      = EXCLUDED.total_cost_sold,
                    last_calculated_at   = NOW(),
                    updated_at           = NOW()
            """),
            upsert_rows  # executemany
        )

    db.commit()


def recalculate_cash_balances(db: Session, account_id: str):
    """
    Recalculate cash balances for one account.
    Uses executemany for bulk upsert.
    """
    transactions = db.execute(
        text("""
            SELECT transaction_type, net_amount_cad, trade_currency, net_amount
            FROM transactions
            WHERE account_id = :account_id
            ORDER BY trade_date ASC, created_at ASC,
            CASE transaction_type
                WHEN 'BUY'              THEN 0
                WHEN 'STOCK_SPLIT'      THEN 1
                WHEN 'RETURN_OF_CAPITAL' THEN 2
                WHEN 'SELL'             THEN 3
                ELSE 4
            END ASC
        """),
        {'account_id': account_id}
    ).fetchall()

    balances: dict[str, Decimal] = {}
    cash_locked_cad = ZERO

    for txn in transactions:
        currency   = txn.trade_currency or 'CAD'
        amount_cad = Decimal(str(txn.net_amount_cad or 0))
        amount_orig = Decimal(str(txn.net_amount or 0))
        txn_type   = txn.transaction_type

        if txn_type in ('DEPOSIT', 'WITHDRAWAL', 'INTEREST', 'DIVIDEND',
                        'FEE', 'INTERNAL_TRANSFER', 'RETURN_OF_CAPITAL'):
            balances['CAD'] = balances.get('CAD', ZERO) + amount_cad

        elif txn_type in ('BUY', 'SELL'):
            if currency == 'CAD':
                balances['CAD'] = balances.get('CAD', ZERO) + amount_cad
            else:
                balances[currency] = balances.get(currency, ZERO) + amount_orig
                balances['CAD']    = balances.get('CAD', ZERO) + amount_cad

        elif txn_type == 'FX_CONVERSION':
            balances[currency] = balances.get(currency, ZERO) + amount_orig
            balances['CAD']    = balances.get('CAD', ZERO) + amount_cad

    # ── Bulk upsert cash balances ─────────────────────────────
    upsert_rows = []
    for currency, balance in balances.items():
        if currency in ('GBP', 'EUR', 'INR'):
            continue
        locked_amount = cash_locked_cad if currency == 'CAD' else ZERO
        upsert_rows.append({
            'account_id': account_id,
            'currency':   currency,
            'total':      str(balance),
            'locked':     str(locked_amount),
        })

    db.execute(
        text("DELETE FROM cash_balances WHERE account_id = :account_id"),
        {'account_id': account_id}
    )

    if upsert_rows:
        db.execute(
            text("""
                INSERT INTO cash_balances (
                    account_id, currency,
                    balance_total, balance_locked,
                    last_updated_at
                ) VALUES (
                    :account_id, :currency,
                    :total, :locked,
                    NOW()
                )
                ON CONFLICT (account_id, currency) DO UPDATE SET
                    balance_total   = EXCLUDED.balance_total,
                    balance_locked  = EXCLUDED.balance_locked,
                    last_updated_at = NOW(),
                    updated_at      = NOW()
            """),
            upsert_rows  # executemany
        )

    db.commit()


def update_unrealized_gains(db: Session):
    """
    Called by price scheduler — updates unrealized G/L for all open positions.
    """
    db.execute(
        text("""
            UPDATE holdings h
            SET
                current_price            = pc.price,
                unrealized_gain_loss     = ROUND(
                    (pc.price - h.acb_per_share) * h.quantity_total, 2
                ),
                unrealized_gain_loss_pct = CASE
                    WHEN h.total_acb > 0
                    THEN ROUND(
                        ((pc.price * h.quantity_total - h.total_acb) / h.total_acb) * 100, 4
                    )
                    ELSE NULL
                END,
                price_updated_at = NOW(),
                updated_at       = NOW()
            FROM price_cache pc
            WHERE pc.symbol   = h.symbol
            AND   pc.currency = h.currency
            AND   h.is_position_open = TRUE
            AND   h.quantity_total   > 0
        """)
    )
    db.execute(
        text("""
            UPDATE holdings h
            SET
                current_price            = NULL,
                unrealized_gain_loss     = NULL,
                unrealized_gain_loss_pct = NULL,
                updated_at               = NOW()
            WHERE h.is_position_open = TRUE
            AND NOT EXISTS (
                SELECT 1 FROM price_cache pc
                WHERE pc.symbol   = h.symbol
                AND   pc.currency = h.currency
            )
        """)
    )
    db.commit()


# ============================================================
# REALIZED GAINS RECALCULATION
# ============================================================

def recalculate_realized_gains(
    db: Session,
    account_ids: list[str],
    member_ids: list[str],
):
    """
    Entry point — recalculate realized gains for affected accounts and members.
    Pass 1: per account per sell → realized_gains (broker view)
    Pass 2: per member cross-broker → realized_gains_consolidated (CPA view)
    """
    for account_id in account_ids:
        _recalculate_realized_gains_for_account(db, account_id)

    for member_id in member_ids:
        _recalculate_consolidated_for_member(db, member_id)


def _recalculate_realized_gains_for_account(db: Session, account_id: str):
    """
    Replay BUY/SELL for one account → insert one row per SELL into realized_gains.
    Only runs for TAXABLE accounts.
    Uses bulk INSERT (executemany) — one DB round trip.
    """
    account = db.execute(
        text("""
            SELECT ma.id, at.tax_category
            FROM member_accounts ma
            JOIN account_types at ON ma.account_type_code = at.code
            WHERE ma.id = :account_id
        """),
        {'account_id': account_id}
    ).fetchone()

    if not account or account.tax_category != 'TAXABLE':
        return

    # Wipe and rebuild for this account
    db.execute(
        text("DELETE FROM realized_gains WHERE account_id = :account_id"),
        {'account_id': account_id}
    )

    transactions = db.execute(
        text("""
            SELECT id, transaction_type, trade_date,
                   symbol_normalized, quantity,
                   net_amount, trade_currency
            FROM transactions
            WHERE account_id = :account_id
            AND transaction_type IN ('BUY', 'SELL', 'STOCK_SPLIT', 'RETURN_OF_CAPITAL')
            AND symbol_normalized IS NOT NULL
            AND quantity IS NOT NULL
            ORDER BY trade_date ASC, created_at ASC,
            CASE transaction_type
                WHEN 'BUY'              THEN 0
                WHEN 'STOCK_SPLIT'      THEN 1
                WHEN 'RETURN_OF_CAPITAL' THEN 2
                WHEN 'SELL'             THEN 3
                ELSE 4
            END ASC
        """),
        {'account_id': account_id}
    ).fetchall()

    acb_state: dict[str, dict] = {}
    gains_to_insert = []

    for txn in transactions:
        symbol   = txn.symbol_normalized
        qty      = Decimal(str(txn.quantity or 0))
        currency = txn.trade_currency or 'CAD'

        if symbol not in acb_state:
            acb_state[symbol] = {
                'qty': ZERO, 'total_acb': ZERO,
                'acb_per_share': ZERO, 'currency': currency
            }

        s = acb_state[symbol]

        if txn.transaction_type == 'BUY':
            cost = abs(Decimal(str(txn.net_amount or 0)))
            s['qty']         += qty
            s['total_acb']   += cost
            if s['qty'] > TINY:
                s['acb_per_share'] = s['total_acb'] / s['qty']

        elif txn.transaction_type == 'SELL':
            if s['qty'] > TINY:
                sell_qty      = min(abs(qty), s['qty'])
                acb_per_share = s['acb_per_share']
                proceeds      = Decimal(str(txn.net_amount or 0))
                acb_total     = acb_per_share * sell_qty
                realized_gl   = proceeds - acb_total

                gains_to_insert.append({
                    'account_id':    account_id,
                    'transaction_id': str(txn.id),
                    'symbol':        symbol,
                    'trade_date':    txn.trade_date,
                    'tax_year':      txn.trade_date.year,
                    'quantity_sold': str(sell_qty),
                    'proceeds':      str(proceeds),
                    'acb_per_share': str(acb_per_share),
                    'acb_total':     str(acb_total),
                    'realized_gl':   str(realized_gl),
                    'currency':      s['currency'],
                })

                s['total_acb'] -= acb_total
                s['qty']       -= sell_qty
                if s['qty'] <= TINY:
                    s['qty']       = ZERO
                    s['total_acb'] = ZERO

        elif txn.transaction_type == 'RETURN_OF_CAPITAL':
            if s['qty'] > TINY:
                roc = abs(Decimal(str(txn.net_amount or 0)))
                s['total_acb']     = max(ZERO, s['total_acb'] - roc)
                s['acb_per_share'] = s['total_acb'] / s['qty']

        elif txn.transaction_type == 'STOCK_SPLIT':
            if s['qty'] > TINY and qty > TINY:
                s['qty']           = qty
                s['acb_per_share'] = s['total_acb'] / s['qty']

    # ── Bulk INSERT all sell events ───────────────────────────
    if gains_to_insert:
        db.execute(
            text("""
                INSERT INTO realized_gains (
                    account_id, transaction_id, symbol,
                    trade_date, tax_year,
                    quantity_sold, proceeds,
                    acb_per_share, acb_total,
                    realized_gl, currency
                ) VALUES (
                    :account_id, :transaction_id, :symbol,
                    :trade_date, :tax_year,
                    :quantity_sold, :proceeds,
                    :acb_per_share, :acb_total,
                    :realized_gl, :currency
                )
            """),
            gains_to_insert  # executemany
        )

    db.commit()
    logger.info(
        f"Realized gains: {len(gains_to_insert)} sell events for account {account_id}"
    )


def _recalculate_consolidated_for_member(db: Session, member_id: str):
    """
    CPA view — cross-broker weighted avg ACB per member per symbol per tax year.
    Replays ALL BUY/SELL across ALL taxable accounts for this member chronologically.
    Uses bulk upsert (executemany) — one DB round trip.
    """
    db.execute(
        text("DELETE FROM realized_gains_consolidated WHERE member_id = :member_id"),
        {'member_id': member_id}
    )

    transactions = db.execute(
        text("""
            SELECT
                t.id, t.transaction_type, t.trade_date,
                t.symbol_normalized, t.quantity,
                t.net_amount, t.trade_currency
            FROM transactions t
            JOIN member_accounts ma ON t.account_id = ma.id
            JOIN account_types at   ON ma.account_type_code = at.code
            WHERE ma.member_id = :member_id
            AND at.tax_category = 'TAXABLE'
            AND t.transaction_type IN ('BUY', 'SELL', 'STOCK_SPLIT', 'RETURN_OF_CAPITAL')
            AND t.symbol_normalized IS NOT NULL
            AND t.quantity IS NOT NULL
            ORDER BY t.trade_date ASC, t.created_at ASC
        """),
        {'member_id': member_id}
    ).fetchall()

    acb_state: dict[str, dict] = {}
    consolidated: dict[tuple, dict] = {}

    for txn in transactions:
        symbol   = txn.symbol_normalized
        qty      = Decimal(str(txn.quantity or 0))
        currency = txn.trade_currency or 'CAD'

        if symbol not in acb_state:
            acb_state[symbol] = {
                'qty': ZERO, 'total_acb': ZERO,
                'acb_per_share': ZERO, 'currency': currency
            }

        s = acb_state[symbol]

        if txn.transaction_type == 'BUY':
            cost = abs(Decimal(str(txn.net_amount or 0)))
            s['qty']         += qty
            s['total_acb']   += cost
            if s['qty'] > TINY:
                s['acb_per_share'] = s['total_acb'] / s['qty']

        elif txn.transaction_type == 'SELL':
            if s['qty'] > TINY:
                sell_qty    = min(abs(qty), s['qty'])
                proceeds    = Decimal(str(txn.net_amount or 0))
                acb_total   = s['acb_per_share'] * sell_qty
                realized_gl = proceeds - acb_total

                key = (txn.trade_date.year, symbol)
                if key not in consolidated:
                    consolidated[key] = {
                        'tax_year': txn.trade_date.year,
                        'symbol':   symbol,
                        'currency': s['currency'],
                        'total_quantity_sold': ZERO,
                        'total_proceeds':      ZERO,
                        'total_acb':           ZERO,
                        'total_realized_gl':   ZERO,
                        'sell_count':          0,
                    }

                c = consolidated[key]
                c['total_quantity_sold'] += sell_qty
                c['total_proceeds']      += proceeds
                c['total_acb']           += acb_total
                c['total_realized_gl']   += realized_gl
                c['sell_count']          += 1

                s['total_acb'] -= acb_total
                s['qty']       -= sell_qty
                if s['qty'] <= TINY:
                    s['qty']       = ZERO
                    s['total_acb'] = ZERO

        elif txn.transaction_type == 'RETURN_OF_CAPITAL':
            if s['qty'] > TINY:
                roc = abs(Decimal(str(txn.net_amount or 0)))
                s['total_acb']     = max(ZERO, s['total_acb'] - roc)
                s['acb_per_share'] = s['total_acb'] / s['qty']

        elif txn.transaction_type == 'STOCK_SPLIT':
            if s['qty'] > TINY and qty > TINY:
                s['qty']           = qty
                s['acb_per_share'] = s['total_acb'] / s['qty']

    # ── Bulk upsert consolidated rows ─────────────────────────
    upsert_rows = [
        {
            'member_id':   member_id,
            'tax_year':    c['tax_year'],
            'symbol':      c['symbol'],
            'currency':    c['currency'],
            'total_qty':   str(c['total_quantity_sold']),
            'total_proceeds': str(c['total_proceeds']),
            'total_acb':   str(c['total_acb']),
            'total_gl':    str(c['total_realized_gl']),
            'sell_count':  c['sell_count'],
        }
        for c in consolidated.values()
    ]

    if upsert_rows:
        db.execute(
            text("""
                INSERT INTO realized_gains_consolidated (
                    member_id, tax_year, symbol, currency,
                    total_quantity_sold, total_proceeds,
                    total_acb, total_realized_gl, sell_count
                ) VALUES (
                    :member_id, :tax_year, :symbol, :currency,
                    :total_qty, :total_proceeds,
                    :total_acb, :total_gl, :sell_count
                )
                ON CONFLICT (member_id, tax_year, symbol) DO UPDATE SET
                    total_quantity_sold = EXCLUDED.total_quantity_sold,
                    total_proceeds      = EXCLUDED.total_proceeds,
                    total_acb           = EXCLUDED.total_acb,
                    total_realized_gl   = EXCLUDED.total_realized_gl,
                    sell_count          = EXCLUDED.sell_count,
                    updated_at          = NOW()
            """),
            upsert_rows  # executemany
        )

    db.commit()
    logger.info(
        f"Consolidated realized gains: {len(upsert_rows)} symbol-year records for member {member_id}"
    )
