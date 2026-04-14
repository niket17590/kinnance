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
-- BROKER ACCOUNT MAPPINGS — owner of account only
-- ============================================================

ALTER TABLE broker_account_mappings ENABLE ROW LEVEL SECURITY;

CREATE POLICY broker_mappings_select_own
    ON broker_account_mappings FOR SELECT
    USING (
        account_id IN (
            SELECT ma.id FROM member_accounts ma
            JOIN members m ON ma.member_id = m.id
            WHERE m.owner_id = (SELECT id FROM users WHERE auth_user_id = auth.uid())
        )
    );

CREATE POLICY broker_mappings_insert_own
    ON broker_account_mappings FOR INSERT
    WITH CHECK (
        account_id IN (
            SELECT ma.id FROM member_accounts ma
            JOIN members m ON ma.member_id = m.id
            WHERE m.owner_id = (SELECT id FROM users WHERE auth_user_id = auth.uid())
        )
    );

CREATE POLICY broker_mappings_delete_own
    ON broker_account_mappings FOR DELETE
    USING (
        account_id IN (
            SELECT ma.id FROM member_accounts ma
            JOIN members m ON ma.member_id = m.id
            WHERE m.owner_id = (SELECT id FROM users WHERE auth_user_id = auth.uid())
        )
    );

CREATE POLICY broker_mappings_super_admin
    ON broker_account_mappings FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM users
            WHERE auth_user_id = auth.uid()
            AND is_super_admin = TRUE
        )
    );

-- ============================================================
-- IMPORT BATCHES — owner only
-- ============================================================

ALTER TABLE import_batches ENABLE ROW LEVEL SECURITY;

CREATE POLICY import_batches_select_own
    ON import_batches FOR SELECT
    USING (owner_id = (SELECT id FROM users WHERE auth_user_id = auth.uid()));

CREATE POLICY import_batches_insert_own
    ON import_batches FOR INSERT
    WITH CHECK (owner_id = (SELECT id FROM users WHERE auth_user_id = auth.uid()));

CREATE POLICY import_batches_update_own
    ON import_batches FOR UPDATE
    USING (owner_id = (SELECT id FROM users WHERE auth_user_id = auth.uid()));

CREATE POLICY import_batches_super_admin
    ON import_batches FOR ALL
    USING (EXISTS (
        SELECT 1 FROM users
        WHERE auth_user_id = auth.uid()
        AND is_super_admin = TRUE
    ));

-- ============================================================
-- TRANSACTIONS — owner of account only
-- ============================================================

ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY transactions_select_own
    ON transactions FOR SELECT
    USING (
        account_id IN (
            SELECT ma.id FROM member_accounts ma
            JOIN members m ON ma.member_id = m.id
            WHERE m.owner_id = (SELECT id FROM users WHERE auth_user_id = auth.uid())
        )
    );

CREATE POLICY transactions_insert_own
    ON transactions FOR INSERT
    WITH CHECK (
        account_id IN (
            SELECT ma.id FROM member_accounts ma
            JOIN members m ON ma.member_id = m.id
            WHERE m.owner_id = (SELECT id FROM users WHERE auth_user_id = auth.uid())
        )
    );

CREATE POLICY transactions_update_own
    ON transactions FOR UPDATE
    USING (
        account_id IN (
            SELECT ma.id FROM member_accounts ma
            JOIN members m ON ma.member_id = m.id
            WHERE m.owner_id = (SELECT id FROM users WHERE auth_user_id = auth.uid())
        )
    );

CREATE POLICY transactions_delete_own
    ON transactions FOR DELETE
    USING (
        account_id IN (
            SELECT ma.id FROM member_accounts ma
            JOIN members m ON ma.member_id = m.id
            WHERE m.owner_id = (SELECT id FROM users WHERE auth_user_id = auth.uid())
        )
    );

CREATE POLICY transactions_super_admin
    ON transactions FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM users
            WHERE auth_user_id = auth.uid()
            AND is_super_admin = TRUE
        )
    );

-- ============================================================
-- HOLDINGS — owner of account only
-- ============================================================

ALTER TABLE holdings ENABLE ROW LEVEL SECURITY;

CREATE POLICY holdings_select_own
    ON holdings FOR SELECT
    USING (
        account_id IN (
            SELECT ma.id FROM member_accounts ma
            JOIN members m ON ma.member_id = m.id
            WHERE m.owner_id = (SELECT id FROM users WHERE auth_user_id = auth.uid())
        )
    );

CREATE POLICY holdings_insert_own
    ON holdings FOR INSERT
    WITH CHECK (
        account_id IN (
            SELECT ma.id FROM member_accounts ma
            JOIN members m ON ma.member_id = m.id
            WHERE m.owner_id = (SELECT id FROM users WHERE auth_user_id = auth.uid())
        )
    );

CREATE POLICY holdings_update_own
    ON holdings FOR UPDATE
    USING (
        account_id IN (
            SELECT ma.id FROM member_accounts ma
            JOIN members m ON ma.member_id = m.id
            WHERE m.owner_id = (SELECT id FROM users WHERE auth_user_id = auth.uid())
        )
    );

CREATE POLICY holdings_delete_own
    ON holdings FOR DELETE
    USING (
        account_id IN (
            SELECT ma.id FROM member_accounts ma
            JOIN members m ON ma.member_id = m.id
            WHERE m.owner_id = (SELECT id FROM users WHERE auth_user_id = auth.uid())
        )
    );

CREATE POLICY holdings_super_admin
    ON holdings FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM users
            WHERE auth_user_id = auth.uid()
            AND is_super_admin = TRUE
        )
    );

-- ============================================================
-- CASH BALANCES — owner of account only
-- ============================================================

ALTER TABLE cash_balances ENABLE ROW LEVEL SECURITY;

CREATE POLICY cash_balances_select_own
    ON cash_balances FOR SELECT
    USING (
        account_id IN (
            SELECT ma.id FROM member_accounts ma
            JOIN members m ON ma.member_id = m.id
            WHERE m.owner_id = (SELECT id FROM users WHERE auth_user_id = auth.uid())
        )
    );

CREATE POLICY cash_balances_insert_own
    ON cash_balances FOR INSERT
    WITH CHECK (
        account_id IN (
            SELECT ma.id FROM member_accounts ma
            JOIN members m ON ma.member_id = m.id
            WHERE m.owner_id = (SELECT id FROM users WHERE auth_user_id = auth.uid())
        )
    );

CREATE POLICY cash_balances_update_own
    ON cash_balances FOR UPDATE
    USING (
        account_id IN (
            SELECT ma.id FROM member_accounts ma
            JOIN members m ON ma.member_id = m.id
            WHERE m.owner_id = (SELECT id FROM users WHERE auth_user_id = auth.uid())
        )
    );

CREATE POLICY cash_balances_delete_own
    ON cash_balances FOR DELETE
    USING (
        account_id IN (
            SELECT ma.id FROM member_accounts ma
            JOIN members m ON ma.member_id = m.id
            WHERE m.owner_id = (SELECT id FROM users WHERE auth_user_id = auth.uid())
        )
    );

CREATE POLICY cash_balances_super_admin
    ON cash_balances FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM users
            WHERE auth_user_id = auth.uid()
            AND is_super_admin = TRUE
        )
    );

-- ============================================================
-- OPTION CONTRACTS — owner of account only
-- ============================================================

ALTER TABLE option_contracts ENABLE ROW LEVEL SECURITY;

CREATE POLICY option_contracts_select_own
    ON option_contracts FOR SELECT
    USING (
        account_id IN (
            SELECT ma.id FROM member_accounts ma
            JOIN members m ON ma.member_id = m.id
            WHERE m.owner_id = (SELECT id FROM users WHERE auth_user_id = auth.uid())
        )
    );

CREATE POLICY option_contracts_insert_own
    ON option_contracts FOR INSERT
    WITH CHECK (
        account_id IN (
            SELECT ma.id FROM member_accounts ma
            JOIN members m ON ma.member_id = m.id
            WHERE m.owner_id = (SELECT id FROM users WHERE auth_user_id = auth.uid())
        )
    );

CREATE POLICY option_contracts_update_own
    ON option_contracts FOR UPDATE
    USING (
        account_id IN (
            SELECT ma.id FROM member_accounts ma
            JOIN members m ON ma.member_id = m.id
            WHERE m.owner_id = (SELECT id FROM users WHERE auth_user_id = auth.uid())
        )
    );

CREATE POLICY option_contracts_delete_own
    ON option_contracts FOR DELETE
    USING (
        account_id IN (
            SELECT ma.id FROM member_accounts ma
            JOIN members m ON ma.member_id = m.id
            WHERE m.owner_id = (SELECT id FROM users WHERE auth_user_id = auth.uid())
        )
    );

CREATE POLICY option_contracts_super_admin
    ON option_contracts FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM users
            WHERE auth_user_id = auth.uid()
            AND is_super_admin = TRUE
        )
    );

-- ============================================================
-- PRICE CACHE — public read, super admin write
-- All users can read prices, only super admin can modify
-- ============================================================

ALTER TABLE price_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY price_cache_select_all
    ON price_cache FOR SELECT
    USING (TRUE);

CREATE POLICY price_cache_modify_super_admin
    ON price_cache FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM users
            WHERE auth_user_id = auth.uid()
            AND is_super_admin = TRUE
        )
    );

-- ============================================================
-- APP SETTINGS — public read, super admin write
-- ============================================================

ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY app_settings_select_all
    ON app_settings FOR SELECT
    USING (TRUE);

CREATE POLICY app_settings_modify_super_admin
    ON app_settings FOR ALL
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


ALTER TABLE realized_gains ENABLE ROW LEVEL SECURITY;

CREATE POLICY realized_gains_select_own
    ON realized_gains FOR SELECT
    USING (
        account_id IN (
            SELECT ma.id FROM member_accounts ma
            JOIN members m ON ma.member_id = m.id
            WHERE m.owner_id = (SELECT id FROM users WHERE auth_user_id = auth.uid())
        )
    );

CREATE POLICY realized_gains_insert_own
    ON realized_gains FOR INSERT
    WITH CHECK (
        account_id IN (
            SELECT ma.id FROM member_accounts ma
            JOIN members m ON ma.member_id = m.id
            WHERE m.owner_id = (SELECT id FROM users WHERE auth_user_id = auth.uid())
        )
    );

CREATE POLICY realized_gains_delete_own
    ON realized_gains FOR DELETE
    USING (
        account_id IN (
            SELECT ma.id FROM member_accounts ma
            JOIN members m ON ma.member_id = m.id
            WHERE m.owner_id = (SELECT id FROM users WHERE auth_user_id = auth.uid())
        )
    );

CREATE POLICY realized_gains_super_admin
    ON realized_gains FOR ALL
    USING (
        EXISTS (SELECT 1 FROM users WHERE auth_user_id = auth.uid() AND is_super_admin = TRUE)
    );

ALTER TABLE realized_gains_consolidated ENABLE ROW LEVEL SECURITY;

CREATE POLICY rgc_select_own
    ON realized_gains_consolidated FOR SELECT
    USING (
        member_id IN (
            SELECT id FROM members
            WHERE owner_id = (SELECT id FROM users WHERE auth_user_id = auth.uid())
        )
    );

CREATE POLICY rgc_insert_own
    ON realized_gains_consolidated FOR INSERT
    WITH CHECK (
        member_id IN (
            SELECT id FROM members
            WHERE owner_id = (SELECT id FROM users WHERE auth_user_id = auth.uid())
        )
    );

CREATE POLICY rgc_delete_own
    ON realized_gains_consolidated FOR DELETE
    USING (
        member_id IN (
            SELECT id FROM members
            WHERE owner_id = (SELECT id FROM users WHERE auth_user_id = auth.uid())
        )
    );

CREATE POLICY rgc_super_admin
    ON realized_gains_consolidated FOR ALL
    USING (
        EXISTS (SELECT 1 FROM users WHERE auth_user_id = auth.uid() AND is_super_admin = TRUE)
    );




ALTER TABLE rebalancer_targets ENABLE ROW LEVEL SECURITY;

CREATE POLICY rebalancer_targets_select_own
    ON rebalancer_targets FOR SELECT
    USING (
        circle_id IN (
            SELECT id FROM circles
            WHERE owner_id = (SELECT id FROM users WHERE auth_user_id = auth.uid())
        )
    );

CREATE POLICY rebalancer_targets_insert_own
    ON rebalancer_targets FOR INSERT
    WITH CHECK (
        circle_id IN (
            SELECT id FROM circles
            WHERE owner_id = (SELECT id FROM users WHERE auth_user_id = auth.uid())
        )
    );

CREATE POLICY rebalancer_targets_update_own
    ON rebalancer_targets FOR UPDATE
    USING (
        circle_id IN (
            SELECT id FROM circles
            WHERE owner_id = (SELECT id FROM users WHERE auth_user_id = auth.uid())
        )
    );

CREATE POLICY rebalancer_targets_delete_own
    ON rebalancer_targets FOR DELETE
    USING (
        circle_id IN (
            SELECT id FROM circles
            WHERE owner_id = (SELECT id FROM users WHERE auth_user_id = auth.uid())
        )
    );

CREATE POLICY rebalancer_targets_super_admin
    ON rebalancer_targets FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM users
            WHERE auth_user_id = auth.uid()
            AND is_super_admin = TRUE
        )
    );
