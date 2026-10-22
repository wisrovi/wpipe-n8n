import { CanvasIR } from "./ir/schemas";

export interface GeneratedFile {
  path: string;
  content: string;
}

const DEFAULT_STEP_ARGS: Record<string, string> = {
  NmapScan: 'target="127.0.0.1"',
  NmapScanStep: 'target="127.0.0.1"',
};

/**
 * Generate a complete production-grade Python microservice from Canvas IR.
 * Features:
 * - True recursive hierarchical C-blocks (Condition, For, While, Parallel, Background) reflecting the visual canvas.
 * - Strict adherence to wpipe-mcp Architect Manual and WPipe Quality Rules.
 * - app/config/: config.yaml, settings.py, __init__.py
 * - Root config.yaml for immediate top-level visibility
 * - Dynamic and non-empty __init__.py files across all packages.
 * - Dockerfile with PYTHONUNBUFFERED=1, SERVICE_NAME, and ENV=production baked in.
 * - Makefile with start, stop, restart, status, logs, into, test, pytest, build, and clean.
 * - run_tests_docker.sh delegating directly to Makefile (`make test`).
 * - High-level executive README.md with copyright notice, technical specs, and Mermaid DAG.
 */
export function generateMicroserviceFiles(
  canvasIr: CanvasIR,
  projectName: string = "main_pipeline",
  dockerImage: string = "python:3.11-slim"
): GeneratedFile[] {
  const nodes = canvasIr.nodes || [];
  const edges = canvasIr.edges || [];

  const nodeMap = new Map<string, any>(nodes.map((n) => [n.id, n]));

  const getChildren = (parentId: string, slotType?: string): any[] => {
    return nodes.filter((n) => {
      const d = n.data || ({} as any);
      if (d.parent_id !== parentId) return false;
      if (slotType && d.slot_type !== slotType) return false;
      return true;
    });
  };

  const imports = new Set<string>([
    "from wpipe import Pipeline, Condition, For, Parallel, Background",
    "from config.settings import settings",
    "from dto.context import PipelineContextDTO",
    "from states.base import BaseStep",
    "from states.clean_data_step import CleanDataStep",
    "from states.transform_payload_step import TransformPayloadStep",
    "from states.ai_sentiment_step import AISentimentStep",
  ]);

  const stepNamesForReadme: string[] = [];

  const renderStep = (node: any, indent: number = 8): string => {
    const pad = " ".repeat(indent);
    const data = node.data || ({} as any);
    const rawType = data.node_type || node.type || "step";
    const ntype = rawType.toLowerCase();
    const label = data.label || "Step";
    const fn = data.step_name || data.func_name || label;
    const ns = data.namespace || "";

    if (ntype === "condition" || ntype.startsWith("wpipe_if") || ntype.includes("condition") || ntype.includes("if")) {
      const rawExpr = data.condition_expression || data.expression || "status_code == 200";
      const expr = rawExpr.replace(/"/g, '\\"');
      const trueKids = getChildren(node.id, "if_body");
      const falseKids = getChildren(node.id, "else_body");

      const tCode = trueKids.length > 0
        ? trueKids.map((c) => renderStep(c, indent + 4)).join(",\n")
        : `${pad}    CleanDataStep(prefix="branch_true_")`;
      const fCode = falseKids.length > 0
        ? falseKids.map((c) => renderStep(c, indent + 4)).join(",\n")
        : "";

      stepNamesForReadme.push(`Condition(${rawExpr})`);

      if (fCode) {
        return `${pad}Condition(\n${pad}    expression="${expr}",\n${pad}    branch_true=[\n${tCode},\n${pad}    ],\n${pad}    branch_false=[\n${fCode},\n${pad}    ],\n${pad})`;
      }
      return `${pad}Condition(\n${pad}    expression="${expr}",\n${pad}    branch_true=[\n${tCode},\n${pad}    ],\n${pad})`;
    }

    if (ntype === "for" || ntype === "wpipe_for" || ntype.includes("for")) {
      const iters = data.for_iterations || data.iterations || 3;
      const loopKids = getChildren(node.id, "loop_body").concat(getChildren(node.id, "if_body"));
      const lCode = loopKids.length > 0
        ? loopKids.map((c) => renderStep(c, indent + 4)).join(",\n")
        : `${pad}    TransformPayloadStep(mode="loop")`;
      stepNamesForReadme.push(`For(${iters} iterations)`);
      return `${pad}For(\n${pad}    iterations=${iters},\n${pad}    steps=[\n${lCode},\n${pad}    ],\n${pad})`;
    }

    if (ntype === "while" || ntype === "wpipe_while" || ntype.includes("while")) {
      const rawExpr = data.condition_expression || data.expression || "retry_count < 3";
      const expr = rawExpr.replace(/"/g, '\\"');
      const loopKids = getChildren(node.id, "loop_body").concat(getChildren(node.id, "if_body"));
      const lCode = loopKids.length > 0
        ? loopKids.map((c) => renderStep(c, indent + 4)).join(",\n")
        : `${pad}    TransformPayloadStep(mode="retry")`;
      stepNamesForReadme.push(`While(${rawExpr})`);
      return `${pad}For(\n${pad}    validation_expression="${expr}",\n${pad}    steps=[\n${lCode},\n${pad}    ],\n${pad})`;
    }

    if (ntype === "parallel" || ntype === "wpipe_parallel" || ntype.includes("parallel")) {
      const merge = data.merge_policy || "accumulate";
      const parKids = getChildren(node.id, "parallel_body").concat(getChildren(node.id, "if_body"));
      const pCode = parKids.length > 0
        ? parKids.map((c) => renderStep(c, indent + 4)).join(",\n")
        : `${pad}    CleanDataStep(),\n${pad}    TransformPayloadStep()`;
      stepNamesForReadme.push(`Parallel(${merge})`);
      return `${pad}Parallel(\n${pad}    steps=[\n${pCode},\n${pad}    ],\n${pad}    merge_policy="${merge}",\n${pad})`;
    }

    if (ntype === "background" || ntype === "wpipe_background" || ntype.includes("background")) {
      const bgKids = getChildren(node.id, "background_body").concat(getChildren(node.id, "loop_body"));
      const bCode = bgKids.length > 0 ? renderStep(bgKids[0], indent + 4).trim() : "TransformPayloadStep()";
      stepNamesForReadme.push("Background");
      return `${pad}Background(\n${pad}    step=${bCode},\n${pad})`;
    }

    if (ns && ns.startsWith("wpipe_steps")) {
      const stepClass = fn.endsWith("Step") ? fn : `${fn}Step`;
      imports.add(`from ${ns} import ${stepClass} as ${fn}`);
      stepNamesForReadme.push(fn);
      const argStr = DEFAULT_STEP_ARGS[fn] || "";
      return `${pad}${fn}(${argStr})`;
    }

    const fnLower = fn.toLowerCase();
    if (fnLower.includes("transform") || fn === "TransformPayloadStep") {
      imports.add("from states.transform_payload_step import TransformPayloadStep");
      stepNamesForReadme.push("TransformPayloadStep");
      const mode = data.params?.mode || "standard";
      return `${pad}TransformPayloadStep(mode="${mode}")`;
    } else if (fnLower.includes("sentiment") || fnLower.includes("ai") || fn === "AISentimentStep") {
      imports.add("from states.ai_sentiment_step import AISentimentStep");
      stepNamesForReadme.push("AISentimentStep");
      const th = data.params?.threshold ?? 0.5;
      return `${pad}AISentimentStep(threshold=${th})`;
    } else {
      imports.add("from states.clean_data_step import CleanDataStep");
      stepNamesForReadme.push("CleanDataStep");
      const pfx = data.params?.prefix || "clean_";
      return `${pad}CleanDataStep(prefix="${pfx}")`;
    }
  };

  // Detect if launcher / trigger is API mode and extract root_path / path prefix
  const triggerNode = nodes.find(
    (n) =>
      n.data?.node_type === "trigger" ||
      n.type === "wpipe_trigger" ||
      (n.data?.node_type || "").includes("trigger")
  );
  const triggerType = (triggerNode?.data?.trigger_type || "api").toLowerCase();
  const isApiTrigger = !triggerNode || ["api", "rest", "fastapi"].includes(triggerType);
  const triggerParam = (triggerNode?.data?.trigger_param || "").trim();
  let defaultRootPath = "";
  if (isApiTrigger && triggerParam.startsWith("/")) {
    defaultRootPath = triggerParam.endsWith("/run")
      ? triggerParam.replace(/\/run$/, "")
      : triggerParam;
  }

  // Filter root execution steps (exclude trigger, response, and nested child steps)
  const rootStepNodes = nodes.filter(
    (n) => {
      const raw = n.data?.node_type || n.type || "step";
      const nt = raw.toLowerCase();
      return !n.data?.parent_id && !["trigger", "response", "wpipe_trigger", "wpipe_response"].includes(nt);
    }
  );

  let stepsStr: string;
  if (rootStepNodes.length > 0) {
    stepsStr = rootStepNodes.map((n) => renderStep(n, 8)).join(",\n");
  } else {
    stepsStr = [
      "        CleanDataStep(prefix=\"clean_\"),",
      "        TransformPayloadStep(mode=\"standard\"),",
      "        AISentimentStep(threshold=0.5),",
    ].join("\n");
    stepNamesForReadme.push("CleanDataStep", "TransformPayloadStep", "AISentimentStep");
  }

  const importsStr = Array.from(imports).sort().join("\n");

  // 1. app/config/settings.py
  const settingsPy = `"""Application settings and environment configuration.

Part of the WPipe microservice architecture (wisrovi SUITE).
"""

import os
from pathlib import Path
from typing import Any

import yaml
from pydantic import BaseModel, Field


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
    return {}


_config: dict[str, Any] = _load_yaml_config()
_server_cfg: dict[str, Any] = _config.get("server", {})
_tracking_cfg: dict[str, Any] = _config.get("tracking", {})


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
        default=os.getenv(
            "SERVICE_NAME", _config.get("microservice_name", "${projectName}")
        ),
        description="Name of the microservice",
    )
    version: str = Field(
        default=os.getenv(
            "SERVICE_VERSION", os.getenv("VERSION", _config.get("version", "1.0.0"))
        ),
        description="Semantic version of the microservice",
    )
    environment: str = Field(
        default=os.getenv("ENV", _config.get("environment", "production")),
        description="Runtime environment",
    )
    debug: bool = Field(
        default=os.getenv("APP_DEBUG", str(_config.get("debug", "False"))).lower()
        == "true",
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
        default=os.getenv(
            "ROOT_PATH",
            os.getenv("API_ROOT_PATH", _server_cfg.get("root_path", "${defaultRootPath}")),
        ),
        description="FastAPI root path prefix for reverse proxy / API gateway routing",
    )
    tracking_db: str = Field(
        default=os.getenv(
            "WPIPE_TRACKING_DB", _tracking_cfg.get("db_path", "output/tracking.db")
        ),
        description="WPipe forensics SQLite database",
    )


settings: AppSettings = AppSettings()
`;

  // 2. config.yaml content
  const configYaml = `# Configuration for ${projectName} (WPipe Microservice)
microservice_name: "${projectName}"
version: "1.0.0"
environment: "production"
debug: false
server:
  host: "0.0.0.0"
  port: 8000
  root_path: "${defaultRootPath}"
tracking:
  db_path: "output/tracking.db"
  collect_system_metrics: true
`;

  // 3. app/config/__init__.py
  const configInitPy = `"""Configuration package for ${projectName}."""
from config.settings import AppSettings, settings

__all__ = ["AppSettings", "settings"]
`;

  // 4. app/dto/context.py
  const dtoContextPy = `"""Shared pipeline context Data Transfer Object.

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
`;

  // 5. app/dto/request.py
  const dtoRequestPy = `"""API request Data Transfer Object."""

from typing import Any

from pydantic import BaseModel, Field


class PipelineRequestDTO(BaseModel):
    """REST API request schema for triggering pipeline execution.

    Attributes:
        transaction_id (str | None): Optional custom transaction ID.
        payload (dict[str, Any]): Input parameters and data.
    """

    transaction_id: str | None = Field(
        default=None, description="Optional custom transaction ID"
    )
    payload: dict[str, Any] = Field(
        default_factory=dict, description="Input parameters and data"
    )
`;

  // 6. app/dto/response.py
  const dtoResponsePy = `"""API response Data Transfer Object."""

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
    data: dict[str, Any] = Field(
        default_factory=dict, description="Resulting output payload"
    )
    metrics: dict[str, Any] = Field(
        default_factory=dict, description="Execution metrics"
    )
    error: str | None = Field(default=None, description="Error message if any")
`;

  // 7. app/dto/__init__.py
  const dtoInitPy = `"""Data Transfer Objects package."""

from dto.context import PipelineContextDTO
from dto.request import PipelineRequestDTO
from dto.response import PipelineResponseDTO

__all__ = ["PipelineContextDTO", "PipelineRequestDTO", "PipelineResponseDTO"]
`;

  // 8. app/services/business_service.py
  const businessServicePy = `"""Decoupled core business and processing services.

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
        self.mode = mode
        logger.debug(f"ProcessingService initialized in mode: {mode}")

    def process_payload(self, raw_data: dict[str, Any]) -> dict[str, Any]:
        """Execute domain business logic and transformation on raw data.

        Args:
            raw_data (dict[str, Any]): Unprocessed input dictionary.

        Returns:
            dict[str, Any]: Transformed and enriched domain dictionary.
        """
        logger.info(
            f"ProcessingService executing domain payload transform (mode: {self.mode})"
        )
        transformed: dict[str, Any] = {
            "processed_by": "ProcessingService",
            "mode": self.mode,
            "items_count": len(raw_data),
        }
        for key, value in raw_data.items():
            transformed[f"proc_{key}"] = value
        return transformed
`;

  // 9. app/services/__init__.py
  const servicesInitPy = `"""Business domain services package."""

from services.business_service import ProcessingService

__all__ = ["ProcessingService"]
`;

  // 10. app/utils/helpers.py
  const utilsHelpersPy = `"""Pure helper functions for metrics sanitation and ID generation."""

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
`;

  // 11. app/utils/__init__.py
  const utilsInitPy = `"""Utility helpers package."""

from utils.helpers import generate_transaction_id, sanitize_metrics

__all__ = ["generate_transaction_id", "sanitize_metrics"]
`;

  // 12. app/states/base.py
  const statesBasePy = `"""Abstract base step for WPipe microservices."""

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
`;

  // 13. app/states/clean_data_step.py
  const cleanDataStepPy = `"""Data cleaning and sanitization step class.

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
`;

  // 14. app/states/transform_payload_step.py
  const transformPayloadStepPy = `"""Payload transformation step class.

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
        logger.info(
            f"TransformPayloadStep transforming context for tx: {ctx_dto.transaction_id}"
        )

        transformed = self.service.process_payload(ctx_dto.processed_data)
        ctx_dto.processed_data.update(transformed)
        ctx_dto.status = "TRANSFORMED"
        ctx_dto.metrics["transformed"] = True
        return ctx_dto.model_dump()
`;

  // 15. app/states/ai_sentiment_step.py
  const aiSentimentStepPy = `"""AI natural language sentiment analysis step class."""

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
        logger.info(
            f"AISentimentStep scoring sentiment for tx: {ctx_dto.transaction_id}"
        )

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
`;

  // 16. app/states/__init__.py
  const statesInitPy = `"""States package dynamically exporting all registered step classes."""

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
`;

  // 17. app/pipelines.py
  const pipelinesPy = `"""Declarative pipeline DAG construction and execution for ${projectName}.

Mandatory architecture component per WPipe Architect Manual.
"""

import os
from typing import Any

from loguru import logger
from wpipe import Background, Condition, For, Parallel, Pipeline  # type: ignore[import-untyped]

from config.settings import settings
from dto.context import PipelineContextDTO
from states.ai_sentiment_step import AISentimentStep
from states.base import BaseStep
from states.clean_data_step import CleanDataStep
from states.transform_payload_step import TransformPayloadStep

os.makedirs("output", exist_ok=True)

# 1. Declarative Pipeline Instance
pipe: Pipeline = Pipeline(pipeline_name="${projectName}")
pipe.tracking_db = settings.tracking_db
pipe.collect_system_metrics = True
pipe.show_progress = True
pipe.max_retries = 3
pipe.retry_delay = 0.5

# 2. Direct inline step assembly reflecting the visual canvas
pipe.set_steps([
${stepsStr}
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
    logger.info(f"Executing ${projectName} WPipe pipeline with transaction: {tx_id}")
    try:
        result = pipe.run(payload)
        logger.info("Pipeline execution completed successfully")
        return result
    except Exception as err:
        logger.error(f"Error executing ${projectName}: {err}")
        return {"error": str(err), "status": "failed"}


if __name__ == "__main__":
    test_payload = {"transaction_id": "test_run", "input_data": {"mode": "direct"}}
    res = execute_pipeline(test_payload)
    print("Execution result:", res)
`;

  // 18. app/main.py
  const mainPy = `"""Microservice main entrypoint: FastAPI REST API & event listener.

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
`;

  // 19. app/__init__.py
  const appInitPy = `"""Application package for ${projectName}.
Provides package exports and pipeline build helper functions.
"""
__version__ = "1.0.0"
__author__ = "William Rodriguez (wisrovi)"

from pipelines import build_pipeline, execute_pipeline

__all__ = ["build_pipeline", "execute_pipeline", "__version__", "__author__"]
`;

  // 20. app/test/test_dto.py
  const testDtoPy = `"""Unit tests for Pydantic Data Transfer Objects."""

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
`;

  // 21. app/test/test_states.py
  const testStatesPy = `"""Unit tests for WPipe Step classes."""

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
`;

  // 22. app/test/test_pipeline.py
  const testPipelinePy = `"""Integration test for declarative pipeline execution."""

from pipelines import build_pipeline, execute_pipeline


def test_build_pipeline() -> None:
    """Verify declarative pipeline instantiation and configuration."""
    pipe = build_pipeline()
    assert pipe is not None
    assert pipe.pipeline_name == "${projectName}"


def test_execute_pipeline_success() -> None:
    """Verify complete pipeline execution mutates payload correctly."""
    payload = {
        "transaction_id": "tx_test_456",
        "input_data": {"user_id": 42, "text": "excellent"},
    }
    result = execute_pipeline(payload)
    assert result.get("status") in (
        "CLEANED",
        "TRANSFORMED",
        "SCORED",
        "success",
        "PENDING",
    )
    assert "transaction_id" in result
`;

  // 23. app/test/test_api.py
  const testApiPy = `"""FastAPI endpoint integration tests."""

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
`;

  // 24. Root tests/test_pipeline.py (Standard root runner compatibility)
  const rootTestPipelinePy = `"""Root runner for pipeline tests."""

from pipelines import build_pipeline, execute_pipeline

__all__ = ["test_build_pipeline", "test_execute_pipeline_success"]
`;

  // 25. Dockerfile
  const dockerfile = `# Multi-stage Docker container for production deployment
# Generated by WPipe Studio (wisrovi SUITE)
FROM ${dockerImage} AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \\
    PYTHONUNBUFFERED=1 \\
    PYTHONPATH=/app/app:/app \\
    SERVICE_NAME=${projectName} \\
    SERVICE_VERSION=1.0.0 \\
    ROOT_PATH="${defaultRootPath}" \\
    ENV=production \\
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

  // 26. docker-compose.yml (environment variables baked into Dockerfile)
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
    volumes:
      - ./output:/app/output
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8000/health"]
      interval: 30s
      timeout: 5s
      retries: 3
`;

  // 27. requirements.txt
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

  // 28. Makefile with start, stop, into, etc.
  const makefile = `# Makefile for ${projectName} (WPipe Microservice)
.PHONY: help start stop restart status logs into test pytest build clean

CONTAINER_NAME=${projectName}_microservice
SERVICE_NAME=${projectName}

help:
	@echo "Available commands for ${projectName}:"
	@echo "  make start     - Build and run microservice in detached Docker container"
	@echo "  make stop      - Stop running microservice container"
	@echo "  make restart   - Restart microservice container"
	@echo "  make status    - View container status and healthcheck"
	@echo "  make logs      - View container logs in real-time"
	@echo "  make into      - Open interactive bash shell inside running container"
	@echo "  make test      - Run automated unit and integration tests inside Docker"
	@echo "  make pytest    - Run local pytest suite with coverage"
	@echo "  make build     - Build production Docker image"
	@echo "  make clean     - Remove cache, coverage artifacts, and bytecode"

start:
	docker compose up -d --build

stop:
	docker compose down

restart: stop start

status:
	docker compose ps
	@curl -s http://localhost:8000/health || true

logs:
	docker compose logs -f $(SERVICE_NAME)

into:
	docker compose exec -it $(SERVICE_NAME) /bin/bash

test:
	docker compose run --rm $(SERVICE_NAME) pytest app/test/ -v

pytest:
	pytest app/test/ --cov=app --cov-report=term-missing

build:
	docker compose build

clean:
	find . -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null || true
	find . -type f -name "*.pyc" -delete 2>/dev/null || true
	rm -rf .pytest_cache .coverage htmlcov output/
`;

  // 29. Executive level README.md with Legal notice, William Rodriguez attribution, specs & Mermaid DAG
  const stepsListText = stepNamesForReadme.length > 0 ? stepNamesForReadme.join(", ") : "CleanDataStep, TransformPayloadStep";
  const nowIso = new Date().toISOString();
  const currentYear = new Date().getFullYear();

  const readmeMd = `# ${projectName}

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
- **Fecha de Compilación**: \`${nowIso}\`.
- **Estándar de Generación**: Dialecto A (Contratos Pydantic Context DTOs + AST Jerárquico Topológico + wpipe-mcp).

### Autor & Atribución Profesional
- **Autor Principal**: **William Rodriguez** ([wisrovi](https://wisrovi.dev))
- **Perfil Profesional**: **AI Leader & Solutions Architect**
- **Sitio Web Oficial**: [https://wisrovi.dev](https://wisrovi.dev)
- **Ubicación**: Badajoz, Extremadura, España
- **Misión & Especialidad**: *Liderazgo en inteligencia artificial avanzada, arquitecturas cloud distribuidas y diseño de motores de orquestación de alto rendimiento.*
- **Copyright**: © ${currentYear} **wisrovi** ([wisrovi.dev](https://wisrovi.dev)). Todos los derechos reservados / All Rights Reserved.

### Términos de Derechos y Uso
Este componente de software y su topología de ejecución fueron diseñados y compilados bajo la infraestructura de **WPipe Studio**. Todos los patrones arquitectónicos, abstracciones de DTOs tipados, vinculaciones de estados (\`@step\`) y contratos de orquestación forman parte de la propiedad intelectual exclusiva de **wisrovi** ([wisrovi.dev](https://wisrovi.dev)). Queda prohibida la alteración no autorizada de metadatos de autoría y derechos protegidos.

---

## 📖 Documentación Técnica del Microservicio

### Descripción General
El microservicio \`${projectName}\` expone un flujo de trabajo modular asíncrono y de alto rendimiento, orquestado mediante **WPipe** y servido a través de **FastAPI**.

- **Pipeline Core**: \`${projectName}\` (\`app/pipelines.py\`)
- **Topología de Pasos Ensamblados**: ${stepsListText}.
- **Bloques de Control Soportados**: Bifurcaciones condicionales (\`Condition\`), bucles deterministas o continuos (\`For\`), ejecución concurrente (\`Parallel\`) y tareas desacopladas (\`Background\`).
- **Contratos de Datos**: Clases Pydantic en \`app/dto/\` con validación estricta de tipos, inmutabilidad y serialización de contexto vía \`@to_obj\`.

### Diagrama de Flujo (Mermaid DAG)

\`\`\`mermaid
flowchart LR
    ING(["🌐 Ingress REST: /run"]):::startClass --> DTO["📋 PipelineContextDTO"]
    DTO --> PIPE["⚡ WPipe: ${projectName}"]
    PIPE --> STEPS["🔄 Pipeline Steps"]
    STEPS --> RES(["🏁 Response: HTTP 200"]):::endClass

    classDef startClass fill:#1e3a8a,stroke:#38bdf8,stroke-width:1.5px,color:#ffffff;
    classDef endClass fill:#064e3b,stroke:#34d399,stroke-width:1.5px,color:#ffffff;
    classDef default fill:#1e293b,stroke:#475569,stroke-width:1.5px,color:#f8fafc;
\`\`\`

### Estructura de Directorios (wpipe-mcp Architecture)

\`\`\`
${projectName}/
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
\`\`\`

### Tecnologías y Librerías Principales

- **[WPipe](https://github.com/wisrovi/wpipe) (>=2.5.13)**: Motor core de ejecución orquestada de pipelines síncronos y asíncronos con gestión de contexto y control de flujo.
- **[WPipe Steps](https://github.com/wisrovi/wpipe-steps) (>=1.0.2)**: Catálogo modular de pasos para bases de datos, conectividad y seguridad.
- **[FastAPI](https://fastapi.tiangolo.com/) & Uvicorn**: API HTTP REST asíncrona de alto rendimiento para el punto de entrada (\`/run\`).
- **[Pydantic v2](https://docs.pydantic.dev/)**: Validación estricta de contratos de datos e inmutabilidad de contexto.
- **[Loguru](https://github.com/Delgan/loguru)**: Registro estructurado y asíncrono de eventos de ejecución.
- **[Pytest & Pytest-Cov](https://pytest.org/)**: Suite de pruebas unitarias automatizadas con cobertura de código.
- **[Docker & Docker Compose](https://www.docker.com/)**: Contenedorización lista para producción.

---

## 🚀 Despliegue y Ejecución

### 1. Iniciar con Docker Compose (Recomendado)
\`\`\`bash
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
\`\`\`

### 2. Ejecución Local con Virtualenv
\`\`\`bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python app/main.py
\`\`\`

### 3. Endpoints y Documentación Interactiva
- **Ejecutar Pipeline**: \`POST /run\` (Envío de payload JSON para procesar en el pipeline)
- **Comprobación de Salud**: \`GET /health\`
- **Documentación Swagger UI**: \`http://localhost:8000/docs\`
- **Especificación OpenAPI**: \`http://localhost:8000/openapi.json\`

### 4. Pruebas Automatizadas
\`\`\`bash
# Ejecutar pruebas en Docker vía Makefile:
./run_tests_docker.sh

# O directamente:
make test

# Ejecución local con reporte de cobertura:
make pytest
\`\`\`

---
*Generated by WPipe Studio by wisrovi*
`;

  // 30. run_tests_docker.sh delegating to Makefile
  const runTestsDockerSh = `#!/usr/bin/env bash
set -e

echo "=========================================================="
echo " Running Automated WPipe Tests via Makefile"
echo " Microservice: ${projectName}"
echo "=========================================================="

make test

echo "=========================================================="
echo " Tests finished successfully in Docker! ✓"
echo "=========================================================="
`;

  // 31. pytest.ini
  const pytestIni = `[pytest]
pythonpath = app .
testpaths = app/test tests
`;

  // 32. pyproject.toml
  const pyprojectToml = `[tool.pytest.ini_options]
pythonpath = ["app", "."]
testpaths = ["app/test", "tests"]

[tool.isort]
profile = "black"
known_first_party = ["config", "dto", "services", "states", "utils", "pipelines", "main", "app"]

[tool.mypy]
mypy_path = ["app"]
explicit_package_bases = true
`;

  // 33. wpipe.config.json
  const wpipeConfigJson = `{
  "enableBackupFile": true,
  "maxSearchFiles": 500
}
`;

  return [
    { path: "app/__init__.py", content: appInitPy },
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
    { path: "pytest.ini", content: pytestIni },
    { path: "pyproject.toml", content: pyprojectToml },
    { path: "Dockerfile", content: dockerfile },
    { path: "docker-compose.yml", content: dockerCompose },
    { path: "requirements.txt", content: requirementsTxt },
    { path: "Makefile", content: makefile },
    { path: "README.md", content: readmeMd },
    { path: "run_tests_docker.sh", content: runTestsDockerSh },
    { path: "wpipe.config.json", content: wpipeConfigJson },
  ];
}
