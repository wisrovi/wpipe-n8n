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
from wpipe_engine.core.limiter import check_compilation_limits
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

if not CANVAS_STATIC_DIR.exists():
    fallback_static = Path.home() / ".wpipe" / "canvas_static"
    if fallback_static.exists():
        CANVAS_STATIC_DIR = fallback_static

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
        return (
            origin.startswith("http://localhost:")
            or origin.startswith("http://127.0.0.1:")
            or origin.startswith("https://studio.wisrovi.dev")
            or origin.startswith("https://wpipe-studio")
            or origin.endswith(".wisrovi.dev")
            or origin.startswith("vscode-webview://")
            or origin == "null"
        )

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
        """Serve bundled static frontend canvas assets."""
        clean_rel = rel_path.lstrip("/").split("?")[0]
        if not clean_rel or clean_rel == "index.html":
            target = CANVAS_STATIC_DIR / "index.html"
        else:
            target = CANVAS_STATIC_DIR / clean_rel

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

        # 1. Base Health & Status
        if clean_path in ("/", "/v1/health", "/health"):
            # If path is "/" and canvas static files exist, serve index.html
            if self.path == "/" and (CANVAS_STATIC_DIR / "index.html").exists():
                if self._serve_static("index.html"):
                    return

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

        # 3. Transparent Local Auth (Developer profile, 0 login friction)
        elif self.path.startswith("/api/v1/auth/me") or self.path.startswith("/auth/me"):
            self._send_json(200, {
                "id": "local_dev",
                "username": "william.rodriguez",
                "name": "William Rodriguez",
                "role": "admin",
            })
            return

        elif self.path.startswith("/api/v1/auth/users") or self.path.startswith("/auth/users"):
            self._send_json(200, [{
                "id": "local_dev",
                "username": "william.rodriguez",
                "name": "William Rodriguez",
                "role": "admin",
            }])
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

        # 0. Local Dev Auth Login
        if clean_path in ("/api/v1/auth/login", "/auth/login"):
            self._send_json(200, {
                "token": "local_dev_token",
                "user": {
                    "id": "local_dev",
                    "username": "william.rodriguez",
                    "name": "William Rodriguez",
                    "role": "admin",
                },
            })
            return

        # 1. Local Projects Creation & Operations
        elif clean_path in ("/api/v1/projects", "/v1/projects"):
            name = body.get("name", "new_microservice")
            desc = body.get("description", "")
            docker_img = body.get("docker_image", "python:3.11-slim")
            proto = body.get("protocol", "fastapi")
            canvas_ir = body.get("canvas_ir")
            gen_files = body.get("generated_files")
            if not gen_files and canvas_ir:
                try:
                    gen_files = compiler.compile_canvas(canvas_ir, project_name=name)
                except Exception:
                    pass
            proj = workspace_mgr.create_project(
                name=name,
                description=desc,
                docker_image=docker_img,
                protocol=proto,
                canvas_ir=canvas_ir,
                generated_files=gen_files,
            )
            self._send_json(201, proj)
            return

        elif clean_path.startswith("/api/v1/projects/") or clean_path.startswith("/v1/projects/"):
            prefix = "/api/v1/projects/" if clean_path.startswith("/api/v1/projects/") else "/v1/projects/"
            subpath = clean_path[len(prefix):]
            parts = [p for p in subpath.split("/") if p]
            if len(parts) >= 2 and parts[1] == "duplicate":
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
            allowed, limit_msg, details = check_compilation_limits(canvas_ir, lic_status)

            if not allowed:
                self._send_json(403, {
                    "error": "LIMIT_EXCEEDED",
                    "message": limit_msg,
                    "details": details,
                    "is_pro": False,
                })
                return

            try:
                files = compiler.compile_canvas(
                    canvas_ir,
                    project_name=project_name,
                    existing_pipeline_code=existing_code,
                )
                self._send_json(200, {
                    "status": "success",
                    "project_name": project_name,
                    "files": files,
                    "license_tier": lic_status.get("tier", "free"),
                })
            except Exception as e:
                self._send_json(500, {"error": "COMPILATION_ERROR", "message": str(e)})

        # 3. Pipeline Simulation
        elif self.path in ("/v1/pipeline/simulate", "/pipeline/simulate", "/api/v1/pipeline/simulate"):
            canvas_ir = body.get("canvas_ir", {})
            input_payload = body.get("input_payload", {})
            breakpoints = body.get("breakpoints", [])

            res = runner.run_simulation(canvas_ir, input_payload, breakpoints)
            self._send_json(200, res)

        # 4. Pipeline Dry-Run Validation
        elif self.path in ("/v1/pipeline/dry-run", "/api/v1/pipeline/dry-run"):
            canvas_ir = body.get("canvas_ir", {})
            self._send_json(200, {"valid": True, "node_count": len(canvas_ir.get("nodes", []))})

        # 5. Pipeline Transform
        elif self.path in ("/v1/pipeline/transform", "/api/v1/pipeline/transform"):
            canvas_ir = body.get("canvas_ir", {})
            self._send_json(200, canvas_ir)

        # 6. Workspace Test Execution
        elif self.path in ("/v1/pipeline/test", "/pipeline/test", "/api/v1/pipeline/test"):
            ws_path = body.get("workspace_dir")
            if not ws_path:
                self._send_json(400, {"error": "MISSING_WORKSPACE_DIR"})
                return

            res = runner.run_pytest(Path(ws_path))
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
            updated = workspace_mgr.update_project(project_id, body)
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
