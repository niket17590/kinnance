-- ============================================================
-- Kinnance RLS Policies
-- Script  : 003_rls_policies.sql
-- Purpose : Row Level Security for all tables
-- Run on  : After 001_initial_schema.sql
-- ============================================================

-- ============================================================
-- USERS
-- ============================================================

ALTER TABLE users ENABLE ROW LEVEL SECURITY;

-- User can read their own record
CREATE POLICY users_select_own
    ON users FOR SELECT
    USING (auth_user_id = auth.uid());

-- User can update their own record
CREATE POLICY users_update_own
    ON users FOR UPDATE
    USING (auth_user_id = auth.uid());

-- Insert allowed on first login
CREATE POLICY users_insert_own
    ON users FOR INSERT
    WITH CHECK (auth_user_id = auth.uid());

-- Super admin can read all users
CREATE POLICY users_select_super_admin
    ON users FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM users
            WHERE auth_user_id = auth.uid()
            AND is_super_admin = TRUE
        )
    );

-- ============================================================
-- MORE RLS POLICIES WILL BE ADDED HERE AS WE ADD TABLES
-- ============================================================