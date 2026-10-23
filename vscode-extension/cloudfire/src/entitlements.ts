/**
 * Plan Entitlements Loader
 *
 * Reads the `plan_entitlements` table in Cloudflare D1 and converts a row into the
 * compact `ent` claim embedded (and signed) in every lease token. wpipe-engine trusts
 * these limits only after verifying the Ed25519 signature, so a browser or local user
 * cannot alter them.
 *
 * If the table or row is missing (e.g. migration not yet applied), hardcoded defaults
 * are used so token issuance never breaks.
 *
 * Author: William Rodriguez (wisrovi.dev)
 */

export interface Entitlements {
  max_blocks: number | null;
  parallel_blocks: boolean;
  background_blocks: boolean;
  ai_steps: boolean;
  real_simulation: boolean;
  zip_export: boolean;
  max_projects: number | null;
}

const UNLIMITED: Entitlements = {
  max_blocks: null,
  parallel_blocks: true,
  background_blocks: true,
  ai_steps: true,
  real_simulation: true,
  zip_export: true,
  max_projects: null,
};

export const DEFAULT_ENTITLEMENTS: Record<string, Entitlements> = {
  free: {
    max_blocks: 5,
    parallel_blocks: false,
    background_blocks: false,
    ai_steps: false,
    real_simulation: true,
    zip_export: true,
    max_projects: null,
  },
  pro: UNLIMITED,
  team: UNLIMITED,
  enterprise: UNLIMITED,
  vip: UNLIMITED,
};

interface EntitlementRow {
  max_blocks: number | null;
  parallel_blocks: number;
  background_blocks: number;
  ai_steps: number;
  real_simulation: number;
  zip_export: number;
  max_projects: number | null;
}

function toLimit(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

/**
 * Resolve the entitlements for a plan from D1, falling back to safe defaults.
 */
export async function loadEntitlements(db: D1Database, plan: string): Promise<Entitlements> {
  const planKey = (plan || "free").toLowerCase();
  const fallback = DEFAULT_ENTITLEMENTS[planKey] || DEFAULT_ENTITLEMENTS.free;
  try {
    const row = await db
      .prepare(
        "SELECT max_blocks, parallel_blocks, background_blocks, ai_steps, real_simulation, zip_export, max_projects FROM plan_entitlements WHERE plan = ?"
      )
      .bind(planKey)
      .first<EntitlementRow>();
    if (!row) return fallback;
    return {
      max_blocks: toLimit(row.max_blocks),
      parallel_blocks: Boolean(row.parallel_blocks),
      background_blocks: Boolean(row.background_blocks),
      ai_steps: Boolean(row.ai_steps),
      real_simulation: Boolean(row.real_simulation),
      zip_export: Boolean(row.zip_export),
      max_projects: toLimit(row.max_projects),
    };
  } catch {
    // Table not migrated yet: keep issuing tokens with the hardcoded defaults.
    return fallback;
  }
}
