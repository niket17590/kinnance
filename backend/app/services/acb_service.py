from sqlalchemy.orm import Session
from sqlalchemy import text
from decimal import Decimal


def recalculate_holdings_for_accounts(db: Session, account_ids: list[str]):
    """
    Recalculate holdings and cash balances for a list of account IDs.
    Called after every import.
    """
    for account_id in account_ids:
        recalculate_holdings(db, account_id)
        recalculate_cash_balances(db, account_id)


def recalculate_holdings(db: Session, account_id: str):
    """
    Recalculate all holdings for an account from scratch.
    Deletes existing holdings and rebuilds from transactions.

    ACB rules:
    - BUY: new ACB = (old total cost + purchase cost) / total shares
    - SELL: ACB per share stays same, realize gain/loss
    - STOCK_SPLIT: adjust qty and ACB per share proportionally
    - RETURN_OF_CAPITAL: reduce ACB per share
    - CORPORATE_ACTION: transfer ACB to new symbol
    """
    # Get all BUY/SELL/SPLIT/ROC transactions for this account
    # ordered by date ascending (oldest first for correct ACB)
    transactions = db.execute(
        text("""
            SELECT
                transaction_type, trade_date, symbol_normalized,
                asset_type, quantity, price_per_unit,
                net_amount, net_amount_cad, trade_currency,
                fx_rate_to_cad, description
            FROM transactions
            WHERE account_id = :account_id
            AND transaction_type IN (
                'BUY', 'SELL', 'STOCK_SPLIT', 'RETURN_OF_CAPITAL',
                'CORPORATE_ACTION', 'NORBERT_GAMBIT'
            )
            AND symbol_normalized IS NOT NULL
            AND quantity IS NOT NULL
            ORDER BY trade_date ASC, created_at ASC
        """),
        {'account_id': account_id}
    ).fetchall()

    # Calculate ACB per symbol
    # holdings_calc: symbol -> {qty, total_cost, currency}
    holdings_calc = {}

    for txn in transactions:
        symbol = txn.symbol_normalized
        qty = Decimal(str(txn.quantity or 0))
        currency = txn.trade_currency or 'USD'

        if symbol not in holdings_calc:
            holdings_calc[symbol] = {
                'qty': Decimal('0'),
                'total_cost': Decimal('0'),
                'currency': currency,
                'asset_type': txn.asset_type or 'STOCK'
            }

        holding = holdings_calc[symbol]

        if txn.transaction_type == 'BUY':
            # Cost = net_amount_cad (always in CAD for consistency)
            # But store in trade currency for per-share ACB
            cost = abs(Decimal(str(txn.net_amount or 0)))
            holding['qty'] += qty
            holding['total_cost'] += cost

        elif txn.transaction_type == 'SELL':
            if holding['qty'] > 0:
                # ACB per share stays same on sell
                acb_per_share = holding['total_cost'] / holding['qty'] \
                    if holding['qty'] > 0 else Decimal('0')
                sell_qty = min(qty, holding['qty'])
                holding['total_cost'] -= acb_per_share * sell_qty
                holding['qty'] -= sell_qty
                if holding['qty'] <= Decimal('0.00000001'):
                    holding['qty'] = Decimal('0')
                    holding['total_cost'] = Decimal('0')

        elif txn.transaction_type == 'STOCK_SPLIT':
            # qty here represents the ratio or new total qty
            # Description usually says "2:1 split"
            # For simplicity: treat new qty as the post-split qty
            if holding['qty'] > 0 and qty > 0:
                holding['qty'] = qty

        elif txn.transaction_type == 'RETURN_OF_CAPITAL':
            # ROC reduces ACB
            roc_per_share = abs(Decimal(str(txn.net_amount or 0)))
            if holding['qty'] > 0:
                holding['total_cost'] = max(
                    Decimal('0'),
                    holding['total_cost'] - (roc_per_share * holding['qty'])
                )

        elif txn.transaction_type == 'CORPORATE_ACTION':
            # Name change — transfer to new symbol
            if qty > 0 and holding['qty'] > 0:
                # Move cost basis to new symbol
                holdings_calc[symbol] = {
                    'qty': Decimal('0'),
                    'total_cost': Decimal('0'),
                    'currency': currency,
                    'asset_type': holding['asset_type']
                }

    # Delete existing holdings for this account
    db.execute(
        text("DELETE FROM holdings WHERE account_id = :account_id"),
        {'account_id': account_id}
    )

    # Insert recalculated holdings
    for symbol, data in holdings_calc.items():
        qty = data['qty']
        total_cost = data['total_cost']

        # Skip zero or negligible holdings
        if qty <= Decimal('0.00000001'):
            continue

        acb_per_share = total_cost / qty if qty > 0 else Decimal('0')

        # Get pledged quantity from open option contracts
        pledged = db.execute(
            text("""
                SELECT COALESCE(SUM(shares_pledged), 0) as pledged
                FROM option_contracts
                WHERE account_id = :account_id
                AND underlying_symbol = :symbol
                AND status = 'OPEN'
                AND contract_type = 'CALL'
            """),
            {'account_id': account_id, 'symbol': symbol}
        ).fetchone()

        qty_pledged = Decimal(str(pledged.pledged or 0))
        qty_free = max(Decimal('0'), qty - qty_pledged)

        db.execute(
            text("""
                INSERT INTO holdings (
                    account_id, symbol, asset_type,
                    quantity_total, quantity_free, quantity_pledged,
                    acb_per_share, total_acb, currency,
                    last_calculated_at
                ) VALUES (
                    :account_id, :symbol, :asset_type,
                    :qty_total, :qty_free, :qty_pledged,
                    :acb_per_share, :total_acb, :currency,
                    NOW()
                )
                ON CONFLICT (account_id, symbol) DO UPDATE SET
                    asset_type = EXCLUDED.asset_type,
                    quantity_total = EXCLUDED.quantity_total,
                    quantity_free = EXCLUDED.quantity_free,
                    quantity_pledged = EXCLUDED.quantity_pledged,
                    acb_per_share = EXCLUDED.acb_per_share,
                    total_acb = EXCLUDED.total_acb,
                    currency = EXCLUDED.currency,
                    last_calculated_at = NOW(),
                    updated_at = NOW()
            """),
            {
                'account_id': account_id,
                'symbol': symbol,
                'asset_type': data['asset_type'],
                'qty_total': str(qty),
                'qty_free': str(qty_free),
                'qty_pledged': str(qty_pledged),
                'acb_per_share': str(acb_per_share),
                'total_acb': str(total_cost),
                'currency': data['currency']
            }
        )

    db.commit()


def recalculate_cash_balances(db: Session, account_id: str):
    """
    Recalculate cash balances for an account from all transactions.
    Cash-affecting types: DEPOSIT, WITHDRAWAL, BUY, SELL, DIVIDEND,
    FX_CONVERSION, INTEREST, FEE, RETURN_OF_CAPITAL, OPTION_PREMIUM,
    OPTION_BUY_BACK, INTERNAL_TRANSFER, NORBERT_GAMBIT
    """
    cash_transactions = db.execute(
        text("""
            SELECT
                transaction_type, trade_currency,
                net_amount, net_amount_cad
            FROM transactions
            WHERE account_id = :account_id
            AND transaction_type NOT IN (
                'STOCK_SPLIT', 'CORPORATE_ACTION', 'CRYPTO'
            )
            ORDER BY trade_date ASC, created_at ASC
        """),
        {'account_id': account_id}
    ).fetchall()

    # balance per currency
    balances = {}

    for txn in cash_transactions:
        currency = txn.trade_currency or 'CAD'
        amount = Decimal(str(txn.net_amount or 0))

        if currency not in balances:
            balances[currency] = Decimal('0')

        balances[currency] += amount

    # Get locked cash from open CSPs
    locked = db.execute(
        text("""
            SELECT
                'CAD' as currency,
                COALESCE(SUM(cash_locked), 0) as locked
            FROM option_contracts
            WHERE account_id = :account_id
            AND status = 'OPEN'
            AND contract_type = 'PUT'
        """),
        {'account_id': account_id}
    ).fetchone()

    cash_locked_cad = Decimal(str(locked.locked or 0))

    # Delete existing balances and reinsert
    db.execute(
        text("DELETE FROM cash_balances WHERE account_id = :account_id"),
        {'account_id': account_id}
    )

    for currency, balance in balances.items():
        if currency not in ('CAD', 'USD', 'GBP', 'EUR', 'INR'):
            continue

        locked_amount = cash_locked_cad if currency == 'CAD' else Decimal('0')

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
                    balance_total = EXCLUDED.balance_total,
                    balance_locked = EXCLUDED.balance_locked,
                    last_updated_at = NOW(),
                    updated_at = NOW()
            """),
            {
                'account_id': account_id,
                'currency': currency,
                'total': str(balance),
                'locked': str(locked_amount)
            }
        )

    db.commit()
