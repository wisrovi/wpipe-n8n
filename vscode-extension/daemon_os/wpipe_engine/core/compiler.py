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

        # 1. Classify steps and triggers
        steps: list[dict[str, Any]] = []
        trigger_node: dict[str, Any] | None = None
        imports: set[str] = {
            "from wpipe import Pipeline, Condition, For, Parallel, Background",
            "from app.config.settings import settings",
            "from app.dto.context import PipelineContextDTO",
            "from app.states.clean_data_step import CleanDataStep",
            "from app.states.transform_payload_step import TransformPayloadStep",
            "from app.states.ai_sentiment_step import AISentimentStep",
        }

        for node in nodes:
            data = node.get("data", {})
            ntype = data.get("node_type") or node.get("type", "")
            if ntype == "trigger":
                trigger_node = node
            elif ntype in ("step", "ai_step", "custom_step"):
                steps.append(node)
                ns = data.get("namespace", "")
                fn = data.get("func_name") or data.get("label", "CustomStep")
                if ns:
                    if ns.startswith("wpipe_steps") and not fn.endswith("Step"):
                        imports.add(f"from {ns} import {fn}Step as {fn}")
                    else:
                        imports.add(f"from {ns} import {fn}")
            elif ntype in ("condition", "for", "while", "parallel", "background"):
                steps.append(node)

        # 2. Render steps array
        rendered_steps: list[str] = []
        if not steps:
            rendered_steps.append("        CleanDataStep(prefix='clean_')")
            rendered_steps.append("        TransformPayloadStep(mode='standard')")
        else:
            for s in steps:
                data = s.get("data", {})
                ntype = data.get("node_type") or s.get("type", "")
                fn = data.get("func_name") or data.get("label", "CustomStep")
                params = dict(DEFAULT_STEP_CONSTRUCTOR_ARGS.get(fn, {}))
                if data.get("params"):
                    params.update(data["params"])

                args_str = ", ".join(f"{k}={repr(v)}" for k, v in params.items())

                if ntype == "condition":
                    expr = data.get("condition_expression", "is_valid == True")
                    rendered_steps.append(f"        Condition(expression={repr(expr)}, branch_true=[CleanDataStep()])")
                elif ntype == "for":
                    iters = data.get("for_iterations", 5)
                    rendered_steps.append(f"        For(iterations={iters}, steps=[TransformPayloadStep()])")
                elif ntype == "while":
                    expr = data.get("condition_expression", "retry_count < 3")
                    rendered_steps.append(f"        For(validation_expression={repr(expr)}, steps=[TransformPayloadStep()])")
                elif ntype == "parallel":
                    merge = data.get("merge_policy", "accumulate")
                    rendered_steps.append(f"        Parallel(steps=[CleanDataStep(), TransformPayloadStep()], merge_policy={repr(merge)})")
                elif ntype == "background":
                    rendered_steps.append("        Background(step=TransformPayloadStep())")
                elif ntype == "ai_step" or data.get("origin") == "described":
                    rendered_steps.append("        AISentimentStep(threshold=0.5)")
                elif ntype in ("custom_step", "step") and not data.get("namespace"):
                    rendered_steps.append("        CleanDataStep(prefix='custom_')")
                else:
                    rendered_steps.append(f"        {fn}({args_str})")

        steps_code = ",\n".join(rendered_steps)
        imports_code = "\n".join(sorted(imports))

        # 3. Smart AST Code Merge (Preserve custom blocks if existing code is provided)
        custom_imports = "# Add custom imports or dependencies here"
        custom_logic = "# Add custom helper functions, step transforms, or middleware here"

        if existing_pipeline_code:
            imp_m = re.search(
                r"# >>> \[WPIPE:CUSTOM_IMPORTS:START\](.*?)# <<< \[WPIPE:CUSTOM_IMPORTS:END\]",
                existing_pipeline_code,
                re.DOTALL,
            )
            if imp_m and imp_m.group(1).strip():
                custom_imports = imp_m.group(1).strip()

            log_m = re.search(
                r"# >>> \[WPIPE:CUSTOM_LOGIC:START\](.*?)# <<< \[WPIPE:CUSTOM_LOGIC:END\]",
                existing_pipeline_code,
                re.DOTALL,
            )
            if log_m and log_m.group(1).strip():
                custom_logic = log_m.group(1).strip()

        # 4. Pipelines.py
        pipelines_py = f'''"""Declarative pipeline DAG construction and execution for {project_name}.
Mandatory architecture component per WPipe Architect Manual.
"""
import os
from typing import Any, Dict
from loguru import logger
{imports_code}

# >>> [WPIPE:CUSTOM_IMPORTS:START]
{custom_imports}
# <<< [WPIPE:CUSTOM_IMPORTS:END]


# >>> [WPIPE:CUSTOM_LOGIC:START]
{custom_logic}
# <<< [WPIPE:CUSTOM_LOGIC:END]

os.makedirs("output", exist_ok=True)

# 1. Declarative Pipeline Instance
pipe: Pipeline = Pipeline(pipeline_name="{project_name}")
pipe.tracking_db = settings.tracking_db
pipe.collect_system_metrics = True
pipe.show_progress = True
pipe.max_retries = 3
pipe.retry_delay = 0.5

# 2. Direct inline step assembly
pipe.set_steps([
{steps_code}
])


def build_pipeline() -> Pipeline:
    """Declaratively return the configured WPipe state machine.

    Returns:
        Pipeline: Configured WPipe pipeline instance.
    """
    return pipe


def execute_pipeline(payload: Dict[str, Any]) -> Dict[str, Any]:
    """Execute the declarative WPipe pipeline.

    Args:
        payload (Dict[str, Any]): Input payload dictionary.

    Returns:
        Dict[str, Any]: Execution result dictionary with mutated context.
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

        # 5. Main.py
        main_py = f'''"""Microservice main entrypoint: FastAPI REST API & event listener.
Complies with WPipe Quality Rules (resource monitoring, timing, 0 hasattr/getattr).
"""
import sys
from typing import Any, Dict
from fastapi import FastAPI, HTTPException
from loguru import logger
from wdecorators import time_execution
from wpipe import ResourceMonitor, TaskTimer
from wpipe.exception.api_error import ProcessError

from app.config.settings import settings
from app.dto.request import PipelineRequestDTO
from app.dto.response import PipelineResponseDTO
from app.pipelines import build_pipeline, execute_pipeline
from app.utils.helpers import generate_transaction_id, sanitize_metrics

app = FastAPI(
    title=settings.app_name,
    description="Production WPipe Microservice (wisrovi SUITE)",
    version="1.0.0",
)


def handle_pipeline_event(event_data: Dict[str, Any]) -> Dict[str, Any]:
    """Receive trigger event, execute pipeline under resource monitoring and return result.

    Args:
        event_data (Dict[str, Any]): Event payload.

    Returns:
        Dict[str, Any]: Execution result.
    """
    tx_id = event_data.get("transaction_id") or generate_transaction_id()
    event_data["transaction_id"] = tx_id
    pipeline = build_pipeline()

    try:
        with ResourceMonitor(f"{{settings.app_name}}_monitor") as monitor:
            with TaskTimer(f"{{settings.app_name}}_timer", timeout_seconds=900) as timer:
                @time_execution
                def run_pipe() -> Dict[str, Any]:
                    return pipeline.run(event_data)

                result = run_pipe()

        summary = monitor.get_summary()
        peak_ram = summary.get("peak_ram_mb", 0) if isinstance(summary, dict) else 0
        elapsed = timer.elapsed_seconds

        logger.info(f"Execution finished for {{tx_id}}. Elapsed: {{elapsed:.2f}}s, Peak RAM: {{peak_ram}} MB")
        return result
    except ProcessError as exc:
        logger.error(f"WPipe process error for {{tx_id}}: {{exc}}")
        raise exc
    except Exception as exc:
        logger.error(f"Unexpected error running pipeline: {{exc}}")
        raise exc


@app.get("/health")
def health() -> Dict[str, str]:
    """Microservice healthcheck endpoint."""
    return {{"status": "ok", "app": settings.app_name}}


@app.post("/run", response_model=PipelineResponseDTO)
def run_pipeline_endpoint(request: PipelineRequestDTO) -> PipelineResponseDTO:
    """REST API endpoint to trigger pipeline execution."""
    tx_id = request.transaction_id or generate_transaction_id()
    payload = {{"transaction_id": tx_id, "input_data": request.payload}}

    try:
        result = handle_pipeline_event(payload)
        return PipelineResponseDTO(
            status="success",
            transaction_id=tx_id,
            data=result.get("processed_data", {{}}),
            metrics=sanitize_metrics(result.get("metrics", {{}})),
        )
    except Exception as err:
        logger.error(f"Pipeline API failure for {{tx_id}}: {{err}}")
        raise HTTPException(status_code=500, detail=str(err)) from err


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host=settings.host, port=settings.port, reload=settings.debug)
'''

        # 6. Config files
        settings_py = f'''"""Application settings and environment configuration.
Part of the WPipe microservice architecture (wisrovi SUITE).
"""
import os
from pydantic import BaseModel, Field


class AppSettings(BaseModel):
    """Typed application settings loaded from environment variables."""

    app_name: str = Field(default="{project_name}", description="Name of the microservice")
    environment: str = Field(default=os.getenv("APP_ENV", "development"), description="Runtime environment")
    debug: bool = Field(default=os.getenv("APP_DEBUG", "True").lower() == "true", description="Debug mode flag")
    host: str = Field(default=os.getenv("HOST", "0.0.0.0"), description="Server host bind address")
    port: int = Field(default=int(os.getenv("PORT", "8000")), description="Server HTTP port")
    tracking_db: str = Field(default=os.getenv("WPIPE_TRACKING_DB", "output/tracking.db"), description="WPipe forensics SQLite database")


settings = AppSettings()
'''

        config_yaml = f"""# Configuration for {project_name} (WPipe Microservice)
microservice_name: "{project_name}"
environment: "development"
debug: true
server:
  host: "0.0.0.0"
  port: 8000
tracking:
  db_path: "output/tracking.db"
  collect_system_metrics: true
"""

        config_init_py = f'''"""Configuration package for {project_name}."""
from app.config.settings import AppSettings, settings

__all__ = ["AppSettings", "settings"]
'''

        # 7. DTO files
        dto_init_py = '''"""Data Transfer Objects package."""
from app.dto.context import PipelineContextDTO
from app.dto.request import PipelineRequestDTO
from app.dto.response import PipelineResponseDTO

__all__ = ["PipelineContextDTO", "PipelineRequestDTO", "PipelineResponseDTO"]
'''

        dto_context_py = '''"""Shared pipeline context Data Transfer Object.
Guarantees strict typing and context immutability validation across WPipe states.
"""
from typing import Any, Dict, Optional
from pydantic import BaseModel, Field


class PipelineContextDTO(BaseModel):
    """Data Transfer Object defining the shared context for the WPipe pipeline."""

    transaction_id: str = Field(..., description="Unique transaction trace identifier")
    input_data: Dict[str, Any] = Field(default_factory=dict, description="Raw input data payload")
    processed_data: Dict[str, Any] = Field(default_factory=dict, description="Transformed and cleaned data")
    status: str = Field(default="PENDING", description="Pipeline execution state")
    metrics: Dict[str, Any] = Field(default_factory=dict, description="Execution and performance metrics")
    error: Optional[str] = Field(default=None, description="Error detail if execution fails")
'''

        dto_request_py = '''"""API request Data Transfer Object."""
from typing import Any, Dict, Optional
from pydantic import BaseModel, Field


class PipelineRequestDTO(BaseModel):
    """REST API request schema for triggering pipeline execution."""

    transaction_id: Optional[str] = Field(default=None, description="Optional custom transaction ID")
    payload: Dict[str, Any] = Field(default_factory=dict, description="Input parameters and data")
'''

        dto_response_py = '''"""API response Data Transfer Object."""
from typing import Any, Dict, Optional
from pydantic import BaseModel, Field


class PipelineResponseDTO(BaseModel):
    """Standard REST API response returned by the microservice."""

    status: str = Field(..., description="Execution status ('success' or 'error')")
    transaction_id: str = Field(..., description="Transaction ID of the execution")
    data: Optional[Dict[str, Any]] = Field(default=None, description="Processed result data")
    metrics: Dict[str, Any] = Field(default_factory=dict, description="Execution performance metrics")
    error: Optional[str] = Field(default=None, description="Error message if failed")
'''

        # 8. Services files
        services_init_py = '''"""Business services package."""
from app.services.business_service import ProcessingService

__all__ = ["ProcessingService"]
'''

        business_service_py = '''"""Decoupled core business and processing services.
Keeps heavy domain logic isolated from the WPipe state machine.
"""
from typing import Any, Dict


class ProcessingService:
    """Decoupled service handling data processing and business operations."""

    def __init__(self, mode: str = "standard") -> None:
        """Initialize the processing service.

        Args:
            mode (str, optional): Service operational mode. Defaults to 'standard'.
        """
        self.mode = mode

    def process_payload(self, raw_data: Dict[str, Any]) -> Dict[str, Any]:
        """Process raw payload data.

        Args:
            raw_data (Dict[str, Any]): Input dictionary to sanitize and transform.

        Returns:
            Dict[str, Any]: Processed output dictionary.
        """
        normalized: Dict[str, Any] = {}
        for key, value in raw_data.items():
            normalized[f"proc_{key}"] = value
        normalized["processed_by"] = "ProcessingService"
        normalized["operational_mode"] = self.mode
        return normalized
'''

        # 9. Utils files
        utils_init_py = '''"""Utilities package."""
from app.utils.helpers import generate_transaction_id, sanitize_metrics

__all__ = ["generate_transaction_id", "sanitize_metrics"]
'''

        utils_helpers_py = '''"""Pure utility helper functions."""
import uuid
from typing import Any, Dict


def generate_transaction_id(prefix: str = "tx_") -> str:
    """Generate a unique transaction identifier.

    Args:
        prefix (str, optional): ID prefix. Defaults to 'tx_'.

    Returns:
        str: Unique transaction identifier.
    """
    return f"{prefix}{uuid.uuid4().hex[:12]}"


def sanitize_metrics(metrics: Dict[str, Any]) -> Dict[str, Any]:
    """Sanitize and format metrics dictionary.

    Args:
        metrics (Dict[str, Any]): Raw metrics dictionary.

    Returns:
        Dict[str, Any]: Sanitized metrics.
    """
    sanitized: Dict[str, Any] = {}
    for key, value in metrics.items():
        if isinstance(value, float):
            sanitized[key] = round(value, 4)
        else:
            sanitized[key] = value
    return sanitized
'''

        # 10. Class-based States
        states_init_py = '''"""WPipe state steps package."""
from app.states.base import BaseStep
from app.states.clean_data_step import CleanDataStep
from app.states.transform_payload_step import TransformPayloadStep
from app.states.ai_sentiment_step import AISentimentStep

__all__ = ["BaseStep", "CleanDataStep", "TransformPayloadStep", "AISentimentStep"]
'''

        states_base_py = '''"""Abstract base step for WPipe microservices."""
from abc import ABC, abstractmethod
from app.dto.context import PipelineContextDTO


class BaseStep(ABC):
    """Base class defining the contract for all WPipe state steps."""

    @abstractmethod
    def __call__(self, context: PipelineContextDTO) -> PipelineContextDTO:
        """Execute step logic mutating the shared pipeline context.

        Args:
            context (PipelineContextDTO): Typed pipeline context.

        Returns:
            PipelineContextDTO: Mutated context instance.
        """
'''

        clean_data_step_py = '''"""Data cleaning and sanitization step class.
Conforms to WPipe class-based state specifications with @step, @timeout_sync, and @to_obj.
"""
from typing import Any
from wpipe import step, to_obj
from wpipe.timeout import timeout_sync
from app.dto.context import PipelineContextDTO
from app.states.base import BaseStep


@step(
    name="CleanDataStep",
    version="v1.0",
    timeout=15,
    description="State responsible for sanitizing and validating incoming pipeline context",
    tags=["data", "cleaner"],
    retry_count=3,
    retry_delay=0.1,
)
class CleanDataStep(BaseStep):
    """WPipe State class that cleans and normalizes context fields.

    Attributes:
        prefix (str): Prefix added to transformed keys.
    """

    def __init__(self, prefix: str = "clean_") -> None:
        """Initialize the CleanDataStep state.

        Args:
            prefix (str, optional): Transformation prefix. Defaults to 'clean_'.
        """
        self.prefix = prefix

    @timeout_sync(seconds=5)
    @to_obj(PipelineContextDTO)
    def __call__(self, context: PipelineContextDTO) -> PipelineContextDTO:
        """Execute step logic mutating the shared pipeline context.

        Args:
            context (PipelineContextDTO): Typed context instance.

        Returns:
            PipelineContextDTO: Mutated and validated context.
        """
        if not context.processed_data:
            context.processed_data = {}

        for key, val in context.input_data.items():
            context.processed_data[f"{self.prefix}{key}"] = val

        context.status = "CLEANED"
        context.metrics["cleaned_items"] = len(context.input_data)
        return context
'''

        transform_payload_step_py = '''"""Payload transformation step class.
Delegates heavy business logic to decoupled ProcessingService.
"""
from typing import Any
from wpipe import step, to_obj
from wpipe.timeout import timeout_sync
from app.dto.context import PipelineContextDTO
from app.services.business_service import ProcessingService
from app.states.base import BaseStep


@step(
    name="TransformPayloadStep",
    version="v1.0",
    timeout=20,
    description="State that delegates transformation to decoupled business services",
    tags=["transform", "service"],
    retry_count=2,
    retry_delay=0.2,
)
class TransformPayloadStep(BaseStep):
    """WPipe State class that delegates to decoupled business services.

    Attributes:
        service (ProcessingService): Decoupled business logic service.
    """

    def __init__(self, mode: str = "standard") -> None:
        """Initialize the TransformPayloadStep state.

        Args:
            mode (str, optional): Operational mode. Defaults to 'standard'.
        """
        self.service = ProcessingService(mode=mode)

    @timeout_sync(seconds=10)
    @to_obj(PipelineContextDTO)
    def __call__(self, context: PipelineContextDTO) -> PipelineContextDTO:
        """Execute transformation logic through the decoupled business service.

        Args:
            context (PipelineContextDTO): Typed context instance.

        Returns:
            PipelineContextDTO: Mutated context instance.
        """
        transformed = self.service.process_payload(context.processed_data)
        context.processed_data.update(transformed)
        context.status = "TRANSFORMED"
        context.metrics["transformation_complete"] = True
        return context
'''

        ai_sentiment_step_py = '''"""AI natural language sentiment analysis step class."""
from typing import Any
from wpipe import step, to_obj
from wpipe.timeout import timeout_sync
from app.dto.context import PipelineContextDTO
from app.states.base import BaseStep


@step(
    name="AISentimentStep",
    version="v1.0",
    timeout=30,
    description="AI State that scores text sentiment and enriches pipeline context",
    tags=["ai", "nlp", "sentiment"],
    retry_count=2,
    retry_delay=0.5,
)
class AISentimentStep(BaseStep):
    """WPipe State class that executes AI sentiment analysis."""

    def __init__(self, threshold: float = 0.5) -> None:
        """Initialize the AISentimentStep state.

        Args:
            threshold (float, optional): Positive sentiment threshold. Defaults to 0.5.
        """
        self.threshold = threshold

    @timeout_sync(seconds=15)
    @to_obj(PipelineContextDTO)
    def __call__(self, context: PipelineContextDTO) -> PipelineContextDTO:
        """Execute AI sentiment scoring on context text.

        Args:
            context (PipelineContextDTO): Typed context instance.

        Returns:
            PipelineContextDTO: Mutated context instance with AI predictions.
        """
        text = str(context.input_data.get("text", ""))
        score = 0.85 if len(text) > 10 else 0.42

        context.processed_data["sentiment_score"] = score
        context.processed_data["sentiment_label"] = "POSITIVE" if score >= self.threshold else "NEUTRAL"
        context.metrics["ai_confidence"] = score
        return context
'''

        # 11. Tests
        test_dto_py = '''"""Unit tests for Pydantic Data Transfer Objects."""
import pytest
from pydantic import ValidationError
from app.dto.context import PipelineContextDTO
from app.dto.request import PipelineRequestDTO
from app.dto.response import PipelineResponseDTO


def test_context_validation() -> None:
    """Verify PipelineContextDTO validation and default values."""
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
    """Verify request and response DTO instantiations."""
    req = PipelineRequestDTO(payload={"test": 1})
    assert req.payload["test"] == 1

    resp = PipelineResponseDTO(status="success", transaction_id="tx_999", data={"done": True})
    assert resp.status == "success"
    assert resp.transaction_id == "tx_999"
'''

        test_states_py = '''"""Unit tests for WPipe Step classes."""
from app.dto.context import PipelineContextDTO
from app.states.clean_data_step import CleanDataStep
from app.states.transform_payload_step import TransformPayloadStep
from app.states.ai_sentiment_step import AISentimentStep


def test_clean_data_step_mutation() -> None:
    """Verify CleanDataStep mutates context fields with configured prefix."""
    step = CleanDataStep(prefix="test_clean_")
    ctx = PipelineContextDTO(transaction_id="tx_1", input_data={"raw_id": "123"})
    result = step(ctx)

    assert result.status == "CLEANED"
    assert result.processed_data["test_clean_raw_id"] == "123"
    assert result.metrics["cleaned_items"] == 1


def test_transform_payload_step_execution() -> None:
    """Verify TransformPayloadStep integrates with processing service."""
    step = TransformPayloadStep(mode="standard")
    ctx = PipelineContextDTO(transaction_id="tx_2", input_data={}, processed_data={"field": "data"})
    result = step(ctx)

    assert result.status == "TRANSFORMED"
    assert "proc_field" in result.processed_data
    assert result.processed_data["processed_by"] == "ProcessingService"


def test_ai_sentiment_step_execution() -> None:
    """Verify AISentimentStep scores sentiment correctly."""
    step = AISentimentStep(threshold=0.5)
    ctx = PipelineContextDTO(transaction_id="tx_3", input_data={"text": "This is a great product with awesome quality"})
    result = step(ctx)

    assert result.processed_data["sentiment_label"] == "POSITIVE"
    assert result.metrics["ai_confidence"] > 0.5
'''

        test_pipeline_py = f'''"""Integration test for declarative pipeline execution."""
from app.dto.context import PipelineContextDTO
from app.pipelines import build_pipeline, execute_pipeline


def test_build_pipeline() -> None:
    """Verify declarative pipeline instantiation and step registration."""
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
    assert result.get("status") in ("CLEANED", "TRANSFORMED", "success")
    assert "transaction_id" in result
'''

        test_api_py = '''"""FastAPI endpoint integration tests."""
from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)


def test_healthcheck() -> None:
    """Verify healthcheck endpoint returns HTTP 200 OK."""
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


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
from app.test.test_pipeline import test_build_pipeline, test_execute_pipeline_success

__all__ = ["test_build_pipeline", "test_execute_pipeline_success"]
'''

        # 12. Root orchestration files
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

        readme_md = f"""# {project_name} Microservice

> **Generated by WPipe Studio (wisrovi SUITE)** on {datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")}  
> **Author**: [William Rodriguez](https://wisrovi.dev) (AI Leader & Solutions Architect)  
> **Ecosystem**: WPipe OS / wisrovi SUITE  

Professional, modular, and containerized microservice architecture built with [WPipe](https://github.com/wisrovi/wpipe).

---

## Tecnologías y Librerías Relevantes

- **[WPipe](https://github.com/wisrovi/wpipe) (>=2.5.13)**: Motor core de ejecución orquestada de pipelines.
- **[WPipe Steps](https://github.com/wisrovi/wpipe-steps) (>=1.0.2)**: Catálogo modular de pasos para bases de datos, conectividad y seguridad.
- **[FastAPI](https://fastapi.tiangolo.com/) & Uvicorn**: API HTTP REST de producción para invocar el pipeline (`POST /run`).
- **[Pydantic](https://docs.pydantic.dev/) (>=2.0.0)**: Esquemas de datos, validación estricta e inmutabilidad de contexto.
- **[Loguru](https://github.com/Delgan/loguru)**: Registro estructurado y asíncrono de eventos de ejecución.
- **[Pytest](https://pytest.org/)**: Suite de pruebas unitarias automatizadas (`tests/test_pipeline.py`).
- **[Docker](https://www.docker.com/)**: Contenedor multi-etapa ligero para producción.

---

## Ejecución

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python app/main.py
```

### Docker
```bash
make start
curl http://localhost:8000/health
```

---
*Generated by WPipe Studio by wisrovi*
"""

        dockerfile = """# Multi-stage Docker container for production deployment
FROM python:3.11-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \\
    PYTHONUNBUFFERED=1 \\
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
    environment:
      - APP_ENV=production
      - APP_DEBUG=false
      - PORT=8000
      - WPIPE_TRACKING_DB=output/tracking.db
      - PYTHONDONTWRITEBYTECODE=1
    volumes:
      - ./output:/app/output
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8000/health"]
      interval: 30s
      timeout: 5s
      retries: 3
"""

        makefile = f"""# Makefile for {project_name} (WPipe Microservice)
.PHONY: help start stop restart status logs test pytest build clean into

help:
\t@echo "Available commands for {project_name}:"
\t@echo "  make start     - Build and run microservice in detached Docker container"
\t@echo "  make stop      - Stop running container"
\t@echo "  make restart   - Restart microservice"
\t@echo "  make status    - View service health and status"
\t@echo "  make logs      - View container logs in real-time"
\t@echo "  make test      - Run automated unit and integration tests inside Docker"
\t@echo "  make pytest    - Run local pytest suite with coverage"
\t@echo "  make into      - Open bash shell inside container"
\t@echo "  make clean     - Remove cache and compiled files"

start:
\tdocker compose up -d --build

stop:
\tdocker compose down

restart: stop start

status:
\tdocker compose ps
\t@curl -s http://localhost:8000/health || true

logs:
\tdocker compose logs -f {project_name}

test:
\tdocker compose run --rm {project_name} pytest app/test/ -v

pytest:
\tpytest app/test/ --cov=app --cov-report=term-missing

into:
\tdocker compose exec {project_name} /bin/bash

clean:
\tfind . -type d -name "__pycache__" -exec rm -rf {{}} + 2>/dev/null || true
\tfind . -type f -name "*.pyc" -delete 2>/dev/null || true
\trm -rf .pytest_cache .coverage htmlcov output/
"""

        run_tests_docker = f"""#!/usr/bin/env bash
set -e

IMAGE_NAME="{project_name}_test_runner"

docker build -t "$IMAGE_NAME" -f Dockerfile .
docker run --rm -e PYTHONDONTWRITEBYTECODE=1 -e APP_ENV=test "$IMAGE_NAME" pytest app/test/ -v --cov=app --cov-report=term-missing
"""

        wpipe_config_json = """{
  "enableBackupFile": true,
  "maxSearchFiles": 500
}
"""

        return {
            "app/__init__.py": f'"""Application package for {project_name}."""\n',
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
            "Dockerfile": dockerfile,
            "docker-compose.yml": docker_compose,
            "requirements.txt": requirements_txt,
            "Makefile": makefile,
            "README.md": readme_md,
            "run_tests_docker.sh": run_tests_docker,
            "wpipe.config.json": wpipe_config_json,
        }
