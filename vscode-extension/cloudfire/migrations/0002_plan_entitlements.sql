-- ============================================================================
-- Migration 0002: Plan Entitlements (database-driven Free / Pro limits)
-- Non-destructive: safe to run against the production D1 database.
--
-- The Cloudflare Worker reads this table when issuing a lease token and embeds the
-- row as the signed `ent` claim. wpipe-engine enforces these limits after verifying
-- the Ed25519 signature, so changing a plan only requires updating a row here.
--
-- Apply:
--   wrangler d1 execute wpipe_licenses --remote --file=migrations/0002_plan_entitlements.sql
-- Author: William Rodriguez (wisrovi.dev)
-- ============================================================================

CREATE TABLE IF NOT EXISTS plan_entitlements (
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

INSERT OR IGNORE INTO plan_entitlements
    (plan, max_blocks, parallel_blocks, background_blocks, ai_steps, real_simulation, zip_export, max_projects)
VALUES
    ('free',       5,    0, 0, 0, 1, 1, NULL),
    ('pro',        NULL, 1, 1, 1, 1, 1, NULL),
    ('team',       NULL, 1, 1, 1, 1, 1, NULL),
    ('enterprise', NULL, 1, 1, 1, 1, 1, NULL),
    ('vip',        NULL, 1, 1, 1, 1, 1, NULL);
