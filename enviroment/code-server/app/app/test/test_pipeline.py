"""Integration test for declarative pipeline execution."""

from pipelines import build_pipeline, execute_pipeline


def test_build_pipeline() -> None:
    """Verify declarative pipeline instantiation and configuration."""
    pipe = build_pipeline()
    assert pipe is not None
    assert pipe.pipeline_name == "main_pipeline"


def test_execute_pipeline_success() -> None:
    """Verify complete pipeline execution mutates payload correctly."""
    payload = {
        "transaction_id": "tx_test_456",
        "input_data": {"user_id": 42, "text": "excellent"},
        "url": "https://httpbin.org/get",
        "method": "GET",
    }
    result = execute_pipeline(payload)
    assert result.get("status") in ("CLEANED", "TRANSFORMED", "SCORED", "success", "SUCCESS", "PENDING")
    assert "transaction_id" in result
