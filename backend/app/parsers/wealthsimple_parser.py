import csv
import io
from decimal import Decimal
from typing import Optional
from .base_parser import (
    BaseParser,
    ParseResult,
    ParsedTransaction,
    normalize_symbol,
    detect_asset_type,
)

# Map WealthSimple account_type values to standard names
WS_ACCOUNT_TYPE_MAP = {
    "non-registered": "CASH",
    "tfsa": "TFSA",
    "fhsa": "FHSA",
    "rrsp": "RRSP",
    "rrif": "RRIF",
    "resp": "RESP",
    "crypto": "CRYPTO",
    "lira": "LIRA",
}

# Map WealthSimple activity types to our transaction types
WS_TYPE_MAP = {
    ("Trade", "BUY"): "BUY",
    ("Trade", "SELL"): "SELL",
    ("MoneyMovement", "EFT"): "DEPOSIT",
    ("MoneyMovement", ""): "DEPOSIT",
    ("MoneyMovement", "TRANSFER"): "INTERNAL_TRANSFER",
    ("MoneyMovement", "TRANSFER_TF"): "INTERNAL_TRANSFER",
    ("MoneyMovement", "IFT"): "INTERNAL_TRANSFER",
    ("MoneyMovement", "E_TRFIN"): "DEPOSIT",
    ("FxExchange", ""): "FX_CONVERSION",
    ("Interest", ""): "INTEREST",
    ("Dividend", ""): "DIVIDEND",
    ("InternalSecurityTransfer", ""): "INTERNAL_TRANSFER",
    ("CorporateAction", "INTERNATIONAL_CODE_CHANGE"): "CORPORATE_ACTION",
}


class WealthSimpleParser(BaseParser):
    """
    Parser for WealthSimple CSV exports.

    Format:
        transaction_date, settlement_date, account_id, account_type,
        activity_type, activity_sub_type, direction, symbol, name,
        currency, quantity, unit_price, commission, net_cash_amount

    Key quirks:
        - account_id is internal WS ID (e.g. HQ78JF768CAD)
        - FX pairs: 2 rows same date/account, one per currency
        - MoneyMovement/EFT: positive=deposit, negative=withdrawal
        - Fractional shares supported
        - Crypto rows: skip entirely
        - Last row is a timestamp note — skip
    """

    def parse(self, file_content: bytes, filename: str) -> ParseResult:
        result = ParseResult()
        fx_buffer = {}        # buffer FX rows to pair them
        ca_buffer = {}        # buffer CorporateAction rows to pair them

        try:
            text = file_content.decode("utf-8-sig").strip()
            reader = csv.DictReader(io.StringIO(text))

            for row_num, row in enumerate(reader, start=2):
                # Skip empty rows and the trailing timestamp line
                if not row.get("transaction_date") or row[
                    "transaction_date"
                ].startswith("As of"):
                    self.log_skip(row_num, "Empty or footer row")
                    continue

                account_type = (row.get("account_type") or "").lower().strip()

                # Skip crypto and chequing entirely
                if account_type in ("crypto", "chequing"):
                    self.log_skip(row_num, f"{account_type.title()} - skipped")
                    continue

                activity_type = (row.get("activity_type") or "").strip()
                activity_sub_type = (row.get("activity_sub_type") or "").strip()
                currency = (row.get("currency") or "CAD").strip().upper()
                net_amount = self.safe_decimal(row.get("net_cash_amount"))
                trade_date = self.safe_date(row.get("transaction_date"))

                if not trade_date:
                    self.log_error(
                        row_num,
                        f"Invalid date: {
                            row.get('transaction_date')}",
                    )
                    continue

                account_id = (row.get("account_id") or "").strip()
                if not account_id:
                    self.log_error(row_num, "Missing account_id")
                    continue

                # Track unique accounts found with their type
                if account_id not in result.broker_accounts_found:
                    result.broker_accounts_found.append(account_id)
                    type_code = WS_ACCOUNT_TYPE_MAP.get(account_type)
                    if type_code:
                        result.broker_account_types[account_id] = type_code

                # Determine transaction type
                type_key = (activity_type, activity_sub_type.upper())
                txn_type = WS_TYPE_MAP.get(type_key)

                # Fallback for MoneyMovement with direction
                if not txn_type and activity_type == "MoneyMovement":
                    txn_type = "DEPOSIT" if net_amount > 0 else "WITHDRAWAL"

                if not txn_type:
                    self.log_skip(
                        row_num,
                        f"Unknown activity: {activity_type}/{activity_sub_type}",
                    )
                    continue

                # Adjust DEPOSIT to WITHDRAWAL if negative
                if txn_type == "DEPOSIT" and net_amount < 0:
                    txn_type = "WITHDRAWAL"

                symbol = (row.get("symbol") or "").strip() or None
                symbol_norm = normalize_symbol(symbol)
                quantity = self.safe_decimal(row.get("quantity")) or None
                if quantity == Decimal("0"):
                    quantity = None
                price = self.safe_decimal(row.get("unit_price")) or None
                if price == Decimal("0"):
                    price = None

                # FX_CONVERSION: buffer and pair rows
                if txn_type == "FX_CONVERSION":
                    fx_key = f"{trade_date}_{account_id}"
                    if fx_key in fx_buffer:
                        # Pair found — create single FX transaction
                        other = fx_buffer.pop(fx_key)
                        # CAD row is the base
                        cad_row = (
                            other
                            if other.trade_currency == "CAD"
                            else ParsedTransaction(
                                transaction_type="FX_CONVERSION",
                                trade_date=trade_date,
                                trade_currency=currency,
                                net_amount=net_amount,
                                net_amount_cad=(
                                    net_amount if currency == "CAD" else Decimal("0")
                                ),
                                broker_account_identifier=account_id,
                                raw_data=dict(row),
                            )
                        )
                        usd_row = other if other.trade_currency == "USD" else cad_row

                        # Calculate FX rate from the pair
                        fx_rate = None
                        if usd_row.net_amount != 0:
                            fx_rate = abs(cad_row.net_amount / usd_row.net_amount)

                        txn = ParsedTransaction(
                            transaction_type="FX_CONVERSION",
                            trade_date=trade_date,
                            trade_currency="USD",
                            net_amount=usd_row.net_amount,
                            net_amount_cad=cad_row.net_amount,
                            broker_account_identifier=account_id,
                            fx_rate_to_cad=fx_rate,
                            description="FX Exchange",
                            raw_data=dict(row),
                        )
                        txn_hash = txn.compute_hash()
                        txn_with_hash = txn
                        result.transactions.append(txn_with_hash)
                    else:
                        # Buffer first row of the pair
                        buffered = ParsedTransaction(
                            transaction_type="FX_CONVERSION",
                            trade_date=trade_date,
                            trade_currency=currency,
                            net_amount=net_amount,
                            net_amount_cad=(
                                net_amount if currency == "CAD" else Decimal("0")
                            ),
                            broker_account_identifier=account_id,
                            raw_data=dict(row),
                        )
                        fx_buffer[fx_key] = buffered
                    continue

                # CORPORATE_ACTION (INTERNATIONAL_CODE_CHANGE) — comes in 2 rows:
                # Row 1: old symbol, qty negative (removal)
                # Row 2: new symbol, qty positive (addition)
                # We pair them and store one CORPORATE_ACTION transaction
                # on the new symbol with notes="RENAME_FROM:OLD_SYMBOL"
                if txn_type == "CORPORATE_ACTION":
                    ca_key = f"{trade_date}_{account_id}"
                    qty_raw = self.safe_decimal(row.get("quantity"))

                    if ca_key in ca_buffer:
                        other = ca_buffer.pop(ca_key)
                        other_qty = self.safe_decimal(other.raw_data.get("quantity", "0"))

                        # Identify which row is old (negative qty) and new (positive qty)
                        if qty_raw > 0:
                            new_symbol = symbol_norm
                            old_symbol = other.symbol_normalized
                        else:
                            new_symbol = other.symbol_normalized
                            old_symbol = symbol_norm

                        if new_symbol and old_symbol:
                            txn = ParsedTransaction(
                                transaction_type="CORPORATE_ACTION",
                                trade_date=trade_date,
                                trade_currency=currency,
                                net_amount=Decimal("0"),
                                net_amount_cad=Decimal("0"),
                                broker_account_identifier=account_id,
                                symbol=new_symbol,
                                symbol_normalized=new_symbol,
                                asset_type=detect_asset_type(new_symbol),
                                description=f"Symbol rename: {old_symbol} → {new_symbol}",
                                quantity=abs(qty_raw) if qty_raw != 0 else abs(other_qty),
                                notes=f"RENAME_FROM:{old_symbol}",
                                raw_data=dict(row),
                            )
                            result.transactions.append(txn)
                        else:
                            self.log_skip(row_num, "Corporate action pair incomplete — skipped")
                    else:
                        # Buffer first row — store raw_data with quantity for pairing
                        buffered = ParsedTransaction(
                            transaction_type="CORPORATE_ACTION",
                            trade_date=trade_date,
                            trade_currency=currency,
                            net_amount=Decimal("0"),
                            net_amount_cad=Decimal("0"),
                            broker_account_identifier=account_id,
                            symbol=symbol_norm,
                            symbol_normalized=symbol_norm,
                            raw_data={**dict(row), "quantity": str(qty_raw)},
                        )
                        ca_buffer[ca_key] = buffered
                    continue
                
                # Skip InternalSecurityTransfer — WS-specific sub-account stock moves.
                # Both legs (debit + credit) map to the same Kinnance account,
                # so quantities and cash net to zero. No ACB or cash balance impact.
                if activity_type == "InternalSecurityTransfer":
                    self.log_skip(row_num, f"InternalSecurityTransfer skipped: {symbol_norm}")
                    continue

                # Skip OPTION asset types — handled separately in future
                if detect_asset_type(symbol_norm) == 'OPTION':
                    self.log_skip(row_num, f"Option trade skipped: {symbol_norm}")
                    continue
                # Regular transaction
                # For USD transactions, net_amount_cad will be set later
                # when we have the FX rate from price cache
                net_amount_cad = net_amount if currency == "CAD" else Decimal("0")

                txn = ParsedTransaction(
                    transaction_type=txn_type,
                    trade_date=trade_date,
                    settlement_date=self.safe_date(row.get("settlement_date")),
                    trade_currency=currency,
                    net_amount=net_amount,
                    net_amount_cad=net_amount_cad,
                    broker_account_identifier=account_id,
                    symbol=symbol,
                    symbol_normalized=symbol_norm,
                    asset_type=detect_asset_type(symbol_norm),
                    description=row.get("name") or activity_type,
                    quantity=abs(quantity) if quantity is not None else None,
                    price_per_unit=price,
                    gross_amount=net_amount,
                    raw_data=dict(row),
                )
                result.transactions.append(txn)

        except Exception as e:
            result.errors.append(f"Fatal parse error: {str(e)}")

        result.errors.extend(self.errors)
        result.skipped.extend(self.skipped)
        return result
