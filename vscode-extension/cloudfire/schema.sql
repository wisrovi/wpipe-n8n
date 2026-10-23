-- ============================================================================
-- WPipe Studio Cloudflare D1 Database Schema
-- Serverless Licensing, Machine Activations & Audit Logs
-- Author: William Rodriguez (wisrovi.dev)
-- ============================================================================

DROP TABLE IF EXISTS plan_entitlements;
DROP TABLE IF EXISTS otp_codes;
DROP TABLE IF EXISTS audit_logs;
DROP TABLE IF EXISTS leases;
DROP TABLE IF EXISTS activations;
DROP TABLE IF EXISTS licenses;

-- 1. Licenses Table (Contracts / Entitlements)
CREATE TABLE licenses (
    id TEXT PRIMARY KEY,
    license_key TEXT UNIQUE NOT NULL,           -- Terminal seat key for VS Code
    admin_key TEXT,                             -- Private enterprise management key for portal
    customer_email TEXT NOT NULL,
    customer_name TEXT,
    plan TEXT NOT NULL DEFAULT 'pro',           -- 'free', 'pro', 'team', 'enterprise'
    status TEXT NOT NULL DEFAULT 'active',      -- 'active', 'expired', 'suspended', 'revoked'
    max_machines INTEGER NOT NULL DEFAULT 2,    -- Legacy backward compatibility
    max_seats INTEGER NOT NULL DEFAULT 1,       -- Allowed concurrent floating seats
    expires_at TEXT,                            -- ISO-8601 timestamp (NULL = lifetime)
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX idx_licenses_key ON licenses(license_key);
CREATE INDEX idx_licenses_admin_key ON licenses(admin_key);
CREATE INDEX idx_licenses_email ON licenses(customer_email);
CREATE INDEX idx_licenses_status ON licenses(status);

-- 2. Machine Activations Table (Legacy persistent activations)
CREATE TABLE activations (
    id TEXT PRIMARY KEY,
    license_id TEXT NOT NULL REFERENCES licenses(id) ON DELETE CASCADE,
    machine_fingerprint TEXT NOT NULL,          -- SHA-256 hash of hardware IDs
    hostname TEXT,
    os_name TEXT,
    last_verified_at TEXT NOT NULL,             -- ISO-8601 timestamp
    lease_expires_at TEXT NOT NULL,             -- ISO-8601 timestamp (e.g. +30 days)
    created_at TEXT NOT NULL,
    UNIQUE(license_id, machine_fingerprint)
);

CREATE INDEX idx_activations_license ON activations(license_id);
CREATE INDEX idx_activations_fingerprint ON activations(machine_fingerprint);

-- 3. Dynamic Floating Leases Table (Concurrent seat management)
CREATE TABLE leases (
    id TEXT PRIMARY KEY,
    license_id TEXT NOT NULL REFERENCES licenses(id) ON DELETE CASCADE,
    machine_fingerprint TEXT NOT NULL,          -- Neutral SHA-256 (Motherboard+CPU+MAC)
    hostname TEXT,                              -- Display name for customer portal
    os_name TEXT,                               -- Operating system
    last_heartbeat_at TEXT NOT NULL,            -- ISO-8601 timestamp
    lease_expires_at TEXT NOT NULL,             -- ISO-8601 timestamp (+2 hours TTL)
    created_at TEXT NOT NULL,
    UNIQUE(license_id, machine_fingerprint)
);

CREATE INDEX idx_leases_lookup ON leases(license_id, machine_fingerprint);
CREATE INDEX idx_leases_expiration ON leases(lease_expires_at);

-- 4. Audit Logs Table (Security, Webhooks, Verification History)
CREATE TABLE audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_type TEXT NOT NULL,                   -- 'lease_acquired', 'heartbeat', 'seat_released', 'quota_exceeded', 'activate', 'verify'
    license_key TEXT,
    machine_fingerprint TEXT,
    ip_address TEXT,
    details_json TEXT,
    created_at TEXT NOT NULL
);

CREATE INDEX idx_audit_event ON audit_logs(event_type);
CREATE INDEX idx_audit_license ON audit_logs(license_key);

-- 5. One-Time Passwords Table (Passwordless corporate email authentication)
CREATE TABLE otp_codes (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    code_hash TEXT NOT NULL,         -- SHA-256 of 6-digit verification code
    attempts INTEGER NOT NULL DEFAULT 0,
    expires_at TEXT NOT NULL,        -- +10 minutes
    used INTEGER NOT NULL DEFAULT 0, -- 1 if consumed
    created_at TEXT NOT NULL
);

CREATE INDEX idx_otp_email ON otp_codes(email);
CREATE INDEX idx_otp_expires ON otp_codes(expires_at);

-- 6. Plan Entitlements (database-driven Free / Pro limits, embedded as signed `ent` claim)
CREATE TABLE plan_entitlements (
    plan TEXT PRIMARY KEY,                       -- 'free', 'pro', 'team', 'enterprise', 'vip'
    max_blocks INTEGER,                          -- NULL = unlimited
    parallel_blocks INTEGER NOT NULL DEFAULT 0,  -- 1 = allowed
    background_blocks INTEGER NOT NULL DEFAULT 0,
    ai_steps INTEGER NOT NULL DEFAULT 0,
    real_simulation INTEGER NOT NULL DEFAULT 1,
    zip_export INTEGER NOT NULL DEFAULT 1,
    max_projects INTEGER,                        -- NULL = unlimited
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO plan_entitlements
    (plan, max_blocks, parallel_blocks, background_blocks, ai_steps, real_simulation, zip_export, max_projects)
VALUES
    ('free',       5,    0, 0, 0, 1, 1, NULL),
    ('pro',        NULL, 1, 1, 1, 1, 1, NULL),
    ('team',       NULL, 1, 1, 1, 1, 1, NULL),
    ('enterprise', NULL, 1, 1, 1, 1, 1, NULL),
    ('vip',        NULL, 1, 1, 1, 1, 1, NULL);

-- ============================================================================
-- Initial Demo / Testing Seed Data
-- ============================================================================
INSERT INTO licenses (
    id,
    license_key,
    admin_key,
    customer_email,
    customer_name,
    plan,
    status,
    max_machines,
    max_seats,
    expires_at,
    created_at,
    updated_at
) VALUES (
    'lic_demo_william_2026',
    'WPIPE-PRO-DEMO-TEST-KEY-2026',
    'WPIPE-ADM-84AB97A8FF7C',
    'wisrovi@wisrovi.dev',
    'William Rodriguez',
    'pro',
    'active',
    5,
    5,
    '2030-01-01T00:00:00Z',
    datetime('now'),
    datetime('now')
);
