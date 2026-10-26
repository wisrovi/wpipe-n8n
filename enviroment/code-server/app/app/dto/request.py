"""API request Data Transfer Object."""

from typing import Any

from pydantic import BaseModel, Field


class PipelineRequestDTO(BaseModel):
    """REST API request schema for triggering pipeline execution.

    Attributes:
        transaction_id (str | None): Optional custom transaction ID.
        payload (dict[str, Any]): Input parameters and data.
    """

    transaction_id: str | None = Field(default=None, description="Optional custom transaction ID")
    payload: dict[str, Any] = Field(default_factory=dict, description="Input parameters and data")
