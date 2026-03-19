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
    is_active                   BOOLEAN NOT NULL DEFAULT TRUE,
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_applies_to
        CHECK (applies_to IN ('PERSON', 'CORPORATION', 'BOTH')),
    CONSTRAINT chk_tax_category
        CHECK (tax_category IN ('TAX_FREE', 'TAX_DEFERRED', 'TAXABLE', 'CORP_TAXABLE'))
);

CREATE INDEX IF NOT EXISTS idx_account_types_region ON account_types(region_code);
CREATE INDEX IF NOT EXISTS idx_account_types_applies_to ON account_types(applies_to);

CREATE TRIGGER trigger_account_types_updated_at
    BEFORE UPDATE ON account_types
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE account_types IS 'Supported account types per region — managed by super admin';
COMMENT ON COLUMN account_types.applies_to IS 'PERSON, CORPORATION, or BOTH';
COMMENT ON COLUMN account_types.tax_category IS 'Tax treatment of this account type';

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
COMMENT ON COLUMN account_type_limits.lifetime_limit IS 'NULL if no lifetime limit exists';

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
    opened_date         DATE,
    is_active           BOOLEAN NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_member_broker_account_type
        UNIQUE (member_id, broker_code, account_type_code)
);

CREATE INDEX IF NOT EXISTS idx_member_accounts_member_id ON member_accounts(member_id);
CREATE INDEX IF NOT EXISTS idx_member_accounts_region ON member_accounts(region_code);

CREATE TRIGGER trigger_member_accounts_updated_at
    BEFORE UPDATE ON member_accounts
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE member_accounts IS 'Brokerage accounts belonging to members';
COMMENT ON COLUMN member_accounts.account_number IS 'Optional brokerage account number';
COMMENT ON COLUMN member_accounts.opened_date IS 'Used for TFSA contribution room calculation';

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

CREATE INDEX IF NOT EXISTS idx_contribution_room_member ON contribution_room(member_id);

CREATE TRIGGER trigger_contribution_room_updated_at
    BEFORE UPDATE ON contribution_room
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE contribution_room IS 'Calculated contribution room per member per account type per year';
COMMENT ON COLUMN contribution_room.is_overridden IS 'True when user manually enters CRA confirmed room';
COMMENT ON COLUMN contribution_room.override_room IS 'CRA confirmed room — used when is_overridden is true';

-- ============================================================
-- MORE TABLES WILL BE ADDED HERE AS WE BUILD FEATURES
-- ============================================================