"""Project repository using WPostgreSQL for data access."""

from __future__ import annotations

from typing import Any

from wpostgresql import WPostgreSQL

from app.models.project import Project


class ProjectRepository:
    """Repository handling Project persistence via WPostgreSQL."""

    def __init__(self, db_config: dict[str, Any]) -> None:
        self.db = WPostgreSQL(Project, db_config)

    def insert(self, project: Project) -> None:
        """Insert a new microservice project record."""
        self.db.insert(project)

    def get_by_id(self, project_id: str) -> Project | None:
        """Fetch a single project by primary key ID."""
        results = self.db.get_by_field(id=project_id)
        return results[0] if results else None

    def get_by_owner(self, owner_id: str) -> list[Project]:
        """Fetch all projects owned by a specific user tenant."""
        return self.db.get_by_field(owner_id=owner_id)

    def get_all(self) -> list[Project]:
        """Fetch all projects across the platform."""
        return self.db.get_all()

    def update(self, project_id: str, project: Project) -> None:
        """Update an existing project record."""
        self.db.update(project_id, project)

    def delete(self, project_id: str) -> None:
        """Physically delete a project record."""
        self.db.delete(project_id, hard=True)
