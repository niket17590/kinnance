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
# EXCHANGE → YFINANCE SUFFIX MAPPING
# Used when resolving bare Canadian tickers to canonical form
# ============================================================
EXCHANGE_TO_SUFFIX = {
    'TSX':  '.TO',
    'TSXV': '.V',
    'CSE':  '.CN',
    'NEO':  '.NE',
}

CANADIAN_SUFFIXES = {'.TO', '.V', '.CN', '.NE', '.TSX'}


def _is_canadian(symbol: str) -> bool:
    """True if symbol has a Canadian exchange suffix."""
    upper = symbol.upper()
    return any(upper.endswith(s) for s in CANADIAN_SUFFIXES)


def _get_currency(symbol: str) -> str:
    return "CAD" if _is_canadian(symbol) else "USD"


def _safe_decimal(val) -> str | None:
    try:
        if val is None or str(val) in ("NaN", ""):
            return None
        return str(Decimal(str(float(val))))
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
    return str(val).lower() == "true"


# ============================================================
# IN-MEMORY DUAL QUEUES
# US symbols → Twelve Data
# CA symbols → yfinance
# ============================================================

_us_queue: deque = deque()
_ca_queue: deque = deque()
_queue_set: set = set()


def load_queue_from_db(db: Session):
    """Load all active symbols from security_master into correct queue."""
    global _us_queue, _ca_queue, _queue_set
    rows = db.execute(
        text("SELECT symbol FROM security_master WHERE is_active = TRUE ORDER BY symbol")
    ).fetchall()
    _us_queue = deque()
    _ca_queue = deque()
    _queue_set = set()
    for row in rows:
        sym = row.symbol
        _queue_set.add(sym)
        if _is_canadian(sym):
            _ca_queue.append(sym)
        else:
            _us_queue.append(sym)
    logger.info(f"Price queues loaded — US: {len(_us_queue)}, CA: {len(_ca_queue)}")


def push_to_queue(symbols: list[str], priority: bool = False):
    """
    Push new symbols to the appropriate queue (US or CA).
    priority=True → front of queue (fetched on next run)
    priority=False → back of queue (normal rotation)
    """
    added_us = 0
    added_ca = 0
    for symbol in (reversed(symbols) if priority else symbols):
        if symbol in _queue_set:
            continue
        _queue_set.add(symbol)
        if _is_canadian(symbol):
            _ca_queue.appendleft(symbol) if priority else _ca_queue.append(symbol)
            added_ca += 1
        else:
            _us_queue.appendleft(symbol) if priority else _us_queue.append(symbol)
            added_us += 1
    if added_us or added_ca:
        pos = "front" if priority else "back"
        logger.info(f"Pushed to {pos} — US: {added_us}, CA: {added_ca}. Queue: US={len(_us_queue)}, CA={len(_ca_queue)}")


def pop_next_batch(queue: deque, batch_size: int) -> list[str]:
    """Pop next batch from queue, rotating symbols to back."""
    if not queue:
        return []
    batch = []
    for _ in range(min(batch_size, len(queue))):
        sym = queue.popleft()
        queue.append(sym)
        batch.append(sym)
    return batch


def queue_sizes() -> dict:
    return {"us": len(_us_queue), "ca": len(_ca_queue)}


def remove_from_queue(symbol: str):
    """Remove a symbol from whichever queue it's in."""
    if symbol in _queue_set:
        _queue_set.discard(symbol)
        try:
            _us_queue.remove(symbol)
        except ValueError:
            pass
        try:
            _ca_queue.remove(symbol)
        except ValueError:
            pass


# ============================================================
# SYMBOL RESOLUTION
# Resolves bare Canadian tickers (e.g. QESS) to canonical
# exchange-suffixed form (e.g. QESS.CN) using Twelve Data
# symbol_search with demo key (always free).
# ============================================================

def resolve_canonical_symbol(db: Session, symbol: str, currency: str) -> str:
    """
    For a bare symbol with CAD currency, resolve to canonical exchange-suffixed form.

    Resolution order:
    1. Already has Canadian suffix → return as-is
    2. Try yfinance — if valid US-listed stock found (currency=USD) → return original (no suffix)
    3. Check symbol_aliases table
    4. Call Twelve Data /symbol_search → find first Canadian result → store alias → return

    Returns canonical symbol (e.g. QESS.CN) or original symbol if US stock or unresolvable.
    """
    if currency != 'CAD':
        return symbol
    if _is_canadian(symbol):
        return symbol

    # Step 1 — try yfinance: if it's a valid US stock, don't add Canadian suffix
    try:
        ticker = yf.Ticker(symbol)
        info = ticker.info or {}
        yf_currency = (info.get("currency") or "").upper()
        yf_name = info.get("longName") or info.get("shortName") or ""
        if yf_name and yf_currency == "USD":
            logger.info(f"Symbol {symbol} confirmed as US stock via yfinance — no suffix applied")
            return symbol
    except Exception as e:
        logger.debug(f"yfinance lookup failed for {symbol}: {e}")

    # Step 2 — check alias table
    row = db.execute(
        text("SELECT canonical_symbol FROM symbol_aliases WHERE bare_symbol = :sym"),
        {"sym": symbol.upper()}
    ).fetchone()
    if row:
        logger.info(f"Symbol alias found: {symbol} → {row.canonical_symbol}")
        return row.canonical_symbol

    # Step 3 — call Twelve Data symbol_search (demo key, always free)
    try:
        with httpx.Client(timeout=10) as client:
            response = client.get(
                f"{TWELVEDATA_BASE_URL}/symbol_search",
                params={"symbol": symbol, "apikey": "demo"}
            )
            response.raise_for_status()
            data = response.json()

        entries = data.get("data", [])
        canadian = next(
            (e for e in entries
             if e.get("country") == "Canada"
             and e.get("symbol", "").upper() == symbol.upper()),
            None
        )

        if canadian:
            exchange = canadian.get("exchange", "")
            suffix = EXCHANGE_TO_SUFFIX.get(exchange)
            if suffix:
                canonical = f"{symbol.upper()}{suffix}"
                try:
                    db.execute(
                        text("""
                            INSERT INTO symbol_aliases (bare_symbol, canonical_symbol, exchange, country)
                            VALUES (:bare, :canonical, :exchange, 'CA')
                            ON CONFLICT (bare_symbol) DO NOTHING
                        """),
                        {"bare": symbol.upper(), "canonical": canonical, "exchange": exchange}
                    )
                    db.commit()
                    logger.info(f"Symbol resolved and stored: {symbol} → {canonical} ({exchange})")
                except Exception:
                    db.rollback()
                return canonical

    except Exception as e:
        logger.warning(f"Symbol resolution failed for {symbol}: {e}")

    logger.warning(f"Could not resolve canonical symbol for {symbol} (CAD) — using as-is")
    return symbol


def get_historical_price_usd(symbol: str, trade_date) -> float | None:
    """
    Fetch the closing price in USD for a symbol on a specific date via yfinance.
    Used to convert pre-2025 WealthSimple CAD-settled USD stock transactions.
    Returns None if price cannot be fetched.
    """
    import datetime
    try:
        if isinstance(trade_date, str):
            trade_date = datetime.date.fromisoformat(trade_date)

        # Fetch a 5-day window around the trade date to handle weekends/holidays
        start = trade_date - datetime.timedelta(days=4)
        end = trade_date + datetime.timedelta(days=1)

        ticker = yf.Ticker(symbol)
        hist = ticker.history(start=start.isoformat(), end=end.isoformat())

        if hist.empty:
            logger.warning(f"yfinance: no historical price for {symbol} around {trade_date}")
            return None

        # Use the closest date on or before the trade date
        hist.index = hist.index.date
        available = [d for d in hist.index if d <= trade_date]
        if not available:
            available = list(hist.index)  # fallback: take nearest available

        closest = max(available)
        price = float(hist.loc[closest, "Close"])
        logger.info(f"Historical price for {symbol} on {trade_date} (using {closest}): {price} USD")
        return price

    except Exception as e:
        logger.warning(f"Failed to fetch historical price for {symbol} on {trade_date}: {e}")
        return None


# ============================================================
# YAHOO FINANCE — security master info (one-time per symbol)
# ============================================================

def _fetch_security_info_yfinance(symbol: str) -> dict:
    """Fetch company profile from Yahoo Finance. One-time per symbol."""
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
            "asset_type": _detect_asset_type_from_yf(info.get("quoteType")),
        }
    except Exception as e:
        logger.error(f"yfinance profile fetch failed for {symbol}: {e}")
        return {}


def _detect_asset_type_from_yf(quote_type: str | None) -> str:
    if not quote_type:
        return "STOCK"
    return {
        "EQUITY":       "STOCK",
        "ETF":          "ETF",
        "MUTUALFUND":   "MUTUAL_FUND",
        "CRYPTOCURRENCY": "CRYPTO",
    }.get(quote_type.upper(), "STOCK")


# ============================================================
# TWELVE DATA — US price cache
# ============================================================

def _call_quote_batch_twelvedata(symbols: list[str]) -> dict:
    """Fetch latest quotes for US symbols from Twelve Data."""
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

        if isinstance(data, dict) and data.get("status") == "error":
            logger.warning(f"Twelve Data error: {data.get('message')}")
            return {}

        if len(symbols) == 1:
            sym = symbols[0]
            if isinstance(data, dict) and "symbol" in data and data.get("status") != "error":
                return {sym: data}
            return {}

        return {k: v for k, v in data.items()
                if isinstance(v, dict) and v.get("status") != "error"}

    except Exception as e:
        logger.error(f"Twelve Data batch fetch failed: {e}")
        return {}


def _call_quote_yfinance(symbols: list[str]) -> dict:
    """Fetch latest quotes for Canadian symbols via yfinance."""
    if not symbols:
        return {}
    results = {}
    for symbol in symbols:
        try:
            ticker = yf.Ticker(symbol)
            hist = ticker.history(period="2d")
            info = ticker.info or {}
            if hist.empty:
                logger.warning(f"yfinance: no data for {symbol}")
                continue

            last_close = float(hist["Close"].iloc[-1])
            prev_close = float(hist["Close"].iloc[-2]) if len(hist) > 1 else None
            day_change = (last_close - prev_close) if prev_close else None
            day_change_pct = ((day_change / prev_close) * 100) if prev_close and prev_close != 0 else None

            results[symbol] = {
                "symbol":          symbol,
                "name":            info.get("longName") or info.get("shortName"),
                "exchange":        info.get("exchange"),
                "currency":        info.get("currency", "CAD"),
                "close":           str(last_close),
                "previous_close":  str(prev_close) if prev_close else None,
                "change":          str(day_change) if day_change is not None else None,
                "percent_change":  str(day_change_pct) if day_change_pct is not None else None,
                "open":            str(float(hist["Open"].iloc[-1])),
                "high":            str(float(hist["High"].iloc[-1])),
                "low":             str(float(hist["Low"].iloc[-1])),
                "volume":          int(hist["Volume"].iloc[-1]),
                "average_volume":  info.get("averageVolume"),
                "is_market_open":  False,  # yfinance doesn't provide this easily
                "fifty_two_week": {
                    "high": str(info.get("fiftyTwoWeekHigh", "")),
                    "low":  str(info.get("fiftyTwoWeekLow", "")),
                    "high_change": str(last_close - info["fiftyTwoWeekHigh"])
                        if info.get("fiftyTwoWeekHigh") else None,
                    "low_change": str(last_close - info["fiftyTwoWeekLow"])
                        if info.get("fiftyTwoWeekLow") else None,
                }
            }
        except Exception as e:
            logger.error(f"yfinance price fetch failed for {symbol}: {e}")
    return results


# ============================================================
# DB UPSERTS
# ============================================================

def _upsert_security_master(db: Session, symbol: str, info: dict):
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
    """Upsert price_cache from either Twelve Data or yfinance quote dict."""
    if not quote:
        return

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
            "symbol":         symbol,
            "currency":       quote.get("currency") or _get_currency(symbol),
            "name":           quote.get("name"),
            "exchange":       quote.get("exchange"),
            "mic_code":       quote.get("mic_code"),
            "trade_date":     quote.get("datetime"),
            "last_quote_at":  last_quote_at,
            "is_market_open": _safe_bool(quote.get("is_market_open")),
            "open":           _safe_decimal(quote.get("open")),
            "high":           _safe_decimal(quote.get("high")),
            "low":            _safe_decimal(quote.get("low")),
            "close":          _safe_decimal(effective_close),
            "volume":         _safe_int(quote.get("volume")),
            "avg_volume":     _safe_int(quote.get("average_volume")),
            "prev_close":     _safe_decimal(prev_val),
            "day_change":     _safe_decimal(quote.get("change")),
            "day_change_pct": _safe_decimal(quote.get("percent_change")),
            "w52_low":        _safe_decimal(fw.get("low")),
            "w52_high":       _safe_decimal(fw.get("high")),
            "w52_low_chg":    _safe_decimal(fw.get("low_change")),
            "w52_high_chg":   _safe_decimal(fw.get("high_change")),
            "w52_low_chg_pct":  _safe_decimal(fw.get("low_change_percent")),
            "w52_high_chg_pct": _safe_decimal(fw.get("high_change_percent")),
            "w52_range":      fw.get("range"),
        }
    )


# ============================================================
# PUBLIC METHOD 1 — ensure_securities_exist
# ============================================================

def ensure_securities_exist(db: Session, symbols: list[str]):
    """
    For each symbol NOT in security_master:
      → Fetch company info from yfinance
      → Insert into security_master
    Skips already-known symbols.
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
# US symbols → Twelve Data, CA symbols → yfinance
# ============================================================

def refresh_prices(db: Session, us_symbols: list[str], ca_symbols: list[str]):
    """
    Fetch and store latest prices.
    US symbols → Twelve Data /quote
    CA symbols → yfinance
    Updates holdings unrealized G/L after storing.
    """
    updated = 0
    failed = 0

    # US stocks via Twelve Data
    if us_symbols:
        logger.info(f"Fetching US prices via Twelve Data: {us_symbols}")
        quotes = _call_quote_batch_twelvedata(us_symbols)
        for symbol in us_symbols:
            quote = quotes.get(symbol)
            if not quote:
                logger.warning(f"No quote from Twelve Data for {symbol}")
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

    # Canadian stocks via yfinance
    if ca_symbols:
        logger.info(f"Fetching CA prices via yfinance: {ca_symbols}")
        quotes = _call_quote_yfinance(ca_symbols)
        for symbol in ca_symbols:
            quote = quotes.get(symbol)
            if not quote:
                logger.warning(f"No quote from yfinance for {symbol}")
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
        update_holdings_unrealized_from_cache(db)


# ============================================================
# PUBLIC METHOD 3 — store_daily_close
# ============================================================

def store_daily_close(db: Session):
    """Copy today's close from price_cache → price_history."""
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
                'combined'
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
# PUBLIC METHOD 4 — disable_symbol (for security rename)
# ============================================================

def disable_symbol(db: Session, symbol: str):
    """
    Disable a symbol — used when a stock is renamed.
    Marks as inactive in security_master, removes from price_cache and queue.
    """
    try:
        db.execute(
            text("UPDATE security_master SET is_active = FALSE, updated_at = NOW() WHERE symbol = :sym"),
            {"sym": symbol}
        )
        db.execute(
            text("DELETE FROM price_cache WHERE symbol = :sym"),
            {"sym": symbol}
        )
        db.commit()
        remove_from_queue(symbol)
        logger.info(f"Symbol disabled: {symbol}")
    except Exception as e:
        db.rollback()
        logger.error(f"Failed to disable symbol {symbol}: {e}")


# ============================================================
# INTERNAL — update holdings unrealized G/L
# ============================================================

def update_holdings_unrealized_from_cache(db: Session):
    """Re-apply existing price_cache values to current holdings rows."""
    _update_holdings_unrealized(db)


def _update_holdings_unrealized(db: Session):
    """Update open holdings with latest prices from price_cache."""
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
