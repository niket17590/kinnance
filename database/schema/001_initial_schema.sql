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
-- MORE TABLES WILL BE ADDED HERE AS WE BUILD FEATURES
-- ============================================================