"""Schemas for User Authentication, Multi-tenant Workspaces, and Projects."""

from datetime import UTC, datetime

from pydantic import BaseModel, Field


class UserProfile(BaseModel):
    id: str
    username: str
    name: str
    role: str
    avatar: str
    created_at: str = Field(default_factory=lambda: datetime.now(UTC).isoformat())


class UserRegisterRequest(BaseModel):
    username: str
    password: str = Field(default="pass123", min_length=4)
    name: str | None = None
    role: str | None = "Developer"


class UserLoginRequest(BaseModel):
    username: str
    password: str = Field(default="admin123")


class AuthTokenResponse(BaseModel):
    token: str
    user: UserProfile
    message: str = "Autenticación exitosa"


class ProjectSummary(BaseModel):
    id: str
    owner_id: str
    name: str
    description: str = ""
    protocol: str = "fastapi"
    step_count: int = 0
    created_at: str
    updated_at: str


class ProjectDetail(BaseModel):
    id: str
    owner_id: str
    name: str
    description: str = ""
    protocol: str = "fastapi"
    canvas_ir: dict = Field(default_factory=dict)
    generated_files: list[dict] = Field(default_factory=list)
    created_at: str
    updated_at: str


class ProjectCreateRequest(BaseModel):
    name: str
    description: str = ""
    protocol: str = "fastapi"
    canvas_ir: dict | None = None
    generated_files: list[dict] | None = None


class ProjectUpdateRequest(BaseModel):
    name: str | None = None
    description: str | None = None
    protocol: str | None = None
    canvas_ir: dict | None = None
    generated_files: list[dict] | None = None


class SimulationRunCreate(BaseModel):
    status: str = "success"
    duration_ms: int = 0
    input_payload: dict = Field(default_factory=dict)
    output_context: dict = Field(default_factory=dict)
    steps_timeline: list[dict] = Field(default_factory=list)
    logs: str = ""


class SimulationRunDetail(BaseModel):
    id: str
    project_id: str
    status: str
    duration_ms: int
    input_payload: dict = Field(default_factory=dict)
    output_context: dict = Field(default_factory=dict)
    steps_timeline: list[dict] = Field(default_factory=list)
    logs: str = ""
    created_at: str


class TerminalCommandRequest(BaseModel):
    command: str


class TerminalCommandResponse(BaseModel):
    stdout: str
    stderr: str
    exit_code: int
    cwd: str


class TestRunResponse(BaseModel):
    total: int
    passed: int
    failed: int
    skipped: int = 0
    duration_sec: float = 0.0
    output: str
    status: str = "success"
    exit_code: int = 0


class EnvVarItem(BaseModel):
    key: str
    value: str


class EnvVarsResponse(BaseModel):
    variables: list[EnvVarItem]


class EnvVarsUpdateRequest(BaseModel):
    variables: list[EnvVarItem]

