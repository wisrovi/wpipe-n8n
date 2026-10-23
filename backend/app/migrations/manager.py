"""Database migration and TableSync manager for WPostgreSQL."""

from __future__ import annotations

from typing import Any

from wpostgresql import WPostgreSQL

from app.config.settings import DatabaseSettings
from app.models.project import Project
from app.models.simulation import SimulationRun
from app.models.token import AuthToken
from app.models.user import User


def run_migrations(settings: DatabaseSettings | None = None) -> dict[str, Any]:
    """Synchronize schema with PostgreSQL using wpostgresql TableSync.

    Ensures tables (users, projects, auth_tokens, simulations) and any missing columns are created
    automatically on startup without manual SQL scripts.
    """
    db_cfg = (settings or DatabaseSettings.from_env()).to_dict()
    user_db = WPostgreSQL(User, db_cfg)
    project_db = WPostgreSQL(Project, db_cfg)
    token_db = WPostgreSQL(AuthToken, db_cfg)
    sim_db = WPostgreSQL(SimulationRun, db_cfg)
    return {
        "status": "synchronized",
        "tables": [user_db.table_name, project_db.table_name, token_db.table_name, sim_db.table_name],
    }
