"""Unit tests for WPipe Step classes."""

from states.base import BaseStep

def test_base_step_interface() -> None:
    """Verify BaseStep requires __call__ implementation."""
    class DummyStep(BaseStep):
        pass

    import pytest
    with pytest.raises(TypeError):
        DummyStep()  # type: ignore[abstract]
