"""Payload transformation step class.

Delegates heavy business logic to decoupled ProcessingService.
"""

from typing import Any

from loguru import logger
from wpipe import step, to_obj  # type: ignore[import-untyped]
from wpipe.timeout import timeout_sync  # type: ignore[import-untyped]
from wpipe.util import object_to_dict  # type: ignore[import-untyped]

from dto.context import PipelineContextDTO
from services.business_service import ProcessingService
from states.base import BaseStep


@step(
    name="TransformPayloadStep",
    version="1.0.0",
    description="Transforms payload by delegating to ProcessingService.",
)
class TransformPayloadStep(BaseStep):
    """WPipe State class that delegates to decoupled business services.

    Attributes:
        service (ProcessingService): Injected domain business service.
    """

    def __init__(self, mode: str = "standard") -> None:
        """Initialize TransformPayloadStep.

        Args:
            mode (str): Operational mode string.
        """
        self.service: ProcessingService = ProcessingService(mode=mode)

    @timeout_sync(60)
    @to_obj(PipelineContextDTO)
    def __call__(self, context: Any) -> dict[str, Any]:
        """Execute payload transformation through domain service.

        Args:
            context (Any): Raw or transformed pipeline context.

        Returns:
            dict[str, Any]: Transformed context dictionary.
        """
        raw_dict = object_to_dict(context)
        if raw_dict.get("error") == {}:
            raw_dict["error"] = None
        ctx_dto = PipelineContextDTO(**raw_dict)
        logger.info(f"TransformPayloadStep transforming context for tx: {ctx_dto.transaction_id}")

        transformed = self.service.process_payload(ctx_dto.processed_data)
        ctx_dto.processed_data.update(transformed)
        ctx_dto.status = "TRANSFORMED"
        ctx_dto.metrics["transformed"] = True
        return ctx_dto.model_dump()
