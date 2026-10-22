"""WPipe Engine - AST Pipeline Compiler & Microservice Generator
Transforms visual Canvas IR into production Python microservices conforming to wpipe-mcp standards.
Author: William Rodriguez (wisrovi.dev)
"""

import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

DEFAULT_STEP_CONSTRUCTOR_ARGS: dict[str, dict[str, Any]] = {
    "NmapScan": {"target": "127.0.0.1"},
    "NmapScanStep": {"target": "127.0.0.1"},
}


def sanitize_ident(name: str) -> str:
    s = re.sub(r"[^0-9a-zA-Z_]", "_", name)
    if not s or s[0].isdigit():
        s = f"step_{s}"
    return s.lower()


class ASTCompiler:
    """Compiles Canvas IR to Python source files while preserving user custom code blocks."""

    def compile_canvas(
        self,
        canvas_ir: dict[str, Any],
        project_name: str = "main_pipeline",
        existing_pipeline_code: str = "",
    ) -> dict[str, str]:
        """Compile Canvas IR JSON to a dictionary of { relative_path: file_content }."""
        nodes = canvas_ir.get("nodes", [])

        # 0. Extract trigger launcher and root_path configuration
        trigger_node = next(
            (
                n
                for n in nodes
                if n.get("data", {}).get("node_type") in ("trigger", "wpipe_trigger")
                or n.get("type") == "wpipe_trigger"
                or "trigger" in (n.get("data", {}).get("node_type") or "")
            ),
            None,
        )
        trigger_data = trigger_node.get("data", {}) if trigger_node else {}
        trigger_type = (trigger_data.get("trigger_type") or "api").lower()
        is_api_trigger = not trigger_node or trigger_type in ("api", "rest", "fastapi")
        trigger_param = (trigger_data.get("trigger_param") or "").strip()
        default_root_path = ""
        if is_api_trigger and trigger_param.startswith("/"):
            default_root_path = trigger_param[:-4] if trigger_param.endswith("/run") else trigger_param

        # 1. Helper to retrieve children by parent_id and slot_type
        def get_children(parent_id: str, slot_type: str | None = None) -> list[dict[str, Any]]:
            res = []
            for n in nodes:
                d = n.get("data", {})
                if d.get("parent_id") == parent_id:
                    if slot_type is None or d.get("slot_type") == slot_type:
                        res.append(n)
            return res

        imports: set[str] = {
            "from wpipe import Pipeline, Condition, For, Parallel, Background  # type: ignore[import-untyped]",
            "from config.settings import settings",
            "from dto.context import PipelineContextDTO",
            "from states.base import BaseStep",
            "from states.clean_data_step import CleanDataStep",
            "from states.transform_payload_step import TransformPayloadStep",
            "from states.ai_sentiment_step import AISentimentStep",
        }

        step_names_for_readme: list[str] = []

        # 2. Recursive hierarchical renderer for C-blocks
        def render_step(node: dict[str, Any], indent: int = 8) -> str:
            pad = " " * indent
            data = node.get("data", {})
            raw_type = data.get("node_type") or node.get("type", "step")
            ntype = raw_type.lower()
            label = data.get("label", "Step")
            fn = data.get("step_name") or data.get("func_name") or label
            ns = data.get("namespace", "")

            if ntype in ("condition", "wpipe_if", "wpipe_if_else") or "if" in ntype or "condition" in ntype:
                raw_expr = data.get("condition_expression") or data.get("expression") or "status_code == 200"
                expr = raw_expr.replace('"', '\\"')
                true_kids = get_children(node.get("id", ""), "if_body")
                false_kids = get_children(node.get("id", ""), "else_body")

                t_code = ",\n".join(render_step(c, indent + 4) for c in true_kids) if true_kids else f'{pad}    CleanDataStep(prefix="branch_true_")'
                f_code = ",\n".join(render_step(c, indent + 4) for c in false_kids) if false_kids else ""

                step_names_for_readme.append(f"Condition({raw_expr})")
                if f_code:
                    return f'{pad}Condition(\n{pad}    expression="{expr}",\n{pad}    branch_true=[\n{t_code},\n{pad}    ],\n{pad}    branch_false=[\n{f_code},\n{pad}    ],\n{pad})'
                return f'{pad}Condition(\n{pad}    expression="{expr}",\n{pad}    branch_true=[\n{t_code},\n{pad}    ],\n{pad})'

            if ntype in ("for", "wpipe_for") or "for" in ntype:
                iters = data.get("for_iterations") or data.get("iterations") or 3
                loop_kids = get_children(node.get("id", ""), "loop_body") or get_children(node.get("id", ""), "if_body")
                l_code = ",\n".join(render_step(c, indent + 4) for c in loop_kids) if loop_kids else f'{pad}    TransformPayloadStep(mode="loop")'
                step_names_for_readme.append(f"For({iters} iterations)")
                return f'{pad}For(\n{pad}    iterations={iters},\n{pad}    steps=[\n{l_code},\n{pad}    ],\n{pad})'

            if ntype in ("while", "wpipe_while") or "while" in ntype:
                raw_expr = data.get("condition_expression") or data.get("expression") or "retry_count < 3"
                expr = raw_expr.replace('"', '\\"')
                loop_kids = get_children(node.get("id", ""), "loop_body") or get_children(node.get("id", ""), "if_body")
                l_code = ",\n".join(render_step(c, indent + 4) for c in loop_kids) if loop_kids else f'{pad}    TransformPayloadStep(mode="retry")'
                step_names_for_readme.append(f"While({raw_expr})")
                return f'{pad}For(\n{pad}    validation_expression="{expr}",\n{pad}    steps=[\n{l_code},\n{pad}    ],\n{pad})'

            if ntype in ("parallel", "wpipe_parallel") or "parallel" in ntype:
                merge = data.get("merge_policy", "accumulate")
                par_kids = get_children(node.get("id", ""), "parallel_body") or get_children(node.get("id", ""), "if_body")
                p_code = ",\n".join(render_step(c, indent + 4) for c in par_kids) if par_kids else f'{pad}    CleanDataStep(),\n{pad}    TransformPayloadStep()'
                step_names_for_readme.append(f"Parallel({merge})")
                return f'{pad}Parallel(\n{pad}    steps=[\n{p_code},\n{pad}    ],\n{pad}    merge_policy="{merge}",\n{pad})'

            if ntype in ("background", "wpipe_background") or "background" in ntype:
                bg_kids = get_children(node.get("id", ""), "background_body") or get_children(node.get("id", ""), "loop_body")
                b_code = render_step(bg_kids[0], indent + 4).strip() if bg_kids else "TransformPayloadStep()"
                step_names_for_readme.append("Background")
                return f'{pad}Background(\n{pad}    step={b_code},\n{pad})'

            # Standard and catalog step handling
            if ns and ns.startswith("wpipe_steps"):
                step_class = fn if fn.endswith("Step") else f"{fn}Step"
                if step_class != fn:
                    imports.add(f"from {ns} import {step_class} as {fn}")
                else:
                    imports.add(f"from {ns} import {fn}")
                step_names_for_readme.append(fn)

                params = dict(DEFAULT_STEP_CONSTRUCTOR_ARGS.get(fn, {}))
                if data.get("params"):
                    params.update(data["params"])
                args_str = ", ".join(f"{k}={repr(v)}" for k, v in params.items())
                return f"{pad}{fn}({args_str})"

            fn_lower = fn.lower()
            if "transform" in fn_lower or fn == "TransformPayloadStep":
                imports.add("from states.transform_payload_step import TransformPayloadStep")
                step_names_for_readme.append("TransformPayloadStep")
                mode = data.get("params", {}).get("mode", "standard")
                return f'{pad}TransformPayloadStep(mode="{mode}")'
            elif "sentiment" in fn_lower or "ai" in fn_lower or fn == "AISentimentStep":
                imports.add("from states.ai_sentiment_step import AISentimentStep")
                step_names_for_readme.append("AISentimentStep")
                th = data.get("params", {}).get("threshold", 0.5)
                return f'{pad}AISentimentStep(threshold={th})'
            else:
                imports.add("from states.clean_data_step import CleanDataStep")
                step_names_for_readme.append("CleanDataStep")
                pfx = data.get("params", {}).get("prefix", "clean_")
                return f'{pad}CleanDataStep(prefix="{pfx}")'

        # 3. Filter root execution steps
        root_nodes = [
            n for n in nodes
            if not n.get("data", {}).get("parent_id")
            and (n.get("data", {}).get("node_type") or n.get("type", "step")) not in ("trigger", "response", "wpipe_trigger", "wpipe_response")
        ]

        if root_nodes:
            steps_code = ",\n".join(render_step(n, 8) for n in root_nodes)
        else:
            steps_code = "\n".join([
                "        CleanDataStep(prefix='clean_'),",
                "        TransformPayloadStep(mode='standard'),",
                "        AISentimentStep(threshold=0.5),",
            ])
            step_names_for_readme.extend(["CleanDataStep", "TransformPayloadStep", "AISentimentStep"])

        imports_code = "\n".join(sorted(imports))

        # 4. Smart AST Code Merge (Preserve custom blocks if existing code is provided)
        custom_blocks = ""
        if existing_pipeline_code:
            imp_m = re.search(
                r"# >>> \[WPIPE:CUSTOM_IMPORTS:START\](.*?)# <<< \[WPIPE:CUSTOM_IMPORTS:END\]",
                existing_pipeline_code,
                re.DOTALL,
            )
            if imp_m and imp_m.group(1).strip() and not imp_m.group(1).strip().startswith("# Add custom imports"):
                custom_blocks += f"\n# >>> [WPIPE:CUSTOM_IMPORTS:START]\n{imp_m.group(1).strip()}\n# <<< [WPIPE:CUSTOM_IMPORTS:END]\n"

            log_m = re.search(
                r"# >>> \[WPIPE:CUSTOM_LOGIC:START\](.*?)# <<< \[WPIPE:CUSTOM_LOGIC:END\]",
                existing_pipeline_code,
                re.DOTALL,
            )
            if log_m and log_m.group(1).strip() and not log_m.group(1).strip().startswith("# Add custom helper"):
                custom_blocks += f"\n# >>> [WPIPE:CUSTOM_LOGIC:START]\n{log_m.group(1).strip()}\n# <<< [WPIPE:CUSTOM_LOGIC:END]\n"

        # 5. Pipelines.py
        pipelines_py = f'''"""Declarative pipeline DAG construction and execution for {project_name}.

Mandatory architecture component per WPipe Architect Manual.
"""

import os
from typing import Any

from loguru import logger
{imports_code}{custom_blocks}

os.makedirs("output", exist_ok=True)

# 1. Declarative Pipeline Instance
pipe: Pipeline = Pipeline(pipeline_name="{project_name}")
pipe.tracking_db = settings.tracking_db
pipe.collect_system_metrics = True
pipe.show_progress = True
pipe.max_retries = 3
pipe.retry_delay = 0.5

# 2. Direct inline step assembly reflecting the visual canvas
pipe.set_steps([
{steps_code}
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
    logger.info(f"Executing {project_name} WPipe pipeline with transaction: {{tx_id}}")
    try:
        result = pipe.run(payload)
        logger.info("Pipeline execution completed successfully")
        return result
    except Exception as err:
        logger.error(f"Error executing {project_name}: {{err}}")
        return {{"error": str(err), "status": "failed"}}


if __name__ == "__main__":
    test_payload = {{"transaction_id": "test_run", "input_data": {{"mode": "direct"}}}}
    res = execute_pipeline(test_payload)
    print("Execution result:", res)
'''

        # 6. Main.py
        main_py = f'''"""Microservice main entrypoint: FastAPI REST API & event listener.

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


def handle_pipeline_event(event_data: dict[str, Any]) -> dict[str, Any]:
    """Receive trigger event, execute pipeline under resource monitoring and return result.

    Args:
        event_data (dict[str, Any]): Event payload.

    Returns:
        dict[str, Any]: Execution result dictionary.

    Raises:
        ProcessError: If a pipeline runtime task fails.
        Exception: If an unexpected error occurs during execution.
    """
    tx_id = event_data.get("transaction_id") or generate_transaction_id()
    event_data["transaction_id"] = tx_id
    pipeline = build_pipeline()

    try:
        with (
            ResourceMonitor(f"{{settings.app_name}}_monitor") as monitor,
            TaskTimer(f"{{settings.app_name}}_timer", timeout_seconds=900) as timer,
        ):

            @time_execution
            def run_pipe() -> dict[str, Any]:
                return pipeline.run(event_data)

            result = run_pipe()

        summary = monitor.get_summary()
        peak_ram = summary.get("peak_ram_mb", 0) if isinstance(summary, dict) else 0
        elapsed = timer.elapsed_seconds

        logger.info(
            f"Execution finished for {{tx_id}}. Elapsed: {{elapsed:.2f}}s, Peak RAM: {{peak_ram}} MB"
        )
        return result
    except ProcessError:
        logger.error(f"WPipe process error for {{tx_id}}")
        raise
    except Exception:
        logger.error(f"Unexpected error running pipeline for {{tx_id}}")
        raise


@app.get("/health")
def health() -> dict[str, str]:
    """Microservice healthcheck endpoint.

    Returns:
        dict[str, str]: Health status dictionary.
    """
    return {{"status": "ok", "app": settings.app_name}}


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
    payload = {{"transaction_id": tx_id, "input_data": request.payload}}

    try:
        result = handle_pipeline_event(payload)
        return PipelineResponseDTO(
            status="success",
            transaction_id=tx_id,
            data=result.get("processed_data", result),
            metrics=sanitize_metrics(result.get("metrics", {{}})),
        )
    except Exception as err:
        logger.error(f"Pipeline API failure for {{tx_id}}: {{err}}")
        raise HTTPException(status_code=500, detail=str(err)) from err


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "app.main:app", host=settings.host, port=settings.port, reload=settings.debug
    )
'''

        # 7. app/__init__.py
        app_init_py = f'''"""Application package for {project_name}.

Provides package exports and pipeline build helper functions.
"""

from pipelines import build_pipeline, execute_pipeline

__version__ = "1.0.0"
__author__ = "William Rodriguez (wisrovi)"

__all__ = ["__author__", "__version__", "build_pipeline", "execute_pipeline"]
'''

        # 8. Config files
        settings_py = f'''"""Application settings and environment configuration.

Part of the WPipe microservice architecture (wisrovi SUITE).
"""

import os
from pathlib import Path
from typing import Any

from pydantic import BaseModel, Field
import yaml


def _load_yaml_config() -> dict[str, Any]:
    """Load configuration dictionary from config.yaml with path resolution fallback.

    Returns:
        dict[str, Any]: Parsed YAML configuration or empty dict if not found.
    """
    config_candidates = [
        Path("app/config/config.yaml"),
        Path("config.yaml"),
        Path(__file__).parent / "config.yaml",
        Path(__file__).parent.parent.parent / "config.yaml",
    ]
    for candidate in config_candidates:
        if candidate.is_file():
            try:
                with open(candidate, "r", encoding="utf-8") as file_stream:
                    parsed_yaml = yaml.safe_load(file_stream)
                    if isinstance(parsed_yaml, dict):
                        return parsed_yaml
            except (OSError, yaml.YAMLError):
                pass
    return {{}}


_config: dict[str, Any] = _load_yaml_config()
_server_cfg: dict[str, Any] = _config.get("server", {{}})
_tracking_cfg: dict[str, Any] = _config.get("tracking", {{}})


class AppSettings(BaseModel):
    """Typed application settings loaded from config.yaml with environment variable overrides.

    Attributes:
        app_name (str): Unique microservice identification name.
        version (str): Semantic version of the microservice.
        environment (str): Runtime environment (development, staging, production).
        debug (bool): Flag indicating if debug logging/features are enabled.
        host (str): Network bind interface host IP.
        port (int): Port number on which the HTTP server listens.
        root_path (str): FastAPI root path prefix for reverse proxy routing.
        tracking_db (str): SQLite database path for WPipe execution tracking.
    """

    app_name: str = Field(
        default=os.getenv("SERVICE_NAME", _config.get("microservice_name", "{project_name}")),
        description="Name of the microservice",
    )
    version: str = Field(
        default=os.getenv("SERVICE_VERSION", os.getenv("VERSION", _config.get("version", "1.0.0"))),
        description="Semantic version of the microservice",
    )
    environment: str = Field(
        default=os.getenv("ENV", _config.get("environment", "production")),
        description="Runtime environment",
    )
    debug: bool = Field(
        default=os.getenv("APP_DEBUG", str(_config.get("debug", "False"))).lower() == "true",
        description="Debug mode flag",
    )
    host: str = Field(
        default=os.getenv("HOST", _server_cfg.get("host", "0.0.0.0")),
        description="Server host bind address",
    )
    port: int = Field(
        default=int(os.getenv("PORT", _server_cfg.get("port", 8000))),
        description="Server HTTP port",
    )
    root_path: str = Field(
        default=os.getenv("ROOT_PATH", os.getenv("API_ROOT_PATH", _server_cfg.get("root_path", "{default_root_path}"))),
        description="FastAPI root path prefix for reverse proxy / API gateway routing",
    )
    tracking_db: str = Field(
        default=os.getenv("WPIPE_TRACKING_DB", _tracking_cfg.get("db_path", "output/tracking.db")),
        description="WPipe forensics SQLite database",
    )


settings: AppSettings = AppSettings()
'''

        config_yaml = f"""# Configuration for {project_name} (WPipe Microservice)
microservice_name: "{project_name}"
version: "1.0.0"
environment: "production"
debug: false
server:
  host: "0.0.0.0"
  port: 8000
  root_path: "{default_root_path}"
tracking:
  db_path: "output/tracking.db"
  collect_system_metrics: true
"""

        config_init_py = f'''"""Configuration package for {project_name}."""

from config.settings import AppSettings, settings

__all__ = ["AppSettings", "settings"]
'''

        # 9. DTO files
        dto_init_py = '''"""Data Transfer Objects package."""

from dto.context import PipelineContextDTO
from dto.request import PipelineRequestDTO
from dto.response import PipelineResponseDTO

__all__ = ["PipelineContextDTO", "PipelineRequestDTO", "PipelineResponseDTO"]
'''

        dto_context_py = '''"""Shared pipeline context Data Transfer Object.

Guarantees strict typing and context immutability validation across WPipe states.
"""

from typing import Any, Union

from pydantic import BaseModel, Field


class PipelineContextDTO(BaseModel):
    """Data Transfer Object defining the shared context for the WPipe pipeline.

    Attributes:
        transaction_id (str): Unique transaction trace identifier.
        input_data (dict[str, Any]): Raw input data payload.
        processed_data (dict[str, Any]): Transformed and cleaned data.
        status (str): Pipeline execution state.
        metrics (dict[str, Any]): Execution and performance metrics.
        error (Union[str, dict[str, Any], None]): Error detail if execution fails.
    """

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
'''

        dto_request_py = '''"""API request Data Transfer Object."""

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
'''

        dto_response_py = '''"""API response Data Transfer Object."""

from typing import Any

from pydantic import BaseModel, Field


class PipelineResponseDTO(BaseModel):
    """Standard REST API response returned by the microservice.

    Attributes:
        status (str): Outcome status of the request.
        transaction_id (str): Transaction identifier associated with the run.
        data (dict[str, Any]): Resulting output payload.
        metrics (dict[str, Any]): Execution and timing metrics.
        error (str | None): Error message if execution encountered a failure.
    """

    status: str = Field(default="success", description="Outcome status")
    transaction_id: str = Field(..., description="Transaction identifier")
    data: dict[str, Any] = Field(default_factory=dict, description="Resulting output payload")
    metrics: dict[str, Any] = Field(default_factory=dict, description="Execution metrics")
    error: str | None = Field(default=None, description="Error message if any")
'''

        # 10. Services files
        services_init_py = '''"""Business domain services package."""

from services.business_service import ProcessingService

__all__ = ["ProcessingService"]
'''

        business_service_py = '''"""Decoupled core business and processing services.

Part of the WPipe microservice architecture (wisrovi SUITE).
"""

from typing import Any

from loguru import logger


class ProcessingService:
    """Business service encapsulating domain operations outside pipeline graph.

    Attributes:
        mode (str): Processing strategy mode identifier.
    """

    def __init__(self, mode: str = "standard") -> None:
        """Initialize the processing service.

        Args:
            mode (str): Operational mode (default: 'standard').
        """
        self.mode: str = mode
        logger.debug(f"ProcessingService initialized in mode: {mode}")

    def process_payload(self, raw_data: dict[str, Any]) -> dict[str, Any]:
        """Execute domain business logic and transformation on raw data.

        Args:
            raw_data (dict[str, Any]): Unprocessed input dictionary.

        Returns:
            dict[str, Any]: Transformed and enriched domain dictionary.
        """
        logger.info(f"ProcessingService executing domain payload transform (mode: {self.mode})")
        transformed: dict[str, Any] = {
            "processed_by": "ProcessingService",
            "mode": self.mode,
            "items_count": len(raw_data),
        }
        for key, value in raw_data.items():
            transformed[f"proc_{key}"] = value
        return transformed
'''

        # 11. Utils files
        utils_init_py = '''"""Utility helpers package."""

from utils.helpers import generate_transaction_id, sanitize_metrics

__all__ = ["generate_transaction_id", "sanitize_metrics"]
'''

        utils_helpers_py = '''"""Pure helper functions for metrics sanitation and ID generation."""

import time
from typing import Any
import uuid


def generate_transaction_id(prefix: str = "tx_") -> str:
    """Generate a unique transaction identifier.

    Args:
        prefix (str): Prefix string for the transaction ID.

    Returns:
        str: Unique transaction trace ID string.
    """
    timestamp = int(time.time() * 1000)
    unique_suffix = uuid.uuid4().hex[:8]
    return f"{prefix}{timestamp}_{unique_suffix}"


def sanitize_metrics(metrics: dict[str, Any]) -> dict[str, Any]:
    """Sanitize performance metrics dictionary.

    Args:
        metrics (dict[str, Any]): Raw metrics dictionary.

    Returns:
        dict[str, Any]: Sanitized dictionary containing numeric values.
    """
    sanitized: dict[str, Any] = {}
    for key, value in metrics.items():
        if isinstance(value, (int, float, bool, str)):
            sanitized[str(key)] = value
    return sanitized
'''

        # 12. Class-based States
        states_init_py = '''"""States package dynamically exporting all registered step classes."""

from states.ai_sentiment_step import AISentimentStep
from states.base import BaseStep
from states.clean_data_step import CleanDataStep
from states.transform_payload_step import TransformPayloadStep

__all__ = [
    "AISentimentStep",
    "BaseStep",
    "CleanDataStep",
    "TransformPayloadStep",
]
'''

        states_base_py = '''"""Abstract base step for WPipe microservices."""

from abc import ABC, abstractmethod
from typing import Any


class BaseStep(ABC):
    """Base class defining the contract for all WPipe state steps."""

    @abstractmethod
    def __call__(self, context: Any) -> dict[str, Any]:
        """Execute step logic mutating the shared pipeline context.

        Args:
            context (Any): Typed pipeline context or dictionary.

        Returns:
            dict[str, Any]: Mutated execution context dictionary.
        """
        raise NotImplementedError("Step implementation must override __call__")
'''

        clean_data_step_py = '''"""Data cleaning and sanitization step class.

Conforms to WPipe class-based state specifications with @step, @timeout_sync, and @to_obj.
"""

from typing import Any

from loguru import logger
from wpipe import step, to_obj  # type: ignore[import-untyped]
from wpipe.timeout import timeout_sync  # type: ignore[import-untyped]
from wpipe.util import object_to_dict  # type: ignore[import-untyped]

from dto.context import PipelineContextDTO
from states.base import BaseStep


@step(
    name="CleanDataStep",
    version="1.0.0",
    description="Sanitizes and normalizes input data into processed context.",
)
class CleanDataStep(BaseStep):
    """WPipe State class that cleans and normalizes context fields.

    Attributes:
        prefix (str): Normalization prefix added to keys.
    """

    def __init__(self, prefix: str = "clean_") -> None:
        """Initialize CleanDataStep.

        Args:
            prefix (str): Key prefix for cleaned items.
        """
        self.prefix: str = prefix

    @timeout_sync(30)
    @to_obj(PipelineContextDTO)
    def __call__(self, context: Any) -> dict[str, Any]:
        """Execute data cleaning and normalization.

        Args:
            context (Any): Raw or transformed pipeline context.

        Returns:
            dict[str, Any]: Mutated and validated context dictionary.
        """
        raw_dict = object_to_dict(context)
        if raw_dict.get("error") == {}:
            raw_dict["error"] = None
        ctx_dto = PipelineContextDTO(**raw_dict)
        logger.info(f"CleanDataStep executing for tx: {ctx_dto.transaction_id}")

        cleaned: dict[str, Any] = {}
        for key, val in ctx_dto.input_data.items():
            cleaned[f"{self.prefix}{key.strip().lower()}"] = val

        ctx_dto.processed_data.update(cleaned)
        ctx_dto.status = "CLEANED"
        ctx_dto.metrics["cleaned_items"] = len(cleaned)
        return ctx_dto.model_dump()
'''

        transform_payload_step_py = '''"""Payload transformation step class.

Delegates heavy business logic to decoupled ProcessingService.
"""

from typing import Any

from loguru import logger
from wpipe import step, to_obj  # type: ignore[import-untyped]
from wpipe.timeout import timeout_sync  # type: ignore[import-untyped]
from wpipe.util import object_to_dict  # type: ignore[import-untyped]

from dto.context import PipelineContextDTO
from services.business_service import ProcessingService
from states.base import BaseStep


@step(
    name="TransformPayloadStep",
    version="1.0.0",
    description="Transforms payload by delegating to ProcessingService.",
)
class TransformPayloadStep(BaseStep):
    """WPipe State class that delegates to decoupled business services.

    Attributes:
        service (ProcessingService): Injected domain business service.
    """

    def __init__(self, mode: str = "standard") -> None:
        """Initialize TransformPayloadStep.

        Args:
            mode (str): Operational mode string.
        """
        self.service: ProcessingService = ProcessingService(mode=mode)

    @timeout_sync(60)
    @to_obj(PipelineContextDTO)
    def __call__(self, context: Any) -> dict[str, Any]:
        """Execute payload transformation through domain service.

        Args:
            context (Any): Raw or transformed pipeline context.

        Returns:
            dict[str, Any]: Transformed context dictionary.
        """
        raw_dict = object_to_dict(context)
        if raw_dict.get("error") == {}:
            raw_dict["error"] = None
        ctx_dto = PipelineContextDTO(**raw_dict)
        logger.info(f"TransformPayloadStep transforming context for tx: {ctx_dto.transaction_id}")

        transformed = self.service.process_payload(ctx_dto.processed_data)
        ctx_dto.processed_data.update(transformed)
        ctx_dto.status = "TRANSFORMED"
        ctx_dto.metrics["transformed"] = True
        return ctx_dto.model_dump()
'''

        ai_sentiment_step_py = '''"""AI natural language sentiment analysis step class."""

from typing import Any

from loguru import logger
from wpipe import step, to_obj  # type: ignore[import-untyped]
from wpipe.timeout import timeout_sync  # type: ignore[import-untyped]
from wpipe.util import object_to_dict  # type: ignore[import-untyped]

from dto.context import PipelineContextDTO
from states.base import BaseStep


@step(
    name="AISentimentStep",
    version="1.0.0",
    description="Analyzes text content and scores sentiment.",
)
class AISentimentStep(BaseStep):
    """WPipe State class that executes AI sentiment analysis.

    Attributes:
        threshold (float): Confidence threshold for classification.
    """

    def __init__(self, threshold: float = 0.5) -> None:
        """Initialize AISentimentStep.

        Args:
            threshold (float): Classification threshold between 0.0 and 1.0.
        """
        self.threshold: float = threshold

    @timeout_sync(45)
    @to_obj(PipelineContextDTO)
    def __call__(self, context: Any) -> dict[str, Any]:
        """Execute sentiment analysis heuristics.

        Args:
            context (Any): Raw or transformed pipeline context.

        Returns:
            dict[str, Any]: Context enriched with sentiment scores.
        """
        raw_dict = object_to_dict(context)
        if raw_dict.get("error") == {}:
            raw_dict["error"] = None
        ctx_dto = PipelineContextDTO(**raw_dict)
        logger.info(f"AISentimentStep scoring sentiment for tx: {ctx_dto.transaction_id}")

        text = str(ctx_dto.input_data.get("text", "")).lower()
        positive_keywords = ("good", "great", "excellent", "super", "awesome", "fast")
        score = 0.85 if any(kw in text for kw in positive_keywords) else 0.42

        ctx_dto.processed_data["sentiment_score"] = score
        ctx_dto.processed_data["sentiment_label"] = (
            "POSITIVE" if score >= self.threshold else "NEUTRAL"
        )
        ctx_dto.metrics["ai_confidence"] = score
        ctx_dto.status = "SCORED"
        return ctx_dto.model_dump()
'''

        # 13. Tests
        test_dto_py = '''"""Unit tests for Pydantic Data Transfer Objects."""

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
'''

        test_states_py = '''"""Unit tests for WPipe Step classes."""

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
'''

        test_pipeline_py = f'''"""Integration test for declarative pipeline execution."""

from pipelines import build_pipeline, execute_pipeline


def test_build_pipeline() -> None:
    """Verify declarative pipeline instantiation and configuration."""
    pipe = build_pipeline()
    assert pipe is not None
    assert pipe.pipeline_name == "{project_name}"


def test_execute_pipeline_success() -> None:
    """Verify complete pipeline execution mutates payload correctly."""
    payload = {{
        "transaction_id": "tx_test_456",
        "input_data": {{"user_id": 42, "text": "excellent"}},
    }}
    result = execute_pipeline(payload)
    assert result.get("status") in ("CLEANED", "TRANSFORMED", "SCORED", "success", "PENDING")
    assert "transaction_id" in result
'''

        test_api_py = '''"""FastAPI endpoint integration tests."""

from fastapi.testclient import TestClient

from config.settings import settings
from main import app

client: TestClient = TestClient(app)


def test_healthcheck() -> None:
    """Verify healthcheck endpoint returns HTTP 200 OK."""
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_app_version_and_root_path() -> None:
    """Verify FastAPI application uses version and root_path from settings."""
    assert app.version == settings.version
    assert app.root_path == settings.root_path


def test_run_endpoint() -> None:
    """Verify /run endpoint triggers pipeline execution and returns response DTO."""
    payload = {"transaction_id": "tx_api_1", "payload": {"metric": "value"}}
    response = client.post("/run", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "success"
    assert data["transaction_id"] == "tx_api_1"
'''

        root_test_pipeline_py = '''"""Root runner for pipeline tests."""

from pipelines import build_pipeline, execute_pipeline

__all__ = ["test_build_pipeline", "test_execute_pipeline_success"]
'''

        # 14. Root orchestration files
        requirements_txt = """wpipe>=2.5.13
wpipe-steps>=1.0.2
wdecorators>=2.0.0
pydantic>=2.0.0
fastapi>=0.110.0
uvicorn>=0.28.0
loguru>=0.7.2
psutil>=5.9.8
pyyaml>=6.0.1
requests>=2.31.0
pytest>=8.0.0
pytest-cov>=4.1.0
httpx>=0.27.0
"""

        now_utc = datetime.now(timezone.utc)
        now_iso = now_utc.strftime("%Y-%m-%d %H:%M:%S UTC")
        current_year = now_utc.year
        steps_list_text = ", ".join(step_names_for_readme) if step_names_for_readme else "CleanDataStep, TransformPayloadStep"

        readme_md = f"""# {project_name}

> **Enterprise Python Microservice Orchestration**  
> Auto-generado, compilado y verificado por **WPipe Studio (wisrovi SUITE)**.

---

## ⚖️ Legal Notice, Authorship & Intellectual Property Rights

> [!IMPORTANT]
> **Aviso Prioritario de Derechos de Autor y Protección de Código**  
> Este documento establece con carácter vinculante y oficial los **derechos de autor, propiedad intelectual y atribución técnica** del presente microservicio. Este archivo se encuentra protegido contra edición manual en WPipe Studio.

### Plataforma & Ecosistema de Ingeniería
- **Suite de Orquestación**: [WPipe Studio](https://github.com/wisrovi/wpipe-studio) (wisrovi SUITE) — Plataforma visual de ingeniería de microservicios y diseño modular de pipelines.
- **Motor Core**: [WPipe](https://github.com/wisrovi/wpipe) (wisrovi SUITE) >=2.5.13.
- **Fecha de Compilación**: `{now_iso}`.
- **Estándar de Generación**: Dialecto A (Contratos Pydantic Context DTOs + AST Jerárquico Topológico + wpipe-mcp).

### Autor & Atribución Profesional
- **Autor Principal**: **William Rodriguez** ([wisrovi](https://wisrovi.dev))
- **Perfil Profesional**: **AI Leader & Solutions Architect**
- **Sitio Web Oficial**: [https://wisrovi.dev](https://wisrovi.dev)
- **Ubicación**: Badajoz, Extremadura, España
- **Misión & Especialidad**: *Liderazgo en inteligencia artificial avanzada, arquitecturas cloud distribuidas y diseño de motores de orquestación de alto rendimiento.*
- **Copyright**: © {current_year} **wisrovi** ([wisrovi.dev](https://wisrovi.dev)). Todos los derechos reservados / All Rights Reserved.

### Términos de Derechos y Uso
Este componente de software y su topología de ejecución fueron diseñados y compilados bajo la infraestructura de **WPipe Studio**. Todos los patrones arquitectónicos, abstracciones de DTOs tipados, vinculaciones de estados (`@step`) y contratos de orquestación forman parte de la propiedad intelectual exclusiva de **wisrovi** ([wisrovi.dev](https://wisrovi.dev)). Queda prohibida la alteración no autorizada de metadatos de autoría y derechos protegidos.

---

## 📖 Documentación Técnica del Microservicio

### Descripción General
El microservicio `{project_name}` expone un flujo de trabajo modular asíncrono y de alto rendimiento, orquestado mediante **WPipe** y servido a través de **FastAPI**.

- **Pipeline Core**: `{project_name}` (`app/pipelines.py`)
- **Topología de Pasos Ensamblados**: {steps_list_text}.
- **Bloques de Control Soportados**: Bifurcaciones condicionales (`Condition`), bucles deterministas o continuos (`For`), ejecución concurrente (`Parallel`) y tareas desacopladas (`Background`).
- **Contratos de Datos**: Clases Pydantic en `app/dto/` con validación estricta de tipos, inmutabilidad y serialización de contexto vía `@to_obj`.

### Diagrama de Flujo (Mermaid DAG)

```mermaid
flowchart TD
    START(["🌐 Ingress (FastAPI REST: /run)"]):::startClass --> DTO["📋 PipelineContextDTO<br/>(Validación de Entrada)"]
    DTO --> PIPE["⚡ WPipe Pipeline: {project_name}"]
    PIPE --> STEPS["🔄 Topología de Pasos & Bloques de Control<br/>({steps_list_text})"]
    STEPS --> RES["🏁 PipelineResponseDTO<br/>(HTTP 200 JSON OK)"]:::endClass

    classDef startClass fill:#1e3a8a,stroke:#3b82f6,stroke-width:2px,color:#ffffff;
    classDef endClass fill:#064e3b,stroke:#10b981,stroke-width:2px,color:#ffffff;
```

### Estructura de Directorios (wpipe-mcp Architecture)

```
{project_name}/
├── app/
│   ├── config/              # Configuración y variables de entorno
│   │   ├── config.yaml      # Parámetros YAML de microservicio
│   │   └── settings.py      # Pydantic AppSettings tipado
│   ├── dto/                 # Contratos Pydantic Context DTOs (Dialecto A)
│   │   ├── context.py       # PipelineContextDTO
│   │   ├── request.py       # PipelineRequestDTO
│   │   └── response.py      # PipelineResponseDTO
│   ├── model/               # Model weights & pre-trained artifacts
│   │   └── .gitkeep
│   ├── services/            # Servicios desacoplados de dominio pesado
│   │   └── business_service.py # ProcessingService
│   ├── states/              # Clases atómicas de estados WPipe (@step)
│   │   ├── base.py          # BaseStep clase abstracta
│   │   ├── clean_data_step.py # CleanDataStep
│   │   ├── transform_payload_step.py # TransformPayloadStep
│   │   └── ai_sentiment_step.py # AISentimentStep
│   ├── test/                # Suite oficial pytest del microservicio
│   │   ├── test_dto.py      # Validación de esquemas Pydantic
│   │   ├── test_states.py   # Mutaciones y ciclo de vida de steps
│   │   ├── test_pipeline.py # Validación del grafo de pipeline
│   │   └── test_api.py      # Integración con TestClient FastAPI
│   ├── utils/               # Funciones auxiliares puras
│   │   └── helpers.py       # Generadores de ID y sanitizadores
│   ├── pipelines.py         # Topología DAG del pipeline WPipe con C-blocks
│   └── main.py              # Entrypoint FastAPI REST y ResourceMonitor
├── tests/                   # Runner estándar raíz
│   └── test_pipeline.py
├── pytest.ini               # Configuración de runner pytest y pythonpath
├── pyproject.toml           # Configuración estándar para Black, isort y mypy
├── Dockerfile               # Contenedor de producción multi-etapa
├── docker-compose.yml       # Orquestación Docker con healthcheck HTTP
├── Makefile                 # Automatización (start, stop, into, test, logs)
├── requirements.txt         # Dependencias Python bloqueadas
├── run_tests_docker.sh      # Script ejecutor que delega en 'make test'
└── wpipe.config.json        # Configuración del motor WPipe
```

### Tecnologías y Librerías Principales

- **[WPipe](https://github.com/wisrovi/wpipe) (>=2.5.13)**: Motor core de ejecución orquestada de pipelines síncronos y asíncronos con gestión de contexto y control de flujo.
- **[WPipe Steps](https://github.com/wisrovi/wpipe-steps) (>=1.0.2)**: Catálogo modular de pasos para bases de datos, conectividad y seguridad.
- **[FastAPI](https://fastapi.tiangolo.com/) & Uvicorn**: API HTTP REST asíncrona de alto rendimiento para el punto de entrada (`/run`).
- **[Pydantic v2](https://docs.pydantic.dev/)**: Validación estricta de contratos de datos e inmutabilidad de contexto.
- **[Loguru](https://github.com/Delgan/loguru)**: Registro estructurado y asíncrono de eventos de ejecución.
- **[Pytest & Pytest-Cov](https://pytest.org/)**: Suite de pruebas unitarias automatizadas con cobertura de código.
- **[Docker & Docker Compose](https://www.docker.com/)**: Contenedorización lista para producción.

---

## 🚀 Despliegue y Ejecución

### 1. Iniciar con Docker Compose (Recomendado)
```bash
# Construir y levantar el microservicio
make start

# Ver el estado y healthcheck:
make status

# Ver logs en tiempo real:
make logs

# Entrar en consola interactiva al contenedor:
make into

# Detener el microservicio:
make stop
```

### 2. Ejecución Local con Virtualenv
```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python app/main.py
```

### 3. Endpoints y Documentación Interactiva
- **Ejecutar Pipeline**: `POST /run` (Envío de payload JSON para procesar en el pipeline)
- **Comprobación de Salud**: `GET /health`
- **Documentación Swagger UI**: `http://localhost:8000/docs`
- **Especificación OpenAPI**: `http://localhost:8000/openapi.json`

### 4. Pruebas Automatizadas
```bash
# Ejecutar pruebas en Docker vía Makefile:
./run_tests_docker.sh

# O directamente:
make test

# Ejecución local con reporte de cobertura:
make pytest
```

---
*Generated by WPipe Studio by wisrovi*
"""

        dockerfile = f"""# Multi-stage Docker container for production deployment
# Generated by WPipe Studio (wisrovi SUITE)
FROM python:3.11-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \\
    PYTHONUNBUFFERED=1 \\
    PYTHONPATH=/app/app:/app \\
    SERVICE_NAME={project_name} \\
    SERVICE_VERSION=1.0.0 \\
    ROOT_PATH="{default_root_path}" \\
    ENV=production \\
    PORT=8000

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends curl make && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip && pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \\
    CMD curl -f http://localhost:8000/health || exit 1

CMD ["python", "app/main.py"]
"""

        docker_compose = f"""version: "3.8"

services:
  {project_name}:
    build:
      context: .
      dockerfile: Dockerfile
    image: wisrovi/{project_name}:latest
    container_name: {project_name}_microservice
    restart: unless-stopped
    ports:
      - "8000:8000"
    volumes:
      - ./output:/app/output
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8000/health"]
      interval: 30s
      timeout: 5s
      retries: 3
"""

        makefile = f"""# Makefile for {project_name} (WPipe Microservice)
.PHONY: help start stop restart status logs into test pytest build clean

CONTAINER_NAME={project_name}_microservice
SERVICE_NAME={project_name}

help:
\t@echo "Available commands for {project_name}:"
\t@echo "  make start     - Build and run microservice in detached Docker container"
\t@echo "  make stop      - Stop running microservice container"
\t@echo "  make restart   - Restart microservice container"
\t@echo "  make status    - View container status and healthcheck"
\t@echo "  make logs      - View container logs in real-time"
\t@echo "  make into      - Open interactive bash shell inside running container"
\t@echo "  make test      - Run automated unit and integration tests inside Docker"
\t@echo "  make pytest    - Run local pytest suite with coverage"
\t@echo "  make build     - Build production Docker image"
\t@echo "  make clean     - Remove cache, coverage artifacts, and bytecode"

start:
\tdocker compose up -d --build

stop:
\tdocker compose down

restart: stop start

status:
\tdocker compose ps
\t@curl -s http://localhost:8000/health || true

logs:
\tdocker compose logs -f $(SERVICE_NAME)

into:
\tdocker compose exec -it $(SERVICE_NAME) /bin/bash

test:
\tdocker compose run --rm $(SERVICE_NAME) pytest app/test/ -v

pytest:
\tpytest app/test/ --cov=app --cov-report=term-missing

build:
\tdocker compose build

clean:
\tfind . -type d -name "__pycache__" -exec rm -rf {{}} + 2>/dev/null || true
\tfind . -type f -name "*.pyc" -delete 2>/dev/null || true
\trm -rf .pytest_cache .coverage htmlcov output/
"""

        run_tests_docker = f"""#!/usr/bin/env bash
set -e

echo "=========================================================="
echo " Running Automated WPipe Tests via Makefile"
echo " Microservice: {project_name}"
echo "=========================================================="

make test

echo "=========================================================="
echo " Tests finished successfully in Docker! ✓"
echo "=========================================================="
"""

        wpipe_config_json = """{
  "enableBackupFile": true,
  "maxSearchFiles": 500
}
"""

        pytest_ini = """[pytest]
pythonpath = app .
testpaths = app/test tests
"""

        pyproject_toml = """[tool.pytest.ini_options]
pythonpath = ["app", "."]
testpaths = ["app/test", "tests"]

[tool.isort]
profile = "black"
known_first_party = ["config", "dto", "services", "states", "utils", "pipelines", "main", "app"]

[tool.mypy]
mypy_path = ["app"]
explicit_package_bases = true
"""

        raw_files = {
            "app/__init__.py": app_init_py,
            "app/config/__init__.py": config_init_py,
            "app/config/config.yaml": config_yaml,
            "app/config/settings.py": settings_py,
            "app/dto/__init__.py": dto_init_py,
            "app/dto/context.py": dto_context_py,
            "app/dto/request.py": dto_request_py,
            "app/dto/response.py": dto_response_py,
            "app/model/.gitkeep": "",
            "app/services/__init__.py": services_init_py,
            "app/services/business_service.py": business_service_py,
            "app/states/__init__.py": states_init_py,
            "app/states/base.py": states_base_py,
            "app/states/clean_data_step.py": clean_data_step_py,
            "app/states/transform_payload_step.py": transform_payload_step_py,
            "app/states/ai_sentiment_step.py": ai_sentiment_step_py,
            "app/test/__init__.py": f'"""Test suite package for {project_name}."""\n',
            "app/test/test_dto.py": test_dto_py,
            "app/test/test_states.py": test_states_py,
            "app/test/test_pipeline.py": test_pipeline_py,
            "app/test/test_api.py": test_api_py,
            "app/utils/__init__.py": utils_init_py,
            "app/utils/helpers.py": utils_helpers_py,
            "app/pipelines.py": pipelines_py,
            "app/main.py": main_py,
            "tests/__init__.py": '"""Root tests runner package."""\n',
            "tests/test_pipeline.py": root_test_pipeline_py,
            "pytest.ini": pytest_ini,
            "pyproject.toml": pyproject_toml,
            "Dockerfile": dockerfile,
            "docker-compose.yml": docker_compose,
            "requirements.txt": requirements_txt,
            "Makefile": makefile,
            "README.md": readme_md,
            "run_tests_docker.sh": run_tests_docker,
            "wpipe.config.json": wpipe_config_json,
        }

        # Apply isort and Black formatting deterministically to all generated Python files
        formatted_files: dict[str, str] = {}
        for path, content in raw_files.items():
            if path.endswith(".py"):
                formatted_files[path] = self._format_code(content)
            else:
                formatted_files[path] = content

        return formatted_files

    @staticmethod
    def _format_code(code: str) -> str:
        """Format Python code with isort and black deterministically.

        Args:
            code (str): Raw generated python code.

        Returns:
            str: Reformatted python code.
        """
        try:
            import isort  # type: ignore[import-untyped]
            from isort import Config  # type: ignore[import-untyped]

            isort_cfg = Config(
                profile="black",
                known_first_party=[
                    "config",
                    "dto",
                    "services",
                    "states",
                    "utils",
                    "pipelines",
                    "main",
                    "app",
                ],
                known_third_party=[
                    "fastapi",
                    "loguru",
                    "wpipe",
                    "wdecorators",
                    "pydantic",
                    "uvicorn",
                    "pytest",
                    "yaml",
                ],
            )
            code = isort.code(code, config=isort_cfg)
        except Exception:
            pass

        try:
            import black  # type: ignore[import-untyped]

            code = black.format_str(code, mode=black.FileMode())
        except Exception:
            pass

        return code
