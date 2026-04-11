import csv
import io
from .base_parser import (
    BaseParser, ParseResult, ParsedTransaction,
    normalize_symbol, detect_asset_type
)




class IBKRParser(BaseParser):
    """
    Parser for IBKR CSV Transaction History exports.

    Columns (after filtering Transaction History / Data rows):
        Date, Account, Description, Transaction Type, Symbol,
        Quantity, Price, Price Currency, Gross Amount, Commission, Net Amount
        [Sub Type — optional, only in some exports]

    Key rules:
        - Deposits/Withdrawals → always CAD (IBKR doesn't specify currency)
        - BUY/SELL → trade_currency from Price Currency column (usually USD)
          net_amount is IBKR's CAD-converted figure — we use it directly
        - Forex Trade Component → FX_CONVERSION, qty=USD amount, price=FX rate
          skip tiny rounding rows (qty < $1 USD)
        - Credit Interest → INTEREST in CAD
        - Adjustment / FX Translations P&L → skip (unrealized FX, not real)
        - Cash Transfer description → INTERNAL_TRANSFER
        - Options (symbol contains C/P strike format) → skip for now
    """

    def parse(self, file_content: bytes, filename: str) -> ParseResult:
        result = ParseResult()

        try:
            text = file_content.decode('utf-8-sig').strip()
            reader = csv.reader(io.StringIO(text))

            for row_num, row in enumerate(reader, start=1):
                # Only process Transaction History data rows
                if len(row) < 3:
                    continue
                if row[0].strip() != 'Transaction History':
                    continue
                if row[1].strip() == 'Header':
                    continue
                if row[1].strip() != 'Data':
                    continue
                if len(row) < 13:
                    self.log_error(row_num, f"Insufficient columns: {len(row)}")
                    continue

                trade_date      = self.safe_date(row[2].strip())
                account_alias   = row[3].strip()
                description     = row[4].strip()
                txn_type_raw    = row[5].strip()
                symbol_raw      = row[6].strip()
                quantity_raw    = row[7].strip()
                price_raw       = row[8].strip()
                price_currency  = row[9].strip().upper()
                commission_raw  = row[11].strip()
                net_raw         = row[12].strip()

                if not trade_date:
                    self.log_error(row_num, f"Invalid date: {row[2]}")
                    continue
                if not account_alias:
                    self.log_error(row_num, 'Missing account alias')
                    continue

                # Track unique accounts
                if account_alias not in result.broker_accounts_found:
                    result.broker_accounts_found.append(account_alias)

                quantity   = self.safe_decimal(quantity_raw)
                price      = self.safe_decimal(price_raw)
                commission = self.safe_decimal(commission_raw)
                net_cad    = self.safe_decimal(net_raw)
                symbol     = symbol_raw if symbol_raw and symbol_raw != '-' else None

                # ── Skip adjustment rows ──────────────────────────────────
                if txn_type_raw == 'Adjustment':
                    self.log_skip(row_num, f"Adjustment skipped: {description}")
                    continue

                # ── Skip option trades (future feature) ───────────────────
                if symbol and detect_asset_type(symbol, description) == 'OPTION':
                    self.log_skip(row_num, f"Option trade skipped: {symbol}")
                    continue

                # ── Internal transfers (Cash Transfer) ────────────────────
                if description == 'Cash Transfer':
                    txn_type = 'INTERNAL_TRANSFER' if net_cad >= 0 else 'WITHDRAWAL'
                    # Determine sign — Cash Transfer can be in or out
                    # Use transaction type raw to determine direction
                    if txn_type_raw == 'Withdrawal':
                        txn_type = 'WITHDRAWAL'
                    elif txn_type_raw == 'Deposit':
                        txn_type = 'INTERNAL_TRANSFER'
                    txn = ParsedTransaction(
                        transaction_type=txn_type,
                        trade_date=trade_date,
                        trade_currency='CAD',
                        net_amount=net_cad,
                        net_amount_cad=net_cad,
                        broker_account_identifier=account_alias,
                        description=description,
                        raw_data={'row': row}
                    )
                    result.transactions.append(txn)
                    continue

                # ── Deposits ─────────────────────────────────────────────
                if txn_type_raw == 'Deposit':
                    txn = ParsedTransaction(
                        transaction_type='DEPOSIT',
                        trade_date=trade_date,
                        trade_currency='CAD',
                        net_amount=net_cad,
                        net_amount_cad=net_cad,
                        broker_account_identifier=account_alias,
                        description=description,
                        raw_data={'row': row}
                    )
                    result.transactions.append(txn)
                    continue

                # ── Withdrawals ───────────────────────────────────────────
                if txn_type_raw == 'Withdrawal':
                    txn = ParsedTransaction(
                        transaction_type='WITHDRAWAL',
                        trade_date=trade_date,
                        trade_currency='CAD',
                        net_amount=net_cad,
                        net_amount_cad=net_cad,
                        broker_account_identifier=account_alias,
                        description=description,
                        raw_data={'row': row}
                    )
                    result.transactions.append(txn)
                    continue

                # ── Credit Interest ───────────────────────────────────────
                if txn_type_raw == 'Credit Interest':
                    txn = ParsedTransaction(
                        transaction_type='INTEREST',
                        trade_date=trade_date,
                        trade_currency='CAD',
                        net_amount=net_cad,
                        net_amount_cad=net_cad,
                        broker_account_identifier=account_alias,
                        description=description,
                        raw_data={'row': row}
                    )
                    result.transactions.append(txn)
                    continue

                # ── FX Conversion ─────────────────────────────────────────
                # symbol=USD.CAD, qty=USD amount, price=FX rate, curr=CAD
                # Skip tiny rounding rows (IBKR generates many of these)
                if txn_type_raw == 'Forex Trade Component':
                    usd_amount = quantity  # positive = buying USD with CAD
                    fx_rate = price

                    # CAD side is negative when buying USD (spending CAD)
                    # CAD side is positive when selling USD (receiving CAD)
                    cad_amount = -(usd_amount * fx_rate) if fx_rate else net_cad

                    txn = ParsedTransaction(
                        transaction_type='FX_CONVERSION',
                        trade_date=trade_date,
                        trade_currency='USD',
                        net_amount=usd_amount,
                        net_amount_cad=cad_amount,
                        broker_account_identifier=account_alias,
                        fx_rate_to_cad=fx_rate if fx_rate != 0 else None,
                        description=description,
                        raw_data={'row': row}
                    )
                    result.transactions.append(txn)
                    continue

                # ── Buy / Sell ────────────────────────────────────────────
                if txn_type_raw in ('Buy', 'Sell'):
                    trade_currency = price_currency if price_currency in ('CAD', 'USD') else 'USD'

                    # net_amount in trade currency — IBKR net_raw is in CAD
                    # For USD trades: derive USD amount from qty × price
                    # net_cad is IBKR's CAD conversion (includes commission in CAD)
                    if trade_currency == 'USD' and quantity != 0 and price != 0:
                        # qty is negative for sells, positive for buys
                        net_usd = -(quantity * price)  # negative for buys, positive for sells
                        # FX rate derived from IBKR's CAD conversion
                        fx_rate = abs(net_cad / net_usd) if net_usd != 0 else None
                    else:
                        net_usd = net_cad
                        fx_rate = None

                    symbol_norm = normalize_symbol(symbol)
                    txn_type = 'BUY' if txn_type_raw == 'Buy' else 'SELL'

                    txn = ParsedTransaction(
                        transaction_type=txn_type,
                        trade_date=trade_date,
                        trade_currency=trade_currency,
                        net_amount=net_usd,
                        net_amount_cad=net_cad,
                        broker_account_identifier=account_alias,
                        symbol=symbol,
                        symbol_normalized=symbol_norm,
                        asset_type=detect_asset_type(symbol_norm, description),
                        description=description,
                        quantity=abs(quantity) if quantity != 0 else None,
                        price_per_unit=price if price != 0 else None,
                        commission=abs(commission),
                        fx_rate_to_cad=fx_rate,
                        raw_data={'row': row}
                    )
                    result.transactions.append(txn)
                    continue

                # ── Unknown ───────────────────────────────────────────────
                self.log_skip(row_num, f"Unknown transaction type: {txn_type_raw}")

        except Exception as e:
            result.errors.append(f"Fatal parse error: {str(e)}")

        result.errors.extend(self.errors)
        result.skipped.extend(self.skipped)
        return result