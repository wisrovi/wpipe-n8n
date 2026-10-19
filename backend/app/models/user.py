"""User domain model for PostgreSQL persistence via WPostgreSQL."""

from pydantic import BaseModel, Field


class User(BaseModel):
    """User entity representing an authenticated account."""

    __tablename__ = "users"

    id: str = Field(description="Primary Key")
    username: str = Field(description="NOT NULL")
    password_hash: str = Field(description="NOT NULL")
    name: str = Field(description="NOT NULL")
    role: str = Field(default="Developer")
    avatar: str = Field(default="WR")
    created_at: str = Field(description="NOT NULL")
