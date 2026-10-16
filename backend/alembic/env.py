from __future__ import annotations

from typing import Any

from alembic import context
from sqlalchemy import Connection, pool
from sqlalchemy.engine import Engine

target_metadata: Any = None

_DEFAULT_URL = "postgresql+asyncpg://localhost/wpipe_studio"


def _database_url() -> str:
    url = context.config.get_main_option("sqlalchemy.url")
    return url or _DEFAULT_URL


def run_migrations_offline() -> None:
    context.configure(
        url=_database_url(),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def _run(connection: Connection) -> None:
    context.configure(connection=connection, target_metadata=target_metadata)
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    engine: Engine = context.get_context().get_engine(
        poolclass=pool.NullPool,
        url=_database_url(),
    )
    with engine.connect() as connection:
        _run(connection)


def main() -> None:
    if context.is_offline_mode():
        run_migrations_offline()
    else:
        run_migrations_online()


if getattr(context, "_proxy", None) is not None:
    main()