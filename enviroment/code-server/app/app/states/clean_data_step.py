"""Data cleaning and sanitization step class.

Conforms to WPipe class-based state specifications with @step, @timeout_sync, and @to_obj.
"""

from typing import Any

from loguru import logger
from wpipe import step, to_obj  # type: ignore[import-untyped]
from wpipe.timeout import timeout_sync  # type: ignore[import-untyped]
from wpipe.util import object_to_dict  # type: ignore[import-untyped]

from dto.context import PipelineContextDTO
from states.base import BaseStep


@step(
    name="CleanDataStep",
    version="1.0.0",
    description="Sanitizes and normalizes input data into processed context.",
)
class CleanDataStep(BaseStep):
    """WPipe State class that cleans and normalizes context fields.

    Attributes:
        prefix (str): Normalization prefix added to keys.
    """

    def __init__(self, prefix: str = "clean_") -> None:
        """Initialize CleanDataStep.

        Args:
            prefix (str): Key prefix for cleaned items.
        """
        self.prefix: str = prefix

    @timeout_sync(30)
    @to_obj(PipelineContextDTO)
    def __call__(self, context: Any) -> dict[str, Any]:
        """Execute data cleaning and normalization.

        Args:
            context (Any): Raw or transformed pipeline context.

        Returns:
            dict[str, Any]: Mutated and validated context dictionary.
        """
        raw_dict = object_to_dict(context)
        if raw_dict.get("error") == {}:
            raw_dict["error"] = None
        ctx_dto = PipelineContextDTO(**raw_dict)
        logger.info(f"CleanDataStep executing for tx: {ctx_dto.transaction_id}")

        cleaned: dict[str, Any] = {}
        for key, val in ctx_dto.input_data.items():
            cleaned[f"{self.prefix}{key.strip().lower()}"] = val

        ctx_dto.processed_data.update(cleaned)
        ctx_dto.status = "CLEANED"
        ctx_dto.metrics["cleaned_items"] = len(cleaned)
        return ctx_dto.model_dump()
