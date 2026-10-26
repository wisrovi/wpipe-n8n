"""AI natural language sentiment analysis step class."""

from typing import Any

from loguru import logger
from wpipe import step, to_obj  # type: ignore[import-untyped]
from wpipe.timeout import timeout_sync  # type: ignore[import-untyped]
from wpipe.util import object_to_dict  # type: ignore[import-untyped]

from dto.context import PipelineContextDTO
from states.base import BaseStep


@step(
    name="AISentimentStep",
    version="1.0.0",
    description="Analyzes text content and scores sentiment.",
)
class AISentimentStep(BaseStep):
    """WPipe State class that executes AI sentiment analysis.

    Attributes:
        threshold (float): Confidence threshold for classification.
    """

    def __init__(self, threshold: float = 0.5) -> None:
        """Initialize AISentimentStep.

        Args:
            threshold (float): Classification threshold between 0.0 and 1.0.
        """
        self.threshold: float = threshold

    @timeout_sync(45)
    @to_obj(PipelineContextDTO)
    def __call__(self, context: Any) -> dict[str, Any]:
        """Execute sentiment analysis heuristics.

        Args:
            context (Any): Raw or transformed pipeline context.

        Returns:
            dict[str, Any]: Context enriched with sentiment scores.
        """
        raw_dict = object_to_dict(context)
        if raw_dict.get("error") == {}:
            raw_dict["error"] = None
        ctx_dto = PipelineContextDTO(**raw_dict)
        logger.info(f"AISentimentStep scoring sentiment for tx: {ctx_dto.transaction_id}")

        text = str(ctx_dto.input_data.get("text", "")).lower()
        positive_keywords = ("good", "great", "excellent", "super", "awesome", "fast")
        score = 0.85 if any(kw in text for kw in positive_keywords) else 0.42

        ctx_dto.processed_data["sentiment_score"] = score
        ctx_dto.processed_data["sentiment_label"] = (
            "POSITIVE" if score >= self.threshold else "NEUTRAL"
        )
        ctx_dto.metrics["ai_confidence"] = score
        ctx_dto.status = "SCORED"
        return ctx_dto.model_dump()
