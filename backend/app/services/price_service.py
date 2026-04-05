import logging
import httpx
import yfinance as yf
from collections import deque
from sqlalchemy.orm import Session
from sqlalchemy import text
from decimal import Decimal
from app.core.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()
TWELVEDATA_BASE_URL = "https://api.twelvedata.com"

# ============================================================
# IN-MEMORY ROLLING QUEUE
# Circular queue of symbols to fetch prices for.
# Loaded from security_master on startup.
# New symbols pushed when added via import.
# Scheduler pops PRICE_BATCH_SIZE symbols per run.
# ============================================================

_symbol_queue: deque = deque()
_queue_set: set = set()  # fast lookup to avoid duplicates


def load_queue_from_db(db: Session):
    """
    Load all active symbols from security_master into the queue.
    Called once at app startup.
    """
    global _symbol_queue, _queue_set
    rows = db.execute(
        text("SELECT symbol FROM security_master WHERE is_active = TRUE ORDER BY symbol")
    ).fetchall()
    symbols = [row.symbol for row in rows]
    _symbol_queue = deque(symbols)
    _queue_set = set(symbols)
    logger.info(f"Price queue loaded with {len(symbols)} symbols")


def push_to_queue(symbols: list[str]):
    """
    Push new symbols to the back of the queue.
    Skips symbols already in queue.
    Called after import adds new symbols to security_master.
    """
    added = 0
    for symbol in symbols:
        if symbol not in _queue_set:
            _symbol_queue.append(symbol)
            _queue_set.add(symbol)
            added += 1
    if added:
        logger.info(f"Pushed {added} new symbols to price queue. Total: {len(_symbol_queue)}")


def pop_next_batch(batch_size: int) -> list[str]:
    """
    Pop the next batch_size symbols from the front of the queue
    and push them to the back (circular rotation).
    Returns the popped symbols.
    """
    if not _symbol_queue:
        return []

    batch = []
    for _ in range(min(batch_size, len(_symbol_queue))):
        symbol = _symbol_queue.popleft()
        _symbol_queue.append(symbol)  # push to back for next cycle
        batch.append(symbol)

    return batch


def queue_size() -> int:
    return len(_symbol_queue)


# ============================================================
# HELPERS
# ============================================================

def _get_currency(symbol: str) -> str:
    if symbol.upper().endswith(".TO") or symbol.upper().endswith(".TSX"):
        return "CAD"
    return "USD"


def _safe_decimal(val) -> str | None:
    try:
        if val is None or val == "NaN" or val == "":
            return None
        f = float(val)
        return str(Decimal(str(f)))
    except Exception:
        return None


def _safe_int(val) -> int | None:
    try:
        return int(val) if val is not None else None
    except Exception:
        return None


def _safe_bool(val) -> bool | None:
    if val is None:
        return None
    if isinstance(val, bool):
        return val
    if isinstance(val, str):
        return val.lower() == "true"
    return bool(val)


# ============================================================
# YAHOO FINANCE — security master (one-time per symbol)
# ============================================================

def _fetch_security_info_yfinance(symbol: str) -> dict:
    """
    Fetch company profile from Yahoo Finance.
    Used only for security_master — one-time fetch per symbol.
    """
    try:
        ticker = yf.Ticker(symbol)
        info = ticker.info or {}
        return {
            "name":       info.get("longName") or info.get("shortName"),
            "exchange":   info.get("exchange"),
            "sector":     info.get("sector"),
            "industry":   info.get("industry"),
            "market_cap": info.get("marketCap"),
            "country":    info.get("country"),
            "asset_type": _detect_asset_type(info.get("quoteType")),
        }
    except Exception as e:
        logger.error(f"yfinance fetch failed for {symbol}: {e}")
        return {}


def _detect_asset_type(quote_type: str | None) -> str:
    if not quote_type:
        return "STOCK"
    return {
        "EQUITY":       "STOCK",
        "ETF":          "ETF",
        "MUTUALFUND":   "MUTUAL_FUND",
        "CRYPTOCURRENCY": "CRYPTO",
    }.get(quote_type.upper(), "STOCK")


# ============================================================
# TWELVE DATA — price cache (every N minutes via scheduler)
# ============================================================

def _call_quote_batch(symbols: list[str]) -> dict:
    """
    Call Twelve Data /quote for up to 8 symbols (free tier limit).
    Returns dict keyed by symbol. Handles rate limit and error responses.
    """
    if not symbols:
        return {}
    try:
        with httpx.Client(timeout=30) as client:
            response = client.get(
                f"{TWELVEDATA_BASE_URL}/quote",
                params={
                    "symbol": ",".join(symbols),
                    "apikey": settings.TWELVEDATA_API_KEY
                }
            )
            response.raise_for_status()
            data = response.json()

        # Top-level error (e.g. rate limit 429)
        if isinstance(data, dict) and data.get("status") == "error":
            logger.warning(f"Twelve Data API error: {data.get('message')}")
            return {}

        # Single symbol — returns quote dict directly
        if len(symbols) == 1:
            sym = symbols[0]
            if isinstance(data, dict) and "symbol" in data and data.get("status") != "error":
                return {sym: data}
            return {}

        # Multiple symbols — returns {symbol: quote_dict, ...}
        result = {}
        for k, v in data.items():
            if isinstance(v, dict) and v.get("status") != "error":
                result[k] = v
            elif isinstance(v, dict):
                logger.warning(f"Quote error for {k}: {v.get('message', 'unknown')}")
        return result

    except Exception as e:
        logger.error(f"Quote batch fetch failed: {e}")
        return {}


# ============================================================
# DB UPSERTS
# ============================================================

def _upsert_security_master(db: Session, symbol: str, info: dict):
    """Insert or update security_master from yfinance info."""
    db.execute(
        text("""
            INSERT INTO security_master (
                symbol, exchange, currency, name, asset_type,
                sector, industry, market_cap, country,
                last_fetched_at
            ) VALUES (
                :symbol, :exchange, :currency, :name, :asset_type,
                :sector, :industry, :market_cap, :country,
                NOW()
            )
            ON CONFLICT (symbol) DO UPDATE SET
                exchange        = COALESCE(EXCLUDED.exchange,   security_master.exchange),
                name            = COALESCE(EXCLUDED.name,       security_master.name),
                asset_type      = COALESCE(EXCLUDED.asset_type, security_master.asset_type),
                sector          = COALESCE(EXCLUDED.sector,     security_master.sector),
                industry        = COALESCE(EXCLUDED.industry,   security_master.industry),
                market_cap      = COALESCE(EXCLUDED.market_cap, security_master.market_cap),
                country         = COALESCE(EXCLUDED.country,    security_master.country),
                last_fetched_at = NOW(),
                updated_at      = NOW()
        """),
        {
            "symbol":     symbol,
            "exchange":   info.get("exchange"),
            "currency":   _get_currency(symbol),
            "name":       info.get("name"),
            "asset_type": info.get("asset_type") or "STOCK",
            "sector":     info.get("sector"),
            "industry":   info.get("industry"),
            "market_cap": info.get("market_cap"),
            "country":    info.get("country"),
        }
    )


def _upsert_price_cache(db: Session, symbol: str, quote: dict):
    """
    Insert or update price_cache from Twelve Data quote response.
    Maps all available fields including 52-week data.
    Uses previous_close as effective price when market is closed.
    """
    if not quote:
        return

    # Effective close — use close if available, fallback to previous_close
    raw_close = quote.get("close")
    raw_prev  = quote.get("previous_close")

    try:
        close_val = float(raw_close) if raw_close and str(raw_close) != "NaN" else None
    except (TypeError, ValueError):
        close_val = None

    try:
        prev_val = float(raw_prev) if raw_prev and str(raw_prev) != "NaN" else None
    except (TypeError, ValueError):
        prev_val = None

    effective_close = close_val if close_val else prev_val

    fw = quote.get("fifty_two_week") or {}

    # Parse last_quote_at timestamp
    last_quote_at = None
    if quote.get("last_quote_at"):
        try:
            import datetime
            last_quote_at = datetime.datetime.fromtimestamp(
                int(quote["last_quote_at"]),
                tz=datetime.timezone.utc
            ).isoformat()
        except Exception:
            pass

    db.execute(
        text("""
            INSERT INTO price_cache (
                symbol, currency,
                name, exchange, mic_code,
                trade_date, last_quote_at, is_market_open,
                open, high, low, close, volume, average_volume,
                previous_close, day_change, day_change_pct,
                week_52_low, week_52_high,
                week_52_low_change, week_52_high_change,
                week_52_low_change_pct, week_52_high_change_pct,
                week_52_range,
                fetched_at
            ) VALUES (
                :symbol, :currency,
                :name, :exchange, :mic_code,
                :trade_date, :last_quote_at, :is_market_open,
                :open, :high, :low, :close, :volume, :avg_volume,
                :prev_close, :day_change, :day_change_pct,
                :w52_low, :w52_high,
                :w52_low_chg, :w52_high_chg,
                :w52_low_chg_pct, :w52_high_chg_pct,
                :w52_range,
                NOW()
            )
            ON CONFLICT (symbol, currency) DO UPDATE SET
                name                  = EXCLUDED.name,
                exchange              = EXCLUDED.exchange,
                mic_code              = EXCLUDED.mic_code,
                trade_date            = EXCLUDED.trade_date,
                last_quote_at         = EXCLUDED.last_quote_at,
                is_market_open        = EXCLUDED.is_market_open,
                open                  = EXCLUDED.open,
                high                  = EXCLUDED.high,
                low                   = EXCLUDED.low,
                close                 = EXCLUDED.close,
                volume                = EXCLUDED.volume,
                average_volume        = EXCLUDED.average_volume,
                previous_close        = EXCLUDED.previous_close,
                day_change            = EXCLUDED.day_change,
                day_change_pct        = EXCLUDED.day_change_pct,
                week_52_low           = EXCLUDED.week_52_low,
                week_52_high          = EXCLUDED.week_52_high,
                week_52_low_change    = EXCLUDED.week_52_low_change,
                week_52_high_change   = EXCLUDED.week_52_high_change,
                week_52_low_change_pct  = EXCLUDED.week_52_low_change_pct,
                week_52_high_change_pct = EXCLUDED.week_52_high_change_pct,
                week_52_range         = EXCLUDED.week_52_range,
                fetched_at            = NOW(),
                updated_at            = NOW()
        """),
        {
            "symbol":        symbol,
            "currency":      quote.get("currency") or _get_currency(symbol),
            "name":          quote.get("name"),
            "exchange":      quote.get("exchange"),
            "mic_code":      quote.get("mic_code"),
            "trade_date":    quote.get("datetime"),
            "last_quote_at": last_quote_at,
            "is_market_open": _safe_bool(quote.get("is_market_open")),
            "open":          _safe_decimal(quote.get("open")),
            "high":          _safe_decimal(quote.get("high")),
            "low":           _safe_decimal(quote.get("low")),
            "close":         _safe_decimal(effective_close),
            "volume":        _safe_int(quote.get("volume")),
            "avg_volume":    _safe_int(quote.get("average_volume")),
            "prev_close":    _safe_decimal(prev_val),
            "day_change":    _safe_decimal(quote.get("change")),
            "day_change_pct": _safe_decimal(quote.get("percent_change")),
            "w52_low":       _safe_decimal(fw.get("low")),
            "w52_high":      _safe_decimal(fw.get("high")),
            "w52_low_chg":   _safe_decimal(fw.get("low_change")),
            "w52_high_chg":  _safe_decimal(fw.get("high_change")),
            "w52_low_chg_pct":  _safe_decimal(fw.get("low_change_percent")),
            "w52_high_chg_pct": _safe_decimal(fw.get("high_change_percent")),
            "w52_range":     fw.get("range"),
        }
    )


# ============================================================
# PUBLIC METHOD 1 — ensure_securities_exist
# Called on import + by scheduler as safety net
# ============================================================

def ensure_securities_exist(db: Session, symbols: list[str]):
    """
    For each symbol NOT in security_master:
      → Fetch from yfinance (free, rich data)
      → Insert into security_master
    Already-known symbols are skipped.
    """
    if not symbols:
        return

    existing = {
        row.symbol for row in db.execute(
            text("SELECT symbol FROM security_master WHERE symbol = ANY(:syms)"),
            {"syms": symbols}
        ).fetchall()
    }

    missing = [s for s in symbols if s not in existing]
    if not missing:
        logger.info(f"All {len(symbols)} symbols already in security_master")
        return

    logger.info(f"Fetching company info for {len(missing)} new symbols: {missing}")

    for symbol in missing:
        info = _fetch_security_info_yfinance(symbol)
        try:
            _upsert_security_master(db, symbol, info)
            db.commit()
            logger.info(f"Security master updated: {symbol} — {info.get('name', 'unknown')}")
        except Exception as e:
            db.rollback()
            logger.error(f"Failed to store security master for {symbol}: {e}")


# ============================================================
# PUBLIC METHOD 2 — refresh_prices
# Called by scheduler with a batch of symbols from the queue
# ============================================================

def refresh_prices(db: Session, symbols: list[str]):
    """
    Fetch latest prices for given symbols from Twelve Data.
    UPSERTs into price_cache.
    Updates holdings unrealized G/L after storing prices.
    Called by scheduler with each batch popped from the queue.
    """
    if not symbols:
        return

    logger.info(f"Fetching prices for: {symbols}")
    quotes = _call_quote_batch(symbols)

    updated = 0
    failed = 0

    for symbol in symbols:
        quote = quotes.get(symbol)
        if not quote:
            logger.warning(f"No quote returned for {symbol}")
            failed += 1
            continue
        try:
            _upsert_price_cache(db, symbol, quote)
            db.commit()
            updated += 1
        except Exception as e:
            db.rollback()
            logger.error(f"Failed to update price_cache for {symbol}: {e}")
            failed += 1

    logger.info(f"Price refresh done — updated: {updated}, failed: {failed}")

    if updated > 0:
        _update_holdings_unrealized(db)


# ============================================================
# PUBLIC METHOD 3 — store_daily_close
# Called by nightly scheduler
# ============================================================

def store_daily_close(db: Session):
    """
    Copy today's OHLCV from price_cache → price_history.
    Called once per day after market close.
    """
    try:
        db.execute(text("""
            INSERT INTO price_history (
                symbol, date, currency,
                open, high, low, close, volume,
                average_volume, day_change, day_change_pct,
                source
            )
            SELECT
                symbol, CURRENT_DATE, currency,
                open, high, low, close, volume,
                average_volume, day_change, day_change_pct,
                'twelvedata'
            FROM price_cache
            WHERE close IS NOT NULL
            ON CONFLICT (symbol, date, currency) DO UPDATE SET
                open           = EXCLUDED.open,
                high           = EXCLUDED.high,
                low            = EXCLUDED.low,
                close          = EXCLUDED.close,
                volume         = EXCLUDED.volume,
                average_volume = EXCLUDED.average_volume,
                day_change     = EXCLUDED.day_change,
                day_change_pct = EXCLUDED.day_change_pct
        """))
        db.commit()
        logger.info("Daily close stored to price_history")
    except Exception as e:
        db.rollback()
        logger.error(f"Failed to store daily close: {e}")


# ============================================================
# INTERNAL — update holdings unrealized G/L
# ============================================================

def _update_holdings_unrealized(db: Session):
    """
    Update open holdings with latest prices from price_cache.
    Uses effective close (which may be previous_close when market is closed).
    """
    try:
        db.execute(text("""
            UPDATE holdings h
            SET
                current_price            = pc.close,
                previous_close           = pc.previous_close,
                day_change               = pc.day_change,
                day_change_pct           = pc.day_change_pct,
                market_value             = ROUND(pc.close * h.quantity_total, 2),
                unrealized_gain_loss     = ROUND(
                    (pc.close - h.acb_per_share) * h.quantity_total, 2
                ),
                unrealized_gain_loss_pct = CASE
                    WHEN h.total_acb > 0
                    THEN ROUND(
                        ((pc.close * h.quantity_total - h.total_acb) / h.total_acb) * 100, 4
                    )
                    ELSE NULL
                END,
                realized_gain_loss_pct = CASE
                    WHEN h.total_cost_sold > 0
                    THEN ROUND((h.realized_gain_loss / h.total_cost_sold) * 100, 4)
                    ELSE NULL
                END,
                price_updated_at = NOW(),
                updated_at       = NOW()
            FROM price_cache pc
            WHERE pc.symbol   = h.symbol
            AND   pc.currency = h.currency
            AND   h.is_position_open = TRUE
            AND   h.quantity_total   > 0
        """))

        # Realized % for closed positions (no price needed)
        db.execute(text("""
            UPDATE holdings
            SET
                realized_gain_loss_pct = CASE
                    WHEN total_cost_sold > 0
                    THEN ROUND((realized_gain_loss / total_cost_sold) * 100, 4)
                    ELSE NULL
                END,
                updated_at = NOW()
            WHERE is_position_open = FALSE
            AND   realized_gain_loss_pct IS NULL
            AND   total_cost_sold > 0
        """))

        # Clear stale prices for open positions with no price
        db.execute(text("""
            UPDATE holdings h
            SET
                current_price            = NULL,
                previous_close           = NULL,
                day_change               = NULL,
                day_change_pct           = NULL,
                market_value             = NULL,
                unrealized_gain_loss     = NULL,
                unrealized_gain_loss_pct = NULL,
                updated_at               = NOW()
            WHERE h.is_position_open = TRUE
            AND NOT EXISTS (
                SELECT 1 FROM price_cache pc
                WHERE pc.symbol = h.symbol AND pc.currency = h.currency
            )
        """))

        db.commit()
        logger.info("Holdings unrealized G/L updated")

    except Exception as e:
        db.rollback()
        logger.error(f"Failed to update holdings unrealized: {e}")
