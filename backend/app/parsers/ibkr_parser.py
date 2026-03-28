import csv
import io
from decimal import Decimal
from typing import Optional
from .base_parser import (
    BaseParser, ParseResult, ParsedTransaction,
    normalize_symbol, detect_asset_type
)

IBKR_TYPE_MAP = {
    'Buy': 'BUY',
    'Sell': 'SELL',
    'Deposit': 'DEPOSIT',
    'Withdrawal': 'WITHDRAWAL',
    'Forex Trade Component': 'FX_CONVERSION',
}

# IBKR uses these descriptions for internal account transfers
INTERNAL_TRANSFER_DESCRIPTIONS = {'Cash Transfer'}


class IBKRParser(BaseParser):
    """
    Parser for IBKR CSV Transaction History exports.

    Format: Multi-section CSV — must filter for Transaction History rows only.
    Columns after filtering:
        Date, Account, Description, Transaction Type, Symbol,
        Quantity, Price, Price Currency, Gross Amount, Commission, Net Amount

    Key quirks:
        - Must skip rows where col[0] != 'Transaction History' or col[1] != 'Data'
        - Account uses alias names: Individual Cash, TFSA, FHSA
        - Gross/Net amounts already in CAD (base currency)
        - Price Currency tells you the original trade currency
        - FX Translations P&L / Adjustment rows = SKIP (unrealized FX)
        - Cash Transfer = INTERNAL_TRANSFER between accounts
        - Commission is always in CAD
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
                    continue  # Skip the header row
                if row[1].strip() != 'Data':
                    continue

                # Data row: Transaction History,Data,date,account,...
                if len(row) < 13:
                    self.log_error(
                        row_num, f"Insufficient columns: {
                            len(row)}")
                    continue

                trade_date = self.safe_date(row[2].strip())
                account_alias = row[3].strip()
                description = row[4].strip()
                txn_type_raw = row[5].strip()
                symbol = row[6].strip() or None
                quantity_raw = row[7].strip()
                price_raw = row[8].strip()
                price_currency = row[9].strip().upper()
                gross_raw = row[10].strip()
                commission_raw = row[11].strip()
                net_raw = row[12].strip()

                if not trade_date:
                    self.log_error(row_num, f"Invalid date: {row[2]}")
                    continue

                if not account_alias:
                    self.log_error(row_num, 'Missing account alias')
                    continue

                if account_alias not in result.broker_accounts_found:
                    result.broker_accounts_found.append(account_alias)

                # Skip FX Translations P&L — unrealized FX gain/loss, not real
                if txn_type_raw == 'Adjustment' and 'FX Translations' in description:
                    self.log_skip(
                        row_num, 'FX Translations P&L adjustment — skipped')
                    continue

                # Detect internal transfers
                if description in INTERNAL_TRANSFER_DESCRIPTIONS:
                    net_amount = self.safe_decimal(net_raw)
                    txn = ParsedTransaction(
                        transaction_type='INTERNAL_TRANSFER',
                        trade_date=trade_date,
                        trade_currency='CAD',
                        net_amount=net_amount,
                        net_amount_cad=net_amount,
                        broker_account_identifier=account_alias,
                        description=description,
                        raw_data={'row': row}
                    )
                    result.transactions.append(txn)
                    continue

                txn_type = IBKR_TYPE_MAP.get(txn_type_raw)
                if not txn_type:
                    self.log_skip(
                        row_num, f"Unknown transaction type: {txn_type_raw}")
                    continue

                # IBKR amounts are in CAD (base currency)
                # price_currency tells us original trade currency
                trade_currency = price_currency if price_currency in (
                    'CAD', 'USD') else 'USD'
                net_amount_cad = self.safe_decimal(net_raw)
                commission = self.safe_decimal(commission_raw)
                quantity = self.safe_decimal(quantity_raw)
                price = self.safe_decimal(price_raw)

                # For FX_CONVERSION rows
                if txn_type == 'FX_CONVERSION':
                    # "Net Amount in Base from Forex Trade: 4,291.66 USD.CAD"
                    # The net_amount here is a tiny rounding adjustment in CAD
                    # quantity = USD amount, price = FX rate
                    usd_amount = quantity  # USD quantity
                    fx_rate = price        # rate used

                    txn = ParsedTransaction(
                        transaction_type='FX_CONVERSION',
                        trade_date=trade_date,
                        trade_currency='USD',
                        net_amount=usd_amount,
                        net_amount_cad=usd_amount * fx_rate if fx_rate else net_amount_cad,
                        broker_account_identifier=account_alias,
                        fx_rate_to_cad=fx_rate if fx_rate != 0 else None,
                        description=description,
                        raw_data={'row': row}
                    )
                    result.transactions.append(txn)
                    continue

                # For trades: calculate original USD amount from CAD amount
                # net_amount_cad is already in CAD
                # For reporting we store CAD amount, original currency amount
                # estimated
                if trade_currency == 'USD' and quantity != 0 and price != 0:
                    net_amount_original = - \
                        (quantity * price)  # negative for buys
                    # Commission already in CAD
                    # Try to derive FX rate
                    if net_amount_original != 0:
                        fx_rate = abs(net_amount_cad / net_amount_original) \
                            if net_amount_original != 0 else None
                    else:
                        fx_rate = None
                        net_amount_original = net_amount_cad
                else:
                    net_amount_original = net_amount_cad
                    fx_rate = None

                symbol_norm = normalize_symbol(symbol)

                txn = ParsedTransaction(
                    transaction_type=txn_type,
                    trade_date=trade_date,
                    trade_currency=trade_currency,
                    net_amount=net_amount_original,
                    net_amount_cad=net_amount_cad,
                    broker_account_identifier=account_alias,
                    symbol=symbol if symbol and symbol != '-' else None,
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

        except Exception as e:
            result.errors.append(f"Fatal parse error: {str(e)}")

        result.errors.extend(self.errors)
        result.skipped.extend(self.skipped)
        return result
