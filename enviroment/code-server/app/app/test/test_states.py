"""Unit tests for WPipe Step classes."""

import pytest
from states.base import BaseStep
from states.pan_step import PanStep
from states.queso_step import QuesoStep
from states.agua_step import AguaStep
from states.ai_process_step import AiProcessStep
from dto.context import PipelineContextDTO


def test_base_step_interface() -> None:
    """Verify BaseStep requires __call__ implementation."""
    class DummyStep(BaseStep):
        pass

    with pytest.raises(TypeError):
        DummyStep()  # type: ignore[abstract]


def test_pan_step_execution() -> None:
    """Verify PanStep runs and returns success."""
    step = PanStep()
    ctx = PipelineContextDTO(transaction_id="tx_pan", input_data={"item": "bread"})
    res = step(ctx.model_dump())
    assert res["status"] == "SUCCESS"


def test_queso_step_execution() -> None:
    """Verify QuesoStep runs and returns success."""
    step = QuesoStep()
    ctx = PipelineContextDTO(transaction_id="tx_queso", input_data={"item": "cheese"})
    res = step(ctx.model_dump())
    assert res["status"] == "SUCCESS"


def test_agua_step_execution() -> None:
    """Verify AguaStep runs and returns success."""
    step = AguaStep()
    ctx = PipelineContextDTO(transaction_id="tx_agua", input_data={"item": "water"})
    res = step(ctx.model_dump())
    assert res["status"] == "SUCCESS"


def test_ai_process_step_execution() -> None:
    """Verify AiProcessStep runs and returns success."""
    step = AiProcessStep()
    ctx = PipelineContextDTO(transaction_id="tx_ai", input_data={"prompt": "test"})
    res = step(ctx.model_dump())
    assert res["status"] == "SUCCESS"
