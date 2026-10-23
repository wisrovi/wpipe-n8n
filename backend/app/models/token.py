"""AuthToken domain model for PostgreSQL persistence via WPostgreSQL."""

from pydantic import BaseModel, Field


class AuthToken(BaseModel):
    """Session token entity for natural Bearer authentication."""

    __tablename__ = "auth_tokens"

    id: str = Field(description="Primary Key")
    token: str = Field(description="NOT NULL")
    user_id: str = Field(description="NOT NULL")
    created_at: str = Field(description="NOT NULL")
    expires_at: str = Field(description="NOT NULL")
