"""Simulation run domain model for PostgreSQL persistence via WPostgreSQL."""

from pydantic import BaseModel, Field


class SimulationRun(BaseModel):
    """Simulation run record capturing execution history, context mutation, and performance."""

    __tablename__ = "simulations"

    id: str = Field(description="Primary Key UUID")
    project_id: str = Field(description="NOT NULL Foreign Key")
    status: str = Field(default="success", description="success | failed | aborted")
    duration_ms: int = Field(default=0, description="Execution duration in milliseconds")
    input_payload_json: str = Field(default="{}", description="JSON stringified initial payload")
    output_context_json: str = Field(default="{}", description="JSON stringified final context")
    steps_timeline_json: str = Field(default="[]", description="JSON array of step execution timings")
    logs: str = Field(default="", description="Simulation console output logs")
    created_at: str = Field(description="ISO 8601 timestamp")
