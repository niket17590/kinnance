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
-- MORE TABLES WILL BE ADDED HERE AS WE BUILD FEATURES
-- ============================================================