"""Decoupled core business and processing services.

Part of the WPipe microservice architecture (wisrovi SUITE).
"""

from typing import Any

from loguru import logger


class ProcessingService:
    """Business service encapsulating domain operations outside pipeline graph.

    Attributes:
        mode (str): Processing strategy mode identifier.
    """

    def __init__(self, mode: str = "standard") -> None:
        """Initialize the processing service.

        Args:
            mode (str): Operational mode (default: 'standard').
        """
        self.mode: str = mode
        logger.debug(f"ProcessingService initialized in mode: {mode}")

    def process_payload(self, raw_data: dict[str, Any]) -> dict[str, Any]:
        """Execute domain business logic and transformation on raw data.

        Args:
            raw_data (dict[str, Any]): Unprocessed input dictionary.

        Returns:
            dict[str, Any]: Transformed and enriched domain dictionary.
        """
        logger.info(f"ProcessingService executing domain payload transform (mode: {self.mode})")
        transformed: dict[str, Any] = {
            "processed_by": "ProcessingService",
            "mode": self.mode,
            "items_count": len(raw_data),
        }
        for key, value in raw_data.items():
            transformed[f"proc_{key}"] = value
        return transformed
