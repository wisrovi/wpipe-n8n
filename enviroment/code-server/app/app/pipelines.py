"""Declarative pipeline DAG construction and execution for main_pipeline.

Mandatory architecture component per WPipe Architect Manual.
"""

import os
from typing import Any

from loguru import logger
from config.settings import settings
from dto.context import PipelineContextDTO
from states.agua_step import AguaStep
from states.ai_process_step_step import AiProcessStepStep
from states.ai_sentiment_step import AISentimentStep
from states.base import BaseStep
from states.clean_data_step import CleanDataStep
from states.pan_step import PanStep
from states.queso_step import QuesoStep
from states.transform_payload_step import TransformPayloadStep
from wpipe import Pipeline, Condition, For, Parallel, Background  # type: ignore[import-untyped]
from wpipe_steps.connectivity.http import httpStep as http

os.makedirs("output", exist_ok=True)

# 1. Declarative Pipeline Instance
pipe: Pipeline = Pipeline(pipeline_name="main_pipeline")
pipe.tracking_db = settings.tracking_db
pipe.collect_system_metrics = True
pipe.show_progress = False
pipe.max_retries = 3
pipe.retry_delay = 0.5

# 2. Direct inline step assembly reflecting the visual canvas
pipe.set_steps([
        http(),
        Condition(
            expression="http_response.get('status_code') == 200",
            branch_true=[
            QuesoStep(),
            ],
            branch_false=[
            PanStep(),
            ],
        ),
        Condition(
            expression="http_response.get('status_code') == 200",
            branch_true=[
            AiProcessStepStep(),
            ],
        ),
        Condition(
            expression="http_response.get('status_code') == 200",
            branch_true=[
            AguaStep(),
            ],
        ),
        Background(step=TransformPayloadStep),
])


def build_pipeline() -> Pipeline:
    """Declaratively return the configured WPipe state machine.

    Returns:
        Pipeline: Configured WPipe pipeline instance.
    """
    return pipe


def execute_pipeline(payload: dict[str, Any]) -> dict[str, Any]:
    """Execute the declarative WPipe pipeline.

    Args:
        payload (dict[str, Any]): Input payload dictionary.

    Returns:
        dict[str, Any]: Execution result dictionary with mutated context.
    """
    tx_id = payload.get("transaction_id", "unknown")
    logger.info(f"Executing main_pipeline WPipe pipeline with transaction: {tx_id}")
    try:
        result = pipe.run(payload)
        logger.info("Pipeline execution completed successfully")
        return result
    except Exception as err:
        logger.error(f"Error executing main_pipeline: {err}")
        raise


if __name__ == "__main__":
    import json
    import sys
    test_payload = {"transaction_id": "sim_run", "input_data": {"mode": "direct"}}
    if len(sys.argv) > 1 and sys.argv[1].strip():
        try:
            test_payload = json.loads(sys.argv[1])
        except Exception:
            pass
    try:
        res = execute_pipeline(test_payload)
        print("WPIPE_SIMULATION_SUCCESS")
        print(json.dumps(res, default=str))
    except Exception as exc:
        print("WPIPE_SIMULATION_FAILED", file=sys.stderr)
        print(f"{type(exc).__name__}: {exc}", file=sys.stderr)
        import traceback
        traceback.print_exc()
        sys.exit(1)
