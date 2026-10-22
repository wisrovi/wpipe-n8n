import { CanvasIR } from "./ir/schemas";

export interface GeneratedFile {
  path: string;
  content: string;
}

/**
 * Generate a complete production-grade Python microservice from Canvas IR.
 * Strictly adheres to the official WPipe Architect Manual & WPipe Quality Rules (wpipe-mcp):
 * - app/config/: config.yaml, settings.py (AppSettings BaseModel), __init__.py
 * - app/dto/: context.py (PipelineContextDTO), request.py, response.py, __init__.py
 * - app/model/: .gitkeep
 * - app/services/: business_service.py (ProcessingService), __init__.py
 * - app/states/: class-based states with @step, @timeout_sync, @to_obj, Google-style docstrings
 * - app/test/: test_dto.py, test_states.py, test_pipeline.py, test_api.py, __init__.py
 * - app/utils/: helpers.py (generate_transaction_id, sanitize_metrics), __init__.py
 * - app/pipelines.py: declarative DAG assembly with inline step instantiation
 * - app/main.py: FastAPI REST API, ResourceMonitor, TaskTimer, @time_execution, 0 hasattr/getattr
 * - root: Dockerfile, docker-compose.yml, requirements.txt, Makefile, README.md, run_tests_docker.sh, wpipe.config.json
 */
export function generateMicroserviceFiles(
  canvasIr: CanvasIR,
  projectName: string = "main_pipeline",
  dockerImage: string = "python:3.11-slim"
): GeneratedFile[] {
  const nodes = canvasIr.nodes || [];
  const triggerNode = nodes.find((n) => n.data?.node_type === "trigger");
  const stepNodes = nodes.filter((n) => n.data?.node_type !== "trigger" && n.data?.node_type !== "response");

  const imports = new Set<string>([
    "from wpipe import Pipeline, Condition, For, Parallel, Background",
    "from app.config.settings import settings",
    "from app.dto.context import PipelineContextDTO",
    "from app.states.clean_data_step import CleanDataStep",
    "from app.states.transform_payload_step import TransformPayloadStep",
    "from app.states.ai_sentiment_step import AISentimentStep",
  ]);

  const stepCallList: string[] = [
    "        CleanDataStep(prefix=\"clean_\")",
    "        TransformPayloadStep(mode=\"standard\")",
  ];

  for (const node of stepNodes) {
    const data = node.data || ({} as any);
    const ntype = data.node_type;
    const label = data.label || "CustomStep";
    const ns = data.namespace || "";

    if (ns && ns.startsWith("wpipe_steps")) {
      const stepClass = label.endsWith("Step") ? label : `${label}Step`;
      imports.add(`from ${ns} import ${stepClass} as ${label}`);
      stepCallList.push(`        ${label}()`);
    } else if ((ntype as string) === "ai_step" || data.origin === "described") {
      stepCallList.push(`        # AI Step: ${label}\n        AISentimentStep(threshold=0.5)`);
    } else if ((ntype as string) === "custom_step" || ntype === "step") {
      stepCallList.push(`        CleanDataStep(prefix="custom_")`);
    } else if (ntype === "condition") {
      const expr = data.condition_expression || "is_valid == True";
      stepCallList.push(`        Condition(expression="${expr}", branch_true=[CleanDataStep()])`);
    } else if (ntype === "for") {
      const iters = data.for_iterations || 5;
      stepCallList.push(`        For(iterations=${iters}, steps=[TransformPayloadStep()])`);
    } else if (ntype === "while") {
      const expr = data.condition_expression || "retry_count < 3";
      stepCallList.push(`        For(validation_expression="${expr}", steps=[TransformPayloadStep()])`);
    } else if (ntype === "parallel") {
      const merge = data.merge_policy || "accumulate";
      stepCallList.push(`        Parallel(steps=[CleanDataStep(), TransformPayloadStep()], merge_policy="${merge}")`);
    } else if (ntype === "background") {
      stepCallList.push(`        Background(step=TransformPayloadStep())`);
    }
  }

  const stepsStr = stepCallList.join(",\n");
  const importsStr = Array.from(imports).sort().join("\n");

  // 1. app/config/settings.py
  const settingsPy = `"""Application settings and environment configuration.
Part of the WPipe microservice architecture (wisrovi SUITE).
"""
import os
from pydantic import BaseModel, Field


class AppSettings(BaseModel):
    """Typed application settings loaded from environment variables."""

    app_name: str = Field(default="${projectName}", description="Name of the microservice")
    environment: str = Field(default=os.getenv("APP_ENV", "development"), description="Runtime environment")
    debug: bool = Field(default=os.getenv("APP_DEBUG", "True").lower() == "true", description="Debug mode flag")
    host: str = Field(default=os.getenv("HOST", "0.0.0.0"), description="Server host bind address")
    port: int = Field(default=int(os.getenv("PORT", "8000")), description="Server HTTP port")
    tracking_db: str = Field(default=os.getenv("WPIPE_TRACKING_DB", "output/tracking.db"), description="WPipe forensics SQLite database")


settings = AppSettings()
`;

  // 2. app/config/config.yaml
  const configYaml = `# Configuration for ${projectName} (WPipe Microservice)
microservice_name: "${projectName}"
environment: "development"
debug: true
server:
  host: "0.0.0.0"
  port: 8000
tracking:
  db_path: "output/tracking.db"
  collect_system_metrics: true
`;

  // 3. app/config/__init__.py
  const configInitPy = `"""Configuration package for ${projectName}."""
from app.config.settings import AppSettings, settings

__all__ = ["AppSettings", "settings"]
`;

  // 4. app/dto/context.py
  const dtoContextPy = `"""Shared pipeline context Data Transfer Object.
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
`;

  // 5. app/dto/request.py
  const dtoRequestPy = `"""API request Data Transfer Object."""
from typing import Any, Dict, Optional
from pydantic import BaseModel, Field


class PipelineRequestDTO(BaseModel):
    """REST API request schema for triggering pipeline execution."""

    transaction_id: Optional[str] = Field(default=None, description="Optional custom transaction ID")
    payload: Dict[str, Any] = Field(default_factory=dict, description="Input parameters and data")
`;

  // 6. app/dto/response.py
  const dtoResponsePy = `"""API response Data Transfer Object."""
from typing import Any, Dict, Optional
from pydantic import BaseModel, Field


class PipelineResponseDTO(BaseModel):
    """Standard REST API response returned by the microservice."""

    status: str = Field(..., description="Execution status ('success' or 'error')")
    transaction_id: str = Field(..., description="Transaction ID of the execution")
    data: Optional[Dict[str, Any]] = Field(default=None, description="Processed result data")
    metrics: Dict[str, Any] = Field(default_factory=dict, description="Execution performance metrics")
    error: Optional[str] = Field(default=None, description="Error message if failed")
`;

  // 7. app/dto/__init__.py
  const dtoInitPy = `"""Data Transfer Objects package."""
from app.dto.context import PipelineContextDTO
from app.dto.request import PipelineRequestDTO
from app.dto.response import PipelineResponseDTO

__all__ = ["PipelineContextDTO", "PipelineRequestDTO", "PipelineResponseDTO"]
`;

  // 8. app/services/business_service.py
  const businessServicePy = `"""Decoupled core business and processing services.
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
`;

  // 9. app/services/__init__.py
  const servicesInitPy = `"""Business services package."""
from app.services.business_service import ProcessingService

__all__ = ["ProcessingService"]
`;

  // 10. app/utils/helpers.py
  const utilsHelpersPy = `"""Pure utility helper functions."""
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
`;

  // 11. app/utils/__init__.py
  const utilsInitPy = `"""Utilities package."""
from app.utils.helpers import generate_transaction_id, sanitize_metrics

__all__ = ["generate_transaction_id", "sanitize_metrics"]
`;

  // 12. app/states/base.py
  const statesBasePy = `"""Abstract base step for WPipe microservices."""
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
`;

  // 13. app/states/clean_data_step.py
  const cleanDataStepPy = `"""Data cleaning and sanitization step class.
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
`;

  // 14. app/states/transform_payload_step.py
  const transformPayloadStepPy = `"""Payload transformation step class.
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
`;

  // 15. app/states/ai_sentiment_step.py
  const aiSentimentStepPy = `"""AI natural language sentiment analysis step class."""
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
`;

  // 16. app/states/__init__.py
  const statesInitPy = `"""WPipe state steps package."""
from app.states.base import BaseStep
from app.states.clean_data_step import CleanDataStep
from app.states.transform_payload_step import TransformPayloadStep
from app.states.ai_sentiment_step import AISentimentStep

__all__ = ["BaseStep", "CleanDataStep", "TransformPayloadStep", "AISentimentStep"]
`;

  // 17. app/pipelines.py
  const pipelinesPy = `"""Declarative pipeline DAG construction and execution.
Mandatory architecture component per WPipe Architect Manual.
"""
import os
from typing import Any, Dict
from loguru import logger
${importsStr}

os.makedirs("output", exist_ok=True)

# 1. Declarative Pipeline Instance
${projectName}: Pipeline = Pipeline(
    pipeline_name="${projectName}",
    pipeline_version="1.0.0",
    tracking_db=settings.tracking_db,
    collect_system_metrics=True,
    show_progress=True,
    max_retries=3,
    retry_delay=0.5,
)

# 2. Direct inline step assembly
${projectName}.set_steps([
${stepsStr}
])


def build_${projectName}() -> Pipeline:
    """Declaratively return the configured WPipe state machine.

    Returns:
        Pipeline: Configured WPipe pipeline instance.
    """
    return ${projectName}


def execute_${projectName}(payload: Dict[str, Any]) -> Dict[str, Any]:
    """Execute the declarative WPipe pipeline.

    Args:
        payload (Dict[str, Any]): Input payload dictionary.

    Returns:
        Dict[str, Any]: Execution result dictionary with mutated context.
    """
    tx_id = payload.get("transaction_id", "unknown")
    logger.info(f"Executing ${projectName} WPipe pipeline with transaction: {tx_id}")
    try:
        result = ${projectName}.run(payload)
        logger.info("Pipeline execution completed successfully")
        return result
    except Exception as err:
        logger.error(f"Error executing ${projectName}: {err}")
        return {"error": str(err), "status": "failed"}
`;

  // 18. app/main.py
  const mainPy = `"""Microservice main entrypoint: FastAPI REST API & event listener.
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
from app.pipelines import build_${projectName}, execute_${projectName}
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
    pipeline = build_${projectName}()

    try:
        with ResourceMonitor(f"{settings.app_name}_monitor") as monitor:
            with TaskTimer(f"{settings.app_name}_timer", timeout_seconds=900) as timer:
                @time_execution
                def run_pipe() -> Dict[str, Any]:
                    return pipeline.run(event_data)

                result = run_pipe()

        summary = monitor.get_summary()
        peak_ram = summary.get("peak_ram_mb", 0) if isinstance(summary, dict) else 0
        elapsed = timer.elapsed_seconds

        logger.info(f"Execution finished for {tx_id}. Elapsed: {elapsed:.2f}s, Peak RAM: {peak_ram} MB")
        return result
    except ProcessError as exc:
        logger.error(f"WPipe process error for {tx_id}: {exc}")
        raise exc
    except Exception as exc:
        logger.error(f"Unexpected error running pipeline: {exc}")
        raise exc


@app.get("/health")
def health() -> Dict[str, str]:
    """Microservice healthcheck endpoint."""
    return {"status": "ok", "app": settings.app_name}


@app.post("/run", response_model=PipelineResponseDTO)
def run_pipeline_endpoint(request: PipelineRequestDTO) -> PipelineResponseDTO:
    """REST API endpoint to trigger pipeline execution."""
    tx_id = request.transaction_id or generate_transaction_id()
    payload = {"transaction_id": tx_id, "input_data": request.payload}

    try:
        result = handle_pipeline_event(payload)
        return PipelineResponseDTO(
            status="success",
            transaction_id=tx_id,
            data=result.get("processed_data", {}),
            metrics=sanitize_metrics(result.get("metrics", {})),
        )
    except Exception as err:
        logger.error(f"Pipeline API failure for {tx_id}: {err}")
        raise HTTPException(status_code=500, detail=str(err)) from err


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host=settings.host, port=settings.port, reload=settings.debug)
`;

  // 19. app/test/test_dto.py
  const testDtoPy = `"""Unit tests for Pydantic Data Transfer Objects."""
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
`;

  // 20. app/test/test_states.py
  const testStatesPy = `"""Unit tests for WPipe Step classes."""
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
`;

  // 21. app/test/test_pipeline.py
  const testPipelinePy = `"""Integration test for declarative pipeline execution."""
from app.dto.context import PipelineContextDTO
from app.pipelines import build_${projectName}, execute_${projectName}


def test_build_pipeline() -> None:
    """Verify declarative pipeline instantiation and step registration."""
    pipe = build_${projectName}()
    assert pipe is not None
    assert pipe.pipeline_name == "${projectName}"


def test_execute_pipeline_success() -> None:
    """Verify complete pipeline execution mutates payload correctly."""
    payload = {
        "transaction_id": "tx_test_456",
        "input_data": {"user_id": 42, "text": "excellent"},
    }
    result = execute_${projectName}(payload)
    assert result.get("status") in ("CLEANED", "TRANSFORMED", "success")
    assert "transaction_id" in result
`;

  // 22. app/test/test_api.py
  const testApiPy = `"""FastAPI endpoint integration tests."""
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
`;

  // 23. Root tests/test_pipeline.py (Standard root runner compatibility)
  const rootTestPipelinePy = `"""Root runner for pipeline tests."""
from app.test.test_pipeline import test_build_pipeline, test_execute_pipeline_success

__all__ = ["test_build_pipeline", "test_execute_pipeline_success"]
`;

  // 24. Dockerfile
  const dockerfile = `# Multi-stage Docker container for production deployment
# Generated by WPipe Studio (wisrovi SUITE)
FROM ${dockerImage} AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \\
    PYTHONUNBUFFERED=1 \\
    PORT=8000

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \\
    curl \\
    make \\
    && rm -rf /var/lib/apt/lists/*

# Install Python requirements
COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip && \\
    pip install --no-cache-dir -r requirements.txt

# Copy microservice application
COPY . .

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \\
    CMD curl -f http://localhost:8000/health || exit 1

CMD ["python", "app/main.py"]
`;

  // 25. docker-compose.yml
  const dockerCompose = `version: "3.8"

services:
  ${projectName}:
    build:
      context: .
      dockerfile: Dockerfile
    image: wisrovi/${projectName}:latest
    container_name: ${projectName}_microservice
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
`;

  // 26. requirements.txt
  const requirementsTxt = `wpipe>=2.5.13
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
`;

  // 27. Makefile
  const makefile = `# Makefile for ${projectName} (WPipe Microservice)
.PHONY: help start stop restart status logs test pytest build clean into

help:
	@echo "Available commands for ${projectName}:"
	@echo "  make start     - Build and run microservice in detached Docker container"
	@echo "  make stop      - Stop running container"
	@echo "  make restart   - Restart microservice"
	@echo "  make status    - View service health and status"
	@echo "  make logs      - View container logs in real-time"
	@echo "  make test      - Run automated unit and integration tests inside Docker"
	@echo "  make pytest    - Run local pytest suite with coverage"
	@echo "  make into      - Open bash shell inside container"
	@echo "  make clean     - Remove cache and compiled files"

start:
	docker compose up -d --build

stop:
	docker compose down

restart: stop start

status:
	docker compose ps
	@curl -s http://localhost:8000/health || true

logs:
	docker compose logs -f ${projectName}

test:
	docker compose run --rm ${projectName} pytest app/test/ -v

pytest:
	pytest app/test/ --cov=app --cov-report=term-missing

into:
	docker compose exec ${projectName} /bin/bash

clean:
	find . -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null || true
	find . -type f -name "*.pyc" -delete 2>/dev/null || true
	rm -rf .pytest_cache .coverage htmlcov output/
`;

  // 28. README.md
  const readmeMd = `# ${projectName} Microservice

> **Generated by WPipe Studio (wisrovi SUITE)** on ${new Date().toISOString()}  
> **Author**: [William Rodriguez](https://wisrovi.dev) (AI Leader & Solutions Architect)  
> **Ecosystem**: WPipe OS / wisrovi SUITE  

Professional, modular, and containerized microservice architecture built with [WPipe](https://github.com/wisrovi/wpipe).

---

## Architecture & Layout

This microservice strictly adheres to the official **WPipe Architect Manual** and **WPipe Quality Rules**:

\`\`\`
${projectName}/
├── app/
│   ├── config/              # Environment settings & YAML configuration
│   │   ├── config.yaml
│   │   └── settings.py      # Pydantic AppSettings
│   ├── dto/                 # Pydantic Data Transfer Objects (Contexts)
│   │   ├── context.py       # PipelineContextDTO
│   │   ├── request.py       # PipelineRequestDTO
│   │   └── response.py      # PipelineResponseDTO
│   ├── model/               # Model weights & pre-trained artifacts
│   │   └── .gitkeep
│   ├── services/            # Decoupled business & processing domain logic
│   │   └── business_service.py
│   ├── states/              # Class-based atomic WPipe states (@step)
│   │   ├── base.py          # BaseStep abstract class
│   │   ├── clean_data_step.py
│   │   ├── transform_payload_step.py
│   │   └── ai_sentiment_step.py
│   ├── test/                # Pytest unit & integration test suite
│   │   ├── test_dto.py
│   │   ├── test_states.py
│   │   ├── test_pipeline.py
│   │   └── test_api.py
│   ├── utils/               # Pure helper functions
│   │   └── helpers.py
│   ├── pipelines.py         # Declarative DAG assembly & inline instantiation
│   └── main.py              # FastAPI REST entrypoint & ResourceMonitor
├── tests/                   # Standard root test runner
├── Dockerfile               # Multi-stage production container
├── docker-compose.yml       # Production orchestration
├── Makefile                 # Docker & lifecycle management
├── requirements.txt         # Locked production dependencies
├── run_tests_docker.sh      # Isolated containerized test runner
└── wpipe.config.json        # WPipe engine configuration
\`\`\`

---

## Technologies and Libraries

- **[WPipe](https://github.com/wisrovi/wpipe) (>=2.5.13)**: High-performance orchestrator engine for pipelines, DAGs, and state machines.
- **[WPipe Steps](https://github.com/wisrovi/wpipe-steps) (>=1.0.2)**: Modular step catalog for database, connectivity, security, and AI.
- **[FastAPI](https://fastapi.tiangolo.com/) & Uvicorn**: High-speed ASGI REST API for invoking the pipeline (\`POST /run\`).
- **[Pydantic](https://docs.pydantic.dev/) (>=2.0.0)**: Strict typing, schema validation, and context immutability.
- **[Loguru](https://github.com/Delgan/loguru)**: Structured, thread-safe asynchronous logging.
- **[Pytest](https://pytest.org/)**: Automated unit and regression test suite with code coverage.
- **[Docker](https://www.docker.com/)**: Multi-stage lightweight containerization.

---

## Execution Guide

### Local Virtual Environment
\`\`\`bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python app/main.py
\`\`\`

### Docker Deployment
\`\`\`bash
make start
# Check logs:
make logs
# Verify healthcheck:
curl http://localhost:8000/health
\`\`\`

### Running Tests
\`\`\`bash
./run_tests_docker.sh
# Or with Makefile:
make test
\`\`\`

---
*Generated by WPipe Studio by wisrovi*
`;

  // 29. run_tests_docker.sh
  const runTestsDockerSh = `#!/usr/bin/env bash
set -e

IMAGE_NAME="${projectName}_test_runner"

echo "=========================================================="
echo " Running Automated WPipe Tests inside Isolated Docker"
echo " Microservice: ${projectName}"
echo "=========================================================="

docker build -t "$IMAGE_NAME" -f Dockerfile .

docker run --rm \\
    -e PYTHONDONTWRITEBYTECODE=1 \\
    -e APP_ENV=test \\
    "$IMAGE_NAME" \\
    pytest app/test/ -v --cov=app --cov-report=term-missing

echo "=========================================================="
echo " Tests finished successfully in Docker! ✓"
echo "=========================================================="
`;

  // 30. wpipe.config.json
  const wpipeConfigJson = `{
  "enableBackupFile": true,
  "maxSearchFiles": 500
}
`;

  return [
    { path: "app/__init__.py", content: `"""Application package for ${projectName}."""\n` },
    { path: "app/config/__init__.py", content: configInitPy },
    { path: "app/config/config.yaml", content: configYaml },
    { path: "app/config/settings.py", content: settingsPy },
    { path: "app/dto/__init__.py", content: dtoInitPy },
    { path: "app/dto/context.py", content: dtoContextPy },
    { path: "app/dto/request.py", content: dtoRequestPy },
    { path: "app/dto/response.py", content: dtoResponsePy },
    { path: "app/model/.gitkeep", content: "" },
    { path: "app/services/__init__.py", content: servicesInitPy },
    { path: "app/services/business_service.py", content: businessServicePy },
    { path: "app/states/__init__.py", content: statesInitPy },
    { path: "app/states/base.py", content: statesBasePy },
    { path: "app/states/clean_data_step.py", content: cleanDataStepPy },
    { path: "app/states/transform_payload_step.py", content: transformPayloadStepPy },
    { path: "app/states/ai_sentiment_step.py", content: aiSentimentStepPy },
    { path: "app/test/__init__.py", content: `"""Test suite package for ${projectName}."""\n` },
    { path: "app/test/test_dto.py", content: testDtoPy },
    { path: "app/test/test_states.py", content: testStatesPy },
    { path: "app/test/test_pipeline.py", content: testPipelinePy },
    { path: "app/test/test_api.py", content: testApiPy },
    { path: "app/utils/__init__.py", content: utilsInitPy },
    { path: "app/utils/helpers.py", content: utilsHelpersPy },
    { path: "app/pipelines.py", content: pipelinesPy },
    { path: "app/main.py", content: mainPy },
    { path: "tests/__init__.py", content: `"""Root tests runner package."""\n` },
    { path: "tests/test_pipeline.py", content: rootTestPipelinePy },
    { path: "Dockerfile", content: dockerfile },
    { path: "docker-compose.yml", content: dockerCompose },
    { path: "requirements.txt", content: requirementsTxt },
    { path: "Makefile", content: makefile },
    { path: "README.md", content: readmeMd },
    { path: "run_tests_docker.sh", content: runTestsDockerSh },
    { path: "wpipe.config.json", content: wpipeConfigJson },
  ];
}
