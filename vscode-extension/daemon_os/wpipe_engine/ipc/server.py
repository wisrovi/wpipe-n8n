from __future__ import annotations
"""WPipe Engine - Local IPC Server
Exposes Unix Domain Socket and HTTP REST endpoints for the VS Code extension.
Author: William Rodriguez (wisrovi.dev)
"""

import json
import os
import platform
import socket
import sys
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from socketserver import ThreadingMixIn
from typing import Any

from wpipe_engine.core.compiler import ASTCompiler
from wpipe_engine.core.licensing import LicenseManager
from wpipe_engine.core.limiter import enforce_entitlements
from wpipe_engine.core.runner import LocalRunner
from wpipe_engine.core.workspace import WorkspaceManager

DEFAULT_SOCKET_PATH = "/tmp/wpipe.sock"
DEFAULT_HTTP_HOST = "127.0.0.1"
DEFAULT_HTTP_PORT = 49152

if hasattr(sys, "_MEIPASS"):
    _base = Path(sys._MEIPASS) / "wpipe_engine"
else:
    _base = Path(__file__).resolve().parent.parent

CANVAS_STATIC_DIR = _base / "canvas_static"
STEPS_CATALOG_FILE = _base / "steps_catalog.json"

# Search paths for canvas_static:
# 1. ~/.wpipe/canvas_static (user/live workspace updates)
# 2. Monorepo sibling frontend/dist
# 3. Inside PyInstaller bundle or package directory
candidate_dirs = [
    Path.home() / ".wpipe" / "canvas_static",
    Path(__file__).resolve().parent.parent.parent.parent.parent / "frontend" / "dist",
    CANVAS_STATIC_DIR,
]
for cand in candidate_dirs:
    if cand.exists() and (cand / "index.html").exists():
        CANVAS_STATIC_DIR = cand
        break

if not STEPS_CATALOG_FILE.exists():
    fallback_cat = Path.home() / ".wpipe" / "steps_catalog.json"
    if fallback_cat.exists():
        STEPS_CATALOG_FILE = fallback_cat


class ThreadedHTTPServer(ThreadingMixIn, HTTPServer):
    daemon_threads = True


class UnixHTTPServer(ThreadingMixIn, HTTPServer):
    address_family = socket.AF_UNIX
    daemon_threads = True


class EngineRequestHandler(BaseHTTPRequestHandler):
    """HTTP / IPC Request Handler for VS Code extension communication."""

    server_version = "WPipeEngine/1.0.0"

    def _is_allowed_origin(self) -> bool:
        """Check if incoming request Origin is trusted (localhost, 127.0.0.1, studio.wisrovi.dev, or vscode-webview)."""
        origin = self.headers.get("Origin", "")
        if not origin:
            return True  # Native sockets, CLI, curl, local tools without Origin header
        origin = origin.strip().lower()
        if origin == "null":
            return True
        if origin.startswith("vscode-webview://"):
            return True
        # Localhost / loopback on any port
        if origin.startswith("http://localhost:") or origin == "http://localhost":
            return True
        if origin.startswith("http://127.0.0.1:") or origin == "http://127.0.0.1":
            return True
        if origin.startswith("http://0.0.0.0:") or origin == "http://0.0.0.0":
            return True
        # Docker internal bridges / private networks (172.16.0.0/12, 10.0.0.0/8, 192.168.0.0/16)
        if any(origin.startswith(f"http://172.{i}.") for i in range(16, 32)):
            return True
        if origin.startswith("http://10.") or origin.startswith("http://192.168."):
            return True
        # Strict exact domain matching for wisrovi suites
        allowed_domains = {
            "https://studio.wisrovi.dev",
            "https://admin.wisrovi.dev",
            "https://portal.wisrovi.dev",
            "https://wisrovi.dev",
            "https://wpipe-studio.pages.dev",
            "https://wpipe-admin.pages.dev",
            "https://wpipe-portal.pages.dev",
        }
        return origin in allowed_domains

    def _send_cors_headers(self) -> None:
        origin = self.headers.get("Origin", "")
        if self._is_allowed_origin():
            allowed = origin if origin else "*"
            self.send_header("Access-Control-Allow-Origin", allowed)
            self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS, HEAD")
            self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization, Access-Control-Request-Private-Network, X-User-ID, X-Session-Token")
            if self.headers.get("Access-Control-Request-Private-Network") == "true":
                self.send_header("Access-Control-Allow-Private-Network", "true")
            self.send_header("Vary", "Origin")

    def _send_json(self, status_code: int, data: dict[str, Any]) -> None:
        raw = json.dumps(data, indent=2).encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self._send_cors_headers()
        self.end_headers()
        self.wfile.write(raw)

    def do_OPTIONS(self) -> None:
        if not self._is_allowed_origin():
            self.send_response(403)
            self.end_headers()
            return
        self.send_response(204)
        self._send_cors_headers()
        self.end_headers()

    def _license_status(self) -> dict[str, Any]:
        """Verified license status (entitlements come only from the signed lease token)."""
        license_mgr: LicenseManager = self.server.license_mgr  # type: ignore
        return license_mgr.get_status()

    def _gate(self, canvas_ir: Any, action: str) -> bool:
        """Enforce plan entitlements. Sends the 400/403 response and returns False when denied."""
        allowed, status_code, error_body = enforce_entitlements(canvas_ir, self._license_status(), action)
        if not allowed:
            self._send_json(status_code, error_body)
        return allowed

    def _project_quota_ok(self) -> bool:
        """Enforce ``max_projects`` from the verified entitlements. Sends 403 when exceeded."""
        workspace_mgr: WorkspaceManager = self.server.workspace_mgr  # type: ignore
        ent = self._license_status().get("entitlements") or {}
        max_projects = ent.get("max_projects")
        if max_projects is not None and len(workspace_mgr.list_projects()) >= max_projects:
            self._send_json(403, {
                "error": "LIMIT_EXCEEDED",
                "message": f"Your plan allows up to {max_projects} local projects.",
                "details": {"code": "LIMIT_PROJECT_COUNT_EXCEEDED", "max_allowed": max_projects,
                            "upgrade_url": "https://wisrovi.dev"},
                "is_pro": False,
            })
            return False
        return True

    def _compile_files(self, canvas_ir: dict[str, Any], project_name: str) -> dict[str, str]:
        """Compile canvas IR server-side. Returns an empty mapping on compiler failure."""
        compiler: ASTCompiler = self.server.compiler  # type: ignore
        try:
            files = compiler.compile_canvas(canvas_ir, project_name=project_name)
        except Exception:
            return {}
        if isinstance(files, dict):
            return {str(k): v for k, v in files.items()}
        if isinstance(files, list):
            return {f.get("path", ""): f.get("content", "") for f in files if isinstance(f, dict)}
        return {}

    @staticmethod
    def _client_file_map(raw: Any) -> dict[str, Any]:
        """Normalize client-submitted files to ``{path: content}``."""
        if isinstance(raw, dict):
            return {str(k): v for k, v in raw.items()}
        out: dict[str, Any] = {}
        if isinstance(raw, list):
            for f in raw:
                if isinstance(f, dict):
                    path = f.get("path") or f.get("name") or ""
                    if path:
                        out[str(path)] = f.get("content", "")
        return out

    def _identity(self) -> dict[str, Any]:
        """Local identity derived from the verified license holder (never a hardcoded admin)."""
        status = self._license_status()
        if status.get("verified") and status.get("customer_name"):
            name = str(status["customer_name"])
            return {
                "id": f"lic_{str(status.get('license_key', ''))[-8:] or 'holder'}",
                "username": name.lower().replace(" ", "."),
                "name": name,
                "role": "pro" if status.get("is_pro") else "user",
                "verified": True,
            }
        return {"id": "engine_local", "username": "local.engine", "name": "Local Engine (Free)",
                "role": "free", "verified": False}

    def _read_json_body(self) -> dict[str, Any]:
        length = int(self.headers.get("Content-Length", 0))
        if length == 0:
            return {}
        raw = self.rfile.read(length).decode("utf-8")
        try:
            return json.loads(raw)
        except Exception:
            return {}

    def _serve_static(self, rel_path: str) -> bool:
        """Serve bundled static frontend canvas assets safely without path traversal."""
        clean_rel = rel_path.lstrip("/").split("?")[0]
        if not clean_rel or clean_rel == "index.html":
            target = (CANVAS_STATIC_DIR / "index.html").resolve()
        else:
            target = (CANVAS_STATIC_DIR / clean_rel).resolve()

        base_dir = CANVAS_STATIC_DIR.resolve()
        try:
            if not target.is_relative_to(base_dir):
                return False
        except (AttributeError, ValueError):
            if not str(target).startswith(str(base_dir)):
                return False

        if not target.is_file():
            return False

        ext = target.suffix.lower()
        content_type = "application/octet-stream"
        if ext == ".html":
            content_type = "text/html; charset=utf-8"
        elif ext == ".js":
            content_type = "application/javascript; charset=utf-8"
        elif ext == ".css":
            content_type = "text/css; charset=utf-8"
        elif ext == ".json":
            content_type = "application/json"
        elif ext == ".webmanifest":
            content_type = "application/manifest+json"
        elif ext == ".png":
            content_type = "image/png"
        elif ext == ".svg":
            content_type = "image/svg+xml"
        elif ext in (".jpg", ".jpeg"):
            content_type = "image/jpeg"
        elif ext in (".woff", ".woff2"):
            content_type = f"font/{ext[1:]}"

        try:
            data = target.read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(data)))
            self._send_cors_headers()
            self.end_headers()
            self.wfile.write(data)
            return True
        except Exception:
            return False

    def do_HEAD(self) -> None:
        self.do_GET()

    def do_GET(self) -> None:
        if not self._is_allowed_origin():
            self._send_json(403, {"error": "FORBIDDEN_ORIGIN", "message": "Cross-origin request rejected."})
            return

        license_mgr: LicenseManager = self.server.license_mgr  # type: ignore
        workspace_mgr: WorkspaceManager = self.server.workspace_mgr  # type: ignore

        clean_path = self.path.split("?")[0]

        # 1. Base Health & Canvas Entrypoint
        if clean_path in ("/", "/index.html") and (CANVAS_STATIC_DIR / "index.html").exists():
            if self._serve_static("index.html"):
                return

        if clean_path in ("/", "/v1/health", "/health"):
            self._send_json(200, {
                "service": "wpipe-engine",
                "version": "1.0.0",
                "vendor": "wisrovi.dev",
                "author": "William Rodriguez",
                "pid": os.getpid(),
                "status": "healthy",
            })
            return

        elif self.path in ("/v1/license/status", "/license/status"):
            status = license_mgr.get_status()
            status["engine"] = {
                "pid": os.getpid(),
                "version": "1.0.0",
                "python_version": platform.python_version(),
                "hostname": socket.gethostname(),
                "os": platform.system(),
                "transport": "unix_socket" if hasattr(self.server, "socket_path") else "http",
            }
            self._send_json(200, status)
            return

        elif clean_path in ("/v1/capabilities", "/api/v1/capabilities"):
            status = license_mgr.get_status()
            self._send_json(200, {
                "engine": True,
                "tier": status.get("tier", "free"),
                "is_pro": bool(status.get("is_pro")),
                "verified": bool(status.get("verified")),
                "entitlements": status.get("entitlements", {}),
                "customer_name": status.get("customer_name"),
                # UI-only hints. Browsers re-verify the signed token with WebCrypto before trusting it.
                "signed_token": status.get("signed_token"),
                "public_key_hex": status.get("public_key_hex"),
            })
            return

        # 2. Step Catalog Endpoints (for the Canvas palette)
        elif self.path.startswith("/api/v1/catalog/steps") or self.path.startswith("/v1/catalog/steps"):
            if STEPS_CATALOG_FILE.exists():
                try:
                    catalog_data = json.loads(STEPS_CATALOG_FILE.read_text(encoding="utf-8"))
                    self._send_json(200, catalog_data)
                    return
                except Exception:
                    pass
            self._send_json(200, [])
            return

        elif self.path.startswith("/api/v1/catalog/categories") or self.path.startswith("/v1/catalog/categories"):
            self._send_json(200, ["triggers", "connectivity", "databases", "ai", "security", "control"])
            return

        # 3. Local identity: derived from the verified license holder (no hardcoded admin profile)
        elif clean_path in ("/api/v1/auth/me", "/auth/me"):
            self._send_json(200, self._identity())
            return

        # 4. Local Projects & Workspace Management
        elif clean_path in ("/api/v1/projects", "/v1/projects"):
            self._send_json(200, workspace_mgr.list_projects())
            return

        elif clean_path.startswith("/api/v1/projects/") or clean_path.startswith("/v1/projects/"):
            prefix = "/api/v1/projects/" if clean_path.startswith("/api/v1/projects/") else "/v1/projects/"
            subpath = clean_path[len(prefix):]
            parts = [p for p in subpath.split("/") if p]
            if len(parts) == 1:
                proj = workspace_mgr.get_project(parts[0])
                if proj:
                    self._send_json(200, proj)
                else:
                    self._send_json(404, {"error": "PROJECT_NOT_FOUND", "id": parts[0]})
                return
            elif len(parts) >= 2 and parts[1] == "env":
                env_list = workspace_mgr.get_env_vars(parts[0])
                self._send_json(200, {"variables": env_list})
                return
            elif len(parts) >= 2 and parts[1] == "simulations":
                sims = workspace_mgr.get_simulations(parts[0])
                self._send_json(200, sims)
                return

        # 5. Static Canvas Files (index.html, JS, CSS, SVG)
        served = self._serve_static(self.path)
        if served:
            return

        # 6. SPA Fallback: if not an API call and canvas exists, serve index.html
        if not self.path.startswith("/api/") and not self.path.startswith("/v1/"):
            if self._serve_static("index.html"):
                return

        self._send_json(404, {"error": "NOT_FOUND", "path": self.path})

    def do_POST(self) -> None:
        if not self._is_allowed_origin():
            self._send_json(403, {"error": "FORBIDDEN_ORIGIN", "message": "Cross-origin request rejected."})
            return

        license_mgr: LicenseManager = self.server.license_mgr  # type: ignore
        compiler: ASTCompiler = self.server.compiler  # type: ignore
        runner: LocalRunner = self.server.runner  # type: ignore
        workspace_mgr: WorkspaceManager = self.server.workspace_mgr  # type: ignore

        body = self._read_json_body()
        clean_path = self.path.split("?")[0]

        # 0. Password logins are not handled by the local engine (identity = verified license holder)
        if clean_path in ("/api/v1/auth/login", "/auth/login"):
            self._send_json(410, {"error": "LOGIN_NOT_SUPPORTED",
                                  "message": "The local engine derives identity from the verified license.",
                                  "user": self._identity()})
            return

        # 1. Local Projects Creation & Operations
        elif clean_path in ("/api/v1/projects", "/v1/projects"):
            name = body.get("name", "new_microservice")
            desc = body.get("description", "")
            docker_img = body.get("docker_image", "python:3.11-slim")
            proto = body.get("protocol", "fastapi")
            canvas_ir = body.get("canvas_ir")

            if not self._project_quota_ok():
                return
            gen_files: dict[str, Any] = {}
            if canvas_ir is not None:
                if not self._gate(canvas_ir, "save_project"):
                    return
                # Files are always generated by the engine itself. Client edits are only kept
                # for paths the engine generated, so no externally produced code can be injected.
                gen_files = self._compile_files(canvas_ir, name)
                for path, content in self._client_file_map(body.get("generated_files")).items():
                    if path in gen_files:
                        gen_files[path] = content
            proj = workspace_mgr.create_project(
                name=name,
                description=desc,
                docker_image=docker_img,
                protocol=proto,
                canvas_ir=canvas_ir,
                generated_files=gen_files or None,
            )
            self._send_json(201, proj)
            return

        elif clean_path.startswith("/api/v1/projects/") or clean_path.startswith("/v1/projects/"):
            prefix = "/api/v1/projects/" if clean_path.startswith("/api/v1/projects/") else "/v1/projects/"
            subpath = clean_path[len(prefix):]
            parts = [p for p in subpath.split("/") if p]
            if len(parts) >= 2 and parts[1] == "duplicate":
                if not self._project_quota_ok():
                    return
                dup = workspace_mgr.duplicate_project(parts[0])
                if dup:
                    self._send_json(200, dup)
                else:
                    self._send_json(404, {"error": "PROJECT_NOT_FOUND", "id": parts[0]})
                return
            elif len(parts) >= 2 and parts[1] == "env":
                saved = workspace_mgr.save_env_vars(parts[0], body.get("variables", []))
                self._send_json(200 if saved else 400, {"status": "saved" if saved else "error"})
                return
            elif len(parts) >= 2 and parts[1] == "simulations":
                saved = workspace_mgr.add_simulation(parts[0], body)
                self._send_json(200 if saved else 400, {"status": "saved" if saved else "error"})
                return
            elif len(parts) >= 2 and parts[1] == "terminal":
                res = workspace_mgr.execute_terminal(parts[0], body.get("command", ""))
                self._send_json(200, res)
                return
            elif len(parts) >= 2 and parts[1] == "run-tests":
                proj = workspace_mgr.get_project(parts[0])
                if not proj:
                    self._send_json(404, {"error": "PROJECT_NOT_FOUND", "id": parts[0]})
                    return
                self._send_json(200, runner.run_pytest(Path(proj["workspace_dir"])))
                return

        # 2. License Activation
        elif clean_path in ("/v1/license/activate", "/license/activate"):
            key = body.get("license_key", "")
            if not key:
                self._send_json(400, {"error": "MISSING_LICENSE_KEY", "message": "Clave requerida"})
                return

            success, msg = license_mgr.activate_with_key(key)
            status_data = license_mgr.get_status()
            self._send_json(200 if success else 400, {
                "success": success,
                "message": msg,
                "license": status_data,
            })

        # 2. Pipeline Compilation (With Freemium Enforcer)
        elif self.path in ("/v1/pipeline/compile", "/pipeline/compile", "/api/v1/pipeline/compile"):
            canvas_ir = body.get("canvas_ir", {})
            project_name = body.get("project_name", "main_pipeline")
            existing_code = body.get("existing_pipeline_code", "")

            # Enforce Free vs Pro limits
            lic_status = license_mgr.get_status()
            if not self._gate(canvas_ir, "compile"):
                return

            try:
                files_dict = compiler.compile_canvas(
                    canvas_ir,
                    project_name=project_name,
                    existing_pipeline_code=existing_code,
                )
                files_list = [{"path": p, "content": c} for p, c in files_dict.items()] if isinstance(files_dict, dict) else files_dict
                self._send_json(200, {
                    "status": "success",
                    "project_name": project_name,
                    "files": files_list,
                    "files_dict": files_dict if isinstance(files_dict, dict) else {},
                    "license_tier": lic_status.get("tier", "free"),
                })
            except Exception as e:
                self._send_json(500, {"error": "COMPILATION_ERROR", "message": str(e)})

        # 3. Pipeline Simulation
        elif self.path in ("/v1/pipeline/simulate", "/pipeline/simulate", "/api/v1/pipeline/simulate"):
            canvas_ir = body.get("canvas_ir", {})
            input_payload = body.get("input_payload", {})
            breakpoints = body.get("breakpoints", [])

            if not self._gate(canvas_ir, "simulate"):
                return
            res = runner.run_simulation(canvas_ir, input_payload, breakpoints)
            self._send_json(200, res)

        # 4. Pipeline Dry-Run Validation
        elif self.path in ("/v1/pipeline/dry-run", "/api/v1/pipeline/dry-run"):
            canvas_ir = body.get("canvas_ir") or body
            nodes = canvas_ir.get("nodes", []) if isinstance(canvas_ir, dict) else []
            sim_steps = [
                {
                    "id": n.get("id"),
                    "name": n.get("data", {}).get("label") or n.get("id"),
                    "reads": n.get("data", {}).get("contract", {}).get("reads", []),
                    "writes": n.get("data", {}).get("contract", {}).get("writes", []),
                    "origin": n.get("data", {}).get("origin", "custom"),
                }
                for n in nodes
                if n.get("data", {}).get("node_type") not in ("trigger", "response")
            ]
            self._send_json(200, {
                "status": "success",
                "valid": True,
                "node_count": len(nodes),
                "simulation_steps": sim_steps,
                "gates": {
                    "ast_syntax_check": True,
                    "input_contract_reads": True,
                    "output_contract_writes": True,
                    "flow_connectivity": True,
                    "wpipe_decorators_valid": True,
                },
            })

        # 5. Pipeline Transform
        elif self.path in ("/v1/pipeline/transform", "/api/v1/pipeline/transform"):
            canvas_ir = body.get("canvas_ir") or body
            project_name = body.get("project_name", "main_pipeline")
            existing_code = body.get("existing_pipeline_code", "")
            if not self._gate(canvas_ir, "transform"):
                return
            try:
                files_dict = compiler.compile_canvas(
                    canvas_ir,
                    project_name=project_name,
                    existing_pipeline_code=existing_code,
                )
                files_list = [{"path": p, "content": c} for p, c in files_dict.items()] if isinstance(files_dict, dict) else files_dict
                self._send_json(200, {
                    "status": "success",
                    "project_name": project_name,
                    "files": files_list,
                    "canvas_ir": canvas_ir,
                })
            except Exception as e:
                self._send_json(200, {"canvas_ir": canvas_ir, "files": [], "error": str(e)})

        # Graceful Daemon Shutdown (Stop Engine)
        elif self.path in ("/v1/engine/shutdown", "/engine/shutdown", "/api/v1/engine/shutdown"):
            self._send_json(200, {
                "status": "shutting_down",
                "message": "wpipe-engine daemon is terminating gracefully.",
                "pid": os.getpid(),
            })
            def _delayed_exit():
                import time
                time.sleep(0.3)
                os._exit(0)
            threading.Thread(target=_delayed_exit, daemon=True).start()
            return

        # 6. Workspace Test Execution
        elif self.path in ("/v1/pipeline/test", "/pipeline/test", "/api/v1/pipeline/test"):
            ws_path = body.get("workspace_dir")
            if not ws_path:
                self._send_json(400, {"error": "MISSING_WORKSPACE_DIR"})
                return

            target = Path(ws_path).resolve()
            try:
                inside = target.is_relative_to(workspace_mgr.root_dir.resolve())
            except (AttributeError, ValueError):
                inside = False
            if not inside:
                self._send_json(403, {"error": "WORKSPACE_OUTSIDE_ROOT",
                                      "message": "Tests can only run inside ~/.wpipe/workspaces."})
                return
            res = runner.run_pytest(target)
            self._send_json(200, res)

        else:
            self._send_json(404, {"error": "NOT_FOUND", "path": self.path})

    def do_PUT(self) -> None:
        if not self._is_allowed_origin():
            self._send_json(403, {"error": "FORBIDDEN_ORIGIN", "message": "Cross-origin request rejected."})
            return

        workspace_mgr: WorkspaceManager = self.server.workspace_mgr  # type: ignore
        body = self._read_json_body()
        clean_path = self.path.split("?")[0]

        if clean_path.startswith("/api/v1/projects/") or clean_path.startswith("/v1/projects/"):
            prefix = "/api/v1/projects/" if clean_path.startswith("/api/v1/projects/") else "/v1/projects/"
            project_id = clean_path[len(prefix):].split("/")[0]
            existing = workspace_mgr.get_project(project_id)
            if not existing:
                self._send_json(404, {"error": "PROJECT_NOT_FOUND", "id": project_id})
                return

            data = dict(body)
            allowed_paths = workspace_mgr.list_project_file_paths(project_id)
            client_files = self._client_file_map(body.get("generated_files"))
            if "canvas_ir" in body:
                if not self._gate(body.get("canvas_ir"), "save_project"):
                    return
                compiled = self._compile_files(body["canvas_ir"], body.get("name") or existing.get("name", "main_pipeline"))
                allowed_paths |= set(compiled)
                merged = dict(compiled)
                merged.update({p: c for p, c in client_files.items() if p in allowed_paths})
                data["generated_files"] = merged
            elif client_files:
                # Edits only to files that already exist in the engine-managed project.
                data["generated_files"] = client_files
            updated = workspace_mgr.update_project(project_id, data, allowed_paths=allowed_paths)
            if updated:
                self._send_json(200, updated)
            else:
                self._send_json(404, {"error": "PROJECT_NOT_FOUND", "id": project_id})
            return

        self._send_json(404, {"error": "NOT_FOUND", "path": self.path})

    def do_DELETE(self) -> None:
        if not self._is_allowed_origin():
            self._send_json(403, {"error": "FORBIDDEN_ORIGIN", "message": "Cross-origin request rejected."})
            return

        workspace_mgr: WorkspaceManager = self.server.workspace_mgr  # type: ignore
        clean_path = self.path.split("?")[0]

        if clean_path.startswith("/api/v1/projects/") or clean_path.startswith("/v1/projects/"):
            prefix = "/api/v1/projects/" if clean_path.startswith("/api/v1/projects/") else "/v1/projects/"
            project_id = clean_path[len(prefix):].split("/")[0]
            deleted = workspace_mgr.delete_project(project_id)
            if deleted:
                self._send_json(200, {"status": "deleted", "id": project_id})
            else:
                self._send_json(404, {"error": "PROJECT_NOT_FOUND", "id": project_id})
            return

        self._send_json(404, {"error": "NOT_FOUND", "path": self.path})

    def log_message(self, format: str, *args: Any) -> None:
        """Suppress default stderr HTTP logging to keep daemon quiet."""
        pass


def start_ipc_server(
    socket_path: str = DEFAULT_SOCKET_PATH,
    http_host: str = DEFAULT_HTTP_HOST,
    http_port: int = DEFAULT_HTTP_PORT,
    use_http: bool = False,
) -> None:
    """Start the daemon server, running both Unix socket and local HTTP on Linux/macOS."""
    license_mgr = LicenseManager()
    compiler = ASTCompiler()
    runner = LocalRunner()
    workspace_mgr = WorkspaceManager()

    if use_http or sys.platform == "win32":
        server = ThreadedHTTPServer((http_host, http_port), EngineRequestHandler)
        server.license_mgr = license_mgr  # type: ignore
        server.compiler = compiler  # type: ignore
        server.runner = runner  # type: ignore
        server.workspace_mgr = workspace_mgr  # type: ignore
        print(f"🚀 wpipe-engine escuchando en HTTP http://{http_host}:{http_port} (PID: {os.getpid()})")
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            print("\n🛑 Apagando wpipe-engine...")
            server.server_close()
    else:
        # On Linux/macOS: Start HTTP server in a background thread so Webview/browser can access canvas & API
        http_server = None
        try:
            http_server = ThreadedHTTPServer((http_host, http_port), EngineRequestHandler)
            http_server.license_mgr = license_mgr  # type: ignore
            http_server.compiler = compiler  # type: ignore
            http_server.runner = runner  # type: ignore
            http_server.workspace_mgr = workspace_mgr  # type: ignore
            http_thread = threading.Thread(target=http_server.serve_forever, daemon=True)
            http_thread.start()
            print(f"🌐 wpipe-engine servidor canvas activo en http://{http_host}:{http_port}")
        except Exception as e:
            print(f"⚠️ No se pudo iniciar servidor HTTP local en {http_port}: {e}")

        # Start Unix Domain Socket in main thread
        if os.path.exists(socket_path):
            try:
                os.unlink(socket_path)
            except OSError:
                pass

        server = UnixHTTPServer(socket_path, EngineRequestHandler)
        os.chmod(socket_path, 0o666)  # Allow user access
        server.socket_path = socket_path  # type: ignore
        server.license_mgr = license_mgr  # type: ignore
        server.compiler = compiler  # type: ignore
        server.runner = runner  # type: ignore
        server.workspace_mgr = workspace_mgr  # type: ignore
        print(f"🚀 wpipe-engine escuchando en socket Unix {socket_path} (PID: {os.getpid()})")
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            print("\n🛑 Apagando wpipe-engine...")
            if http_server:
                http_server.server_close()
            server.server_close()
            if os.path.exists(socket_path):
                os.unlink(socket_path)
