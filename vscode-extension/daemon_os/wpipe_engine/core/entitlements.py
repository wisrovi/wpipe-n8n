"""WPipe Engine - Plan Entitlements Resolver

Single source of truth inside the engine for what each license plan is allowed to do.

Security model:
- Entitlements are ONLY derived from an Ed25519 lease token whose signature has been
  verified (see ``licensing.verify_lease_token``). The optional ``ent`` claim inside that
  signed token is issued by the Cloudflare Worker from the ``plan_entitlements`` table in D1.
- Values sent by HTTP clients (e.g. ``"is_pro": true`` in a request body) are never read.
- Without a valid token the hardcoded Free defaults below apply. They live inside the
  compiled engine binary, not in any user-editable file.

Author: William Rodriguez (wisrovi.dev)
"""

from __future__ import annotations

from typing import Any

# Hardcoded Free tier: applied whenever no verified lease token is available.
FREE_ENTITLEMENTS: dict[str, Any] = {
    "max_blocks": 5,
    "parallel_blocks": False,
    "background_blocks": False,
    "ai_steps": False,
    "real_simulation": True,
    "zip_export": True,
    "max_projects": None,
}

# Paid tiers: unlimited by default (can be narrowed by the signed ``ent`` claim).
UNLIMITED_ENTITLEMENTS: dict[str, Any] = {
    "max_blocks": None,
    "parallel_blocks": True,
    "background_blocks": True,
    "ai_steps": True,
    "real_simulation": True,
    "zip_export": True,
    "max_projects": None,
}

PLAN_DEFAULTS: dict[str, dict[str, Any]] = {
    "free": FREE_ENTITLEMENTS,
    "pro": UNLIMITED_ENTITLEMENTS,
    "team": UNLIMITED_ENTITLEMENTS,
    "enterprise": UNLIMITED_ENTITLEMENTS,
    "vip": UNLIMITED_ENTITLEMENTS,
    "partner": UNLIMITED_ENTITLEMENTS,
}

_BOOL_KEYS = ("parallel_blocks", "background_blocks", "ai_steps", "real_simulation", "zip_export")
_LIMIT_KEYS = ("max_blocks", "max_projects")


def _sanitize_limit(value: Any) -> tuple[bool, int | None]:
    """Return (is_valid, limit). ``None`` means unlimited; negative/invalid values are rejected."""
    if value is None:
        return True, None
    if isinstance(value, bool):
        return False, None
    if isinstance(value, int) and value >= 0:
        return True, value
    return False, None


def resolve_entitlements(plan: str | None, ent_claim: Any = None) -> dict[str, Any]:
    """Build the effective entitlements for a *verified* plan and optional signed ``ent`` claim.

    Unknown plans fall back to Free. Malformed claim values are ignored (the plan default wins).
    """
    plan_key = (plan or "free").strip().lower() if isinstance(plan, str) else "free"
    resolved = dict(PLAN_DEFAULTS.get(plan_key, FREE_ENTITLEMENTS))

    if isinstance(ent_claim, dict):
        for key in _BOOL_KEYS:
            if key in ent_claim and isinstance(ent_claim[key], bool):
                resolved[key] = ent_claim[key]
        for key in _LIMIT_KEYS:
            if key in ent_claim:
                ok, limit = _sanitize_limit(ent_claim[key])
                if ok:
                    resolved[key] = limit
    return resolved


def is_unlimited(entitlements: dict[str, Any]) -> bool:
    """True when the plan has no block limit and all Pro block families enabled."""
    return (
        entitlements.get("max_blocks") is None
        and bool(entitlements.get("parallel_blocks"))
        and bool(entitlements.get("background_blocks"))
        and bool(entitlements.get("ai_steps"))
    )


def to_legacy_features(entitlements: dict[str, Any]) -> dict[str, bool]:
    """Map entitlements to the legacy ``features`` dictionary consumed by older clients."""
    return {
        "unlimited_blocks": entitlements.get("max_blocks") is None,
        "parallel_blocks": bool(entitlements.get("parallel_blocks")),
        "background_tasks": bool(entitlements.get("background_blocks")),
        "ai_steps": bool(entitlements.get("ai_steps")),
        "live_debugging": bool(entitlements.get("real_simulation")),
    }
