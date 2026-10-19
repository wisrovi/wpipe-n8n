"""Project domain model for PostgreSQL persistence via WPostgreSQL."""

from pydantic import BaseModel, Field


class Project(BaseModel):
    """Project entity representing an isolated WPipe microservice workspace."""

    __tablename__ = "projects"

    id: str = Field(description="Primary Key")
    owner_id: str = Field(description="NOT NULL")
    name: str = Field(description="NOT NULL")
    description: str = Field(default="")
    protocol: str = Field(default="fastapi")
    canvas_ir_json: str = Field(default="{}")
    generated_files_json: str = Field(default="[]")
    created_at: str = Field(description="NOT NULL")
    updated_at: str = Field(description="NOT NULL")
