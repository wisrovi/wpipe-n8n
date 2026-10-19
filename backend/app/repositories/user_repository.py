"""User repository using WPostgreSQL for data access."""

from __future__ import annotations

from typing import Any

from wpostgresql import WPostgreSQL

from app.models.user import User


class UserRepository:
    """Repository handling User persistence via WPostgreSQL."""

    def __init__(self, db_config: dict[str, Any]) -> None:
        self.db = WPostgreSQL(User, db_config)

    def insert(self, user: User) -> None:
        """Insert a new user record."""
        self.db.insert(user)

    def get_by_id(self, user_id: str) -> User | None:
        """Fetch a single user by primary key ID."""
        results = self.db.get_by_field(id=user_id)
        return results[0] if results else None

    def get_by_username(self, username: str) -> User | None:
        """Fetch a single user by username."""
        results = self.db.get_by_field(username=username)
        return results[0] if results else None

    def get_all(self) -> list[User]:
        """Fetch all user records."""
        return self.db.get_all()
