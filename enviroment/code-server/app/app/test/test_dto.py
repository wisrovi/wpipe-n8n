"""Unit tests for Pydantic Data Transfer Objects."""

import pytest
from pydantic import ValidationError

from dto.context import PipelineContextDTO
from dto.request import PipelineRequestDTO
from dto.response import PipelineResponseDTO


def test_context_validation() -> None:
    """Verify PipelineContextDTO instantiates with valid required attributes."""
    ctx = PipelineContextDTO(transaction_id="tx_123", input_data={"key": "value"})
    assert ctx.transaction_id == "tx_123"
    assert ctx.status == "PENDING"
    assert ctx.input_data["key"] == "value"
    assert ctx.processed_data == {}


def test_context_missing_transaction_id() -> None:
    """Verify ValidationError is raised when mandatory transaction_id is missing."""
    with pytest.raises(ValidationError):
        PipelineContextDTO(input_data={"key": "value"})  # type: ignore[call-arg]


def test_request_response_dtos() -> None:
    """Verify request and response DTO instantiations and field access."""
    req = PipelineRequestDTO(payload={"test": 1})
    assert req.payload["test"] == 1

    resp = PipelineResponseDTO(
        status="success", transaction_id="tx_999", data={"done": True}
    )
    assert resp.status == "success"
    assert resp.transaction_id == "tx_999"
