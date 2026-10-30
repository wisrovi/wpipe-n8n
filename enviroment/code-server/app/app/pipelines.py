"""Declarative pipeline DAG construction and execution for main_pipeline.

Multi-trigger pipeline architecture reflecting multiple execution trees on visual canvas.
Mandatory architecture component per WPipe Architect Manual.
"""

import os
from typing import Any

from loguru import logger
from config.settings import settings
from dto.context import PipelineContextDTO
from states.ai_process_step import AiProcessStep
from states.base import BaseStep
from states.pan_step import PanStep
from states.queso_step import QuesoStep
from wpipe import Pipeline, Condition, For, Parallel, Background  # type: ignore[import-untyped]
from wpipe_steps.connectivity.http import HttpRequestStep as HttpRequestContext

os.makedirs("output", exist_ok=True)

# 1. Declarative Pipeline Instances (Multi-Trigger Architecture)
# --- Pipeline: main (API: /run) ---
pipe_main: Pipeline = Pipeline(pipeline_name="main_pipeline")
pipe_main.tracking_db = settings.tracking_db
pipe_main.collect_system_metrics = True
pipe_main.show_progress = False
pipe_main.max_retries = 3
pipe_main.retry_delay = 0.5

pipe_main.set_steps([
        AiProcessStep(),
        Condition(
            expression="http_response.get('status_code') == 200",
            branch_true=[
            PanStep(),
            ],
        )
])

# --- Pipeline: run (API: /run) ---
pipe_run: Pipeline = Pipeline(pipeline_name="main_pipeline_run")
pipe_run.tracking_db = settings.tracking_db
pipe_run.collect_system_metrics = True
pipe_run.show_progress = False
pipe_run.max_retries = 3
pipe_run.retry_delay = 0.5

pipe_run.set_steps([
        HttpRequestContext(),
        For(
            iterations=3,
            steps=[
            QuesoStep(),
            ],
        )
])

# Canonical registry of all pipelines declared on this canvas
pipelines: dict[str, Pipeline] = {
    "main": pipe_main,
    "run": pipe_run,
}

# Primary pipeline alias for backward compatibility
pipe: Pipeline = pipe_main


def build_pipeline(name: str = "main") -> Pipeline:
    """Declaratively return the configured WPipe state machine.

    Args:
        name (str): Pipeline name key. Defaults to 'main'.

    Returns:
        Pipeline: Configured WPipe pipeline instance.
    """
    return pipelines.get(name, pipe_main)


def execute_pipeline(payload: dict[str, Any], pipeline_name: str = "main") -> dict[str, Any]:
    """Execute the declarative WPipe pipeline.

    Args:
        payload (dict[str, Any]): Input payload dictionary.
        pipeline_name (str): Target pipeline identifier. Defaults to 'main'.

    Returns:
        dict[str, Any]: Execution result dictionary with mutated context.
    """
    target_pipe = pipelines.get(pipeline_name, pipe_main)
    tx_id = payload.get("transaction_id", "unknown")
    logger.info(f"Executing main_pipeline [{pipeline_name}] WPipe pipeline with transaction: {tx_id}")
    try:
        result = target_pipe.run(payload)
        logger.info(f"Pipeline [{pipeline_name}] completed successfully")
        return result
    except Exception as err:
        logger.error(f"Error executing main_pipeline [{pipeline_name}]: {err}")
        raise


if __name__ == "__main__":
    import json
    import sys
    test_payload = {"transaction_id": "sim_run", "input_data": {"mode": "direct"}}
    target_pipeline = "main"
    if len(sys.argv) > 1 and sys.argv[1].strip():
        try:
            parsed = json.loads(sys.argv[1])
            if isinstance(parsed, dict):
                test_payload = parsed
                if "_target_pipeline" in parsed:
                    target_pipeline = parsed.pop("_target_pipeline")
        except Exception:
            pass
    try:
        res = execute_pipeline(test_payload, pipeline_name=target_pipeline)
        print("WPIPE_SIMULATION_SUCCESS")
        print(json.dumps(res, default=str))
    except Exception as exc:
        print("WPIPE_SIMULATION_FAILED", file=sys.stderr)
        print(f"{type(exc).__name__}: {exc}", file=sys.stderr)
        import traceback
        traceback.print_exc()
        sys.exit(1)
