"""AuthToken repository using WPostgreSQL for data access."""

from __future__ import annotations

from typing import Any

from wpostgresql import WPostgreSQL

from app.models.token import AuthToken


class TokenRepository:
    """Repository handling session tokens via WPostgreSQL."""

    def __init__(self, db_config: dict[str, Any]) -> None:
        self.db = WPostgreSQL(AuthToken, db_config)

    def insert(self, token: AuthToken) -> None:
        """Insert a newly minted session token."""
        self.db.insert(token)

    def get_by_token(self, token_str: str) -> AuthToken | None:
        """Fetch session token by token string value."""
        results = self.db.get_by_field(token=token_str)
        if not results:
            results = self.db.get_by_field(id=token_str)
        return results[0] if results else None

    def delete_by_token(self, token_str: str) -> None:
        """Revoke / delete a session token."""
        try:
            self.db.delete(token_str, hard=True)
        except Exception:
            pass
