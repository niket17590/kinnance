-- ============================================================
-- Kinnance Database Schema
-- Script  : 001_initial_schema.sql
-- Purpose : All table definitions
-- Run on  : Fresh database only
-- ============================================================

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- AUTO-UPDATE FUNCTION
-- Reused by all tables via triggers
-- ============================================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- USERS
-- One row per registered user.
-- Created automatically on first login via post-auth trigger.
-- ============================================================

CREATE TABLE IF NOT EXISTS users (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    auth_user_id        UUID NOT NULL UNIQUE,
    email               TEXT NOT NULL UNIQUE,
    display_name        TEXT,
    avatar_url          TEXT,
    is_super_admin      BOOLEAN NOT NULL DEFAULT FALSE,
    is_active           BOOLEAN NOT NULL DEFAULT TRUE,
    last_login_at       TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_auth_user_id
    ON users(auth_user_id);

CREATE INDEX IF NOT EXISTS idx_users_email
    ON users(email);

CREATE TRIGGER trigger_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE users IS 'One row per registered Kinnance user';
COMMENT ON COLUMN users.auth_user_id IS 'Links to Supabase auth.users.id';
COMMENT ON COLUMN users.is_super_admin IS 'Set manually in DB only — never via API';
COMMENT ON COLUMN users.avatar_url IS 'Profile picture from Google OAuth';

-- ============================================================
-- FUNCTION: handle_new_user
-- Automatically creates a public.users row when someone
-- signs up via Supabase Auth
-- ============================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.users (
    auth_user_id,
    email,
    display_name,
    avatar_url
  )
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(
      NEW.raw_user_meta_data->>'full_name',
      NEW.raw_user_meta_data->>'display_name',
      NEW.raw_user_meta_data->>'name',
      split_part(NEW.email, '@', 1)
    ),
    NEW.raw_user_meta_data->>'avatar_url'
  )
  ON CONFLICT (auth_user_id) DO UPDATE
    SET
      email         = EXCLUDED.email,
      display_name  = COALESCE(EXCLUDED.display_name, public.users.display_name),
      avatar_url    = COALESCE(EXCLUDED.avatar_url, public.users.avatar_url),
      last_login_at = NOW(),
      updated_at    = NOW();

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- TRIGGER: on_auth_user_created
-- Fires after every new signup in auth.users
-- ============================================================

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- ============================================================
-- Function: handle_user_login
-- Updates last_login_at every time a user signs in
-- ============================================================

CREATE OR REPLACE FUNCTION public.handle_user_login()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE public.users
  SET last_login_at = NOW(),
      updated_at = NOW()
  WHERE auth_user_id = NEW.id;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- Trigger: on_auth_user_updated
-- Fires when auth.users is updated (happens on every login)
-- ============================================================

DROP TRIGGER IF EXISTS on_auth_user_updated ON auth.users;

CREATE TRIGGER on_auth_user_updated
  AFTER UPDATE ON auth.users
  FOR EACH ROW
  WHEN (OLD.last_sign_in_at IS DISTINCT FROM NEW.last_sign_in_at)
  EXECUTE FUNCTION public.handle_user_login();

-- ============================================================
-- 1. REGIONS
-- ============================================================

CREATE TABLE IF NOT EXISTS regions (
    code                TEXT PRIMARY KEY,
    name                TEXT NOT NULL,
    default_currency    TEXT NOT NULL,
    is_active           BOOLEAN NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trigger_regions_updated_at
    BEFORE UPDATE ON regions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE regions IS 'Supported countries and regions';

-- ============================================================
-- 2. CURRENCIES
-- ============================================================

CREATE TABLE IF NOT EXISTS currencies (
    code        TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    symbol      TEXT NOT NULL,
    is_active   BOOLEAN NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trigger_currencies_updated_at
    BEFORE UPDATE ON currencies
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE currencies IS 'Global currency reference data';

-- ============================================================
-- 3. BROKERS
-- ============================================================

CREATE TABLE IF NOT EXISTS brokers (
    code            TEXT PRIMARY KEY,
    region_code     TEXT NOT NULL REFERENCES regions(code),
    name            TEXT NOT NULL,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_brokers_region ON brokers(region_code);

CREATE TRIGGER trigger_brokers_updated_at
    BEFORE UPDATE ON brokers
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE brokers IS 'Supported brokers per region — managed by super admin';

-- ============================================================
-- 4. ACCOUNT TYPES
-- ============================================================

CREATE TABLE IF NOT EXISTS account_types (
    code                        TEXT PRIMARY KEY,
    region_code                 TEXT NOT NULL REFERENCES regions(code),
    name                        TEXT NOT NULL,
    short_name                  TEXT NOT NULL,
    applies_to                  TEXT NOT NULL DEFAULT 'BOTH',
    tax_category                TEXT NOT NULL,
    has_contribution_limit      BOOLEAN NOT NULL DEFAULT FALSE,
    has_lifetime_limit          BOOLEAN NOT NULL DEFAULT FALSE,
    contribution_limit_type     TEXT,
    is_active                   BOOLEAN NOT NULL DEFAULT TRUE,
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_applies_to
        CHECK (applies_to IN ('PERSON', 'CORPORATION', 'BOTH')),
    CONSTRAINT chk_tax_category
        CHECK (tax_category IN ('TAX_FREE', 'TAX_DEFERRED', 'TAXABLE', 'CORP_TAXABLE'))
);

CREATE INDEX IF NOT EXISTS idx_account_types_region
    ON account_types(region_code);

CREATE INDEX IF NOT EXISTS idx_account_types_applies_to
    ON account_types(applies_to);

CREATE TRIGGER trigger_account_types_updated_at
    BEFORE UPDATE ON account_types
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE account_types IS 'Supported account types per region — managed by super admin';
COMMENT ON COLUMN account_types.applies_to IS 'PERSON, CORPORATION, or BOTH';
COMMENT ON COLUMN account_types.tax_category IS 'Tax treatment of this account type';
COMMENT ON COLUMN account_types.contribution_limit_type IS 'FIXED_ANNUAL, INCOME_BASED, LIFETIME, or NULL';

-- ============================================================
-- 5. ACCOUNT TYPE LIMITS
-- ============================================================

CREATE TABLE IF NOT EXISTS account_type_limits (
    account_type_code   TEXT NOT NULL REFERENCES account_types(code),
    tax_year            INTEGER NOT NULL,
    annual_limit        NUMERIC(12,2),
    lifetime_limit      NUMERIC(12,2),
    notes               TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (account_type_code, tax_year)
);

COMMENT ON TABLE account_type_limits IS 'Government annual and lifetime limits per account type per year';

-- ============================================================
-- 6. MEMBERS
-- ============================================================

CREATE TABLE IF NOT EXISTS members (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    owner_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    display_name    TEXT NOT NULL,
    member_type     TEXT NOT NULL DEFAULT 'PERSON',
    email           TEXT,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_member_type
        CHECK (member_type IN ('PERSON', 'CORPORATION'))
);

CREATE INDEX IF NOT EXISTS idx_members_owner_id ON members(owner_id);

CREATE TRIGGER trigger_members_updated_at
    BEFORE UPDATE ON members
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE members IS 'People or corporations managed by a user';
COMMENT ON COLUMN members.email IS 'Optional — for future viewer login feature';
COMMENT ON COLUMN members.member_type IS 'PERSON or CORPORATION';

-- ============================================================
-- 7. MEMBER ACCOUNTS
-- ============================================================

CREATE TABLE IF NOT EXISTS member_accounts (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    member_id           UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    broker_code         TEXT NOT NULL REFERENCES brokers(code),
    account_type_code   TEXT NOT NULL REFERENCES account_types(code),
    region_code         TEXT NOT NULL REFERENCES regions(code),
    nickname            TEXT,
    account_number      TEXT,
    is_active           BOOLEAN NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_member_broker_account_type
        UNIQUE (member_id, broker_code, account_type_code)
);

CREATE INDEX IF NOT EXISTS idx_member_accounts_member_id
    ON member_accounts(member_id);

CREATE INDEX IF NOT EXISTS idx_member_accounts_region
    ON member_accounts(region_code);

CREATE TRIGGER trigger_member_accounts_updated_at
    BEFORE UPDATE ON member_accounts
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE member_accounts IS 'Brokerage accounts belonging to members';
COMMENT ON COLUMN member_accounts.account_number IS 'Optional brokerage account number';

-- ============================================================
-- 8. CIRCLES
-- ============================================================

CREATE TABLE IF NOT EXISTS circles (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    owner_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    region_code     TEXT NOT NULL REFERENCES regions(code),
    description     TEXT,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_circles_owner_id ON circles(owner_id);
CREATE INDEX IF NOT EXISTS idx_circles_region ON circles(region_code);

CREATE TRIGGER trigger_circles_updated_at
    BEFORE UPDATE ON circles
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE circles IS 'Grouping of accounts for consolidated views — same region only';

-- ============================================================
-- 9. CIRCLE ACCOUNTS
-- ============================================================

CREATE TABLE IF NOT EXISTS circle_accounts (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    circle_id   UUID NOT NULL REFERENCES circles(id) ON DELETE CASCADE,
    account_id  UUID NOT NULL REFERENCES member_accounts(id) ON DELETE CASCADE,
    added_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_circle_account UNIQUE (circle_id, account_id)
);

CREATE INDEX IF NOT EXISTS idx_circle_accounts_circle_id ON circle_accounts(circle_id);
CREATE INDEX IF NOT EXISTS idx_circle_accounts_account_id ON circle_accounts(account_id);

COMMENT ON TABLE circle_accounts IS 'Junction — accounts tagged to circles';

-- ============================================================
-- 10. CONTRIBUTION ROOM
-- ============================================================

CREATE TABLE IF NOT EXISTS contribution_room (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    member_id           UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    account_type_code   TEXT NOT NULL REFERENCES account_types(code),
    tax_year            INTEGER NOT NULL,
    opened_year         INTEGER,
    annual_limit        NUMERIC(12,2) NOT NULL DEFAULT 0,
    carried_forward     NUMERIC(12,2) NOT NULL DEFAULT 0,
    contributed         NUMERIC(12,2) NOT NULL DEFAULT 0,
    withdrawn           NUMERIC(12,2) NOT NULL DEFAULT 0,
    available_room      NUMERIC(12,2) NOT NULL DEFAULT 0,
    override_room       NUMERIC(12,2),
    is_overridden       BOOLEAN NOT NULL DEFAULT FALSE,
    last_calculated_at  TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_contribution_room
        UNIQUE (member_id, account_type_code, tax_year)
);

CREATE INDEX IF NOT EXISTS idx_contribution_room_member
    ON contribution_room(member_id);

CREATE TRIGGER trigger_contribution_room_updated_at
    BEFORE UPDATE ON contribution_room
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE contribution_room IS 'Calculated contribution room per member per account type per year';
COMMENT ON COLUMN contribution_room.opened_year IS 'Year account type was first opened — used for FIXED_ANNUAL calculations';
COMMENT ON COLUMN contribution_room.is_overridden IS 'True when user manually enters CRA confirmed room';

-- ============================================================
-- 11. BROKER ACCOUNT MAPPINGS
-- Saves how broker file identifiers map to our accounts.
-- e.g. IBKR "Individual Cash" -> account UUID
-- Populated on first upload, auto-matched on subsequent uploads.
-- ============================================================

CREATE TABLE IF NOT EXISTS broker_account_mappings (
    id                          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    account_id                  UUID NOT NULL REFERENCES member_accounts(id) ON DELETE CASCADE,
    broker_code                 TEXT NOT NULL REFERENCES brokers(code),
    broker_account_identifier   TEXT NOT NULL,
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_broker_account_mapping
        UNIQUE (broker_code, broker_account_identifier)
);

CREATE INDEX IF NOT EXISTS idx_broker_mappings_account
    ON broker_account_mappings(account_id);

CREATE INDEX IF NOT EXISTS idx_broker_mappings_broker
    ON broker_account_mappings(broker_code, broker_account_identifier);

CREATE TRIGGER trigger_broker_account_mappings_updated_at
    BEFORE UPDATE ON broker_account_mappings
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE broker_account_mappings IS 'Maps broker file identifiers to Kinnance accounts — saved after first upload for auto-matching';
COMMENT ON COLUMN broker_account_mappings.broker_account_identifier IS 'e.g. HQ78JF768CAD (WS), Individual Cash (IBKR), 40132143 (Questrade)';

-- ============================================================
-- 12. IMPORT BATCHES
-- One row per CSV upload. Audit trail.
-- ============================================================
CREATE TABLE IF NOT EXISTS import_batches (
    id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    owner_id                UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    broker_code             TEXT NOT NULL REFERENCES brokers(code),
    filename                TEXT NOT NULL,
    status                  TEXT NOT NULL DEFAULT 'PROCESSING',
    rows_total              INTEGER NOT NULL DEFAULT 0,
    rows_imported           INTEGER NOT NULL DEFAULT 0,
    rows_duplicate_skipped  INTEGER NOT NULL DEFAULT 0,
    rows_account_skipped    INTEGER NOT NULL DEFAULT 0,
    transaction_date_from   DATE,
    transaction_date_to     DATE,
    error_message           TEXT,
    imported_at             TIMESTAMPTZ,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_import_status
        CHECK (status IN ('PROCESSING', 'COMPLETE', 'FAILED'))
);

CREATE INDEX IF NOT EXISTS idx_import_batches_owner
    ON import_batches(owner_id);

CREATE INDEX IF NOT EXISTS idx_import_batches_broker
    ON import_batches(broker_code);

COMMENT ON TABLE import_batches IS 'Audit trail for every CSV upload';
COMMENT ON COLUMN import_batches.rows_duplicate_skipped IS 'Transactions already in DB — skipped on re-upload';
COMMENT ON COLUMN import_batches.rows_account_skipped IS 'Transactions for accounts user chose to skip';

-- ============================================================
-- 13. TRANSACTIONS
-- Source of truth. Every financial event ever.
-- ============================================================

CREATE TABLE IF NOT EXISTS transactions (
    id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    account_id              UUID NOT NULL REFERENCES member_accounts(id) ON DELETE CASCADE,
    import_batch_id         UUID REFERENCES import_batches(id) ON DELETE SET NULL,
    transaction_type        TEXT NOT NULL,
    trade_date              DATE NOT NULL,
    settlement_date         DATE,
    symbol                  TEXT,
    symbol_normalized       TEXT,
    asset_type              TEXT,
    description             TEXT,
    quantity                NUMERIC(18,8),
    price_per_unit          NUMERIC(18,6),
    trade_currency          TEXT NOT NULL DEFAULT 'CAD',
    gross_amount            NUMERIC(18,2),
    commission              NUMERIC(18,6) NOT NULL DEFAULT 0,
    net_amount              NUMERIC(18,2) NOT NULL,
    net_amount_cad          NUMERIC(18,2) NOT NULL,
    fx_rate_to_cad          NUMERIC(10,6),
    option_contract_id      UUID,
    paired_transaction_id   UUID REFERENCES transactions(id) ON DELETE SET NULL,
    import_hash             TEXT UNIQUE,
    raw_data                JSONB,
    notes                   TEXT,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_transaction_type CHECK (
        transaction_type IN (
            'BUY', 'SELL', 'DIVIDEND', 'DEPOSIT', 'WITHDRAWAL',
            'FX_CONVERSION', 'INTEREST', 'FEE', 'RETURN_OF_CAPITAL',
            'STOCK_SPLIT', 'CORPORATE_ACTION', 'INTERNAL_TRANSFER',
            'NORBERT_GAMBIT', 'OPTION_PREMIUM', 'OPTION_BUY_BACK',
            'OPTION_ASSIGNED', 'OPTION_EXPIRED', 'CRYPTO', 'OTHER'
        )
    ),
    CONSTRAINT chk_asset_type CHECK (
        asset_type IN ('STOCK', 'ETF', 'OPTION', 'CRYPTO', 'CASH', 'OTHER', NULL)
    ),
    CONSTRAINT chk_trade_currency CHECK (
        trade_currency IN ('CAD', 'USD', 'GBP', 'EUR', 'INR')
    )
);

CREATE INDEX IF NOT EXISTS idx_transactions_account_id
    ON transactions(account_id);

CREATE INDEX IF NOT EXISTS idx_transactions_trade_date
    ON transactions(trade_date DESC);

CREATE INDEX IF NOT EXISTS idx_transactions_symbol
    ON transactions(symbol_normalized)
    WHERE symbol_normalized IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_transactions_type
    ON transactions(transaction_type);

CREATE INDEX IF NOT EXISTS idx_transactions_import_batch
    ON transactions(import_batch_id)
    WHERE import_batch_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_transactions_account_symbol
    ON transactions(account_id, symbol_normalized, trade_date DESC)
    WHERE symbol_normalized IS NOT NULL;

CREATE TRIGGER trigger_transactions_updated_at
    BEFORE UPDATE ON transactions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE transactions IS 'Source of truth — every financial event across all accounts';
COMMENT ON COLUMN transactions.symbol IS 'Raw symbol from broker CSV';
COMMENT ON COLUMN transactions.symbol_normalized IS 'Clean symbol for price lookups — DLR.TO not G036247';
COMMENT ON COLUMN transactions.net_amount IS 'In trade_currency — negative=outflow positive=inflow';
COMMENT ON COLUMN transactions.net_amount_cad IS 'Always in CAD — for reporting and tax calculations';
COMMENT ON COLUMN transactions.fx_rate_to_cad IS 'Exchange rate used at time of trade';
COMMENT ON COLUMN transactions.paired_transaction_id IS 'Links FX pairs — CAD row links to USD row';
COMMENT ON COLUMN transactions.import_hash IS 'SHA-256 of raw row — prevents duplicate imports';
COMMENT ON COLUMN transactions.raw_data IS 'Original broker CSV row stored as JSON — enables re-parsing';

-- ============================================================
-- 14. HOLDINGS
-- Derived from transactions. Recalculated on every import.
-- One row per symbol per account.
-- ============================================================
    CREATE TABLE holdings (
        id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        account_id              UUID NOT NULL REFERENCES member_accounts(id) ON DELETE CASCADE,
        symbol                  TEXT NOT NULL,
        asset_type              TEXT NOT NULL DEFAULT 'STOCK',

        -- Position state
        is_position_open        BOOLEAN NOT NULL DEFAULT TRUE,
        quantity_total          NUMERIC(18,8) NOT NULL DEFAULT 0,
        quantity_free           NUMERIC(18,8) NOT NULL DEFAULT 0,
        quantity_pledged        NUMERIC(18,8) NOT NULL DEFAULT 0,

        -- ACB tracking
        acb_per_share           NUMERIC(18,6) NOT NULL DEFAULT 0,
        total_acb               NUMERIC(18,2) NOT NULL DEFAULT 0,
        currency                TEXT NOT NULL DEFAULT 'USD',

        -- Realized G/L (accumulated across all sells, never reset)
        total_proceeds          NUMERIC(18,2) NOT NULL DEFAULT 0,
        total_cost_sold         NUMERIC(18,2) NOT NULL DEFAULT 0,
        realized_gain_loss      NUMERIC(18,2) NOT NULL DEFAULT 0,

        -- Unrealized G/L (updated by price scheduler, null if no price)
        current_price           NUMERIC(18,6),
        unrealized_gain_loss    NUMERIC(18,2),
        unrealized_gain_loss_pct NUMERIC(8,4),
        price_updated_at        TIMESTAMPTZ,

        last_calculated_at      TIMESTAMPTZ,
        created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),

        CONSTRAINT uq_holding_account_symbol
            UNIQUE (account_id, symbol),
        CONSTRAINT chk_holding_asset_type
            CHECK (asset_type IN ('STOCK', 'ETF', 'CRYPTO', 'OTHER'))
    );

    CREATE INDEX IF NOT EXISTS idx_holdings_account_id ON holdings(account_id);
    CREATE INDEX IF NOT EXISTS idx_holdings_symbol ON holdings(symbol);
    CREATE INDEX IF NOT EXISTS idx_holdings_open ON holdings(is_position_open) WHERE is_position_open = TRUE;

    CREATE TRIGGER trigger_holdings_updated_at
        BEFORE UPDATE ON holdings
        FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

    COMMENT ON TABLE holdings IS 'One row per account+symbol. Tracks open and closed positions with realized and unrealized G/L.';
    COMMENT ON COLUMN holdings.is_position_open IS 'TRUE if quantity > 0, FALSE if fully sold';
    COMMENT ON COLUMN holdings.realized_gain_loss IS 'Cumulative realized G/L from all sells. Never resets even if position reopened.';
    COMMENT ON COLUMN holdings.unrealized_gain_loss IS 'Updated by price scheduler. NULL if no price available.';
    COMMENT ON COLUMN holdings.total_proceeds IS 'Sum of all sell proceeds for this symbol in this account';
    COMMENT ON COLUMN holdings.total_cost_sold IS 'Sum of ACB of all shares sold';
    COMMENT ON COLUMN holdings.current_price IS 'Latest price from price_cache — copied here for fast UI access';
-- ============================================================
-- 15. CASH BALANCES
-- CAD and USD cash per account.
-- One row per currency per account.
-- ============================================================

CREATE TABLE IF NOT EXISTS cash_balances (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    account_id      UUID NOT NULL REFERENCES member_accounts(id) ON DELETE CASCADE,
    currency        TEXT NOT NULL,
    balance_total   NUMERIC(18,2) NOT NULL DEFAULT 0,
    balance_locked  NUMERIC(18,2) NOT NULL DEFAULT 0,
    balance_free    NUMERIC(18,2) GENERATED ALWAYS AS (balance_total - balance_locked) STORED,
    last_updated_at TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_cash_balance_account_currency
        UNIQUE (account_id, currency),
    CONSTRAINT chk_cash_currency
        CHECK (currency IN ('CAD', 'USD', 'GBP', 'EUR', 'INR'))
);

CREATE INDEX IF NOT EXISTS idx_cash_balances_account_id
    ON cash_balances(account_id);

CREATE TRIGGER trigger_cash_balances_updated_at
    BEFORE UPDATE ON cash_balances
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE cash_balances IS 'Cash per currency per account — updated on every import';
COMMENT ON COLUMN cash_balances.balance_total IS 'All cash including locked amount';
COMMENT ON COLUMN cash_balances.balance_locked IS 'Locked in cash secured puts';
COMMENT ON COLUMN cash_balances.balance_free IS 'Available = total - locked (computed column)';

-- ============================================================
-- 16. OPTION CONTRACTS
-- Options positions — created now for holdings/cash integrity.
-- Full UI built in Phase 5.
-- ============================================================

CREATE TABLE IF NOT EXISTS option_contracts (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    account_id          UUID NOT NULL REFERENCES member_accounts(id) ON DELETE CASCADE,
    underlying_symbol   TEXT NOT NULL,
    contract_type       TEXT NOT NULL,
    strike_price        NUMERIC(18,2) NOT NULL,
    expiry_date         DATE NOT NULL,
    contracts_qty       INTEGER NOT NULL DEFAULT 1,
    shares_pledged      INTEGER NOT NULL DEFAULT 0,
    cash_locked         NUMERIC(18,2) NOT NULL DEFAULT 0,
    premium_received    NUMERIC(18,6) NOT NULL DEFAULT 0,
    total_premium       NUMERIC(18,2) NOT NULL DEFAULT 0,
    open_date           DATE NOT NULL,
    status              TEXT NOT NULL DEFAULT 'OPEN',
    close_date          DATE,
    close_premium       NUMERIC(18,6),
    net_pnl             NUMERIC(18,2),
    rolled_to_id        UUID REFERENCES option_contracts(id),
    notes               TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_contract_type
        CHECK (contract_type IN ('CALL', 'PUT')),
    CONSTRAINT chk_option_status
        CHECK (status IN ('OPEN', 'CLOSED', 'EXPIRED', 'ASSIGNED', 'ROLLED'))
);

CREATE INDEX IF NOT EXISTS idx_option_contracts_account
    ON option_contracts(account_id);

CREATE INDEX IF NOT EXISTS idx_option_contracts_status
    ON option_contracts(status)
    WHERE status = 'OPEN';

CREATE INDEX IF NOT EXISTS idx_option_contracts_expiry
    ON option_contracts(expiry_date)
    WHERE status = 'OPEN';

CREATE TRIGGER trigger_option_contracts_updated_at
    BEFORE UPDATE ON option_contracts
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE option_contracts IS 'Options positions — used for pledged shares and locked cash in holdings/balances';
COMMENT ON COLUMN option_contracts.shares_pledged IS 'contracts_qty x 100 for CALL positions';
COMMENT ON COLUMN option_contracts.cash_locked IS 'strike x contracts_qty x 100 for PUT positions';
COMMENT ON COLUMN option_contracts.rolled_to_id IS 'Points to new contract when position is rolled';

-- Add FK from transactions to option_contracts now that table exists
ALTER TABLE transactions
    ADD CONSTRAINT fk_transactions_option_contract
    FOREIGN KEY (option_contract_id)
    REFERENCES option_contracts(id)
    ON DELETE SET NULL;

-- ============================================================
-- 17. PRICE CACHE
-- Global shared price cache — all users share this.
-- Updated by APScheduler background job.
-- ============================================================

CREATE TABLE IF NOT EXISTS price_cache (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    symbol              TEXT NOT NULL,
    currency            TEXT NOT NULL,
    price               NUMERIC(18,6),
    previous_close      NUMERIC(18,6),
    day_change          NUMERIC(18,6),
    day_change_pct      NUMERIC(8,4),
    week_52_high        NUMERIC(18,6),
    week_52_low         NUMERIC(18,6),
    source              TEXT NOT NULL DEFAULT 'twelvedata',
    fetched_at          TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_price_cache_symbol_currency
        UNIQUE (symbol, currency)
);

CREATE INDEX IF NOT EXISTS idx_price_cache_symbol
    ON price_cache(symbol);

CREATE INDEX IF NOT EXISTS idx_price_cache_fetched_at
    ON price_cache(fetched_at DESC);

CREATE TRIGGER trigger_price_cache_updated_at
    BEFORE UPDATE ON price_cache
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE price_cache IS 'Global price cache shared across all users — updated by background scheduler';
COMMENT ON COLUMN price_cache.source IS 'Price data source: twelvedata or manual';

-- ============================================================
-- 18. APP SETTINGS
-- Super admin configurable key-value settings.
-- ============================================================

CREATE TABLE IF NOT EXISTS app_settings (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    setting_key     TEXT NOT NULL UNIQUE,
    setting_value   TEXT NOT NULL,
    description     TEXT,
    updated_by      UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trigger_app_settings_updated_at
    BEFORE UPDATE ON app_settings
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE app_settings IS 'Super admin configurable settings — price refresh, feature flags etc';

-- ============================================================
-- MORE TABLES WILL BE ADDED HERE AS WE BUILD FEATURES
-- ============================================================


-- 1. Create security_master
CREATE TABLE security_master (
    symbol          TEXT PRIMARY KEY,
    exchange        TEXT,
    currency        TEXT NOT NULL DEFAULT 'USD',
    name            TEXT,
    asset_type      TEXT,
    sector          TEXT,
    industry        TEXT,
    market_cap      NUMERIC(20,2),
    country         TEXT,
    logo_url        TEXT,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    last_fetched_at TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Drop and recreate price_cache with full OHLCV
DROP TABLE IF EXISTS price_cache CASCADE;

CREATE TABLE price_cache (
    symbol              TEXT NOT NULL,
    currency            TEXT NOT NULL,
    name                TEXT,              -- from API (good to cache)
    exchange            TEXT,              -- e.g. NASDAQ
    mic_code            TEXT,              -- e.g. XNGS
    trade_date          DATE,              -- date of last trade
    last_quote_at       TIMESTAMPTZ,       -- exact timestamp of last quote
    is_market_open      BOOLEAN,           -- was market open at fetch time
    -- OHLCV
    open                NUMERIC(18,6),
    high                NUMERIC(18,6),
    low                 NUMERIC(18,6),
    close               NUMERIC(18,6),
    volume              BIGINT,
    average_volume      BIGINT,            -- 30-day average volume
    -- Day change
    previous_close      NUMERIC(18,6),
    day_change          NUMERIC(18,6),     -- API field: "change"
    day_change_pct      NUMERIC(10,6),     -- API field: "percent_change"
    -- 52 week
    week_52_low              NUMERIC(18,6),
    week_52_high             NUMERIC(18,6),
    week_52_low_change       NUMERIC(18,6),
    week_52_high_change      NUMERIC(18,6),
    week_52_low_change_pct   NUMERIC(10,6),
    week_52_high_change_pct  NUMERIC(10,6),
    week_52_range            TEXT,
    -- Meta
    fetched_at          TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (symbol, currency)
);

-- 3. Create price_history
DROP TABLE IF EXISTS price_history CASCADE;

CREATE TABLE price_history (
    symbol          TEXT NOT NULL,
    date            DATE NOT NULL,
    currency        TEXT NOT NULL,
    open            NUMERIC(18,6),
    high            NUMERIC(18,6),
    low             NUMERIC(18,6),
    close           NUMERIC(18,6),
    volume          BIGINT,
    average_volume  BIGINT,
    day_change      NUMERIC(18,6),
    day_change_pct  NUMERIC(10,6),
    source          TEXT NOT NULL DEFAULT 'twelvedata',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (symbol, date, currency)
);

CREATE INDEX idx_price_history_symbol_date
    ON price_history(symbol, date DESC);

-- 4. Create portfolio_snapshots
CREATE TABLE portfolio_snapshots (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    circle_id       UUID NOT NULL REFERENCES circles(id) ON DELETE CASCADE,
    date            DATE NOT NULL,
    total_value     NUMERIC(18,2),
    total_invested  NUMERIC(18,2),
    total_deposited NUMERIC(18,2),
    total_withdrawn NUMERIC(18,2),
    net_deposited   NUMERIC(18,2),
    unrealized_gl   NUMERIC(18,2),
    realized_gl     NUMERIC(18,2),
    total_gl        NUMERIC(18,2),
    cash_cad        NUMERIC(18,2),
    cash_usd        NUMERIC(18,2),
    currency        TEXT NOT NULL DEFAULT 'CAD',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_snapshot_circle_date UNIQUE (circle_id, date)
);

CREATE INDEX idx_snapshots_circle_date
    ON portfolio_snapshots(circle_id, date DESC);

-- 5. Add missing columns to holdings
ALTER TABLE holdings ADD COLUMN IF NOT EXISTS market_value NUMERIC(18,2);
ALTER TABLE holdings ADD COLUMN IF NOT EXISTS day_change NUMERIC(18,6);
ALTER TABLE holdings ADD COLUMN IF NOT EXISTS day_change_pct NUMERIC(8,4);
ALTER TABLE holdings ADD COLUMN IF NOT EXISTS previous_close NUMERIC(18,6);
ALTER TABLE holdings ADD COLUMN IF NOT EXISTS realized_gain_loss_pct NUMERIC(8,4);

-- 6. Expand transaction_type constraint
ALTER TABLE transactions DROP CONSTRAINT IF EXISTS chk_transaction_type;
ALTER TABLE transactions ADD CONSTRAINT chk_transaction_type CHECK (
    transaction_type IN (
        'BUY', 'SELL', 'DIVIDEND', 'DISTRIBUTION', 'DEPOSIT', 'WITHDRAWAL',
        'FX_CONVERSION', 'INTEREST', 'FEE', 'RETURN_OF_CAPITAL',
        'STOCK_SPLIT', 'CORPORATE_ACTION', 'INTERNAL_TRANSFER',
        'NORBERT_GAMBIT', 'OPTION_PREMIUM', 'OPTION_BUY_BACK',
        'OPTION_ASSIGNED', 'OPTION_EXPIRED', 'CRYPTO', 'OTHER'
    )
);

-- 7. Expand asset_type constraint on transactions
ALTER TABLE transactions DROP CONSTRAINT IF EXISTS chk_asset_type;
ALTER TABLE transactions ADD CONSTRAINT chk_asset_type CHECK (
    asset_type IN (
        'STOCK', 'ETF', 'OPTION', 'CRYPTO', 'CASH',
        'REIT', 'PREFERRED', 'BOND', 'MUTUAL_FUND', 'GIC', 'OTHER', NULL
    )
);

-- 8. Expand asset_type constraint on holdings
ALTER TABLE holdings DROP CONSTRAINT IF EXISTS chk_holding_asset_type;
ALTER TABLE holdings ADD CONSTRAINT chk_holding_asset_type CHECK (
    asset_type IN (
        'STOCK', 'ETF', 'CRYPTO', 'REIT', 'PREFERRED', 'OTHER'
    )
);

CREATE TABLE symbol_aliases (
    bare_symbol      TEXT PRIMARY KEY,
    canonical_symbol TEXT NOT NULL,
    exchange         TEXT,
    country          TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE transactions DROP CONSTRAINT transactions_import_hash_key;





-- ============================================================
-- 1. REALIZED GAINS — per account per SELL transaction
--    Source of truth for broker reconciliation view.
--    Populated by acb_service on every import / recalculation.
-- ============================================================

CREATE TABLE IF NOT EXISTS realized_gains (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    account_id          UUID NOT NULL REFERENCES member_accounts(id) ON DELETE CASCADE,
    transaction_id      UUID REFERENCES transactions(id) ON DELETE SET NULL,
    symbol              TEXT NOT NULL,
    trade_date          DATE NOT NULL,
    tax_year            INTEGER NOT NULL,
    quantity_sold       NUMERIC(18,8) NOT NULL,
    proceeds            NUMERIC(18,2) NOT NULL,   -- net_amount of SELL (after commission)
    acb_per_share       NUMERIC(18,6) NOT NULL,   -- per-account ACB at time of sell
    acb_total           NUMERIC(18,2) NOT NULL,   -- acb_per_share × quantity_sold
    realized_gl         NUMERIC(18,2) NOT NULL,   -- proceeds − acb_total
    currency            TEXT NOT NULL DEFAULT 'CAD',
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_realized_gains_account_id
    ON realized_gains(account_id);

CREATE INDEX IF NOT EXISTS idx_realized_gains_tax_year
    ON realized_gains(tax_year);

CREATE INDEX IF NOT EXISTS idx_realized_gains_symbol
    ON realized_gains(symbol);

CREATE INDEX IF NOT EXISTS idx_realized_gains_account_year
    ON realized_gains(account_id, tax_year);

COMMENT ON TABLE realized_gains IS 'One row per SELL transaction — per-account ACB for broker reconciliation view';
COMMENT ON COLUMN realized_gains.acb_per_share IS 'Per-account weighted average ACB at moment of sell — matches broker T5008';
COMMENT ON COLUMN realized_gains.proceeds IS 'Net proceeds after commission — same as transactions.net_amount for SELL';

-- ============================================================
-- 2. REALIZED GAINS CONSOLIDATED — per member per symbol per tax year
--    CPA view — cross-broker weighted average ACB per person.
--    Populated by acb_service after per-account calculation.
-- ============================================================

CREATE TABLE IF NOT EXISTS realized_gains_consolidated (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    member_id           UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    tax_year            INTEGER NOT NULL,
    symbol              TEXT NOT NULL,
    currency            TEXT NOT NULL DEFAULT 'CAD',
    total_quantity_sold NUMERIC(18,8) NOT NULL,
    total_proceeds      NUMERIC(18,2) NOT NULL,
    total_acb           NUMERIC(18,2) NOT NULL,   -- true cross-broker weighted avg ACB
    total_realized_gl   NUMERIC(18,2) NOT NULL,
    sell_count          INTEGER NOT NULL DEFAULT 1, -- number of SELL transactions
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_realized_gains_consolidated
        UNIQUE (member_id, tax_year, symbol)
);

CREATE INDEX IF NOT EXISTS idx_rgc_member_year
    ON realized_gains_consolidated(member_id, tax_year);

CREATE INDEX IF NOT EXISTS idx_rgc_symbol
    ON realized_gains_consolidated(symbol);

COMMENT ON TABLE realized_gains_consolidated IS 'CPA view — cross-broker ACB per member per symbol per year for Schedule 3';
COMMENT ON COLUMN realized_gains_consolidated.total_acb IS 'True cross-broker weighted average ACB — differs from broker reports when same stock held at multiple brokers';


- ============================================================

CREATE TABLE IF NOT EXISTS rebalancer_targets (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    circle_id           UUID NOT NULL REFERENCES circles(id) ON DELETE CASCADE,
    symbol              TEXT NOT NULL,
    target_weight_pct   NUMERIC(5,2) NOT NULL DEFAULT 0,
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_rebalancer_circle_symbol
        UNIQUE (circle_id, symbol),
    CONSTRAINT chk_target_weight
        CHECK (target_weight_pct >= 0 AND target_weight_pct <= 100)
);

CREATE INDEX IF NOT EXISTS idx_rebalancer_targets_circle
    ON rebalancer_targets(circle_id);

CREATE TRIGGER trigger_rebalancer_targets_updated_at
    BEFORE UPDATE ON rebalancer_targets
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE rebalancer_targets IS 'User-defined target weights per symbol per circle for portfolio rebalancing';
COMMENT ON COLUMN rebalancer_targets.target_weight_pct IS '0-100 — target % of portfolio. Total across circle can be < 100 (user may only target some positions).';
