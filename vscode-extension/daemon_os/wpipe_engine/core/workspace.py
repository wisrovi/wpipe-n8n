"""WPipe Engine - Local Workspace & Project Manager
Manages local microservice directories, canvas persistence, .env variables and terminal commands.
Author: William Rodriguez (wisrovi.dev)
"""

import json
import os
import re
import shutil
import subprocess
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


DEFAULT_WORKSPACES_ROOT = Path.home() / ".wpipe" / "workspaces"


class WorkspaceManager:
    """Manages local microservice project workspaces on the developer's filesystem."""

    def __init__(self, root_dir: Path | None = None) -> None:
        self.root_dir = root_dir or DEFAULT_WORKSPACES_ROOT
        self.root_dir.mkdir(parents=True, exist_ok=True)

    def _sanitize_name(self, name: str) -> str:
        clean = re.sub(r"[^a-zA-Z0-9_-]", "_", name.strip())
        return clean or "unnamed_microservice"

    def _find_project_dir(self, project_id: str) -> Path | None:
        """Find project directory by its ID or exact directory name, strictly contained within root_dir."""
        if not project_id or not isinstance(project_id, str):
            return None
        # Disallow directory traversal sequences
        if ".." in project_id or "/" in project_id or "\\" in project_id:
            return None

        # 1. Exact match on directory name
        direct_path = (self.root_dir / project_id).resolve()
        root_resolved = self.root_dir.resolve()
        try:
            if not direct_path.is_relative_to(root_resolved) or direct_path == root_resolved:
                return None
        except (AttributeError, ValueError):
            if not str(direct_path).startswith(str(root_resolved)):
                return None

        if direct_path.is_dir():
            return direct_path

        # 2. Match by id in meta.json
        for pdir in self.root_dir.iterdir():
            if pdir.is_dir():
                meta_file = pdir / "meta.json"
                if meta_file.is_file():
                    try:
                        meta = json.loads(meta_file.read_text(encoding="utf-8"))
                        if meta.get("id") == project_id or meta.get("name") == project_id:
                            return pdir
                    except Exception:
                        pass
        return None

    def _safe_target(self, pdir: Path, rel_path: str) -> Path | None:
        """Resolve a project-relative file path, rejecting anything that escapes ``pdir``."""
        if not rel_path or not isinstance(rel_path, str):
            return None
        if rel_path.startswith(("/", "\\")) or ".." in Path(rel_path).parts:
            return None
        target = (pdir / rel_path).resolve()
        base = pdir.resolve()
        try:
            if not target.is_relative_to(base) or target == base:
                return None
        except (AttributeError, ValueError):
            return None
        if target.name in ("meta.json", "canvas_ir.json", "simulations.json"):
            return None
        return target

    def _write_generated_files(
        self,
        pdir: Path,
        generated_files: Any,
        allowed_paths: set[str] | None = None,
    ) -> int:
        """Write generated files safely inside ``pdir``.

        Args:
            pdir: Project directory.
            generated_files: ``{path: content}`` mapping or ``[{"path", "content"}]`` list.
            allowed_paths: When given, only these relative paths may be written (used to let
                users keep edits to engine-generated files without injecting new ones).

        Returns:
            Number of files written.
        """
        items: list[tuple[str, Any]] = []
        if isinstance(generated_files, dict):
            items = list(generated_files.items())
        elif isinstance(generated_files, list):
            for f in generated_files:
                if isinstance(f, dict):
                    items.append((f.get("path") or f.get("name") or "", f.get("content", "")))

        written = 0
        for rel_path, content in items:
            if allowed_paths is not None and rel_path not in allowed_paths:
                continue
            target = self._safe_target(pdir, rel_path)
            if target is None:
                continue
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(content if isinstance(content, str) else str(content), encoding="utf-8")
            written += 1
        return written

    def list_project_file_paths(self, project_id: str) -> set[str]:
        """Return the set of relative file paths currently stored in a project."""
        pdir = self._find_project_dir(project_id)
        if not pdir:
            return set()
        paths: set[str] = set()
        for fpath in pdir.rglob("*"):
            if fpath.is_file() and fpath.name not in ("meta.json", "canvas_ir.json", "simulations.json"):
                paths.add(str(fpath.relative_to(pdir)))
        return paths

    def list_projects(self) -> list[dict[str, Any]]:
        """List all microservice projects found in ~/.wpipe/workspaces/."""
        projects: list[dict[str, Any]] = []

        if not self.root_dir.exists():
            return projects

        for pdir in self.root_dir.iterdir():
            if not pdir.is_dir():
                continue

            meta_file = pdir / "meta.json"
            meta: dict[str, Any] = {}
            if meta_file.is_file():
                try:
                    meta = json.loads(meta_file.read_text(encoding="utf-8"))
                except Exception:
                    meta = {}

            proj_id = meta.get("id") or f"proj_{pdir.name}"
            proj_name = meta.get("name") or pdir.name
            desc = meta.get("description", f"Local microservice in {pdir.name}")
            docker_img = meta.get("docker_image", "python:3.11-slim")
            created_at = meta.get("created_at") or datetime.fromtimestamp(pdir.stat().st_ctime, tz=timezone.utc).isoformat()
            updated_at = meta.get("updated_at") or datetime.fromtimestamp(pdir.stat().st_mtime, tz=timezone.utc).isoformat()

            # Count nodes from canvas_ir.json if available
            canvas_file = pdir / "canvas_ir.json"
            node_count = meta.get("node_count", 0)
            if node_count == 0 and canvas_file.is_file():
                try:
                    cir = json.loads(canvas_file.read_text(encoding="utf-8"))
                    node_count = len(cir.get("nodes", []))
                except Exception:
                    pass

            projects.append({
                "id": proj_id,
                "name": proj_name,
                "description": desc,
                "docker_image": docker_img,
                "node_count": node_count,
                "created_at": created_at,
                "updated_at": updated_at,
                "path": str(pdir),
            })

        # Sort newest updated first
        projects.sort(key=lambda x: x.get("updated_at", ""), reverse=True)
        return projects

    def get_project(self, project_id: str) -> dict[str, Any] | None:
        """Get full project details including canvas_ir and generated files."""
        pdir = self._find_project_dir(project_id)
        if not pdir:
            return None

        meta_file = pdir / "meta.json"
        meta: dict[str, Any] = {}
        if meta_file.is_file():
            try:
                meta = json.loads(meta_file.read_text(encoding="utf-8"))
            except Exception:
                pass

        canvas_file = pdir / "canvas_ir.json"
        canvas_ir: dict[str, Any] = {}
        if canvas_file.is_file():
            try:
                canvas_ir = json.loads(canvas_file.read_text(encoding="utf-8"))
            except Exception:
                pass

        # Scan files in directory to construct generated_files
        generated_files: list[dict[str, str]] = []
        for fpath in pdir.rglob("*"):
            if fpath.is_file() and not fpath.name.startswith(".") and fpath.name not in ("meta.json", "canvas_ir.json", "simulations.json"):
                rel_path = str(fpath.relative_to(pdir))
                try:
                    content = fpath.read_text(encoding="utf-8")
                    generated_files.append({
                        "name": fpath.name,
                        "path": rel_path,
                        "content": content,
                    })
                except Exception:
                    pass

        return {
            "id": meta.get("id") or f"proj_{pdir.name}",
            "name": meta.get("name") or pdir.name,
            "description": meta.get("description", ""),
            "docker_image": meta.get("docker_image", "python:3.11-slim"),
            "protocol": meta.get("protocol", "fastapi"),
            "canvas_ir": canvas_ir,
            "generated_files": generated_files,
            "files": generated_files,
            "node_count": len(canvas_ir.get("nodes", [])),
            "created_at": meta.get("created_at") or datetime.now(timezone.utc).isoformat(),
            "updated_at": meta.get("updated_at") or datetime.now(timezone.utc).isoformat(),
            "workspace_dir": str(pdir),
        }

    def create_project(
        self,
        name: str,
        description: str = "",
        docker_image: str = "python:3.11-slim",
        protocol: str = "fastapi",
        canvas_ir: dict[str, Any] | None = None,
        generated_files: list[dict[str, str]] | None = None,
    ) -> dict[str, Any]:
        """Create a new local project directory with canvas_ir, meta, and files."""
        clean_name = self._sanitize_name(name)
        proj_id = f"proj_{uuid.uuid4().hex[:8]}"

        pdir = self.root_dir / clean_name
        if pdir.exists():
            # If name exists, append id suffix
            pdir = self.root_dir / f"{clean_name}_{proj_id[5:]}"
        pdir.mkdir(parents=True, exist_ok=True)

        now = datetime.now(timezone.utc).isoformat()
        nodes = (canvas_ir or {}).get("nodes", [])

        meta = {
            "id": proj_id,
            "name": clean_name,
            "description": description or f"Microservicio {clean_name}",
            "docker_image": docker_image or "python:3.11-slim",
            "protocol": protocol or "fastapi",
            "node_count": len(nodes),
            "created_at": now,
            "updated_at": now,
        }

        # Write meta.json
        (pdir / "meta.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")

        # Write canvas_ir.json
        if canvas_ir:
            (pdir / "canvas_ir.json").write_text(json.dumps(canvas_ir, indent=2), encoding="utf-8")

        # Write generated files (path traversal safe)
        if generated_files:
            self._write_generated_files(pdir, generated_files)

        # Write default .env if not exists
        env_file = pdir / ".env"
        if not env_file.exists():
            env_file.write_text(f"PORT=8000\nENV=development\nSERVICE_NAME={clean_name}\n", encoding="utf-8")

        return self.get_project(proj_id) or meta

    def update_project(
        self,
        project_id: str,
        data: dict[str, Any],
        allowed_paths: set[str] | None = None,
    ) -> dict[str, Any] | None:
        """Update existing project canvas_ir, files and meta.

        ``allowed_paths`` restricts which generated files may be (over)written.
        """
        pdir = self._find_project_dir(project_id)
        if not pdir:
            return None

        now = datetime.now(timezone.utc).isoformat()
        meta_file = pdir / "meta.json"
        meta: dict[str, Any] = {}
        if meta_file.is_file():
            try:
                meta = json.loads(meta_file.read_text(encoding="utf-8"))
            except Exception:
                meta = {}

        if "name" in data:
            meta["name"] = self._sanitize_name(data["name"])
        if "description" in data:
            meta["description"] = data["description"]
        if "docker_image" in data:
            meta["docker_image"] = data["docker_image"]
        meta["updated_at"] = now

        if "canvas_ir" in data:
            cir = data["canvas_ir"]
            meta["node_count"] = len(cir.get("nodes", []))
            (pdir / "canvas_ir.json").write_text(json.dumps(cir, indent=2), encoding="utf-8")

        meta_file.write_text(json.dumps(meta, indent=2), encoding="utf-8")

        if "generated_files" in data:
            self._write_generated_files(pdir, data["generated_files"], allowed_paths=allowed_paths)

        return self.get_project(meta.get("id", project_id))

    def duplicate_project(self, project_id: str) -> dict[str, Any] | None:
        """Duplicate an existing project directory."""
        source_dir = self._find_project_dir(project_id)
        if not source_dir:
            return None

        meta_file = source_dir / "meta.json"
        meta: dict[str, Any] = {}
        if meta_file.is_file():
            try:
                meta = json.loads(meta_file.read_text(encoding="utf-8"))
            except Exception:
                pass

        base_name = meta.get("name", source_dir.name)
        new_name = f"{base_name}_copy"
        new_id = f"proj_{uuid.uuid4().hex[:8]}"

        target_dir = self.root_dir / new_name
        counter = 1
        while target_dir.exists():
            target_dir = self.root_dir / f"{new_name}_{counter}"
            counter += 1

        shutil.copytree(source_dir, target_dir)

        now = datetime.now(timezone.utc).isoformat()
        meta["id"] = new_id
        meta["name"] = target_dir.name
        meta["description"] = f"Copia de {base_name}"
        meta["created_at"] = now
        meta["updated_at"] = now
        (target_dir / "meta.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")

        return self.get_project(new_id)

    def delete_project(self, project_id: str) -> bool:
        """Delete project directory completely from filesystem with strict containment verification."""
        pdir = self._find_project_dir(project_id)
        if not pdir or not pdir.is_dir():
            return False

        # Extra safety verification: pdir must be strictly a subfolder of root_dir
        try:
            resolved_pdir = pdir.resolve()
            resolved_root = self.root_dir.resolve()
            if not resolved_pdir.is_relative_to(resolved_root) or resolved_pdir == resolved_root:
                return False
        except (AttributeError, ValueError):
            return False

        try:
            shutil.rmtree(pdir)
            return True
        except Exception:
            return False

    def get_env_vars(self, project_id: str) -> list[dict[str, str]]:
        """Parse .env file into key-value pairs."""
        pdir = self._find_project_dir(project_id)
        if not pdir:
            return []

        env_file = pdir / ".env"
        if not env_file.is_file():
            return []

        variables: list[dict[str, str]] = []
        for line in env_file.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            variables.append({"key": k.strip(), "value": v.strip()})
        return variables

    def save_env_vars(self, project_id: str, variables: list[dict[str, str]]) -> bool:
        """Save variables to .env file."""
        pdir = self._find_project_dir(project_id)
        if not pdir:
            return False

        lines = [f"{v.get('key', '').strip()}={v.get('value', '').strip()}" for v in variables if v.get("key")]
        content = "\n".join(lines) + "\n"
        (pdir / ".env").write_text(content, encoding="utf-8")
        return True

    def get_simulations(self, project_id: str) -> list[dict[str, Any]]:
        """Get simulation history for project."""
        pdir = self._find_project_dir(project_id)
        if not pdir:
            return []

        sim_file = pdir / "simulations.json"
        if not sim_file.is_file():
            return []

        try:
            return json.loads(sim_file.read_text(encoding="utf-8"))
        except Exception:
            return []

    def add_simulation(self, project_id: str, simulation_log: dict[str, Any]) -> bool:
        """Append simulation run to project history."""
        pdir = self._find_project_dir(project_id)
        if not pdir:
            return False

        sim_file = pdir / "simulations.json"
        history: list[dict[str, Any]] = []
        if sim_file.is_file():
            try:
                history = json.loads(sim_file.read_text(encoding="utf-8"))
            except Exception:
                history = []

        simulation_log["id"] = simulation_log.get("id") or f"sim_{uuid.uuid4().hex[:8]}"
        simulation_log["created_at"] = datetime.now(timezone.utc).isoformat()
        history.insert(0, simulation_log)
        # Keep last 50 runs
        history = history[:50]

        try:
            sim_file.write_text(json.dumps(history, indent=2), encoding="utf-8")
            return True
        except Exception:
            return False

    def execute_terminal(self, project_id: str, command: str) -> dict[str, Any]:
        """Execute a safe shell command inside the project workspace directory."""
        pdir = self._find_project_dir(project_id)
        if not pdir:
            return {"stdout": "", "stderr": "Project directory not found or invalid.", "exit_code": 1, "cwd": ""}

        cmd = (command or "").strip()
        if not cmd:
            return {"stdout": "", "stderr": "", "exit_code": 0, "cwd": str(pdir)}

        forbidden = ["rm -rf /", ":(){ :|:& };:", "mkfs", "dd if=", "shutdown", "reboot"]
        for f in forbidden:
            if f in cmd:
                return {
                    "stdout": "",
                    "stderr": f"Command rejected for security reasons: {f}",
                    "exit_code": 1,
                    "cwd": str(pdir),
                }

        try:
            res = subprocess.run(
                cmd,
                shell=True,
                cwd=str(pdir),
                capture_output=True,
                text=True,
                timeout=30,
            )
            return {
                "stdout": res.stdout,
                "stderr": res.stderr,
                "exit_code": res.returncode,
                "cwd": str(pdir),
            }
        except subprocess.TimeoutExpired:
            return {
                "stdout": "",
                "stderr": "Command execution timed out after 30 seconds.",
                "exit_code": 124,
                "cwd": str(pdir),
            }
        except Exception as e:
            return {
                "stdout": "",
                "stderr": f"Execution error: {str(e)}",
                "exit_code": 1,
                "cwd": str(pdir),
            }
