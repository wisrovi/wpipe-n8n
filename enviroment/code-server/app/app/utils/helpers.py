"""Pure helper functions for metrics sanitation and ID generation."""

import time
from typing import Any
import uuid


def generate_transaction_id(prefix: str = "tx_") -> str:
    """Generate a unique transaction identifier.

    Args:
        prefix (str): Prefix string for the transaction ID.

    Returns:
        str: Unique transaction trace ID string.
    """
    timestamp = int(time.time() * 1000)
    unique_suffix = uuid.uuid4().hex[:8]
    return f"{prefix}{timestamp}_{unique_suffix}"


def sanitize_metrics(metrics: dict[str, Any]) -> dict[str, Any]:
    """Sanitize performance metrics dictionary.

    Args:
        metrics (dict[str, Any]): Raw metrics dictionary.

    Returns:
        dict[str, Any]: Sanitized dictionary containing numeric values.
    """
    sanitized: dict[str, Any] = {}
    for key, value in metrics.items():
        if isinstance(value, (int, float, bool, str)):
            sanitized[str(key)] = value
    return sanitized
