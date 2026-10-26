"""Application settings and environment configuration.

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
        default=os.getenv("SERVICE_NAME", _config.get("microservice_name", "main_pipeline")),
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
        default=os.getenv("ROOT_PATH", os.getenv("API_ROOT_PATH", _server_cfg.get("root_path", ""))),
        description="FastAPI root path prefix for reverse proxy / API gateway routing",
    )
    tracking_db: str = Field(
        default=os.getenv("WPIPE_TRACKING_DB", _tracking_cfg.get("db_path", "output/tracking.db")),
        description="WPipe forensics SQLite database",
    )


settings: AppSettings = AppSettings()
