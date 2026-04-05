import io
from decimal import Decimal
from typing import Optional
import openpyxl
from .base_parser import (
    BaseParser, ParseResult, ParsedTransaction,
    normalize_symbol, detect_asset_type
)

QT_ACCOUNT_TYPE_MAP = {
    'individual cash':   'CASH',
    'individual margin': 'MARGIN',
    'individual rrsp':   'RRSP',
    'individual tfsa':   'TFSA',
    'individual fhsa':   'FHSA',
    'individual rrif':   'RRIF',
    'individual lira':   'LIRA',
    'individual resp':   'RESP',
    'corporate cash':    'CORP_CASH',
    'corporate margin':  'CORP_MARGIN',
}

# Map Questrade Activity Type + Action to our transaction types
QT_TYPE_MAP = {
    'Trades_Buy': 'BUY',
    'Trades_Sell': 'SELL',
    'Deposits_DEP': 'DEPOSIT',
    'Withdrawals_EFT': 'WITHDRAWAL',
    'FX conversion_FXT': 'FX_CONVERSION',
    'Fees and rebates_FCH': 'FEE',
    'Corporate actions_NAC': 'CORPORATE_ACTION',
    'Other_BRW': 'NORBERT_GAMBIT',
}


class QuestradeParser(BaseParser):
    """
    Parser for Questrade XLSX exports.

    Columns:
        Transaction Date, Settlement Date, Action, Symbol, Description,
        Quantity, Price, Gross Amount, Commission, Net Amount,
        Currency, Account #, Activity Type, Account Type

    Key quirks:
        - Account # is a real number (40132143) — most reliable identifier
        - FX conversion = 2 rows same date, one per currency — must pair
        - BRW = Norbert Gambit (DLR ETF FX method) — treat as FX_CONVERSION
        - FCH = Fee rows often come in pairs (fee + HST same date)
        - NAC = Corporate action name change (2 rows: remove old, add new)
        - G036247 = Questrade internal code for DLR.TO
        - Date format: datetime object from openpyxl
        - Quantity/Price are strings with many decimals
    """

    def parse(self, file_content: bytes, filename: str) -> ParseResult:
        result = ParseResult()
        fx_buffer = {}
        fee_buffer = {}

        try:
            wb = openpyxl.load_workbook(
                io.BytesIO(file_content),
                read_only=True,
                data_only=True
            )
            ws = wb.active
            rows = list(ws.iter_rows(values_only=True))

            if not rows:
                result.errors.append('Empty file')
                return result

            # Skip header row
            for row_num, row in enumerate(rows[1:], start=2):
                if not row or not row[0]:
                    continue

                trade_date = self.safe_date(row[0])
                settlement_date = self.safe_date(row[1])
                action = str(row[2] or '').strip()
                symbol = str(row[3] or '').strip() or None
                description = str(row[4] or '').strip()
                quantity = self.safe_decimal(row[5])
                price = self.safe_decimal(row[6])
                gross_amount = self.safe_decimal(row[7])
                commission = self.safe_decimal(row[8])
                net_amount = self.safe_decimal(row[9])
                currency = str(row[10] or 'CAD').strip().upper()
                account_number = str(row[11] or '').strip()
                activity_type = str(row[12] or '').strip()
                account_type = str(row[13] or '').strip()

                if not trade_date:
                    self.log_error(row_num, f"Invalid date: {row[0]}")
                    continue

                if not account_number:
                    self.log_error(row_num, 'Missing account number')
                    continue

                if account_number not in result.broker_accounts_found:
                    result.broker_accounts_found.append(account_number)
                    type_code = QT_ACCOUNT_TYPE_MAP.get(account_type.lower().strip())
                    if type_code:
                        result.broker_account_types[account_number] = type_code

                # Determine transaction type
                type_key = f"{activity_type}_{action}"
                txn_type = QT_TYPE_MAP.get(type_key)

                if not txn_type:
                    self.log_skip(row_num, f"Unknown type: {type_key}")
                    continue

                symbol_norm = normalize_symbol(symbol)
                net_amount_cad = net_amount if currency == 'CAD' else Decimal(
                    '0')

                # Handle FX conversion pairs (FXT)
                if txn_type == 'FX_CONVERSION':
                    fx_key = f"{trade_date}_{account_number}"
                    if fx_key in fx_buffer:
                        other = fx_buffer.pop(fx_key)
                        cad_amt = net_amount if currency == 'CAD' else other.net_amount_cad
                        usd_amt = net_amount if currency == 'USD' else other.net_amount

                        fx_rate = None
                        if usd_amt != 0:
                            fx_rate = abs(cad_amt / usd_amt)

                        txn = ParsedTransaction(
                            transaction_type='FX_CONVERSION',
                            trade_date=trade_date,
                            settlement_date=settlement_date,
                            trade_currency='USD',
                            net_amount=usd_amt,
                            net_amount_cad=cad_amt,
                            broker_account_identifier=account_number,
                            fx_rate_to_cad=fx_rate,
                            description='FX Conversion',
                            raw_data={'row': str(row)}
                        )
                        result.transactions.append(txn)
                    else:
                        buffered = ParsedTransaction(
                            transaction_type='FX_CONVERSION',
                            trade_date=trade_date,
                            trade_currency=currency,
                            net_amount=net_amount,
                            net_amount_cad=net_amount_cad,
                            broker_account_identifier=account_number,
                            raw_data={'row': str(row)}
                        )
                        fx_buffer[fx_key] = buffered
                    continue

                # Handle Norbert Gambit (BRW + DLR)
                if txn_type == 'NORBERT_GAMBIT':
                    # Extract FX rate from description if available
                    # "JOURNAL POSITION FROM USD BOOK VALUE: $19412.19 CNV@ 1.3771"
                    fx_rate = None
                    if 'CNV@' in description:
                        try:
                            rate_str = description.split(
                                'CNV@')[1].strip().split()[0]
                            fx_rate = Decimal(rate_str)
                        except Exception:
                            pass

                    txn = ParsedTransaction(
                        transaction_type='NORBERT_GAMBIT',
                        trade_date=trade_date,
                        settlement_date=settlement_date,
                        trade_currency=currency,
                        net_amount=net_amount,
                        net_amount_cad=net_amount_cad,
                        broker_account_identifier=account_number,
                        symbol=symbol,
                        symbol_normalized='DLR.TO',
                        asset_type='ETF',
                        description=description,
                        quantity=abs(quantity) if quantity != 0 else None,
                        fx_rate_to_cad=fx_rate,
                        raw_data={'row': str(row)}
                    )
                    result.transactions.append(txn)
                    continue

                # Handle fee pairs (FCH fee + HST = combine)
                if txn_type == 'FEE':
                    fee_key = f"{trade_date}_{account_number}"
                    if fee_key in fee_buffer:
                        other = fee_buffer.pop(fee_key)
                        combined_amount = net_amount + other.net_amount
                        txn = ParsedTransaction(
                            transaction_type='FEE',
                            trade_date=trade_date,
                            trade_currency=currency,
                            net_amount=combined_amount,
                            net_amount_cad=combined_amount,
                            broker_account_identifier=account_number,
                            description=f"Fee: {description}",
                            raw_data={'row': str(row)}
                        )
                        result.transactions.append(txn)
                    else:
                        buffered = ParsedTransaction(
                            transaction_type='FEE',
                            trade_date=trade_date,
                            trade_currency=currency,
                            net_amount=net_amount,
                            net_amount_cad=net_amount_cad,
                            broker_account_identifier=account_number,
                            description=description,
                            raw_data={'row': str(row)}
                        )
                        fee_buffer[fee_key] = buffered
                    continue

                # Skip zero-amount corporate action rows (name change out row)
                if txn_type == 'CORPORATE_ACTION' and net_amount == 0 and \
                   quantity and quantity < 0:
                    self.log_skip(
                        row_num, 'Corporate action removal row — skipped')
                    continue

                # Standard transaction
                txn = ParsedTransaction(
                    transaction_type=txn_type,
                    trade_date=trade_date,
                    settlement_date=settlement_date,
                    trade_currency=currency,
                    net_amount=net_amount,
                    net_amount_cad=net_amount_cad,
                    broker_account_identifier=account_number,
                    symbol=symbol,
                    symbol_normalized=symbol_norm,
                    asset_type=detect_asset_type(symbol_norm, description),
                    description=description,
                    quantity=abs(quantity) if quantity != 0 else None,
                    price_per_unit=price if price != 0 else None,
                    gross_amount=gross_amount if gross_amount != 0 else None,
                    commission=commission,
                    raw_data={'row': str(row)}
                )
                result.transactions.append(txn)

        except Exception as e:
            result.errors.append(f"Fatal parse error: {str(e)}")

        result.errors.extend(self.errors)
        result.skipped.extend(self.skipped)
        return result
