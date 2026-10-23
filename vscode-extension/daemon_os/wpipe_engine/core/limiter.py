"""WPipe Engine - Freemium Quota & Feature Limiter

Server-side enforcement point for Free vs Pro restrictions. Every engine endpoint that
produces value (code generation, real simulation, project persistence) must call
``enforce_entitlements`` before doing any work.

Design rules:
- Node classification is shared with the compiler (``classify_node`` / ``is_ai_step``), so
  the limiter judges exactly what the compiler would emit. A client cannot label a node one
  way for the limiter and have the compiler render it another way.
- Block counting is done on the flat IR node list the compiler consumes, which already
  includes nested children (linked through ``parent_id``).
- Entitlements are read from the verified license status only, never from request bodies.

Author: William Rodriguez (wisrovi.dev)
"""

from __future__ import annotations

from typing import Any

from wpipe_engine.core.entitlements import FREE_ENTITLEMENTS, UNLIMITED_ENTITLEMENTS

MAX_FREE_BLOCKS = int(FREE_ENTITLEMENTS["max_blocks"])

# Hard ceiling to protect the engine against resource exhaustion, even for Pro plans.
MAX_IR_NODES_HARD_LIMIT = 2000

PROHIBITED_FREE_BLOCK_TYPES = {
    "parallel": "Concurrent Parallel Execution (Parallel)",
    "background": "Background Tasks (Background)",
    "ai": "Artificial Intelligence Steps (AI Step)",
}

_KIND_TO_ENTITLEMENT = {
    "parallel": "parallel_blocks",
    "background": "background_blocks",
    "ai": "ai_steps",
}

UPGRADE_URL = "https://wisrovi.dev"


def raw_node_type(node: dict[str, Any]) -> str:
    """Return the lowercase raw node type exactly as the compiler resolves it."""
    data = node.get("data") or {}
    raw = data.get("node_type") or node.get("type") or "step"
    return str(raw).lower()


def classify_node(node: dict[str, Any]) -> str:
    """Classify an IR node into the structural kind the compiler renders.

    Returns one of: ``condition``, ``for``, ``while``, ``parallel``, ``background``, ``step``.
    The evaluation order mirrors the compiler so both always agree.
    """
    ntype = raw_node_type(node)
    if ntype in ("condition", "wpipe_if", "wpipe_if_else") or "if" in ntype or "condition" in ntype:
        return "condition"
    if ntype in ("for", "wpipe_for") or "for" in ntype:
        return "for"
    if ntype in ("while", "wpipe_while") or "while" in ntype:
        return "while"
    if ntype in ("parallel", "wpipe_parallel") or "parallel" in ntype:
        return "parallel"
    if ntype in ("background", "wpipe_background") or "background" in ntype:
        return "background"
    return "step"


def is_io_node(node: dict[str, Any]) -> bool:
    """True for pipeline trigger / response nodes (not rendered as execution steps)."""
    return raw_node_type(node) in ("trigger", "response", "wpipe_trigger", "wpipe_response")


def is_ai_step(node: dict[str, Any]) -> bool:
    """True when the compiler would emit an AI step for this node.

    A node is an AI step if it is a plain step (not a control block or trigger/response) and
    any of these holds: it comes from the AI block, it is an AI-described step, or its
    function name targets the AI sentiment state.
    """
    if is_io_node(node) or classify_node(node) != "step":
        return False
    data = node.get("data") or {}
    namespace = str(data.get("namespace") or "")
    if namespace.startswith("wpipe_steps"):
        return False
    if str(data.get("block_type") or node.get("block_type") or "").lower() == "wpipe_ai_step":
        return True
    if str(data.get("origin") or "").lower() == "described":
        return True
    fn = str(data.get("step_name") or data.get("func_name") or data.get("label") or "")
    return fn == "AISentimentStep" or "sentiment" in fn.lower()


def node_feature_kind(node: dict[str, Any]) -> str | None:
    """Return the Pro feature family used by a node (``parallel``/``background``/``ai``) or None."""
    kind = classify_node(node)
    if kind in ("parallel", "background"):
        return kind
    if is_ai_step(node):
        return "ai"
    return None


def validate_canvas_ir(canvas_ir: Any) -> tuple[bool, str]:
    """Structural validation so malformed payloads cannot confuse counting or compilation."""
    if not isinstance(canvas_ir, dict):
        return False, "canvas_ir must be a JSON object."
    nodes = canvas_ir.get("nodes", [])
    if not isinstance(nodes, list):
        return False, "canvas_ir.nodes must be a JSON array."
    if len(nodes) > MAX_IR_NODES_HARD_LIMIT:
        return False, f"canvas_ir exceeds the hard limit of {MAX_IR_NODES_HARD_LIMIT} nodes."
    for node in nodes:
        if not isinstance(node, dict):
            return False, "Every canvas_ir node must be a JSON object."
        if "data" in node and not isinstance(node["data"], dict):
            return False, "canvas_ir node 'data' must be a JSON object."
    return True, ""


def _license_entitlements(license_status: dict[str, Any]) -> dict[str, Any]:
    """Extract effective entitlements from a verified license status dictionary."""
    ent = license_status.get("entitlements")
    if isinstance(ent, dict):
        return ent
    # Backwards compatibility: legacy statuses only expose ``is_pro``.
    return dict(UNLIMITED_ENTITLEMENTS) if license_status.get("is_pro") else dict(FREE_ENTITLEMENTS)


def check_compilation_limits(
    canvas_ir: dict[str, Any], license_status: dict[str, Any]
) -> tuple[bool, str, dict[str, Any]]:
    """Validate whether the given canvas pipeline is permitted under the active license tier.

    Returns: (is_allowed, user_message, error_details).
    """
    valid, reason = validate_canvas_ir(canvas_ir)
    if not valid:
        return False, reason, {"code": "INVALID_CANVAS_IR", "reason": reason}

    ent = _license_entitlements(license_status)
    nodes: list[dict[str, Any]] = canvas_ir.get("nodes", [])
    total_blocks = len(nodes)
    max_blocks = ent.get("max_blocks")

    # 1. Block count limit (counts every node, including nested children).
    if max_blocks is not None and total_blocks > max_blocks:
        msg = (
            f"Your plan allows up to {max_blocks} blocks per pipeline "
            f"(the current pipeline has {total_blocks} blocks). "
            f"Upgrade to WPipe Pro at wisrovi.dev for unlimited pipelines."
        )
        return False, msg, {
            "code": "LIMIT_BLOCK_COUNT_EXCEEDED",
            "current_blocks": total_blocks,
            "max_allowed": max_blocks,
            "upgrade_url": UPGRADE_URL,
        }

    # 2. Pro-exclusive block families.
    for node in nodes:
        kind = node_feature_kind(node)
        if kind is None:
            continue
        if not ent.get(_KIND_TO_ENTITLEMENT[kind], False):
            feature_name = PROHIBITED_FREE_BLOCK_TYPES[kind]
            msg = (
                f"The '{feature_name}' block is exclusive to WPipe Pro. "
                f"Upgrade your license at wisrovi.dev to unlock concurrency, "
                f"background workers and AI integration."
            )
            return False, msg, {
                "code": "PRO_FEATURE_REQUIRED",
                "prohibited_block": raw_node_type(node) if kind != "ai" else "wpipe_ai_step",
                "feature": kind,
                "feature_name": feature_name,
                "upgrade_url": UPGRADE_URL,
            }

    limit_label = "unlimited" if max_blocks is None else str(max_blocks)
    return True, f"Pipeline allowed for current plan ({total_blocks}/{limit_label} blocks).", {}


def enforce_entitlements(
    canvas_ir: Any, license_status: dict[str, Any], action: str = "compile"
) -> tuple[bool, int, dict[str, Any]]:
    """Single gate used by every value-producing endpoint.

    Args:
        canvas_ir: IR payload that the handler is about to compile / simulate / persist.
        license_status: Output of ``LicenseManager.get_status()`` (verified server-side).
        action: ``compile``, ``transform``, ``simulate``, ``save_project``, ``duplicate``.

    Returns:
        (allowed, http_status, error_body). ``error_body`` is empty when allowed.
    """
    ent = _license_entitlements(license_status)

    if action == "simulate" and not ent.get("real_simulation", False):
        return False, 403, {
            "error": "LIMIT_EXCEEDED",
            "message": "Real simulation is not included in your plan.",
            "details": {"code": "REAL_SIMULATION_NOT_ALLOWED", "upgrade_url": UPGRADE_URL},
            "is_pro": False,
        }

    allowed, msg, details = check_compilation_limits(canvas_ir, license_status)
    if allowed:
        return True, 200, {}

    status = 400 if details.get("code") == "INVALID_CANVAS_IR" else 403
    return False, status, {
        "error": "INVALID_CANVAS_IR" if status == 400 else "LIMIT_EXCEEDED",
        "message": msg,
        "details": details,
        "is_pro": bool(license_status.get("is_pro", False)),
        "action": action,
    }
