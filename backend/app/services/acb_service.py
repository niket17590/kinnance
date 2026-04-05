from sqlalchemy.orm import Session
from sqlalchemy import text
from decimal import Decimal, ROUND_HALF_UP


ZERO = Decimal('0')
TINY = Decimal('0.00000001')  # threshold for zero quantity check


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
    Recalculate all holdings for an account from scratch.

    Rules:
    - One row per account+symbol — never deleted, just updated
    - BUY: increases quantity, recalculates ACB per share, commission included in cost
    - SELL: reduces quantity, accumulates realized G/L, ACB per share unchanged
    - Full SELL: quantity=0, is_position_open=FALSE, acb_per_share kept for reference
    - New BUY after close: reopens position, realized G/L keeps accumulating
    - RETURN_OF_CAPITAL: reduces ACB
    - STOCK_SPLIT: adjusts quantity and ACB per share
    - Commission always included in ACB cost basis (CRA requirement)
    """
    # Fetch all relevant transactions ordered by date ASC
    transactions = db.execute(
        text("""
            SELECT
                id,
                transaction_type,
                trade_date,
                symbol_normalized,
                asset_type,
                quantity,
                price_per_unit,
                net_amount,
                net_amount_cad,
                trade_currency,
                commission,
                fx_rate_to_cad,
                description
            FROM transactions
            WHERE account_id = :account_id
            AND transaction_type IN (
                'BUY', 'SELL', 'STOCK_SPLIT',
                'RETURN_OF_CAPITAL', 'CORPORATE_ACTION',
                'NORBERT_GAMBIT'
            )
            AND symbol_normalized IS NOT NULL
            AND quantity IS NOT NULL
            ORDER BY trade_date ASC, created_at ASC
        """),
        {'account_id': account_id}
    ).fetchall()

    # holdings_calc[symbol] = {
    #   qty, total_acb, acb_per_share,
    #   currency, asset_type,
    #   realized_gain_loss, total_proceeds, total_cost_sold,
    #   is_open
    # }
    holdings_calc = {}

    for txn in transactions:
        symbol = txn.symbol_normalized
        qty = Decimal(str(txn.quantity or 0))
        commission = Decimal(str(txn.commission or 0))
        currency = txn.trade_currency or 'USD'

        if symbol not in holdings_calc:
            holdings_calc[symbol] = {
                'qty': ZERO,
                'total_acb': ZERO,
                'acb_per_share': ZERO,
                'currency': currency,
                'asset_type': txn.asset_type or 'STOCK',
                'realized_gain_loss': ZERO,
                'total_proceeds': ZERO,
                'total_cost_sold': ZERO,
                'is_open': False
            }

        h = holdings_calc[symbol]

        if txn.transaction_type == 'BUY':
            # Cost = absolute net amount + commission (both in trade currency)
            # net_amount is negative for buys, so take abs
            cost = abs(Decimal(str(txn.net_amount or 0)))
            # Commission is already included in net_amount from most brokers
            # but we add it explicitly if it's tracked separately
            # To avoid double-counting: use net_amount which already includes commission
            # net_amount = -(quantity * price + commission) for buys
            h['qty'] += qty
            h['total_acb'] += cost
            if h['qty'] > TINY:
                h['acb_per_share'] = h['total_acb'] / h['qty']
            h['is_open'] = True

        elif txn.transaction_type == 'SELL':
            if h['qty'] > TINY:
                # ACB per share does NOT change on sell
                acb_per_share = h['acb_per_share']
                sell_qty = min(abs(qty), h['qty'])

                # Proceeds = net_amount (positive for sells, already nets commission)
                proceeds = Decimal(str(txn.net_amount or 0))
                cost_basis = acb_per_share * sell_qty

                # Realized G/L for this sell
                gain = proceeds - cost_basis

                # Accumulate
                h['realized_gain_loss'] += gain
                h['total_proceeds'] += proceeds
                h['total_cost_sold'] += cost_basis

                # Reduce ACB and quantity
                h['total_acb'] -= cost_basis
                h['qty'] -= sell_qty

                # Check if fully closed
                if h['qty'] <= TINY:
                    h['qty'] = ZERO
                    h['total_acb'] = ZERO
                    h['is_open'] = False
                    # acb_per_share kept as last known value for reference

        elif txn.transaction_type == 'RETURN_OF_CAPITAL':
            # ROC reduces ACB — amount per share x current quantity
            if h['qty'] > TINY:
                roc_total = abs(Decimal(str(txn.net_amount or 0)))
                h['total_acb'] = max(ZERO, h['total_acb'] - roc_total)
                h['acb_per_share'] = h['total_acb'] / h['qty']

        elif txn.transaction_type == 'STOCK_SPLIT':
            # qty = new total quantity post-split
            if h['qty'] > TINY and qty > TINY:
                h['qty'] = qty
                h['acb_per_share'] = h['total_acb'] / h['qty']

        elif txn.transaction_type == 'CORPORATE_ACTION':
            # Name change — zero out old symbol
            # New symbol will have its own transactions
            if h['qty'] > TINY:
                h['qty'] = ZERO
                h['total_acb'] = ZERO
                h['is_open'] = False

        elif txn.transaction_type == 'NORBERT_GAMBIT':
            # Treat as FX conversion — no stock position change
            # Cash balances handled by recalculate_cash_balances
            pass

    # Get pledged quantities from open option contracts
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

    # Upsert holdings — never delete rows
    for symbol, data in holdings_calc.items():
        qty = data['qty']
        total_acb = data['total_acb']
        acb_per_share = data['acb_per_share']
        is_open = data['is_open']

        qty_pledged = pledged_map.get(symbol, ZERO)
        qty_free = max(ZERO, qty - qty_pledged)

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
                    asset_type              = EXCLUDED.asset_type,
                    is_position_open        = EXCLUDED.is_position_open,
                    quantity_total          = EXCLUDED.quantity_total,
                    quantity_free           = EXCLUDED.quantity_free,
                    quantity_pledged        = EXCLUDED.quantity_pledged,
                    acb_per_share           = EXCLUDED.acb_per_share,
                    total_acb               = EXCLUDED.total_acb,
                    currency                = EXCLUDED.currency,
                    realized_gain_loss      = EXCLUDED.realized_gain_loss,
                    total_proceeds          = EXCLUDED.total_proceeds,
                    total_cost_sold         = EXCLUDED.total_cost_sold,
                    last_calculated_at      = NOW(),
                    updated_at              = NOW()
            """),
            {
                'account_id': account_id,
                'symbol': symbol,
                'asset_type': data['asset_type'],
                'is_open': is_open,
                'qty_total': str(qty),
                'qty_free': str(qty_free),
                'qty_pledged': str(qty_pledged),
                'acb_per_share': str(acb_per_share),
                'total_acb': str(total_acb),
                'currency': data['currency'],
                'realized_gl': str(data['realized_gain_loss']),
                'total_proceeds': str(data['total_proceeds']),
                'total_cost_sold': str(data['total_cost_sold'])
            }
        )

    db.commit()


def recalculate_cash_balances(db: Session, account_id: str):
    """
    Recalculate cash balances for an account from all transactions.

    Transaction effects on cash:
    - BUY:               net_amount (negative) → reduces cash in trade_currency
    - SELL:              net_amount (positive) → increases cash in trade_currency
    - DEPOSIT:           net_amount (positive) → increases cash
    - WITHDRAWAL:        net_amount (negative) → reduces cash
    - DIVIDEND:          net_amount (positive) → increases cash
    - INTEREST:          net_amount (positive) → increases cash
    - FEE:               net_amount (negative) → reduces cash
    - FX_CONVERSION:     net_amount in trade_currency (one CAD row, one USD row)
    - INTERNAL_TRANSFER: net_amount in trade_currency (moves between accounts)
    - NORBERT_GAMBIT:    treat as FX_CONVERSION

    STOCK_SPLIT, CORPORATE_ACTION → no cash effect
    """
    cash_transactions = db.execute(
        text("""
            SELECT
                transaction_type,
                trade_currency,
                net_amount
            FROM transactions
            WHERE account_id = :account_id
            AND transaction_type NOT IN (
                'STOCK_SPLIT', 'CORPORATE_ACTION', 'CRYPTO'
            )
            ORDER BY trade_date ASC, created_at ASC
        """),
        {'account_id': account_id}
    ).fetchall()

    # Accumulate balance per currency
    balances = {}

    for txn in cash_transactions:
        currency = txn.trade_currency or 'CAD'
        amount = Decimal(str(txn.net_amount or 0))

        if currency not in balances:
            balances[currency] = ZERO

        balances[currency] += amount

    # Get locked cash from open cash-secured puts
    locked = db.execute(
        text("""
            SELECT COALESCE(SUM(cash_locked), 0) as locked
            FROM option_contracts
            WHERE account_id = :account_id
            AND status = 'OPEN'
            AND contract_type = 'PUT'
        """),
        {'account_id': account_id}
    ).fetchone()

    cash_locked_cad = Decimal(str(locked.locked or 0))

    # Delete and reinsert
    db.execute(
        text("DELETE FROM cash_balances WHERE account_id = :account_id"),
        {'account_id': account_id}
    )

    for currency, balance in balances.items():
        if currency not in ('CAD', 'USD', 'GBP', 'EUR', 'INR'):
            continue

        locked_amount = cash_locked_cad if currency == 'CAD' else ZERO

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
            {
                'account_id': account_id,
                'currency': currency,
                'total': str(balance),
                'locked': str(locked_amount)
            }
        )

    db.commit()


def update_unrealized_gains(db: Session):
    """
    Called by the price scheduler after prices are updated.
    Updates unrealized_gain_loss and unrealized_gain_loss_pct
    for all open positions that have a price in price_cache.
    """
    db.execute(
        text("""
            UPDATE holdings h
            SET
                current_price           = pc.price,
                unrealized_gain_loss    = ROUND(
                    (pc.price - h.acb_per_share) * h.quantity_total,
                    2
                ),
                unrealized_gain_loss_pct = CASE
                    WHEN h.total_acb > 0
                    THEN ROUND(
                        ((pc.price * h.quantity_total - h.total_acb) / h.total_acb) * 100,
                        4
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

    # Clear unrealized for symbols with no price
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