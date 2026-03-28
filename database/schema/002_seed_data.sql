-- ============================================================
-- Kinnance Seed Data
-- Script  : 002_seed_data.sql
-- Purpose : Initial reference data for Canada
-- Run on  : After 001_initial_schema.sql
-- ============================================================

-- ============================================================
-- REGIONS
-- ============================================================

INSERT INTO regions (code, name, default_currency, is_active) VALUES
    ('CA', 'Canada',        'CAD', TRUE),
    ('US', 'United States', 'USD', FALSE),
    ('IN', 'India',         'INR', FALSE)
ON CONFLICT (code) DO UPDATE SET
    name             = EXCLUDED.name,
    default_currency = EXCLUDED.default_currency,
    is_active        = EXCLUDED.is_active;

-- ============================================================
-- CURRENCIES
-- ============================================================

INSERT INTO currencies (code, name, symbol, is_active) VALUES
    ('CAD', 'Canadian Dollar', '$', TRUE),
    ('USD', 'US Dollar',       '$', TRUE),
    ('INR', 'Indian Rupee',    '₹', TRUE),
    ('GBP', 'British Pound',   '£', TRUE),
    ('EUR', 'Euro',            '€', TRUE)
ON CONFLICT (code) DO UPDATE SET
    name      = EXCLUDED.name,
    symbol    = EXCLUDED.symbol,
    is_active = EXCLUDED.is_active;

-- ============================================================
-- BROKERS — Canada
-- ============================================================

INSERT INTO brokers (code, region_code, name, is_active) VALUES
    ('WEALTHSIMPLE', 'CA', 'WealthSimple',         TRUE),
    ('QUESTRADE',    'CA', 'Questrade',             TRUE),
    ('IBKR',         'CA', 'Interactive Brokers',   TRUE),
    ('NBDB',         'CA', 'National Bank Direct',  TRUE),
    ('TDDI',         'CA', 'TD Direct Investing',   TRUE),
    ('RBC_DI',       'CA', 'RBC Direct Investing',  TRUE),
    ('BMO_IL',       'CA', 'BMO InvestorLine',      TRUE),
    ('CIBC_II',      'CA', 'CIBC Investor''s Edge', TRUE),
    ('MANUAL',       'CA', 'Manual Entry',          TRUE)
ON CONFLICT (code) DO UPDATE SET
    name      = EXCLUDED.name,
    is_active = EXCLUDED.is_active;

-- ============================================================
-- ACCOUNT TYPES — Canada
-- ============================================================

INSERT INTO account_types (
    code, region_code, name, short_name,
    applies_to, tax_category,
    has_contribution_limit, has_lifetime_limit,
    contribution_limit_type, is_active
) VALUES
    ('TFSA',        'CA', 'Tax-Free Savings Account',           'TFSA',        'PERSON',      'TAX_FREE',     TRUE,  FALSE, 'FIXED_ANNUAL', TRUE),
    ('FHSA',        'CA', 'First Home Savings Account',         'FHSA',        'PERSON',      'TAX_FREE',     TRUE,  TRUE,  'FIXED_ANNUAL', TRUE),
    ('RRSP',        'CA', 'Registered Retirement Savings Plan', 'RRSP',        'PERSON',      'TAX_DEFERRED', TRUE,  FALSE, 'INCOME_BASED', TRUE),
    ('RRIF',        'CA', 'Registered Retirement Income Fund',  'RRIF',        'PERSON',      'TAX_DEFERRED', FALSE, FALSE, 'INCOME_BASED', TRUE),
    ('RESP',        'CA', 'Registered Education Savings Plan',  'RESP',        'PERSON',      'TAX_DEFERRED', FALSE, TRUE,  'LIFETIME',     TRUE),
    ('LIRA',        'CA', 'Locked-In Retirement Account',       'LIRA',        'PERSON',      'TAX_DEFERRED', FALSE, FALSE, 'INCOME_BASED', TRUE),
    ('CASH',        'CA', 'Non-Registered Cash Account',        'Cash',        'PERSON',      'TAXABLE',      FALSE, FALSE, NULL,           TRUE),
    ('MARGIN',      'CA', 'Non-Registered Margin Account',      'Margin',      'PERSON',      'TAXABLE',      FALSE, FALSE, NULL,           TRUE),
    ('CORP_CASH',   'CA', 'Corporate Cash Account',             'Corp Cash',   'CORPORATION', 'CORP_TAXABLE', FALSE, FALSE, NULL,           TRUE),
    ('CORP_MARGIN', 'CA', 'Corporate Margin Account',           'Corp Margin', 'CORPORATION', 'CORP_TAXABLE', FALSE, FALSE, NULL,           TRUE)
ON CONFLICT (code) DO UPDATE SET
    name                    = EXCLUDED.name,
    short_name              = EXCLUDED.short_name,
    applies_to              = EXCLUDED.applies_to,
    tax_category            = EXCLUDED.tax_category,
    has_contribution_limit  = EXCLUDED.has_contribution_limit,
    has_lifetime_limit      = EXCLUDED.has_lifetime_limit,
    contribution_limit_type = EXCLUDED.contribution_limit_type,
    is_active               = EXCLUDED.is_active;

-- ============================================================
-- ACCOUNT TYPE LIMITS — Canada
-- ============================================================

-- TFSA annual limits (2009 onwards)
INSERT INTO account_type_limits (account_type_code, tax_year, annual_limit, lifetime_limit) VALUES
    ('TFSA', 2009, 5000.00,  NULL),
    ('TFSA', 2010, 5000.00,  NULL),
    ('TFSA', 2011, 5000.00,  NULL),
    ('TFSA', 2012, 5000.00,  NULL),
    ('TFSA', 2013, 5500.00,  NULL),
    ('TFSA', 2014, 5500.00,  NULL),
    ('TFSA', 2015, 10000.00, NULL),
    ('TFSA', 2016, 5500.00,  NULL),
    ('TFSA', 2017, 5500.00,  NULL),
    ('TFSA', 2018, 5500.00,  NULL),
    ('TFSA', 2019, 6000.00,  NULL),
    ('TFSA', 2020, 6000.00,  NULL),
    ('TFSA', 2021, 6000.00,  NULL),
    ('TFSA', 2022, 6000.00,  NULL),
    ('TFSA', 2023, 6500.00,  NULL),
    ('TFSA', 2024, 7000.00,  NULL),
    ('TFSA', 2025, 7000.00,  NULL)
ON CONFLICT (account_type_code, tax_year) DO NOTHING;

-- FHSA annual + lifetime limits
INSERT INTO account_type_limits (account_type_code, tax_year, annual_limit, lifetime_limit) VALUES
    ('FHSA', 2023, 8000.00, 40000.00),
    ('FHSA', 2024, 8000.00, 40000.00),
    ('FHSA', 2025, 8000.00, 40000.00)
ON CONFLICT (account_type_code, tax_year) DO NOTHING;

-- RESP lifetime limit only
INSERT INTO account_type_limits (account_type_code, tax_year, annual_limit, lifetime_limit, notes)
VALUES ('RESP', 0, NULL, 50000.00, 'Lifetime limit — tax_year 0 means not year-specific')
ON CONFLICT (account_type_code, tax_year) DO NOTHING;

-- ============================================================
-- APP SETTINGS — defaults
-- ============================================================

INSERT INTO app_settings (setting_key, setting_value, description) VALUES
    ('price_refresh_enabled',    'true',   'Enable/disable background price refresh scheduler'),
    ('price_refresh_minutes',    '60',     'How often to refresh prices in minutes'),
    ('price_refresh_symbols_limit', '800', 'Max symbols per refresh (Twelve Data free tier = 800/day)'),
    ('twelvedata_api_key',       '',       'Twelve Data API key — set this before enabling price refresh'),
    ('app_version',              '1.0.0',  'Current application version'),
    ('maintenance_mode',         'false',  'When true, show maintenance message to all users'),
    ('max_import_rows',          '5000',   'Maximum rows allowed per CSV import'),
    ('supported_currencies',     'CAD,USD','Comma-separated list of supported trade currencies')
ON CONFLICT (setting_key) DO NOTHING;