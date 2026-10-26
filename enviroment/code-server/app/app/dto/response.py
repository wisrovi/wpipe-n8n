"""API response Data Transfer Object."""

from typing import Any

from pydantic import BaseModel, Field


class PipelineResponseDTO(BaseModel):
    """Standard REST API response returned by the microservice.

    Attributes:
        status (str): Outcome status of the request.
        transaction_id (str): Transaction identifier associated with the run.
        data (dict[str, Any]): Resulting output payload.
        metrics (dict[str, Any]): Execution and timing metrics.
        error (str | None): Error message if execution encountered a failure.
    """

    status: str = Field(default="success", description="Outcome status")
    transaction_id: str = Field(..., description="Transaction identifier")
    data: dict[str, Any] = Field(default_factory=dict, description="Resulting output payload")
    metrics: dict[str, Any] = Field(default_factory=dict, description="Execution metrics")
    error: str | None = Field(default=None, description="Error message if any")
