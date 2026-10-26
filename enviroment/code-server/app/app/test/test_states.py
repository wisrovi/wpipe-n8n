"""Unit tests for WPipe Step classes."""

from dto.context import PipelineContextDTO
from states.ai_sentiment_step import AISentimentStep
from states.clean_data_step import CleanDataStep
from states.transform_payload_step import TransformPayloadStep


def test_clean_data_step_mutation() -> None:
    """Verify CleanDataStep mutates context fields with configured prefix."""
    step = CleanDataStep(prefix="test_clean_")
    ctx = PipelineContextDTO(transaction_id="tx_1", input_data={"raw_id": "123"})
    result = step(ctx.model_dump())

    assert result["status"] == "CLEANED"
    assert result["processed_data"]["test_clean_raw_id"] == "123"
    assert result["metrics"]["cleaned_items"] == 1


def test_transform_payload_step_execution() -> None:
    """Verify TransformPayloadStep integrates with processing service."""
    step = TransformPayloadStep(mode="standard")
    ctx = PipelineContextDTO(
        transaction_id="tx_2", input_data={}, processed_data={"field": "data"}
    )
    result = step(ctx.model_dump())

    assert result["status"] == "TRANSFORMED"
    assert "proc_field" in result["processed_data"]
    assert result["processed_data"]["processed_by"] == "ProcessingService"


def test_ai_sentiment_step_execution() -> None:
    """Verify AISentimentStep scores sentiment correctly."""
    step = AISentimentStep(threshold=0.5)
    ctx = PipelineContextDTO(
        transaction_id="tx_3",
        input_data={"text": "This is a great product with awesome quality"},
    )
    result = step(ctx.model_dump())

    assert result["processed_data"]["sentiment_label"] == "POSITIVE"
    assert result["metrics"]["ai_confidence"] > 0.5
