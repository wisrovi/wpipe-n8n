"""Unit tests for WPostgreSQL repositories, database settings, and schema migrations."""

import uuid

from app.config.settings import DatabaseSettings
from app.migrations.manager import run_migrations
from app.models.project import Project
from app.models.token import AuthToken
from app.models.user import User
from app.repositories.project_repository import ProjectRepository
from app.repositories.token_repository import TokenRepository
from app.repositories.user_repository import UserRepository


def test_database_settings():
    """Test loading database configuration from environment."""
    settings = DatabaseSettings.from_env()
    cfg_dict = settings.to_dict()
    assert "dbname" in cfg_dict
    assert "user" in cfg_dict
    assert "password" in cfg_dict
    assert "host" in cfg_dict
    assert "port" in cfg_dict
    assert cfg_dict["port"] == 5432


def test_migrations_manager():
    """Test running TableSync schema synchronization."""
    result = run_migrations()
    assert result["status"] == "synchronized"
    assert "users" in result["tables"]
    assert "projects" in result["tables"]
    assert "auth_tokens" in result["tables"]


def test_user_repository_crud():
    """Test UserRepository with WPostgreSQL."""
    cfg = DatabaseSettings.from_env().to_dict()
    repo = UserRepository(cfg)
    uid = f"usr_{uuid.uuid4().hex[:8]}"
    username = f"repo_user_{uuid.uuid4().hex[:6]}"

    user = User(
        id=uid,
        username=username,
        password_hash="testhash123",
        name="Repo Test User",
        role="Developer",
        avatar="RU",
        created_at="2026-10-19T00:00:00Z",
    )
    repo.insert(user)

    fetched_id = repo.get_by_id(uid)
    assert fetched_id is not None
    assert fetched_id.id == uid
    assert fetched_id.username == username

    fetched_user = repo.get_by_username(username)
    assert fetched_user is not None
    assert fetched_user.id == uid

    all_users = repo.get_all()
    assert any(u.id == uid for u in all_users)


def test_project_repository_crud():
    """Test ProjectRepository with WPostgreSQL."""
    cfg = DatabaseSettings.from_env().to_dict()
    repo = ProjectRepository(cfg)
    pid = f"proj_{uuid.uuid4().hex[:8]}"
    owner_id = f"usr_{uuid.uuid4().hex[:8]}"

    proj = Project(
        id=pid,
        owner_id=owner_id,
        name="test_postgres_project",
        description="Testing WPostgreSQL project persistence",
        protocol="fastapi",
        canvas_ir_json="{}",
        generated_files_json="[]",
        created_at="2026-10-19T00:00:00Z",
        updated_at="2026-10-19T00:00:00Z",
    )
    repo.insert(proj)

    fetched = repo.get_by_id(pid)
    assert fetched is not None
    assert fetched.name == "test_postgres_project"

    by_owner = repo.get_by_owner(owner_id)
    assert len(by_owner) == 1
    assert by_owner[0].id == pid

    # Update
    proj.description = "Updated description"
    repo.update(pid, proj)
    updated = repo.get_by_id(pid)
    assert updated is not None
    assert updated.description == "Updated description"

    # Delete
    repo.delete(pid)
    assert repo.get_by_id(pid) is None


def test_token_repository_crud():
    """Test TokenRepository with WPostgreSQL."""
    cfg = DatabaseSettings.from_env().to_dict()
    repo = TokenRepository(cfg)
    token_str = f"tok_{uuid.uuid4().hex}"
    uid = f"usr_{uuid.uuid4().hex[:8]}"

    tok = AuthToken(
        id=token_str,
        token=token_str,
        user_id=uid,
        created_at="2026-10-19T00:00:00Z",
        expires_at="2026-11-19T00:00:00Z",
    )
    repo.insert(tok)

    found = repo.get_by_token(token_str)
    assert found is not None
    assert found.token == token_str
    assert found.user_id == uid

    repo.delete_by_token(token_str)
    assert repo.get_by_token(token_str) is None
