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
    is_active
) VALUES
    ('TFSA',        'CA', 'Tax-Free Savings Account',           'TFSA',        'PERSON',      'TAX_FREE',     TRUE,  FALSE, TRUE),
    ('FHSA',        'CA', 'First Home Savings Account',         'FHSA',        'PERSON',      'TAX_FREE',     TRUE,  TRUE,  TRUE),
    ('RRSP',        'CA', 'Registered Retirement Savings Plan', 'RRSP',        'PERSON',      'TAX_DEFERRED', TRUE,  FALSE, TRUE),
    ('RRIF',        'CA', 'Registered Retirement Income Fund',  'RRIF',        'PERSON',      'TAX_DEFERRED', FALSE, FALSE, TRUE),
    ('RESP',        'CA', 'Registered Education Savings Plan',  'RESP',        'PERSON',      'TAX_DEFERRED', FALSE, TRUE,  TRUE),
    ('LIRA',        'CA', 'Locked-In Retirement Account',       'LIRA',        'PERSON',      'TAX_DEFERRED', FALSE, FALSE, TRUE),
    ('CASH',        'CA', 'Non-Registered Cash Account',        'Cash',        'PERSON',      'TAXABLE',      FALSE, FALSE, TRUE),
    ('MARGIN',      'CA', 'Non-Registered Margin Account',      'Margin',      'PERSON',      'TAXABLE',      FALSE, FALSE, TRUE),
    ('CORP_CASH',   'CA', 'Corporate Cash Account',             'Corp Cash',   'CORPORATION', 'CORP_TAXABLE', FALSE, FALSE, TRUE),
    ('CORP_MARGIN', 'CA', 'Corporate Margin Account',           'Corp Margin', 'CORPORATION', 'CORP_TAXABLE', FALSE, FALSE, TRUE)
ON CONFLICT (code) DO UPDATE SET
    name                   = EXCLUDED.name,
    short_name             = EXCLUDED.short_name,
    applies_to             = EXCLUDED.applies_to,
    tax_category           = EXCLUDED.tax_category,
    has_contribution_limit = EXCLUDED.has_contribution_limit,
    has_lifetime_limit     = EXCLUDED.has_lifetime_limit,
    is_active              = EXCLUDED.is_active;

-- ============================================================
-- ACCOUNT TYPE LIMITS — Canada
-- CRA official limits — never changes once set
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

-- FHSA annual + lifetime limits (started 2023)
INSERT INTO account_type_limits (account_type_code, tax_year, annual_limit, lifetime_limit) VALUES
    ('FHSA', 2023, 8000.00, 40000.00),
    ('FHSA', 2024, 8000.00, 40000.00),
    ('FHSA', 2025, 8000.00, 40000.00)
ON CONFLICT (account_type_code, tax_year) DO NOTHING;

-- RESP lifetime limit only
INSERT INTO account_type_limits (account_type_code, tax_year, annual_limit, lifetime_limit) VALUES
    ('RESP', 2024, NULL, 50000.00),
    ('RESP', 2025, NULL, 50000.00)
ON CONFLICT (account_type_code, tax_year) DO NOTHING;