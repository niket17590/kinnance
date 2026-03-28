from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal
from typing import Optional
import hashlib
import json


@dataclass
class ParsedTransaction:
    """
    Standardized transaction format output by all parsers.
    Every parser converts its broker-specific format into this.
    """
    # Required fields
    transaction_type: str
    trade_date: date
    trade_currency: str
    net_amount: Decimal
    net_amount_cad: Decimal

    # Account matching
    broker_account_identifier: str  # raw account ID from broker file

    # Optional fields
    settlement_date: Optional[date] = None
    symbol: Optional[str] = None
    symbol_normalized: Optional[str] = None
    asset_type: Optional[str] = None
    description: Optional[str] = None
    quantity: Optional[Decimal] = None
    price_per_unit: Optional[Decimal] = None
    gross_amount: Optional[Decimal] = None
    commission: Decimal = Decimal('0')
    fx_rate_to_cad: Optional[Decimal] = None
    paired_key: Optional[str] = None  # used to link FX pairs before saving
    raw_data: Optional[dict] = None
    notes: Optional[str] = None

    def compute_hash(self) -> str:
        """
        SHA-256 hash for duplicate detection.
        Based on fields that uniquely identify a transaction.
        """
        key = json.dumps({
            'date': str(self.trade_date),
            'type': self.transaction_type,
            'account': self.broker_account_identifier,
            'symbol': self.symbol,
            'qty': str(self.quantity),
            'amount': str(self.net_amount),
            'currency': self.trade_currency,
            'description': self.description
        }, sort_keys=True)
        return hashlib.sha256(key.encode()).hexdigest()


@dataclass
class ParseResult:
    """Result returned by every parser after processing a file."""
    transactions: list[ParsedTransaction] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)
    skipped: list[str] = field(default_factory=list)
    broker_accounts_found: list[str] = field(default_factory=list)
    broker_account_types: dict[str, str] = field(default_factory=dict)

    @property
    def success_count(self) -> int:
        return len(self.transactions)

    @property
    def error_count(self) -> int:
        return len(self.errors)


# Symbol normalization map for known broker-specific codes
SYMBOL_MAP = {
    'G036247': 'DLR.TO',   # Questrade internal code for DLR ETF
    'E035729': 'PLUG.CN',  # Old symbol before name change
}


def normalize_symbol(symbol: Optional[str]) -> Optional[str]:
    """Convert broker-specific symbols to standard tickers."""
    if not symbol:
        return None
    symbol = symbol.strip().upper()
    return SYMBOL_MAP.get(symbol, symbol)


def detect_asset_type(
        symbol: Optional[str], description: Optional[str] = None) -> Optional[str]:
    """
    Detect asset type from symbol and description.
    Options symbols have specific formats: AAPL250117C00200000
    ETFs are harder to detect without a reference list.
    """
    if not symbol:
        return None

    # Options: symbol format is UNDERLYING + DATE + C/P + STRIKE
    # e.g. AAPL250117C00200000
    if len(symbol) > 10 and ('C' in symbol[6:] or 'P' in symbol[6:]):
        return 'OPTION'

    # Crypto detection
    crypto_symbols = {'BTC', 'ETH', 'SOL', 'USDC', 'USDT', 'ADA', 'DOT'}
    if symbol in crypto_symbols:
        return 'CRYPTO'

    # Known ETFs (expand this list over time)
    etf_symbols = {
        'DLR', 'DLR.TO', 'G036247', 'SPY', 'QQQ', 'VFV', 'ZSP',
        'XEF', 'XIC', 'VTI', 'VOO', 'VUN', 'VCN'
    }
    if symbol in etf_symbols:
        return 'ETF'

    return 'STOCK'


class BaseParser(ABC):
    """
    Abstract base class for all broker CSV parsers.
    Each broker parser must implement parse().
    """

    def __init__(self):
        self.errors: list[str] = []
        self.skipped: list[str] = []

    @abstractmethod
    def parse(self, file_content: bytes, filename: str) -> ParseResult:
        """
        Parse broker file content into standardized ParsedTransaction list.

        Args:
            file_content: Raw file bytes
            filename: Original filename (used to detect .csv vs .xlsx)

        Returns:
            ParseResult with transactions, errors, skipped rows
        """
        pass

    def log_error(self, row_num: int, message: str, row_data: any = None):
        self.errors.append(f"Row {row_num}: {message}")

    def log_skip(self, row_num: int, reason: str):
        self.skipped.append(f"Row {row_num}: {reason}")

    def safe_decimal(self, value, default=Decimal('0')) -> Decimal:
        """Safely convert any value to Decimal."""
        if value is None or value == '' or value == '-':
            return default
        try:
            cleaned = str(value).replace(',', '').strip()
            return Decimal(cleaned)
        except Exception:
            return default

    def safe_date(self, value) -> Optional[date]:
        """Parse various date formats to date object."""
        if not value:
            return None
        from datetime import datetime
        formats = [
            '%Y-%m-%d',
            '%m/%d/%Y',
            '%Y-%m-%d %I:%M:%S %p',  # Questrade: 2025-12-29 12:00:00 AM
            '%Y-%m-%dT%H:%M:%S',
        ]
        value_str = str(value).strip()
        for fmt in formats:
            try:
                return datetime.strptime(value_str, fmt).date()
            except ValueError:
                continue
        return None
