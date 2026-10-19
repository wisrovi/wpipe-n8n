"""Migrations package for WPostgreSQL schema synchronization."""

from app.migrations.manager import run_migrations

__all__ = ["run_migrations"]
