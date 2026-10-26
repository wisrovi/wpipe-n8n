"""Shared pipeline context Data Transfer Object.

Guarantees strict typing and context immutability validation across WPipe states.
"""

from typing import Any, Union

from pydantic import BaseModel, Field


class PipelineContextDTO(BaseModel):
    """Data Transfer Object defining the shared context for the WPipe pipeline."""
    model_config = {"extra": "allow"}

    transaction_id: str = Field(..., description="Unique transaction trace identifier")
    input_data: dict[str, Any] = Field(
        default_factory=dict, description="Raw input data payload"
    )
    processed_data: dict[str, Any] = Field(
        default_factory=dict, description="Transformed and cleaned data"
    )
    status: str = Field(default="PENDING", description="Pipeline execution state")
    metrics: dict[str, Any] = Field(
        default_factory=dict, description="Execution and performance metrics"
    )
    error: Union[str, dict[str, Any], None] = Field(
        default=None, description="Error detail if execution fails"
    )
