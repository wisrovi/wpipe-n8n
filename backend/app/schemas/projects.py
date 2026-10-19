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
