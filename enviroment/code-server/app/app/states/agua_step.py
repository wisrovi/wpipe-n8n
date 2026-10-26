"""User-defined custom step: AguaStep."""

from typing import Any
from loguru import logger
from dto.context import PipelineContextDTO
from wpipe import step, to_obj
from wpipe.timeout import timeout_sync
from wpipe.util import object_to_dict


@step(name="AguaStep", version="1.0.0", description="User custom pipeline step")
class AguaStep:
    """Custom user state implementation."""

    def __init__(self, **kwargs: Any) -> None:
        self.config = kwargs

    @timeout_sync(30)
    @to_obj(PipelineContextDTO)
    def __call__(self, context: Any) -> dict[str, Any]:
        raw_dict = object_to_dict(context)
        if raw_dict.get("error") == {}:
            raw_dict["error"] = None
        ctx = PipelineContextDTO(**raw_dict)
        logger.info(f"AguaStep executing for tx: {ctx.transaction_id}")
        ctx.status = "SUCCESS"
        ctx.metrics["agua_step"] = True
        return ctx.model_dump()
