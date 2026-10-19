"""WPipe Engine - Freemium Quota & Feature Limiter
Enforces maximum 5 blocks and feature restrictions on Free tier while unlocking Pro features.
Author: William Rodriguez (wisrovi.dev)
"""

from typing import Any

MAX_FREE_BLOCKS = 5

PROHIBITED_FREE_BLOCK_TYPES = {
    "wpipe_parallel": "Ejecución Paralela Concurrente (Parallel)",
    "wpipe_background": "Tareas en Segundo Plano (Background)",
    "wpipe_ai_step": "Pasos con Inteligencia Artificial (AI Step)",
}


def check_compilation_limits(
    canvas_ir: dict[str, Any], license_status: dict[str, Any]
) -> tuple[bool, str, dict[str, Any]]:
    """Validate whether the given canvas pipeline is permitted under the active license tier.

    Returns: (is_allowed, user_message, error_details).
    """
    is_pro = bool(license_status.get("is_pro", False))
    if is_pro:
        return True, "Plan Pro activo: compilación ilimitada permitida.", {}

    nodes = canvas_ir.get("nodes", [])
    total_blocks = len(nodes)

    # 1. Check Max Block Count on Free Tier
    if total_blocks > MAX_FREE_BLOCKS:
        msg = (
            f"Has alcanzado el límite de {MAX_FREE_BLOCKS} bloques del plan Free "
            f"(tu pipeline actual contiene {total_blocks} bloques). "
            f"Para diseñar pipelines de complejidad ilimitada, actualiza a WPipe Pro en wisrovi.dev."
        )
        details = {
            "code": "LIMIT_BLOCK_COUNT_EXCEEDED",
            "current_blocks": total_blocks,
            "max_allowed": MAX_FREE_BLOCKS,
            "upgrade_url": "https://wisrovi.dev",
        }
        return False, msg, details

    # 2. Check Pro-Exclusive Block Types
    for node in nodes:
        data = node.get("data", {})
        node_type = data.get("node_type") or node.get("type", "")
        if node_type in PROHIBITED_FREE_BLOCK_TYPES:
            feature_name = PROHIBITED_FREE_BLOCK_TYPES[node_type]
            msg = (
                f"El bloque '{feature_name}' es exclusivo de la versión WPipe Pro. "
                f"Actualiza tu licencia en wisrovi.dev para desbloquear concurrencia, "
                f"background workers e integración con IA."
            )
            details = {
                "code": "PRO_FEATURE_REQUIRED",
                "prohibited_block": node_type,
                "feature_name": feature_name,
                "upgrade_url": "https://wisrovi.dev",
            }
            return False, msg, details

    return True, f"Pipeline válido para plan Free ({total_blocks}/{MAX_FREE_BLOCKS} bloques).", {}
