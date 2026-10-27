"""Microservice main entrypoint: FastAPI REST API & event listener.

Complies with WPipe Quality Rules (resource monitoring, timing, 0 hasattr/getattr).
"""

from typing import Any

from fastapi import FastAPI, HTTPException
from loguru import logger
from wdecorators import time_execution  # type: ignore[import-untyped]
from wpipe import ResourceMonitor, TaskTimer  # type: ignore[import-untyped]
from wpipe.exception.api_error import ProcessError  # type: ignore[import-untyped]

from config.settings import settings
from dto.request import PipelineRequestDTO
from dto.response import PipelineResponseDTO
from pipelines import build_pipeline
from utils.helpers import generate_transaction_id, sanitize_metrics

app: FastAPI = FastAPI(
    title=settings.app_name,
    description="Production WPipe Microservice (wisrovi SUITE)",
    version=settings.version,
    root_path=settings.root_path,
)


def handle_pipeline_event(event_data: dict[str, Any], pipeline_name: str = "main") -> dict[str, Any]:
    """Receive trigger event, execute pipeline under resource monitoring and return result.

    Args:
        event_data (dict[str, Any]): Event payload.
        pipeline_name (str): Identifier of the target pipeline to execute. Defaults to 'main'.

    Returns:
        dict[str, Any]: Execution result dictionary.

    Raises:
        ProcessError: If a pipeline runtime task fails.
        Exception: If an unexpected error occurs during execution.
    """
    tx_id = event_data.get("transaction_id") or generate_transaction_id()
    event_data["transaction_id"] = tx_id
    pipeline = build_pipeline(pipeline_name)

    try:
        with (
            ResourceMonitor(f"{settings.app_name}_monitor") as monitor,
            TaskTimer(f"{settings.app_name}_timer", timeout_seconds=900) as timer,
        ):

            @time_execution
            def run_pipe() -> dict[str, Any]:
                return pipeline.run(event_data)

            result = run_pipe()

        summary = monitor.get_summary()
        peak_ram = summary.get("peak_ram_mb", 0) if isinstance(summary, dict) else 0
        elapsed = timer.elapsed_seconds

        logger.info(
            f"Execution finished for {tx_id}. Elapsed: {elapsed:.2f}s, Peak RAM: {peak_ram} MB"
        )
        return result
    except ProcessError:
        logger.error(f"WPipe process error for {tx_id}")
        raise
    except Exception:
        logger.error(f"Unexpected error running pipeline for {tx_id}")
        raise


@app.get("/health")
def health() -> dict[str, str]:
    """Microservice healthcheck endpoint.

    Returns:
        dict[str, str]: Health status dictionary.
    """
    return {"status": "ok", "app": settings.app_name}


@app.post("/run", response_model=PipelineResponseDTO)
def run_pipeline_endpoint(request: PipelineRequestDTO) -> PipelineResponseDTO:
    """REST API endpoint to trigger pipeline execution.

    Args:
        request (PipelineRequestDTO): Request payload containing input data.

    Returns:
        PipelineResponseDTO: Structured response with execution results and metrics.

    Raises:
        HTTPException: If an unhandled error occurs during execution.
    """
    tx_id = request.transaction_id or generate_transaction_id()
    payload = {"transaction_id": tx_id, "input_data": request.payload}
    if isinstance(request.payload, dict):
        payload.update(request.payload)

    try:
        result = handle_pipeline_event(payload)
        return PipelineResponseDTO(
            status="success",
            transaction_id=tx_id,
            data=result.get("processed_data", result),
            metrics=sanitize_metrics(result.get("metrics", {})),
        )
    except Exception as err:
        logger.error(f"Pipeline API failure for {tx_id}: {err}")
        raise HTTPException(status_code=500, detail=str(err)) from err


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "app.main:app", host=settings.host, port=settings.port, reload=settings.debug
    )
