"""Project and Multi-Tenant Workspace Manager Service.

Provides persistence via WPostgreSQL (with fallback to SQLite for non-docker test environments),
strict user-level workspace isolation, session token management with hashed password authentication,
and microservices lifecycle management.
Persists data to PostgreSQL and full runnable microservice source trees to a shared media volume on the host.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import secrets
import shutil
import sqlite3
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

from app.config.settings import DatabaseSettings
from app.core.logging import get_logger
from app.migrations.manager import run_migrations
from app.models.project import Project as ProjectModel
from app.models.token import AuthToken as AuthTokenModel
from app.models.user import User as UserModel
from app.repositories.project_repository import ProjectRepository
from app.repositories.token_repository import TokenRepository
from app.repositories.user_repository import UserRepository
from app.schemas.projects import (
    ProjectCreateRequest,
    ProjectDetail,
    ProjectSummary,
    ProjectUpdateRequest,
    UserProfile,
)

logger = get_logger(__name__)


def _resolve_paths() -> tuple[Path, Path]:
    """Resolve database path and workspaces directory in persistent host media volume."""
    env_media = os.environ.get("STUDIO_MEDIA_DIR") or os.environ.get("STUDIO_DATA_DIR")
    if env_media:
        media_root = Path(env_media).resolve()
    else:
        root_dir = Path(__file__).resolve().parent.parent.parent.parent
        media_root = (root_dir / "media").resolve()

    media_root.mkdir(parents=True, exist_ok=True)
    db_path = Path(os.environ.get("STUDIO_DB_PATH", media_root / "studio.db")).resolve()
    workspaces_root = Path(os.environ.get("STUDIO_WORKSPACES_DIR", media_root / "workspaces")).resolve()
    workspaces_root.mkdir(parents=True, exist_ok=True)
    return db_path, workspaces_root


DEFAULT_DB_PATH, DEFAULT_WORKSPACES_ROOT = _resolve_paths()


def hash_password(password: str) -> str:
    """Hash password using PBKDF2-HMAC-SHA256 with a unique random salt."""
    salt = secrets.token_hex(16)
    key = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), 100_000)
    return f"pbkdf2_sha256${salt}${key.hex()}"


def verify_password(password: str, hashed: str | None) -> bool:
    """Verify password against stored PBKDF2 hash using constant-time comparison."""
    if not hashed:
        return False
    try:
        parts = hashed.split("$")
        if len(parts) != 3 or parts[0] != "pbkdf2_sha256":
            return False
        salt = parts[1]
        expected_key = parts[2]
        key = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), 100_000)
        return secrets.compare_digest(key.hex(), expected_key)
    except Exception:
        return False


def _slugify(name: str) -> str:
    cleaned = re.sub(r"[^\w\s-]", "", name).strip().lower()
    return re.sub(r"[-\s]+", "_", cleaned) or "microservice"


class ProjectManager:
    def __init__(
        self,
        db_path: Path | None = None,
        workspaces_root: Path | None = None,
        use_postgres: bool | None = None,
    ) -> None:
        self.db_path = (db_path or DEFAULT_DB_PATH).resolve()
        self.workspaces_root = (workspaces_root or DEFAULT_WORKSPACES_ROOT).resolve()
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self.workspaces_root.mkdir(parents=True, exist_ok=True)

        self.db_settings = DatabaseSettings.from_env()
        self.use_postgres = False

        force_sqlite = os.environ.get("STUDIO_USE_SQLITE", "0") == "1"
        if not force_sqlite and (use_postgres is True or use_postgres is None):
            try:
                run_migrations(self.db_settings)
                self.user_repo = UserRepository(self.db_settings.to_dict())
                self.project_repo = ProjectRepository(self.db_settings.to_dict())
                self.token_repo = TokenRepository(self.db_settings.to_dict())
                self.use_postgres = True
                self._seed_postgres_data()
                logger.info("ProjectManager initialized with WPostgreSQL persistence.")
            except Exception as e:
                logger.warning(
                    "Could not connect to WPostgreSQL (%s). Falling back to SQLite.", e
                )
                self.use_postgres = False

        if not self.use_postgres:
            self._init_db()
            logger.info("ProjectManager initialized with SQLite fallback.")

    def _get_connection(self) -> sqlite3.Connection:
        conn = sqlite3.connect(str(self.db_path), timeout=15.0)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode = WAL")
        conn.execute("PRAGMA synchronous = NORMAL")
        conn.execute("PRAGMA foreign_keys = ON")
        return conn

    def _init_db(self) -> None:
        with self._get_connection() as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS users (
                    id TEXT PRIMARY KEY,
                    username TEXT UNIQUE NOT NULL,
                    password_hash TEXT NOT NULL,
                    name TEXT NOT NULL,
                    role TEXT NOT NULL,
                    avatar TEXT NOT NULL,
                    created_at TEXT NOT NULL
                )
                """
            )
            user_cols = [r[1] for r in conn.execute("PRAGMA table_info(users)").fetchall()]
            if "password_hash" not in user_cols:
                conn.execute("ALTER TABLE users ADD COLUMN password_hash TEXT DEFAULT ''")

            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS sessions (
                    token TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    expires_at TEXT NOT NULL,
                    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
                )
                """
            )

            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS projects (
                    id TEXT PRIMARY KEY,
                    owner_id TEXT NOT NULL,
                    name TEXT NOT NULL,
                    description TEXT NOT NULL DEFAULT '',
                    protocol TEXT NOT NULL DEFAULT 'fastapi',
                    canvas_ir TEXT NOT NULL DEFAULT '{}',
                    generated_files TEXT NOT NULL DEFAULT '[]',
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
                )
                """
            )
            conn.commit()

        self._seed_default_data()

    def _seed_postgres_data(self) -> None:
        now = datetime.now(UTC).isoformat()

        # Seed 1: William Rodriguez (AI Leader & Solutions Architect) - password: admin123
        william = self.user_repo.get_by_id("usr_william")
        ecommerce_ir = {
            "nodes": [{
                "id": "trigger_1",
                "type": "wpipe_trigger",
                "data": {
                    "label": "Trigger Ingress",
                    "node_type": "trigger",
                    "trigger_type": "api",
                    "trigger_param": "/run",
                },
            }],
            "edges": [],
        }
        if not william:
            self.user_repo.insert(
                UserModel(
                    id="usr_william",
                    username="william.rodriguez",
                    password_hash=hash_password("admin123"),
                    name="William R.",
                    role="AI Leader & Solutions Architect",
                    avatar="WR",
                    created_at=now,
                )
            )
            self.project_repo.insert(
                ProjectModel(
                    id="proj_ecommerce_orders",
                    owner_id="usr_william",
                    name="ecommerce_orders_pipeline",
                    description="Microservicio WPipe para procesamiento de pedidos y enriquecimiento con IA",
                    protocol="fastapi",
                    canvas_ir_json=json.dumps(ecommerce_ir),
                    generated_files_json=json.dumps([]),
                    created_at=now,
                    updated_at=now,
                )
            )
        elif not william.password_hash:
            william.password_hash = hash_password("admin123")
            self.user_repo.db.update(william.id, william)

        # Seed disk microservice folder for William
        ws_william = self.get_workspace_dir("usr_william", "proj_ecommerce_orders", "ecommerce_orders_pipeline")
        self._sync_project_files_to_disk(ws_william, None, ecommerce_ir, "ecommerce_orders_pipeline")
        with open(ws_william / "meta.json", "w", encoding="utf-8") as f:
            json.dump({
                "id": "proj_ecommerce_orders",
                "name": "ecommerce_orders_pipeline",
                "owner_id": "usr_william",
                "created_at": now,
            }, f, indent=2)

        # Seed 2: Dev Engineer (Pipeline Core Developer) - password: dev123
        dev = self.user_repo.get_by_id("usr_developer")
        iot_ir = {
            "nodes": [{
                "id": "trigger_kafka",
                "type": "wpipe_trigger",
                "data": {
                    "label": "Kafka Ingress",
                    "node_type": "trigger",
                    "trigger_type": "kafka",
                    "trigger_param": "telemetry.sensors",
                },
            }],
            "edges": [],
        }
        if not dev:
            self.user_repo.insert(
                UserModel(
                    id="usr_developer",
                    username="developer",
                    password_hash=hash_password("dev123"),
                    name="Dev Engineer",
                    role="Pipeline Core Developer",
                    avatar="DE",
                    created_at=now,
                )
            )
            self.project_repo.insert(
                ProjectModel(
                    id="proj_iot_sensor_telemetry",
                    owner_id="usr_developer",
                    name="iot_sensor_telemetry",
                    description="Microservicio WPipe para procesamiento Kafka Stream y caching Redis",
                    protocol="kafka",
                    canvas_ir_json=json.dumps(iot_ir),
                    generated_files_json=json.dumps([]),
                    created_at=now,
                    updated_at=now,
                )
            )
        elif not dev.password_hash:
            dev.password_hash = hash_password("dev123")
            self.user_repo.db.update(dev.id, dev)

        # Seed disk microservice folder for Developer
        ws_dev = self.get_workspace_dir("usr_developer", "proj_iot_sensor_telemetry", "iot_sensor_telemetry")
        self._sync_project_files_to_disk(ws_dev, None, iot_ir, "iot_sensor_telemetry")
        with open(ws_dev / "meta.json", "w", encoding="utf-8") as f:
            json.dump({
                "id": "proj_iot_sensor_telemetry",
                "name": "iot_sensor_telemetry",
                "owner_id": "usr_developer",
                "created_at": now,
            }, f, indent=2)

        # Seed 3: Guest / Sandbox - password: guest123
        guest = self.user_repo.get_by_id("usr_guest")
        if not guest:
            self.user_repo.insert(
                UserModel(
                    id="usr_guest",
                    username="guest",
                    password_hash=hash_password("guest123"),
                    name="Invitado",
                    role="Sandbox Explorer",
                    avatar="IN",
                    created_at=now,
                )
            )
        elif not guest.password_hash:
            guest.password_hash = hash_password("guest123")
            self.user_repo.db.update(guest.id, guest)

    def _seed_default_data(self) -> None:
        with self._get_connection() as conn:
            now = datetime.now(UTC).isoformat()
            ecommerce_ir = {
                "nodes": [{
                    "id": "trigger_1",
                    "type": "wpipe_trigger",
                    "data": {
                        "label": "Trigger Ingress",
                        "node_type": "trigger",
                        "trigger_type": "api",
                        "trigger_param": "/run",
                    },
                }],
                "edges": [],
            }

            row_william = conn.execute(
                "SELECT id, password_hash FROM users WHERE username = ?", ("william.rodriguez",)
            ).fetchone()
            if not row_william:
                conn.execute(
                    """
                    INSERT INTO users (id, username, password_hash, name, role, avatar, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        "usr_william",
                        "william.rodriguez",
                        hash_password("admin123"),
                        "William R.",
                        "AI Leader & Solutions Architect",
                        "WR",
                        now,
                    ),
                )
                conn.execute(
                    """
                    INSERT INTO projects (id, owner_id, name, description, protocol, canvas_ir, generated_files, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        "proj_ecommerce_orders",
                        "usr_william",
                        "ecommerce_orders_pipeline",
                        "Microservicio WPipe para procesamiento de pedidos y enriquecimiento con IA",
                        "fastapi",
                        json.dumps(ecommerce_ir),
                        json.dumps([]),
                        now,
                        now,
                    ),
                )
            elif not row_william["password_hash"]:
                conn.execute(
                    "UPDATE users SET password_hash = ? WHERE id = ?",
                    (hash_password("admin123"), row_william["id"]),
                )

            row_dev = conn.execute(
                "SELECT id, password_hash FROM users WHERE username = ?", ("developer",)
            ).fetchone()
            iot_ir = {
                "nodes": [{
                    "id": "trigger_kafka",
                    "type": "wpipe_trigger",
                    "data": {
                        "label": "Kafka Ingress",
                        "node_type": "trigger",
                        "trigger_type": "kafka",
                        "trigger_param": "telemetry.sensors",
                    },
                }],
                "edges": [],
            }
            if not row_dev:
                conn.execute(
                    """
                    INSERT INTO users (id, username, password_hash, name, role, avatar, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        "usr_developer",
                        "developer",
                        hash_password("dev123"),
                        "Dev Engineer",
                        "Pipeline Core Developer",
                        "DE",
                        now,
                    ),
                )
                conn.execute(
                    """
                    INSERT INTO projects (id, owner_id, name, description, protocol, canvas_ir, generated_files, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        "proj_iot_sensor_telemetry",
                        "usr_developer",
                        "iot_sensor_telemetry",
                        "Microservicio WPipe para procesamiento Kafka Stream y caching Redis",
                        "kafka",
                        json.dumps(iot_ir),
                        json.dumps([]),
                        now,
                        now,
                    ),
                )
            elif not row_dev["password_hash"]:
                conn.execute(
                    "UPDATE users SET password_hash = ? WHERE id = ?",
                    (hash_password("dev123"), row_dev["id"]),
                )

            row_guest = conn.execute(
                "SELECT id, password_hash FROM users WHERE username = ?", ("guest",)
            ).fetchone()
            if not row_guest:
                conn.execute(
                    """
                    INSERT INTO users (id, username, password_hash, name, role, avatar, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        "usr_guest",
                        "guest",
                        hash_password("guest123"),
                        "Invitado",
                        "Sandbox Explorer",
                        "IN",
                        now,
                    ),
                )
            elif not row_guest["password_hash"]:
                conn.execute(
                    "UPDATE users SET password_hash = ? WHERE id = ?",
                    (hash_password("guest123"), row_guest["id"]),
                )

            conn.commit()

        # Seed physical files for SQLite fallback
        ws_william = self.get_workspace_dir("usr_william", "proj_ecommerce_orders", "ecommerce_orders_pipeline")
        self._sync_project_files_to_disk(ws_william, None, ecommerce_ir, "ecommerce_orders_pipeline")
        ws_dev = self.get_workspace_dir("usr_developer", "proj_iot_sensor_telemetry", "iot_sensor_telemetry")
        self._sync_project_files_to_disk(ws_dev, None, iot_ir, "iot_sensor_telemetry")

    # ---------------- User & Session Management ----------------

    def list_users(self) -> list[UserProfile]:
        if self.use_postgres:
            rows = self.user_repo.get_all()
            rows.sort(key=lambda u: u.created_at)
            return [
                UserProfile(
                    id=row.id,
                    username=row.username,
                    name=row.name,
                    role=row.role,
                    avatar=row.avatar,
                    created_at=row.created_at,
                )
                for row in rows
            ]

        with self._get_connection() as conn:
            rows = conn.execute("SELECT * FROM users ORDER BY created_at ASC").fetchall()
            return [
                UserProfile(
                    id=row["id"],
                    username=row["username"],
                    name=row["name"],
                    role=row["role"],
                    avatar=row["avatar"],
                    created_at=row["created_at"],
                )
                for row in rows
            ]

    def get_user_by_id(self, user_id: str) -> UserProfile | None:
        if self.use_postgres:
            row = self.user_repo.get_by_id(user_id)
            if not row:
                return None
            return UserProfile(
                id=row.id,
                username=row.username,
                name=row.name,
                role=row.role,
                avatar=row.avatar,
                created_at=row.created_at,
            )

        with self._get_connection() as conn:
            row = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
            if not row:
                return None
            return UserProfile(
                id=row["id"],
                username=row["username"],
                name=row["name"],
                role=row["role"],
                avatar=row["avatar"],
                created_at=row["created_at"],
            )

    def get_user_by_username(self, username: str) -> UserProfile | None:
        clean_user = username.strip().lower()
        if self.use_postgres:
            row = self.user_repo.get_by_username(clean_user)
            if not row:
                return None
            return UserProfile(
                id=row.id,
                username=row.username,
                name=row.name,
                role=row.role,
                avatar=row.avatar,
                created_at=row.created_at,
            )

        with self._get_connection() as conn:
            row = conn.execute("SELECT * FROM users WHERE username = ?", (clean_user,)).fetchone()
            if not row:
                return None
            return UserProfile(
                id=row["id"],
                username=row["username"],
                name=row["name"],
                role=row["role"],
                avatar=row["avatar"],
                created_at=row["created_at"],
            )

    def create_session(self, user_id: str, days_valid: int = 30) -> str:
        """Create a new secure session token stored in PostgreSQL or SQLite."""
        token = secrets.token_urlsafe(32)
        now = datetime.now(UTC)
        expires_at = (now + timedelta(days=days_valid)).isoformat()

        if self.use_postgres:
            self.token_repo.insert(
                AuthTokenModel(
                    id=token,
                    token=token,
                    user_id=user_id,
                    created_at=now.isoformat(),
                    expires_at=expires_at,
                )
            )
            return token

        with self._get_connection() as conn:
            conn.execute(
                """
                INSERT INTO sessions (token, user_id, created_at, expires_at)
                VALUES (?, ?, ?, ?)
                """,
                (token, user_id, now.isoformat(), expires_at),
            )
            conn.commit()
        return token

    def authenticate_user(self, username: str, password: str) -> tuple[UserProfile, str] | None:
        """Authenticate user by username and password. Returns (UserProfile, session_token) or None."""
        clean_user = username.strip().lower()
        if self.use_postgres:
            user_model = self.user_repo.get_by_username(clean_user)
            if not user_model:
                return None
            stored_hash = user_model.password_hash
            if not stored_hash or verify_password(password, stored_hash):
                profile = UserProfile(
                    id=user_model.id,
                    username=user_model.username,
                    name=user_model.name,
                    role=user_model.role,
                    avatar=user_model.avatar,
                    created_at=user_model.created_at,
                )
                token = self.create_session(profile.id)
                return profile, token
            return None

        with self._get_connection() as conn:
            row = conn.execute("SELECT * FROM users WHERE username = ?", (clean_user,)).fetchone()
            if not row:
                return None
            stored_hash = row["password_hash"]
            if not stored_hash or verify_password(password, stored_hash):
                user = UserProfile(
                    id=row["id"],
                    username=row["username"],
                    name=row["name"],
                    role=row["role"],
                    avatar=row["avatar"],
                    created_at=row["created_at"],
                )
                token = self.create_session(user.id)
                return user, token
            return None

    def get_user_by_token(self, token: str) -> UserProfile | None:
        """Retrieve user associated with a valid, non-expired session token."""
        if not token or not token.strip():
            return None
        clean_token = token.strip()
        now = datetime.now(UTC).isoformat()

        if self.use_postgres:
            token_record = self.token_repo.get_by_token(clean_token)
            if not token_record:
                return None
            if token_record.expires_at <= now:
                return None
            return self.get_user_by_id(token_record.user_id)

        with self._get_connection() as conn:
            row = conn.execute(
                """
                SELECT u.* FROM users u
                JOIN sessions s ON u.id = s.user_id
                WHERE s.token = ? AND s.expires_at > ?
                """,
                (clean_token, now),
            ).fetchone()
            if not row:
                return None
            return UserProfile(
                id=row["id"],
                username=row["username"],
                name=row["name"],
                role=row["role"],
                avatar=row["avatar"],
                created_at=row["created_at"],
            )

    def logout_token(self, token: str) -> bool:
        """Revoke a session token upon user logout."""
        if not token:
            return False
        clean_token = token.strip()
        if self.use_postgres:
            self.token_repo.delete_by_token(clean_token)
            return True

        with self._get_connection() as conn:
            res = conn.execute("DELETE FROM sessions WHERE token = ?", (clean_token,))
            conn.commit()
            return res.rowcount > 0

    def register_user(
        self,
        username: str,
        password: str = "pass123",
        name: str | None = None,
        role: str | None = None,
    ) -> tuple[UserProfile, str]:
        """Register a new user identity with a hashed password and return (UserProfile, session_token)."""
        clean_user = username.strip().lower()
        existing = self.get_user_by_username(clean_user)
        if existing:
            if password:
                pwd_hash = hash_password(password)
                if self.use_postgres:
                    u_model = UserModel(
                        id=existing.id,
                        username=clean_user,
                        password_hash=pwd_hash,
                        name=existing.name,
                        role=existing.role,
                        avatar=existing.avatar,
                        created_at=existing.created_at,
                    )
                    self.user_repo.db.update(existing.id, u_model)
                else:
                    with self._get_connection() as conn:
                        conn.execute("UPDATE users SET password_hash = ? WHERE id = ?", (pwd_hash, existing.id))
                        conn.commit()
            token = self.create_session(existing.id)
            return existing, token

        user_id = f"usr_{uuid.uuid4().hex[:8]}"
        display_name = name.strip() if name and name.strip() else clean_user.capitalize()
        user_role = role.strip() if role and role.strip() else "Developer"
        initials = "".join([part[0].upper() for part in display_name.split() if part])[:2] or "US"
        now = datetime.now(UTC).isoformat()
        pwd_hash = hash_password(password)

        if self.use_postgres:
            self.user_repo.insert(
                UserModel(
                    id=user_id,
                    username=clean_user,
                    password_hash=pwd_hash,
                    name=display_name,
                    role=user_role,
                    avatar=initials,
                    created_at=now,
                )
            )
        else:
            with self._get_connection() as conn:
                conn.execute(
                    """
                    INSERT INTO users (id, username, password_hash, name, role, avatar, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                    (user_id, clean_user, pwd_hash, display_name, user_role, initials, now),
                )
                conn.commit()

        # Create isolated workspace root for this user
        (self.workspaces_root / user_id).mkdir(parents=True, exist_ok=True)
        user = UserProfile(
            id=user_id,
            username=clean_user,
            name=display_name,
            role=user_role,
            avatar=initials,
            created_at=now,
        )
        token = self.create_session(user_id)
        return user, token

    # ---------------- Multi-Tenant Project & Disk Workspace Management ----------------

    def get_workspace_dir(
        self,
        owner_id: str,
        project_id: str,
        name: str | None = None,
    ) -> Path:
        """Strictly sandboxed directory within host persistent media volume.

        Each user has their isolated workspace root: `media/workspaces/{owner_id}/`.
        Inside their workspace, each microservice has its own folder named after the microservice.
        """
        clean_owner = re.sub(r"[^\w-]", "", owner_id)
        clean_proj = re.sub(r"[^\w-]", "", project_id)
        user_ws = (self.workspaces_root / clean_owner).resolve()
        user_ws.mkdir(parents=True, exist_ok=True)

        slug = _slugify(name) if name else None
        if not slug:
            try:
                p = self.get_project(project_id, owner_id)
                if p:
                    slug = _slugify(p.name)
            except Exception:
                pass

        if not slug:
            slug = clean_proj

        target_dir = (user_ws / slug).resolve()
        if not str(target_dir).startswith(str(self.workspaces_root.resolve())):
            raise ValueError("Path traversal attempt detected")

        # Disambiguate if folder exists and belongs to a different project ID
        meta_file = target_dir / "meta.json"
        if target_dir.exists() and meta_file.exists():
            try:
                with open(meta_file, encoding="utf-8") as f:
                    meta_data = json.load(f)
                if meta_data.get("id") and meta_data.get("id") != project_id:
                    target_dir = (user_ws / f"{slug}_{clean_proj[:8]}").resolve()
            except Exception:
                pass

        target_dir.mkdir(parents=True, exist_ok=True)
        return target_dir

    def _sync_project_files_to_disk(
        self,
        ws_dir: Path,
        files: list[dict[str, Any]] | None,
        canvas_ir: dict[str, Any] | None,
        project_name: str,
    ) -> None:
        """Synchronize the complete microservice source tree to the physical workspace folder on disk."""
        ws_dir.mkdir(parents=True, exist_ok=True)

        target_files: list[dict[str, str]] = []
        if files and len(files) > 0:
            target_files = [
                {"path": f.get("path", ""), "content": f.get("content", "")}
                for f in files
                if isinstance(f, dict) and f.get("path")
            ]

        # If no explicit files are supplied, auto-compile from Canvas IR
        if not target_files and canvas_ir:
            try:
                from app.schemas.ir import CanvasIR
                from app.services.ir_transformer import (
                    transform_canvas_to_semantic,
                    transform_semantic_to_target,
                )
                c_data = dict(canvas_ir)
                if "nodes" in c_data and isinstance(c_data["nodes"], list):
                    fixed_nodes = []
                    for n in c_data["nodes"]:
                        nd = dict(n)
                        data = dict(nd.get("data", {}))
                        if "label" not in data:
                            data["label"] = data.get("node_type", "Step").capitalize()
                        nd["data"] = data
                        fixed_nodes.append(nd)
                    c_data["nodes"] = fixed_nodes

                c_ir = CanvasIR(**c_data)
                semantic_ir = transform_canvas_to_semantic(c_ir)
                target_ir = transform_semantic_to_target(semantic_ir, project_name=project_name)
                target_files = [{"path": f.path, "content": f.content} for f in target_ir.files]
            except Exception as e:
                logger.warning("Could not auto-compile canvas IR to files for %s: %s", project_name, e)

        # Write each file to the microservice workspace directory on disk
        for tf in target_files:
            rel_path = tf.get("path")
            if not rel_path:
                continue
            clean_rel = re.sub(r"^[/\\]+", "", rel_path)
            dest = (ws_dir / clean_rel).resolve()
            if not str(dest).startswith(str(ws_dir.resolve())):
                continue
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_text(tf.get("content", ""), encoding="utf-8")

    def list_projects(self, owner_id: str) -> list[ProjectSummary]:
        if self.use_postgres:
            projects = self.project_repo.get_by_owner(owner_id)
            projects.sort(key=lambda p: p.updated_at, reverse=True)
            summaries: list[ProjectSummary] = []
            for p in projects:
                try:
                    c_ir = json.loads(p.canvas_ir_json or "{}")
                    step_count = len(c_ir.get("nodes", []))
                except Exception:
                    step_count = 0
                summaries.append(
                    ProjectSummary(
                        id=p.id,
                        owner_id=p.owner_id,
                        name=p.name,
                        description=p.description,
                        protocol=p.protocol,
                        step_count=step_count,
                        created_at=p.created_at,
                        updated_at=p.updated_at,
                    )
                )
            return summaries

        with self._get_connection() as conn:
            rows = conn.execute(
                "SELECT * FROM projects WHERE owner_id = ? ORDER BY updated_at DESC",
                (owner_id,),
            ).fetchall()
            summaries = []
            for row in rows:
                try:
                    c_ir = json.loads(row["canvas_ir"] or "{}")
                    step_count = len(c_ir.get("nodes", []))
                except Exception:
                    step_count = 0
                summaries.append(
                    ProjectSummary(
                        id=row["id"],
                        owner_id=row["owner_id"],
                        name=row["name"],
                        description=row["description"],
                        protocol=row["protocol"],
                        step_count=step_count,
                        created_at=row["created_at"],
                        updated_at=row["updated_at"],
                    )
                )
            return summaries

    def get_project(self, project_id: str, owner_id: str) -> ProjectDetail | None:
        if self.use_postgres:
            p = self.project_repo.get_by_id(project_id)
            if not p or p.owner_id != owner_id:
                return None
            try:
                canvas_ir = json.loads(p.canvas_ir_json or "{}")
            except Exception:
                canvas_ir = {}
            try:
                generated_files = json.loads(p.generated_files_json or "[]")
            except Exception:
                generated_files = []

            return ProjectDetail(
                id=p.id,
                owner_id=p.owner_id,
                name=p.name,
                description=p.description,
                protocol=p.protocol,
                canvas_ir=canvas_ir,
                generated_files=generated_files,
                created_at=p.created_at,
                updated_at=p.updated_at,
            )

        with self._get_connection() as conn:
            row = conn.execute(
                "SELECT * FROM projects WHERE id = ? AND owner_id = ?",
                (project_id, owner_id),
            ).fetchone()
            if not row:
                return None
            try:
                canvas_ir = json.loads(row["canvas_ir"] or "{}")
            except Exception:
                canvas_ir = {}
            try:
                generated_files = json.loads(row["generated_files"] or "[]")
            except Exception:
                generated_files = []

            return ProjectDetail(
                id=row["id"],
                owner_id=row["owner_id"],
                name=row["name"],
                description=row["description"],
                protocol=row["protocol"],
                canvas_ir=canvas_ir,
                generated_files=generated_files,
                created_at=row["created_at"],
                updated_at=row["updated_at"],
            )

    def create_project(self, owner_id: str, req: ProjectCreateRequest) -> ProjectDetail:
        proj_id = f"proj_{uuid.uuid4().hex[:10]}"
        clean_name = _slugify(req.name)
        now = datetime.now(UTC).isoformat()
        canvas_ir_dict = req.canvas_ir if req.canvas_ir is not None else {}
        generated_files_list = req.generated_files if req.generated_files is not None else []

        if self.use_postgres:
            self.project_repo.insert(
                ProjectModel(
                    id=proj_id,
                    owner_id=owner_id,
                    name=clean_name,
                    description=req.description,
                    protocol=req.protocol,
                    canvas_ir_json=json.dumps(canvas_ir_dict),
                    generated_files_json=json.dumps(generated_files_list),
                    created_at=now,
                    updated_at=now,
                )
            )
        else:
            with self._get_connection() as conn:
                conn.execute(
                    """
                    INSERT INTO projects (id, owner_id, name, description, protocol, canvas_ir, generated_files, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        proj_id,
                        owner_id,
                        clean_name,
                        req.description,
                        req.protocol,
                        json.dumps(canvas_ir_dict),
                        json.dumps(generated_files_list),
                        now,
                        now,
                    ),
                )
                conn.commit()

        # Initialize physical workspace directory for this microservice in the shared host media volume
        ws_dir = self.get_workspace_dir(owner_id, proj_id, clean_name)
        with open(ws_dir / "meta.json", "w", encoding="utf-8") as f:
            json.dump({
                "id": proj_id,
                "name": clean_name,
                "owner_id": owner_id,
                "created_at": now,
                "updated_at": now,
            }, f, indent=2)

        if canvas_ir_dict:
            with open(ws_dir / "canvas_ir.json", "w", encoding="utf-8") as f:
                json.dump(canvas_ir_dict, f, indent=2)

        # Synchronize full microservice file tree to disk
        self._sync_project_files_to_disk(ws_dir, generated_files_list, canvas_ir_dict, clean_name)

        return ProjectDetail(
            id=proj_id,
            owner_id=owner_id,
            name=clean_name,
            description=req.description,
            protocol=req.protocol,
            canvas_ir=canvas_ir_dict,
            generated_files=generated_files_list,
            created_at=now,
            updated_at=now,
        )

    def update_project(
        self, project_id: str, owner_id: str, req: ProjectUpdateRequest
    ) -> ProjectDetail | None:
        current = self.get_project(project_id, owner_id)
        if not current:
            return None

        updated_name = _slugify(req.name) if req.name is not None else current.name
        updated_desc = req.description if req.description is not None else current.description
        updated_protocol = req.protocol if req.protocol is not None else current.protocol
        updated_canvas = req.canvas_ir if req.canvas_ir is not None else current.canvas_ir
        updated_files = req.generated_files if req.generated_files is not None else current.generated_files
        now = datetime.now(UTC).isoformat()

        if self.use_postgres:
            p_model = ProjectModel(
                id=project_id,
                owner_id=owner_id,
                name=updated_name,
                description=updated_desc,
                protocol=updated_protocol,
                canvas_ir_json=json.dumps(updated_canvas),
                generated_files_json=json.dumps(updated_files),
                created_at=current.created_at,
                updated_at=now,
            )
            self.project_repo.update(project_id, p_model)
        else:
            with self._get_connection() as conn:
                conn.execute(
                    """
                    UPDATE projects
                    SET name = ?, description = ?, protocol = ?, canvas_ir = ?, generated_files = ?, updated_at = ?
                    WHERE id = ? AND owner_id = ?
                    """,
                    (
                        updated_name,
                        updated_desc,
                        updated_protocol,
                        json.dumps(updated_canvas),
                        json.dumps(updated_files),
                        now,
                        project_id,
                        owner_id,
                    ),
                )
                conn.commit()

        # Workspace directory migration if renamed
        old_dir = self.get_workspace_dir(owner_id, project_id, current.name)
        ws_dir = self.get_workspace_dir(owner_id, project_id, updated_name)
        if old_dir.exists() and old_dir.resolve() != ws_dir.resolve():
            try:
                for item in old_dir.iterdir():
                    dest_item = ws_dir / item.name
                    if item.is_file():
                        shutil.copy2(item, dest_item)
                    elif item.is_dir():
                        shutil.copytree(item, dest_item, dirs_exist_ok=True)
                shutil.rmtree(old_dir, ignore_errors=True)
            except Exception as e:
                logger.warning("Failed to migrate microservice directory %s: %s", project_id, e)

        # Update physical workspace metadata and files in shared host volume
        try:
            with open(ws_dir / "meta.json", "w", encoding="utf-8") as f:
                json.dump({
                    "id": project_id,
                    "name": updated_name,
                    "owner_id": owner_id,
                    "created_at": current.created_at,
                    "updated_at": now,
                }, f, indent=2)

            if updated_canvas:
                with open(ws_dir / "canvas_ir.json", "w", encoding="utf-8") as f:
                    json.dump(updated_canvas, f, indent=2)

            self._sync_project_files_to_disk(ws_dir, updated_files, updated_canvas, updated_name)
        except Exception as e:
            logger.warning("Failed to sync files to disk for %s: %s", project_id, e)

        return ProjectDetail(
            id=project_id,
            owner_id=owner_id,
            name=updated_name,
            description=updated_desc,
            protocol=updated_protocol,
            canvas_ir=updated_canvas,
            generated_files=updated_files,
            created_at=current.created_at,
            updated_at=now,
        )

    def delete_project(self, project_id: str, owner_id: str) -> bool:
        current = self.get_project(project_id, owner_id)
        if not current:
            return False

        if self.use_postgres:
            self.project_repo.delete(project_id)
        else:
            with self._get_connection() as conn:
                res = conn.execute(
                    "DELETE FROM projects WHERE id = ? AND owner_id = ?",
                    (project_id, owner_id),
                )
                conn.commit()
                if res.rowcount == 0:
                    return False

        # Remove physical microservice directory from shared host media volume
        try:
            ws_dir = self.get_workspace_dir(owner_id, project_id, current.name)
            if ws_dir.exists():
                shutil.rmtree(ws_dir, ignore_errors=True)
        except Exception as e:
            logger.warning("Failed to clean disk files for %s: %s", project_id, e)

        return True

    def duplicate_project(self, project_id: str, owner_id: str) -> ProjectDetail | None:
        source = self.get_project(project_id, owner_id)
        if not source:
            return None

        copy_name = f"{source.name}_copy"
        create_req = ProjectCreateRequest(
            name=copy_name,
            description=f"Copia de {source.name} ({source.description})",
            protocol=source.protocol,
            canvas_ir=source.canvas_ir,
            generated_files=source.generated_files,
        )
        new_project = self.create_project(owner_id, create_req)

        # Clone physical files if any exist
        try:
            src_dir = self.get_workspace_dir(owner_id, project_id, source.name)
            dst_dir = self.get_workspace_dir(owner_id, new_project.id, new_project.name)
            for item in src_dir.iterdir():
                if item.name not in ("meta.json", "canvas_ir.json"):
                    dest_path = dst_dir / item.name
                    if item.is_file():
                        shutil.copy2(item, dest_path)
                    elif item.is_dir():
                        shutil.copytree(item, dest_path, dirs_exist_ok=True)
        except Exception as e:
            logger.warning("Failed to duplicate physical workspace files: %s", e)

        return new_project


_project_manager: ProjectManager | None = None


def get_project_manager() -> ProjectManager:
    global _project_manager
    if _project_manager is None:
        _project_manager = ProjectManager()
    return _project_manager
