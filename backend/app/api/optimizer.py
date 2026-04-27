"""
Portfolio Consolidation Optimizer — v1 restored + two fixes
============================================================
Pair-swap model (original v1):

  For each pair of candidate stocks (A, B):
    Find pos_a in some account X (non-home, at loss)
    Find pos_b in some DIFFERENT account Y (non-home, at loss)
    Account X: SELL A, BUY B
    Account Y: SELL B, BUY A

Fixes applied over original v1:
  1. after-state scans entire working dict (not just original positions)
  2. loss harvest only counted for taxable accounts (not TFSA/RRSP/FHSA)
"""

import logging
from dataclasses import dataclass, field
from typing import Optional

from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import text

from app.core.database import get_db
from app.core.security import get_current_db_user

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/optimizer", tags=["optimizer"])

MIN_SHARES     = 10
MIN_VALUE      = 500.0
HOME_THRESHOLD = 0.70
TAXABLE_CATEGORIES = {'TAXABLE', 'CORP_TAXABLE'}


@dataclass
class Position:
    account_id: str
    account_label: str
    broker_code: str
    account_type_code: str
    tax_category: str
    symbol: str
    quantity: float
    current_price: float
    market_value: float
    unrealized_gl: float
    acb_per_share: float

    @property
    def is_sellable(self) -> bool:
        return self.unrealized_gl <= 0

    @property
    def is_taxable(self) -> bool:
        return self.tax_category in TAXABLE_CATEGORIES

    @property
    def is_odd_lot(self) -> bool:
        return (round(self.quantity) % 100) != 0


@dataclass
class SwapLeg:
    action: str          # "SELL" or "BUY"
    symbol: str
    quantity: float
    price: float
    value: float
    account_id: str
    account_label: str
    unrealized_gl: float  # for SELL legs; 0 for non-taxable or BUY


@dataclass
class Swap:
    swap_id: int
    legs: list[SwapLeg]
    total_loss_harvested: float
    total_qty_moved: float
    cash_residuals: dict[str, float]   # account_id → residual cash +/-
    note: str = ""


@dataclass
class StockAnalysis:
    symbol: str
    total_quantity: float
    total_value: float
    account_count: int
    home_account_id: str
    home_account_label: str
    home_qty: float
    home_pct: float
    positions: list[Position]
    sellable_non_home: list[Position]
    stuck_non_home: list[Position]


# ── Main endpoint ────────────────────────────────────────────────────────────

@router.get("")
def run_optimizer(
    circle_id: str = Query(...),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_db_user)
):
    owner_id = str(current_user.id)

    circle = db.execute(
        text("SELECT id, name FROM circles WHERE id=:cid AND owner_id=:oid AND is_active=TRUE"),
        {"cid": circle_id, "oid": owner_id}
    ).fetchone()
    if not circle:
        raise HTTPException(status_code=404, detail="Circle not found")

    rows = db.execute(text("""
        SELECT
            h.symbol, h.quantity_total, h.current_price, h.market_value,
            h.unrealized_gain_loss AS unrealized_gl,
            h.acb_per_share,
            ma.id AS account_id, ma.broker_code, ma.account_type_code,
            ma.nickname, b.name AS broker_name, at.name AS account_type_name,
            at.tax_category, m.display_name AS member_name
        FROM holdings h
        JOIN member_accounts ma ON h.account_id = ma.id
        JOIN members m          ON ma.member_id  = m.id
        JOIN circle_accounts ca ON ca.account_id = ma.id
        JOIN brokers b          ON ma.broker_code = b.code
        JOIN account_types at   ON ma.account_type_code = at.code
        WHERE ca.circle_id = :cid AND m.owner_id = :oid
          AND h.is_position_open = TRUE AND h.quantity_total > 0
          AND h.current_price IS NOT NULL
    """), {"cid": circle_id, "oid": owner_id}).fetchall()

    if not rows:
        return _empty(circle_id, circle.name)

    positions: list[Position] = []
    for r in rows:
        label = f"{r.member_name} {r.nickname or r.account_type_name} @ {r.broker_name}"
        positions.append(Position(
            account_id=str(r.account_id),
            account_label=label,
            broker_code=r.broker_code,
            account_type_code=r.account_type_code,
            tax_category=r.tax_category,
            symbol=r.symbol,
            quantity=float(r.quantity_total or 0),
            current_price=float(r.current_price or 0),
            market_value=float(r.market_value or 0),
            unrealized_gl=float(r.unrealized_gl or 0),
            acb_per_share=float(r.acb_per_share or 0),
        ))

    return _optimize(positions, circle.name, circle_id)


# ── Core optimizer ───────────────────────────────────────────────────────────

def _optimize(positions: list[Position], circle_name: str, circle_id: str) -> dict:

    # Step 1 — analyse each stock
    stock_map: dict[str, list[Position]] = {}
    for p in positions:
        stock_map.setdefault(p.symbol, []).append(p)

    analyses: list[StockAnalysis] = []
    for symbol, pos_list in stock_map.items():
        analyses.append(_analyse_stock(symbol, pos_list))

    # Step 2 — filter to candidate stocks
    candidates = [
        a for a in analyses
        if a.account_count >= 2
        and a.total_quantity >= MIN_SHARES
        and a.total_value >= MIN_VALUE
        and len(a.sellable_non_home) > 0
    ]

    # Step 3 — build swap pairs (original v1 logic)
    swaps: list[Swap] = []
    swap_id = 1

    working: dict[tuple, float] = {(p.account_id, p.symbol): p.quantity for p in positions}

    for i, stock_a in enumerate(candidates):
        for j, stock_b in enumerate(candidates):
            if j <= i:
                continue

            swap = _try_swap(stock_a, stock_b, working, swap_id)
            if swap:
                for leg in swap.legs:
                    key = (leg.account_id, leg.symbol)
                    if leg.action == "SELL":
                        working[key] = working.get(key, 0) - leg.quantity
                    else:
                        working[key] = working.get(key, 0) + leg.quantity
                swaps.append(swap)
                swap_id += 1

    # Step 4 — build output
    account_label_map = {p.account_id: p.account_label for p in positions}

    stocks_output = []
    for a in analyses:
        before = sorted([
            {
                "account_id":    p.account_id,
                "account_label": p.account_label,
                "quantity":      p.quantity,
                "market_value":  round(p.market_value, 2),
                "unrealized_gl": round(p.unrealized_gl, 2),
                "is_home":       p.account_id == a.home_account_id,
                "is_sellable":   p.is_sellable,
                "is_odd_lot":    p.is_odd_lot,
            }
            for p in a.positions
        ], key=lambda x: -x["quantity"])

        # FIX 1: scan entire working dict for after-state (catches BUY destinations)
        price = a.positions[0].current_price if a.positions else 0
        after_map: dict[str, float] = {
            acct_id: qty
            for (acct_id, sym), qty in working.items()
            if sym == a.symbol and qty > 0.001
        }
        after = sorted([
            {
                "account_id":    acct_id,
                "account_label": account_label_map.get(acct_id, acct_id),
                "quantity":      round(qty, 4),
                "market_value":  round(qty * price, 2),
                "is_home":       acct_id == a.home_account_id,
            }
            for acct_id, qty in after_map.items()
        ], key=lambda x: -x["quantity"])

        has_change = any(
            abs(working.get((p.account_id, a.symbol), 0) - p.quantity) > 0.001
            for p in a.positions
        )

        stocks_output.append({
            "symbol":             a.symbol,
            "total_quantity":     a.total_quantity,
            "total_value":        round(a.total_value, 2),
            "current_price":      price,
            "home_account_id":    a.home_account_id,
            "home_account_label": a.home_account_label,
            "home_pct_before":    round(a.home_pct * 100, 1),
            "is_candidate":       a in candidates,
            "has_change":         has_change,
            "before":             before,
            "after":              after,
        })

    stocks_output.sort(key=lambda s: (0 if s["has_change"] else 1, -s["total_value"]))

    stuck = []
    for a in analyses:
        for p in a.stuck_non_home:
            stuck.append({
                "symbol": p.symbol, "account_label": p.account_label,
                "quantity": p.quantity, "market_value": round(p.market_value, 2),
                "unrealized_gl": round(p.unrealized_gl, 2),
                "reason": "Capital gain — selling would trigger a taxable event",
            })

    total_loss = sum(s.total_loss_harvested for s in swaps)
    total_qty  = sum(s.total_qty_moved for s in swaps)

    return {
        "circle_id":       circle_id,
        "circle_name":     circle_name,
        "stocks_analyzed": stocks_output,
        "swaps":           [_swap_to_dict(s) for s in swaps],
        "stuck_positions": stuck,
        "summary": {
            "stocks_analyzed":      len(analyses),
            "candidate_stocks":     len(candidates),
            "swaps_found":          len(swaps),
            "total_loss_harvested": round(total_loss, 2),
            "total_qty_consolidated": round(total_qty, 4),
        }
    }


def _analyse_stock(symbol: str, pos_list: list[Position]) -> StockAnalysis:
    total_qty = sum(p.quantity for p in pos_list)
    total_val = sum(p.market_value for p in pos_list)

    home = max(pos_list, key=lambda p: p.quantity)
    home_pct = home.quantity / total_qty if total_qty > 0 else 0

    for p in pos_list:
        if total_qty > 0 and p.quantity / total_qty >= HOME_THRESHOLD:
            home = p
            home_pct = p.quantity / total_qty
            break

    non_home = [p for p in pos_list if p.account_id != home.account_id]
    sellable = sorted(
        [p for p in non_home if p.is_sellable and p.quantity >= MIN_SHARES and p.market_value >= MIN_VALUE],
        key=lambda p: p.unrealized_gl  # most negative loss first
    )
    stuck = [p for p in non_home if not p.is_sellable and p.quantity >= MIN_SHARES]

    return StockAnalysis(
        symbol=symbol,
        total_quantity=total_qty,
        total_value=total_val,
        account_count=len(pos_list),
        home_account_id=home.account_id,
        home_account_label=home.account_label,
        home_qty=home.quantity,
        home_pct=home_pct,
        positions=pos_list,
        sellable_non_home=sellable,
        stuck_non_home=stuck,
    )


def _try_swap(
    stock_a: StockAnalysis,
    stock_b: StockAnalysis,
    working: dict,
    swap_id: int
) -> Optional[Swap]:
    """
    Original v1 logic — no restriction on which account holds which stock.
    Any two accounts where each has the other's non-home stock at a loss.

    Account X sells stock_a → buys stock_b
    Account Y sells stock_b → buys stock_a
    """
    best_swap = None
    best_score = -1.0

    for pos_a in stock_a.sellable_non_home:
        avail_a = working.get((pos_a.account_id, pos_a.symbol), 0)
        if avail_a < MIN_SHARES:
            continue

        for pos_b in stock_b.sellable_non_home:
            # Must be in a DIFFERENT account
            if pos_b.account_id == pos_a.account_id:
                continue

            avail_b = working.get((pos_b.account_id, pos_b.symbol), 0)
            if avail_b < MIN_SHARES:
                continue

            # Don't sell from the home of the OTHER stock
            if pos_a.account_id == stock_b.home_account_id:
                continue
            if pos_b.account_id == stock_a.home_account_id:
                continue

            # Quantities
            sell_qty_a = avail_a
            sell_val_a = sell_qty_a * pos_a.current_price

            buy_qty_b = sell_val_a / pos_b.current_price if pos_b.current_price > 0 else 0
            buy_qty_b = min(buy_qty_b, avail_b)
            buy_qty_b = int(buy_qty_b)
            if buy_qty_b < 1:
                continue

            actual_sell_val_b = buy_qty_b * pos_b.current_price
            actual_buy_qty_a = actual_sell_val_b / pos_a.current_price if pos_a.current_price > 0 else 0
            actual_buy_qty_a = min(actual_buy_qty_a, sell_qty_a)
            actual_buy_qty_a = int(actual_buy_qty_a)
            if actual_buy_qty_a < 1:
                continue

            actual_sell_qty_a = min(sell_qty_a, int(actual_sell_val_b / pos_a.current_price) + 1)
            actual_sell_qty_a = min(actual_sell_qty_a, int(avail_a))

            # FIX 2: loss only counts for taxable accounts
            loss_a = abs(pos_a.unrealized_gl / pos_a.quantity * actual_sell_qty_a) \
                     if pos_a.unrealized_gl < 0 and pos_a.quantity > 0 and pos_a.is_taxable else 0
            loss_b = abs(pos_b.unrealized_gl / pos_b.quantity * buy_qty_b) \
                     if pos_b.unrealized_gl < 0 and pos_b.quantity > 0 and pos_b.is_taxable else 0
            score = loss_a + loss_b + actual_sell_qty_a + buy_qty_b

            if score > best_score:
                best_score = score

                val_a_sell = round(actual_sell_qty_a * pos_a.current_price, 2)
                val_b_buy  = round(buy_qty_b * pos_b.current_price, 2)
                val_b_sell = round(buy_qty_b * pos_b.current_price, 2)
                val_a_buy  = round(actual_buy_qty_a * pos_a.current_price, 2)

                # FIX 2: only report unrealized_gl on SELL legs for taxable accounts
                gl_a = round(pos_a.unrealized_gl / pos_a.quantity * actual_sell_qty_a, 2) \
                       if pos_a.quantity > 0 and pos_a.is_taxable else 0
                gl_b = round(pos_b.unrealized_gl / pos_b.quantity * buy_qty_b, 2) \
                       if pos_b.quantity > 0 and pos_b.is_taxable else 0

                legs = [
                    SwapLeg("SELL", pos_a.symbol, actual_sell_qty_a, pos_a.current_price,
                            val_a_sell, pos_a.account_id, pos_a.account_label, gl_a),
                    SwapLeg("BUY",  pos_b.symbol, buy_qty_b, pos_b.current_price,
                            val_b_buy,  pos_a.account_id, pos_a.account_label, 0),
                    SwapLeg("SELL", pos_b.symbol, buy_qty_b, pos_b.current_price,
                            val_b_sell, pos_b.account_id, pos_b.account_label, gl_b),
                    SwapLeg("BUY",  pos_a.symbol, actual_buy_qty_a, pos_a.current_price,
                            val_a_buy,  pos_b.account_id, pos_b.account_label, 0),
                ]

                residuals = {
                    pos_a.account_id: round(val_a_sell - val_b_buy, 2),
                    pos_b.account_id: round(val_b_sell - val_a_buy, 2),
                }

                total_loss  = round(loss_a + loss_b, 2)
                total_moved = actual_sell_qty_a + buy_qty_b
                note = f"Swap {stock_a.symbol} ↔ {stock_b.symbol}"
                if total_loss > 0:
                    note += f" · harvests ${total_loss:.2f} in losses"

                best_swap = Swap(
                    swap_id=swap_id,
                    legs=legs,
                    total_loss_harvested=total_loss,
                    total_qty_moved=float(total_moved),
                    cash_residuals=residuals,
                    note=note,
                )

    return best_swap


def _swap_to_dict(s: Swap) -> dict:
    return {
        "swap_id": s.swap_id,
        "note": s.note,
        "total_loss_harvested": s.total_loss_harvested,
        "total_qty_moved": s.total_qty_moved,
        "cash_residuals": [
            {"account_id": acct, "residual": val}
            for acct, val in s.cash_residuals.items()
        ],
        "legs": [
            {
                "action":        leg.action,
                "symbol":        leg.symbol,
                "quantity":      leg.quantity,
                "price":         round(leg.price, 4),
                "value":         round(leg.value, 2),
                "account_id":    leg.account_id,
                "account_label": leg.account_label,
                "unrealized_gl": leg.unrealized_gl if leg.action == "SELL" else None,
            }
            for leg in s.legs
        ]
    }


def _empty(circle_id, circle_name):
    return {
        "circle_id": circle_id, "circle_name": circle_name,
        "stocks_analyzed": [], "swaps": [], "stuck_positions": [],
        "summary": {
            "stocks_analyzed": 0, "candidate_stocks": 0,
            "swaps_found": 0, "total_loss_harvested": 0.0, "total_qty_consolidated": 0.0
        }
    }
