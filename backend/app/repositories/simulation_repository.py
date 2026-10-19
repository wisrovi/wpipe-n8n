"""Simulation repository using WPostgreSQL for data access."""

from __future__ import annotations

from typing import Any

from wpostgresql import WPostgreSQL

from app.models.simulation import SimulationRun


class SimulationRepository:
    """Repository handling SimulationRun persistence via WPostgreSQL."""

    def __init__(self, db_config: dict[str, Any]) -> None:
        self.db = WPostgreSQL(SimulationRun, db_config)

    def insert(self, run: SimulationRun) -> None:
        """Insert a new simulation execution run record."""
        self.db.insert(run)

    def get_by_id(self, run_id: str) -> SimulationRun | None:
        """Fetch a single simulation run by primary key ID."""
        results = self.db.get_by_field(id=run_id)
        return results[0] if results else None

    def get_by_project(self, project_id: str) -> list[SimulationRun]:
        """Fetch all simulation runs for a given microservice project."""
        return self.db.get_by_field(project_id=project_id)

    def delete(self, run_id: str) -> None:
        """Physically delete a simulation run record."""
        self.db.delete(run_id, hard=True)
