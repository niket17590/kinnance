-- ============================================================
-- Performance Indexes
-- Script  : 004_performance_indexes.sql
-- Purpose : Composite and partial indexes for common query patterns
-- ============================================================

-- ── holdings ─────────────────────────────────────────────────
-- Dashboard / holdings / performance all filter by account_id
-- then restrict to open positions. Combining both into one index
-- avoids a second pass over all holdings rows for an account.
CREATE INDEX IF NOT EXISTS idx_holdings_account_open
    ON holdings(account_id, is_position_open)
    WHERE is_position_open = TRUE;

-- Price scheduler UPDATE joins on symbol+currency for open positions.
-- Existing idx_holdings_symbol only covers symbol; this covers the
-- full join condition used in update_unrealized_gains.
CREATE INDEX IF NOT EXISTS idx_holdings_symbol_currency_open
    ON holdings(symbol, currency)
    WHERE is_position_open = TRUE AND quantity_total > 0;

-- ── transactions ─────────────────────────────────────────────
-- Dashboard "recent transactions" fetches last N rows per account
-- ordered by trade_date. The existing composite index
-- (account_id, symbol_normalized, trade_date DESC) works but carries
-- an unnecessary symbol column for date-only queries.
CREATE INDEX IF NOT EXISTS idx_transactions_account_date
    ON transactions(account_id, trade_date DESC);

-- ── member_accounts ──────────────────────────────────────────
-- Holdings / performance endpoints support broker filter:
-- WHERE ma.broker_code IN (...). No index existed on this column.
CREATE INDEX IF NOT EXISTS idx_member_accounts_broker
    ON member_accounts(broker_code);
