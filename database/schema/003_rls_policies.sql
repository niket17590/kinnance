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
-- REGIONS — public read, super admin write
-- ============================================================

ALTER TABLE regions ENABLE ROW LEVEL SECURITY;

CREATE POLICY regions_select_all
    ON regions FOR SELECT USING (TRUE);

CREATE POLICY regions_modify_super_admin
    ON regions FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM users
            WHERE auth_user_id = auth.uid()
            AND is_super_admin = TRUE
        )
    );

-- ============================================================
-- CURRENCIES — public read, super admin write
-- ============================================================

ALTER TABLE currencies ENABLE ROW LEVEL SECURITY;

CREATE POLICY currencies_select_all
    ON currencies FOR SELECT USING (TRUE);

CREATE POLICY currencies_modify_super_admin
    ON currencies FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM users
            WHERE auth_user_id = auth.uid()
            AND is_super_admin = TRUE
        )
    );

-- ============================================================
-- BROKERS — public read, super admin write
-- ============================================================

ALTER TABLE brokers ENABLE ROW LEVEL SECURITY;

CREATE POLICY brokers_select_all
    ON brokers FOR SELECT USING (TRUE);

CREATE POLICY brokers_modify_super_admin
    ON brokers FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM users
            WHERE auth_user_id = auth.uid()
            AND is_super_admin = TRUE
        )
    );

-- ============================================================
-- MEMBERS — owner only, super admin sees all
-- ============================================================

ALTER TABLE members ENABLE ROW LEVEL SECURITY;

CREATE POLICY members_select_own
    ON members FOR SELECT
    USING (
        owner_id = (SELECT id FROM users WHERE auth_user_id = auth.uid())
    );

CREATE POLICY members_insert_own
    ON members FOR INSERT
    WITH CHECK (
        owner_id = (SELECT id FROM users WHERE auth_user_id = auth.uid())
    );

CREATE POLICY members_update_own
    ON members FOR UPDATE
    USING (
        owner_id = (SELECT id FROM users WHERE auth_user_id = auth.uid())
    );

CREATE POLICY members_delete_own
    ON members FOR DELETE
    USING (
        owner_id = (SELECT id FROM users WHERE auth_user_id = auth.uid())
    );

CREATE POLICY members_super_admin
    ON members FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM users
            WHERE auth_user_id = auth.uid()
            AND is_super_admin = TRUE
        )
    );

-- ============================================================
-- CIRCLES — owner only
-- ============================================================

ALTER TABLE circles ENABLE ROW LEVEL SECURITY;

CREATE POLICY circles_select_own
    ON circles FOR SELECT
    USING (
        owner_id = (SELECT id FROM users WHERE auth_user_id = auth.uid())
    );

CREATE POLICY circles_insert_own
    ON circles FOR INSERT
    WITH CHECK (
        owner_id = (SELECT id FROM users WHERE auth_user_id = auth.uid())
    );

CREATE POLICY circles_update_own
    ON circles FOR UPDATE
    USING (
        owner_id = (SELECT id FROM users WHERE auth_user_id = auth.uid())
    );

CREATE POLICY circles_delete_own
    ON circles FOR DELETE
    USING (
        owner_id = (SELECT id FROM users WHERE auth_user_id = auth.uid())
    );

CREATE POLICY circles_super_admin
    ON circles FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM users
            WHERE auth_user_id = auth.uid()
            AND is_super_admin = TRUE
        )
    );

-- ============================================================
-- CIRCLE ACCOUNTS — owner of circle only
-- ============================================================

ALTER TABLE circle_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY circle_accounts_select_own
    ON circle_accounts FOR SELECT
    USING (
        circle_id IN (
            SELECT id FROM circles
            WHERE owner_id = (SELECT id FROM users WHERE auth_user_id = auth.uid())
        )
    );

CREATE POLICY circle_accounts_insert_own
    ON circle_accounts FOR INSERT
    WITH CHECK (
        circle_id IN (
            SELECT id FROM circles
            WHERE owner_id = (SELECT id FROM users WHERE auth_user_id = auth.uid())
        )
    );

CREATE POLICY circle_accounts_delete_own
    ON circle_accounts FOR DELETE
    USING (
        circle_id IN (
            SELECT id FROM circles
            WHERE owner_id = (SELECT id FROM users WHERE auth_user_id = auth.uid())
        )
    );

CREATE POLICY circle_accounts_super_admin
    ON circle_accounts FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM users
            WHERE auth_user_id = auth.uid()
            AND is_super_admin = TRUE
        )
    );

-- ============================================================
-- ACCOUNT TYPES — public read, super admin write
-- ============================================================

ALTER TABLE account_types ENABLE ROW LEVEL SECURITY;

CREATE POLICY account_types_select_all
    ON account_types FOR SELECT USING (TRUE);

CREATE POLICY account_types_modify_super_admin
    ON account_types FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM users
            WHERE auth_user_id = auth.uid()
            AND is_super_admin = TRUE
        )
    );

-- ============================================================
-- ACCOUNT TYPE LIMITS — public read, super admin write
-- ============================================================

ALTER TABLE account_type_limits ENABLE ROW LEVEL SECURITY;

CREATE POLICY account_type_limits_select_all
    ON account_type_limits FOR SELECT USING (TRUE);

CREATE POLICY account_type_limits_modify_super_admin
    ON account_type_limits FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM users
            WHERE auth_user_id = auth.uid()
            AND is_super_admin = TRUE
        )
    );

-- ============================================================
-- MEMBER ACCOUNTS — owner of member only
-- ============================================================

ALTER TABLE member_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY member_accounts_select_own
    ON member_accounts FOR SELECT
    USING (
        member_id IN (
            SELECT id FROM members
            WHERE owner_id = (SELECT id FROM users WHERE auth_user_id = auth.uid())
        )
    );

CREATE POLICY member_accounts_insert_own
    ON member_accounts FOR INSERT
    WITH CHECK (
        member_id IN (
            SELECT id FROM members
            WHERE owner_id = (SELECT id FROM users WHERE auth_user_id = auth.uid())
        )
    );

CREATE POLICY member_accounts_update_own
    ON member_accounts FOR UPDATE
    USING (
        member_id IN (
            SELECT id FROM members
            WHERE owner_id = (SELECT id FROM users WHERE auth_user_id = auth.uid())
        )
    );

CREATE POLICY member_accounts_delete_own
    ON member_accounts FOR DELETE
    USING (
        member_id IN (
            SELECT id FROM members
            WHERE owner_id = (SELECT id FROM users WHERE auth_user_id = auth.uid())
        )
    );

CREATE POLICY member_accounts_super_admin
    ON member_accounts FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM users
            WHERE auth_user_id = auth.uid()
            AND is_super_admin = TRUE
        )
    );

-- ============================================================
-- CONTRIBUTION ROOM — owner of member only
-- ============================================================

ALTER TABLE contribution_room ENABLE ROW LEVEL SECURITY;

CREATE POLICY contribution_room_select_own
    ON contribution_room FOR SELECT
    USING (
        member_id IN (
            SELECT id FROM members
            WHERE owner_id = (SELECT id FROM users WHERE auth_user_id = auth.uid())
        )
    );

CREATE POLICY contribution_room_insert_own
    ON contribution_room FOR INSERT
    WITH CHECK (
        member_id IN (
            SELECT id FROM members
            WHERE owner_id = (SELECT id FROM users WHERE auth_user_id = auth.uid())
        )
    );

CREATE POLICY contribution_room_update_own
    ON contribution_room FOR UPDATE
    USING (
        member_id IN (
            SELECT id FROM members
            WHERE owner_id = (SELECT id FROM users WHERE auth_user_id = auth.uid())
        )
    );

CREATE POLICY contribution_room_super_admin
    ON contribution_room FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM users
            WHERE auth_user_id = auth.uid()
            AND is_super_admin = TRUE
        )
    );

-- ============================================================
-- MORE RLS POLICIES ADDED HERE IN PHASE 3
-- ============================================================