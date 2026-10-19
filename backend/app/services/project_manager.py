"""Project and Multi-Tenant Workspace Manager Service.

Provides SQLite-backed persistence, strict user-level workspace isolation,
and microservices lifecycle management.
"""

from __future__ import annotations

import json
import os
import re
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path

from app.core.logging import get_logger
from app.schemas.projects import (
    ProjectCreateRequest,
    ProjectDetail,
    ProjectSummary,
    ProjectUpdateRequest,
    UserProfile,
)

logger = get_logger(__name__)

DB_PATH = Path(__file__).resolve().parent.parent.parent / "data" / "studio.db"
WORKSPACES_ROOT = Path(__file__).resolve().parent.parent.parent / "data" / "workspaces"


def _slugify(name: str) -> str:
    cleaned = re.sub(r"[^\w\s-]", "", name).strip().lower()
    return re.sub(r"[-\s]+", "_", cleaned) or "microservice"


class ProjectManager:
    def __init__(self, db_path: Path = DB_PATH) -> None:
        self.db_path = db_path
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        WORKSPACES_ROOT.mkdir(parents=True, exist_ok=True)
        self._init_db()

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
                    name TEXT NOT NULL,
                    role TEXT NOT NULL,
                    avatar TEXT NOT NULL,
                    created_at TEXT NOT NULL
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

    def _seed_default_data(self) -> None:
        with self._get_connection() as conn:
            # Seed 1: William Rodriguez (AI Leader & Solutions Architect)
            william_exists = conn.execute(
                "SELECT 1 FROM users WHERE username = ?", ("william.rodriguez",)
            ).fetchone()
            if not william_exists:
                conn.execute(
                    """
                    INSERT INTO users (id, username, name, role, avatar, created_at)
                    VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    (
                        "usr_william",
                        "william.rodriguez",
                        "William R.",
                        "AI Leader & Solutions Architect",
                        "WR",
                        datetime.now(timezone.utc).isoformat(),
                    ),
                )

                # Seed sample microservice for William
                now = datetime.now(timezone.utc).isoformat()
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
                        json.dumps({"nodes": [{"id": "trigger_1", "type": "wpipe_trigger", "data": {"node_type": "trigger", "trigger_type": "api", "trigger_param": "/run"}}], "edges": []}),
                        json.dumps([]),
                        now,
                        now,
                    ),
                )

            # Seed 2: Dev Engineer
            dev_exists = conn.execute(
                "SELECT 1 FROM users WHERE username = ?", ("developer",)
            ).fetchone()
            if not dev_exists:
                conn.execute(
                    """
                    INSERT INTO users (id, username, name, role, avatar, created_at)
                    VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    (
                        "usr_developer",
                        "developer",
                        "Dev Engineer",
                        "Pipeline Core Developer",
                        "DE",
                        datetime.now(timezone.utc).isoformat(),
                    ),
                )
                now = datetime.now(timezone.utc).isoformat()
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
                        json.dumps({"nodes": [{"id": "trigger_kafka", "type": "wpipe_trigger", "data": {"node_type": "trigger", "trigger_type": "kafka", "trigger_param": "telemetry.sensors"}}], "edges": []}),
                        json.dumps([]),
                        now,
                        now,
                    ),
                )

            # Seed 3: Guest / Sandbox
            guest_exists = conn.execute(
                "SELECT 1 FROM users WHERE username = ?", ("guest",)
            ).fetchone()
            if not guest_exists:
                conn.execute(
                    """
                    INSERT INTO users (id, username, name, role, avatar, created_at)
                    VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    (
                        "usr_guest",
                        "guest",
                        "Invitado",
                        "Sandbox Explorer",
                        "IN",
                        datetime.now(timezone.utc).isoformat(),
                    ),
                )
            conn.commit()

    # ---------------- User Management ----------------

    def list_users(self) -> list[UserProfile]:
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
        with self._get_connection() as conn:
            row = conn.execute("SELECT * FROM users WHERE username = ?", (username.strip().lower(),)).fetchone()
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

    def register_user(self, username: str, name: str | None = None, role: str | None = None) -> UserProfile:
        clean_user = username.strip().lower()
        existing = self.get_user_by_username(clean_user)
        if existing:
            return existing

        user_id = f"usr_{uuid.uuid4().hex[:8]}"
        display_name = name.strip() if name and name.strip() else clean_user.capitalize()
        user_role = role.strip() if role and role.strip() else "Developer"
        initials = "".join([part[0].upper() for part in display_name.split() if part])[:2] or "US"
        now = datetime.now(timezone.utc).isoformat()

        with self._get_connection() as conn:
            conn.execute(
                """
                INSERT INTO users (id, username, name, role, avatar, created_at)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (user_id, clean_user, display_name, user_role, initials, now),
            )
            conn.commit()

        # Create user workspace directory
        (WORKSPACES_ROOT / user_id).mkdir(parents=True, exist_ok=True)
        return UserProfile(
            id=user_id,
            username=clean_user,
            name=display_name,
            role=user_role,
            avatar=initials,
            created_at=now,
        )

    # ---------------- Multi-Tenant Project Management ----------------

    def get_workspace_dir(self, owner_id: str, project_id: str) -> Path:
        # Strictly sandbox directory within WORKSPACES_ROOT to avoid any path traversal
        clean_owner = re.sub(r"[^\w-]", "", owner_id)
        clean_proj = re.sub(r"[^\w-]", "", project_id)
        path = (WORKSPACES_ROOT / clean_owner / clean_proj).resolve()
        if not str(path).startswith(str(WORKSPACES_ROOT.resolve())):
            raise ValueError("Path traversal attempt detected")
        path.mkdir(parents=True, exist_ok=True)
        return path

    def list_projects(self, owner_id: str) -> list[ProjectSummary]:
        with self._get_connection() as conn:
            rows = conn.execute(
                "SELECT * FROM projects WHERE owner_id = ? ORDER BY updated_at DESC",
                (owner_id,),
            ).fetchall()
            summaries: list[ProjectSummary] = []
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
        user = self.get_user_by_id(owner_id)
        if not user:
            raise ValueError(f"User {owner_id} does not exist")

        proj_id = f"proj_{uuid.uuid4().hex[:10]}"
        clean_name = _slugify(req.name)
        now = datetime.now(timezone.utc).isoformat()
        canvas_ir_dict = req.canvas_ir or {}
        generated_files_list = req.generated_files or []

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

        # Initialize physical workspace directory for this project
        ws_dir = self.get_workspace_dir(owner_id, proj_id)
        with open(ws_dir / "meta.json", "w", encoding="utf-8") as f:
            json.dump({"id": proj_id, "name": clean_name, "owner_id": owner_id}, f)

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
        now = datetime.now(timezone.utc).isoformat()

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

        # Update physical workspace metadata
        try:
            ws_dir = self.get_workspace_dir(owner_id, project_id)
            with open(ws_dir / "meta.json", "w", encoding="utf-8") as f:
                json.dump({"id": project_id, "name": updated_name, "owner_id": owner_id, "updated_at": now}, f)
        except Exception as e:
            logger.warning("Failed to update disk meta for %s: %s", project_id, e)

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
        with self._get_connection() as conn:
            res = conn.execute(
                "DELETE FROM projects WHERE id = ? AND owner_id = ?",
                (project_id, owner_id),
            )
            conn.commit()
            if res.rowcount == 0:
                return False

        # Remove physical directory
        try:
            import shutil
            ws_dir = self.get_workspace_dir(owner_id, project_id)
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
        return self.create_project(owner_id, create_req)


_project_manager: ProjectManager | None = None


def get_project_manager() -> ProjectManager:
    global _project_manager
    if _project_manager is None:
        _project_manager = ProjectManager()
    return _project_manager
