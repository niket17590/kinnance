import json
import logging
import math
import os
from datetime import date, datetime
from decimal import Decimal

import yfinance as yf
from dateutil import parser as date_parser
from sqlalchemy import text
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

EARNINGS_REFRESH_MAX_SYMBOLS = int(os.getenv("EARNINGS_REFRESH_MAX_SYMBOLS", "60"))
YFINANCE_CACHE_DIR = os.getenv(
    "YFINANCE_CACHE_DIR",
    os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".cache")),
)
os.makedirs(YFINANCE_CACHE_DIR, exist_ok=True)
yf.set_tz_cache_location(YFINANCE_CACHE_DIR)


def _safe_decimal(value) -> str | None:
    if value is None:
        return None
    try:
        if value != value:
            return None
    except Exception:
        pass
    try:
        numeric = float(value)
        if math.isnan(numeric) or math.isinf(numeric):
            return None
        return str(Decimal(str(numeric)))
    except Exception:
        return None


def _safe_date(value) -> date | None:
    if value is None:
        return None
    try:
        if value != value:
            return None
    except Exception:
        pass
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    try:
        return date_parser.parse(str(value)).date()
    except Exception:
        return None


def _first_present(row: dict, keys: list[str]):
    for key in keys:
        if key in row and row[key] is not None:
            return row[key]
    return None


def _calendar_value(calendar, keys: list[str]):
    if calendar is None:
        return None
    if isinstance(calendar, dict):
        return _first_present(calendar, keys)
    try:
        if hasattr(calendar, "empty") and calendar.empty:
            return None
        if hasattr(calendar, "loc"):
            for key in keys:
                if key in calendar.index:
                    value = calendar.loc[key]
                    if hasattr(value, "iloc"):
                        return value.iloc[0]
                    return value
        data = calendar.to_dict()
        for key in keys:
            value = data.get(key)
            if isinstance(value, dict):
                return next(iter(value.values()), None)
            if value is not None:
                return value
    except Exception:
        return None
    return None


def _normalize_earnings_dates(df) -> dict:
    if df is None or getattr(df, "empty", True):
        return {}

    today = date.today()
    rows = []
    for idx, row in df.iterrows():
        row_date = _safe_date(idx)
        if not row_date:
            continue
        row_dict = row.to_dict()
        rows.append((row_date, row_dict))

    if not rows:
        return {}

    future_rows = [item for item in rows if item[0] >= today]
    past_rows = [item for item in rows if item[0] < today]

    result = {}
    if future_rows:
        next_date, next_row = min(future_rows, key=lambda item: item[0])
        result.update({
            "earnings_date": next_date,
            "eps_estimate": _safe_decimal(_first_present(next_row, ["EPS Estimate", "Eps Estimate"])),
            "eps_actual": _safe_decimal(_first_present(next_row, ["Reported EPS", "Reported Eps"])),
            "eps_surprise_pct": _safe_decimal(_first_present(next_row, ["Surprise(%)", "Surprise (%)"])),
        })

    if past_rows:
        previous_date, previous_row = max(past_rows, key=lambda item: item[0])
        result.update({
            "previous_earnings_date": previous_date,
            "previous_eps_estimate": _safe_decimal(_first_present(previous_row, ["EPS Estimate", "Eps Estimate"])),
            "previous_eps_actual": _safe_decimal(_first_present(previous_row, ["Reported EPS", "Reported Eps"])),
            "previous_eps_surprise_pct": _safe_decimal(_first_present(previous_row, ["Surprise(%)", "Surprise (%)"])),
        })

    if not result:
        selected_date, selected = max(rows, key=lambda item: item[0])
        result.update({
            "earnings_date": selected_date,
            "eps_estimate": _safe_decimal(_first_present(selected, ["EPS Estimate", "Eps Estimate"])),
            "eps_actual": _safe_decimal(_first_present(selected, ["Reported EPS", "Reported Eps"])),
            "eps_surprise_pct": _safe_decimal(_first_present(selected, ["Surprise(%)", "Surprise (%)"])),
        })

    return result


def _get_earnings_dates(ticker) -> dict:
    try:
        if hasattr(ticker, "get_earnings_dates"):
            return _normalize_earnings_dates(ticker.get_earnings_dates(limit=8))
    except Exception as exc:
        logger.debug("yfinance get_earnings_dates unavailable: %s", exc)

    try:
        return _normalize_earnings_dates(ticker.earnings_dates)
    except Exception as exc:
        logger.debug("yfinance earnings_dates failed: %s", exc)
    return {}


def _get_earnings_history(ticker) -> dict:
    try:
        history = ticker.get_earnings_history()
    except Exception as exc:
        logger.debug("yfinance earnings_history failed: %s", exc)
        return {}

    if history is None or getattr(history, "empty", True):
        return {}

    rows = []
    for idx, row in history.iterrows():
        row_date = _safe_date(idx)
        if not row_date:
            continue
        rows.append((row_date, row.to_dict()))

    if not rows:
        return {}

    previous_date, previous_row = max(rows, key=lambda item: item[0])
    return {
        "previous_earnings_date": previous_date,
        "previous_eps_estimate": _safe_decimal(_first_present(previous_row, ["epsEstimate", "EPS Estimate"])),
        "previous_eps_actual": _safe_decimal(_first_present(previous_row, ["epsActual", "Reported EPS"])),
        "previous_eps_surprise_pct": _safe_decimal(_first_present(previous_row, ["surprisePercent", "Surprise(%)"])),
    }


def _get_calendar_data(ticker) -> dict:
    try:
        calendar = ticker.calendar
    except Exception as exc:
        logger.debug("yfinance calendar failed: %s", exc)
        return {}

    earnings_date_raw = _calendar_value(calendar, ["Earnings Date", "Earnings Date Start"])
    if isinstance(earnings_date_raw, (list, tuple)) and earnings_date_raw:
        earnings_date_raw = earnings_date_raw[0]

    return {
        "earnings_date": _safe_date(earnings_date_raw),
        "eps_estimate": _safe_decimal(_calendar_value(calendar, ["Earnings Average", "EPS Average"])),
        "revenue_estimate": _safe_decimal(_calendar_value(calendar, ["Revenue Average"])),
    }


def _build_points(data: dict) -> tuple[list[str], list[str]]:
    bullish = []
    bearish = []

    if data.get("previous_eps_actual") is not None:
        eps_actual = _safe_decimal(data.get("previous_eps_actual"))
        eps_estimate = _safe_decimal(data.get("previous_eps_estimate"))
    else:
        eps_actual = _safe_decimal(data.get("eps_actual"))
        eps_estimate = _safe_decimal(data.get("eps_estimate"))

    if data.get("previous_revenue_actual") is not None:
        revenue_actual = _safe_decimal(data.get("previous_revenue_actual"))
        revenue_estimate = _safe_decimal(data.get("previous_revenue_estimate"))
    else:
        revenue_actual = _safe_decimal(data.get("revenue_actual"))
        revenue_estimate = _safe_decimal(data.get("revenue_estimate"))

    if eps_actual is not None and eps_estimate is not None:
        actual = Decimal(eps_actual)
        estimate = Decimal(eps_estimate)
        if actual >= estimate:
            bullish.append("EPS met or beat estimate")
        else:
            bearish.append("EPS missed estimate")

    if revenue_actual is not None and revenue_estimate is not None:
        actual = Decimal(revenue_actual)
        estimate = Decimal(revenue_estimate)
        if actual >= estimate:
            bullish.append("Revenue met or beat estimate")
        else:
            bearish.append("Revenue missed estimate")

    return bullish[:3], bearish[:3]


def fetch_earnings_event(symbol: str) -> dict:
    ticker = yf.Ticker(symbol)
    data = {"symbol": symbol, "source": "yfinance"}

    calendar_data = _get_calendar_data(ticker)
    dates_data = _get_earnings_dates(ticker)
    history_data = _get_earnings_history(ticker)
    data.update(calendar_data)
    data.update({k: v for k, v in dates_data.items() if v is not None})
    data.update({k: v for k, v in history_data.items() if v is not None})

    earnings_date = data.get("earnings_date")
    eps_actual = _safe_decimal(data.get("eps_actual"))
    today = date.today()

    if eps_actual is not None:
        status = "REPORTED"
    elif earnings_date == today:
        status = "TODAY"
    elif earnings_date and earnings_date > today:
        status = "UPCOMING"
    else:
        status = "UNKNOWN"

    data["status"] = status
    data["eps_estimate"] = _safe_decimal(data.get("eps_estimate"))
    data["eps_actual"] = eps_actual
    data["eps_surprise_pct"] = _safe_decimal(data.get("eps_surprise_pct"))
    data["revenue_estimate"] = _safe_decimal(data.get("revenue_estimate"))
    data["revenue_actual"] = _safe_decimal(data.get("revenue_actual"))
    data["revenue_surprise_pct"] = _safe_decimal(data.get("revenue_surprise_pct"))
    data["previous_eps_estimate"] = _safe_decimal(data.get("previous_eps_estimate"))
    data["previous_eps_actual"] = _safe_decimal(data.get("previous_eps_actual"))
    data["previous_eps_surprise_pct"] = _safe_decimal(data.get("previous_eps_surprise_pct"))
    data["previous_revenue_estimate"] = _safe_decimal(data.get("previous_revenue_estimate"))
    data["previous_revenue_actual"] = _safe_decimal(data.get("previous_revenue_actual"))
    data["previous_revenue_surprise_pct"] = _safe_decimal(data.get("previous_revenue_surprise_pct"))
    data["bullish_points"], data["bearish_points"] = _build_points(data)
    return data


def _upsert_earnings_event(db: Session, event: dict):
    db.execute(
        text("""
            INSERT INTO earnings_events (
                symbol, earnings_date, earnings_time, fiscal_quarter, status,
                eps_estimate, eps_actual, eps_surprise_pct,
                revenue_estimate, revenue_actual, revenue_surprise_pct,
                previous_earnings_date,
                previous_eps_estimate, previous_eps_actual, previous_eps_surprise_pct,
                previous_revenue_estimate, previous_revenue_actual, previous_revenue_surprise_pct,
                bullish_points, bearish_points, source,
                last_checked_at, fetched_at
            )
            VALUES (
                :symbol, :earnings_date, :earnings_time, :fiscal_quarter, :status,
                :eps_estimate, :eps_actual, :eps_surprise_pct,
                :revenue_estimate, :revenue_actual, :revenue_surprise_pct,
                :previous_earnings_date,
                :previous_eps_estimate, :previous_eps_actual, :previous_eps_surprise_pct,
                :previous_revenue_estimate, :previous_revenue_actual, :previous_revenue_surprise_pct,
                CAST(:bullish_points AS jsonb), CAST(:bearish_points AS jsonb), :source,
                NOW(), NOW()
            )
            ON CONFLICT (symbol) DO UPDATE SET
                earnings_date = EXCLUDED.earnings_date,
                earnings_time = EXCLUDED.earnings_time,
                fiscal_quarter = EXCLUDED.fiscal_quarter,
                status = EXCLUDED.status,
                eps_estimate = EXCLUDED.eps_estimate,
                eps_actual = EXCLUDED.eps_actual,
                eps_surprise_pct = EXCLUDED.eps_surprise_pct,
                revenue_estimate = EXCLUDED.revenue_estimate,
                revenue_actual = EXCLUDED.revenue_actual,
                revenue_surprise_pct = EXCLUDED.revenue_surprise_pct,
                previous_earnings_date = EXCLUDED.previous_earnings_date,
                previous_eps_estimate = EXCLUDED.previous_eps_estimate,
                previous_eps_actual = EXCLUDED.previous_eps_actual,
                previous_eps_surprise_pct = EXCLUDED.previous_eps_surprise_pct,
                previous_revenue_estimate = EXCLUDED.previous_revenue_estimate,
                previous_revenue_actual = EXCLUDED.previous_revenue_actual,
                previous_revenue_surprise_pct = EXCLUDED.previous_revenue_surprise_pct,
                bullish_points = EXCLUDED.bullish_points,
                bearish_points = EXCLUDED.bearish_points,
                source = EXCLUDED.source,
                last_checked_at = NOW(),
                fetched_at = NOW()
        """),
        {
            "symbol": event["symbol"],
            "earnings_date": event.get("earnings_date"),
            "earnings_time": event.get("earnings_time"),
            "fiscal_quarter": event.get("fiscal_quarter"),
            "status": event.get("status", "UNKNOWN"),
            "eps_estimate": event.get("eps_estimate"),
            "eps_actual": event.get("eps_actual"),
            "eps_surprise_pct": event.get("eps_surprise_pct"),
            "revenue_estimate": event.get("revenue_estimate"),
            "revenue_actual": event.get("revenue_actual"),
            "revenue_surprise_pct": event.get("revenue_surprise_pct"),
            "previous_earnings_date": event.get("previous_earnings_date"),
            "previous_eps_estimate": event.get("previous_eps_estimate"),
            "previous_eps_actual": event.get("previous_eps_actual"),
            "previous_eps_surprise_pct": event.get("previous_eps_surprise_pct"),
            "previous_revenue_estimate": event.get("previous_revenue_estimate"),
            "previous_revenue_actual": event.get("previous_revenue_actual"),
            "previous_revenue_surprise_pct": event.get("previous_revenue_surprise_pct"),
            "bullish_points": json.dumps(event.get("bullish_points") or []),
            "bearish_points": json.dumps(event.get("bearish_points") or []),
            "source": event.get("source", "yfinance"),
        },
    )


def sync_earnings_events(db: Session) -> dict:
    rows = db.execute(
        text("SELECT symbol FROM security_master WHERE is_active = TRUE ORDER BY symbol")
    ).fetchall()
    symbols = [row.symbol for row in rows if row.symbol]
    if not symbols:
        logger.info("Earnings sync skipped: no active symbols")
        return {"active_symbols": 0, "refreshed": 0, "failed": 0}

    db.execute(
        text("""
            INSERT INTO earnings_events (symbol, status, last_checked_at)
            SELECT unnest(CAST(:symbols AS text[])), 'UNKNOWN', NOW()
            ON CONFLICT (symbol) DO NOTHING
        """),
        {"symbols": symbols},
    )
    db.commit()

    refresh_rows = db.execute(
        text("""
            SELECT symbol
            FROM earnings_events
            WHERE symbol = ANY(CAST(:symbols AS text[]))
              AND (
                    fetched_at IS NULL
                    OR status = 'UNKNOWN'
                    OR earnings_date IS NULL
                    OR previous_earnings_date IS NULL
                    OR previous_eps_actual IS NULL
                    OR (status <> 'REPORTED' AND earnings_date <= CURRENT_DATE + INTERVAL '1 day')
                    OR (status = 'REPORTED' AND earnings_date >= CURRENT_DATE - INTERVAL '2 days')
              )
            ORDER BY
                CASE
                    WHEN earnings_date = CURRENT_DATE THEN 0
                    WHEN earnings_date IS NULL THEN 1
                    ELSE 2
                END,
                earnings_date ASC NULLS LAST,
                symbol ASC
            LIMIT :limit
        """),
        {"symbols": symbols, "limit": EARNINGS_REFRESH_MAX_SYMBOLS},
    ).fetchall()

    refreshed = 0
    failed = 0
    for row in refresh_rows:
        try:
            event = fetch_earnings_event(row.symbol)
            _upsert_earnings_event(db, event)
            db.commit()
            refreshed += 1
        except Exception as exc:
            db.rollback()
            failed += 1
            logger.warning("Earnings sync failed for %s: %s", row.symbol, exc)
            db.execute(
                text("""
                    UPDATE earnings_events
                    SET last_checked_at = NOW()
                    WHERE symbol = :symbol
                """),
                {"symbol": row.symbol},
            )
            db.commit()

    logger.info(
        "Earnings sync complete: active=%s refreshed=%s failed=%s",
        len(symbols),
        refreshed,
        failed,
    )
    return {"active_symbols": len(symbols), "refreshed": refreshed, "failed": failed}
