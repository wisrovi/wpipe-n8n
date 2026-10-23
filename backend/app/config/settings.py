"""Database and Application Configuration following wpipe-mcp and wpostgresql standards."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


@dataclass
class DatabaseSettings:
    """PostgreSQL connection settings for WPostgreSQL repository layer."""

    dbname: str
    user: str
    password: str
    host: str
    port: int

    @classmethod
    def from_env(cls) -> DatabaseSettings:
        return cls(
            dbname=os.environ.get("POSTGRES_DB", "wpostgresql"),
            user=os.environ.get("POSTGRES_USER", "postgres"),
            password=os.environ.get("POSTGRES_PASSWORD", "postgres"),
            host=os.environ.get("POSTGRES_HOST", "localhost"),
            port=int(os.environ.get("POSTGRES_PORT", "5432")),
        )

    def to_dict(self) -> dict[str, str | int]:
        return {
            "dbname": self.dbname,
            "user": self.user,
            "password": self.password,
            "host": self.host,
            "port": self.port,
        }


@dataclass
class AppSettings:
    """Application-level workspace and environment settings."""

    app_name: str = "WPipe Studio"
    version: str = "2.5.10"
    api_v1_prefix: str = "/api/v1"
    media_dir: Path = Path(os.environ.get("STUDIO_MEDIA_DIR", "./media")).resolve()
    workspaces_dir: Path = Path(
        os.environ.get("STUDIO_WORKSPACES_DIR", "./media/workspaces")
    ).resolve()

    @classmethod
    def from_env(cls) -> AppSettings:
        media_root = Path(os.environ.get("STUDIO_MEDIA_DIR", "./media")).resolve()
        workspaces_root = Path(
            os.environ.get("STUDIO_WORKSPACES_DIR", media_root / "workspaces")
        ).resolve()
        media_root.mkdir(parents=True, exist_ok=True)
        workspaces_root.mkdir(parents=True, exist_ok=True)
        return cls(
            media_dir=media_root,
            workspaces_dir=workspaces_root,
        )
