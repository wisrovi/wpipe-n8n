"""WPipe Engine - Local IPC Server
Exposes Unix Domain Socket and HTTP REST endpoints for the VS Code extension.
Author: William Rodriguez (wisrovi.dev)
"""

import json
import os
import socket
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from socketserver import ThreadingMixIn
from typing import Any

from wpipe_engine.core.compiler import ASTCompiler
from wpipe_engine.core.licensing import LicenseManager
from wpipe_engine.core.limiter import check_compilation_limits
from wpipe_engine.core.runner import LocalRunner

DEFAULT_SOCKET_PATH = "/tmp/wpipe.sock"
DEFAULT_HTTP_HOST = "127.0.0.1"
DEFAULT_HTTP_PORT = 49152


class ThreadedHTTPServer(ThreadingMixIn, HTTPServer):
    daemon_threads = True


class UnixHTTPServer(ThreadingMixIn, HTTPServer):
    address_family = socket.AF_UNIX
    daemon_threads = True


class EngineRequestHandler(BaseHTTPRequestHandler):
    """HTTP / IPC Request Handler for VS Code extension communication."""

    server_version = "WPipeEngine/1.0.0"

    def _send_json(self, status_code: int, data: dict[str, Any]) -> None:
        raw = json.dumps(data, indent=2).encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()
        self.wfile.write(raw)

    def do_OPTIONS(self) -> None:
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
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

    def do_GET(self) -> None:
        license_mgr: LicenseManager = self.server.license_mgr  # type: ignore

        if self.path in ("/", "/v1/health", "/health"):
            self._send_json(200, {
                "service": "wpipe-engine",
                "version": "1.0.0",
                "vendor": "wisrovi.dev",
                "author": "William Rodriguez",
                "pid": os.getpid(),
                "status": "healthy",
            })
        elif self.path in ("/v1/license/status", "/license/status"):
            status = license_mgr.get_status()
            self._send_json(200, status)
        else:
            self._send_json(404, {"error": "NOT_FOUND", "path": self.path})

    def do_POST(self) -> None:
        license_mgr: LicenseManager = self.server.license_mgr  # type: ignore
        compiler: ASTCompiler = self.server.compiler  # type: ignore
        runner: LocalRunner = self.server.runner  # type: ignore

        body = self._read_json_body()

        # 1. License Activation
        if self.path in ("/v1/license/activate", "/license/activate"):
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
        elif self.path in ("/v1/pipeline/compile", "/pipeline/compile"):
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
        elif self.path in ("/v1/pipeline/simulate", "/pipeline/simulate"):
            canvas_ir = body.get("canvas_ir", {})
            input_payload = body.get("input_payload", {})
            breakpoints = body.get("breakpoints", [])

            res = runner.run_simulation(canvas_ir, input_payload, breakpoints)
            self._send_json(200, res)

        # 4. Workspace Test Execution
        elif self.path in ("/v1/pipeline/test", "/pipeline/test"):
            ws_path = body.get("workspace_dir")
            if not ws_path:
                self._send_json(400, {"error": "MISSING_WORKSPACE_DIR"})
                return

            res = runner.run_pytest(Path(ws_path))
            self._send_json(200, res)

        else:
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
    """Start the daemon server, either on a Unix domain socket or local HTTP."""
    license_mgr = LicenseManager()
    compiler = ASTCompiler()
    runner = LocalRunner()

    if use_http or sys.platform == "win32":
        server = ThreadedHTTPServer((http_host, http_port), EngineRequestHandler)
        server.license_mgr = license_mgr  # type: ignore
        server.compiler = compiler  # type: ignore
        server.runner = runner  # type: ignore
        print(f"🚀 wpipe-engine escuchando en HTTP http://{http_host}:{http_port} (PID: {os.getpid()})")
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            print("\n🛑 Apagando wpipe-engine...")
            server.server_close()
    else:
        # Unix Domain Socket mode (Linux/macOS)
        if os.path.exists(socket_path):
            try:
                os.unlink(socket_path)
            except OSError:
                pass

        server = UnixHTTPServer(socket_path, EngineRequestHandler)
        os.chmod(socket_path, 0o666)  # Allow user access
        server.license_mgr = license_mgr  # type: ignore
        server.compiler = compiler  # type: ignore
        server.runner = runner  # type: ignore
        print(f"🚀 wpipe-engine escuchando en socket Unix {socket_path} (PID: {os.getpid()})")
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            print("\n🛑 Apagando wpipe-engine...")
            server.server_close()
            if os.path.exists(socket_path):
                os.unlink(socket_path)
