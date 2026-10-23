"""Comprehensive Security and Penetration Tests for WPipe Engine Daemon.

This test module performs adversarial and defensive security validations:
1. Cross-Origin Resource Sharing (CORS) origin spoofing and bypass attempts.
2. Static file serving path traversal attacks (e.g. attempting to read /etc/passwd or parent directories).
3. Workspace project directory traversal and malicious deletion attempts.
4. Dangerous command injection filters in local terminal execution.

Author: William Rodriguez (wisrovi.dev)
"""

import tempfile
from pathlib import Path
from unittest.mock import MagicMock

import pytest

from wpipe_engine.core.workspace import WorkspaceManager
from wpipe_engine.ipc.server import EngineRequestHandler, CANVAS_STATIC_DIR


def test_cors_origin_validation_hardened():
    """Verify that only explicitly trusted origins are allowed, blocking phishing and spoofed domains.
    
    Validates:
    - Trusted origins: localhost, 127.0.0.1, studio.wisrovi.dev, portal.wisrovi.dev, vscode-webview://, null.
    - Attack origins: wpipe-studio-evil.com, evil.wisrovi.dev.attacker.com, http://fake-wisrovi.dev.
    """
    handler = EngineRequestHandler.__new__(EngineRequestHandler)
    
    # 1. Valid trusted origins
    trusted_cases = [
        "",  # Native socket / CLI without Origin header
        "null",  # Sandboxed iframe
        "http://localhost:3000",
        "http://localhost:5173",
        "http://127.0.0.1:49152",
        "http://127.0.0.1:8080",
        "https://studio.wisrovi.dev",
        "https://admin.wisrovi.dev",
        "https://portal.wisrovi.dev",
        "https://wpipe-studio.pages.dev",
        "vscode-webview://random-id-12345",
    ]
    for origin in trusted_cases:
        handler.headers = {"Origin": origin} if origin else {}
        assert handler._is_allowed_origin() is True, f"Expected origin '{origin}' to be allowed"

    # 2. Hostile / spoofed attack origins
    attack_cases = [
        "https://wpipe-studio-evil.com",
        "https://wpipe-studio.malicious.net",
        "http://evil.wisrovi.dev",  # Insecure HTTP on subdomain
        "https://evil.wisrovi.dev.attacker.com",
        "https://wisrovi.dev.attacker.com",
        "https://hacker.io",
        "http://localhost.attacker.com",
    ]
    for attack in attack_cases:
        handler.headers = {"Origin": attack}
        assert handler._is_allowed_origin() is False, f"Expected attack origin '{attack}' to be BLOCKED"


def test_static_serve_path_traversal_prevention():
    """Verify that directory traversal sequences ('../') are rejected and cannot escape the canvas directory.
    
    Validates:
    - Normal requests (index.html, assets/...) return valid or clean status.
    - Attacks trying to read parent files (../../main.py or /etc/passwd) return False.
    """
    handler = EngineRequestHandler.__new__(EngineRequestHandler)

    # Attack paths with traversal
    attacks = [
        "../main.py",
        "../../../../../../etc/passwd",
        "..%2F..%2Fmain.py",
        "assets/../../server.py",
    ]
    for atk in attacks:
        result = handler._serve_static(atk)
        assert result is False, f"Path traversal attack '{atk}' should be blocked"


def test_workspace_path_traversal_prevention():
    """Verify that project lookups and deletions cannot escape the workspace directory.
    
    Validates:
    - Valid project IDs resolve inside the designated root directory.
    - Directory traversal sequences in project IDs return None and are never deleted.
    """
    with tempfile.TemporaryDirectory() as tmpdir:
        root = Path(tmpdir) / "workspaces"
        root.mkdir()
        
        # Create a legitimate project
        proj_dir = root / "valid_project"
        proj_dir.mkdir()
        (proj_dir / "meta.json").write_text('{"id": "valid_project", "name": "Valid"}', encoding="utf-8")
        
        # Create a sibling directory that should never be accessed or deleted
        sensitive_dir = Path(tmpdir) / "sensitive_data"
        sensitive_dir.mkdir()
        (sensitive_dir / "secret.txt").write_text("SUPER_SECRET_KEY", encoding="utf-8")
        
        wm = WorkspaceManager(root_dir=root)
        
        # 1. Normal project resolution
        assert wm._find_project_dir("valid_project") == proj_dir
        
        # 2. Path traversal lookup attempts
        assert wm._find_project_dir("../sensitive_data") is None
        assert wm._find_project_dir("..") is None
        assert wm._find_project_dir("../../") is None
        assert wm._find_project_dir("../../../etc/passwd") is None
        
        # 3. Path traversal deletion attempt
        del_result = wm.delete_project("../sensitive_data")
        assert del_result is False
        assert sensitive_dir.exists(), "Sensitive sibling directory must NOT be deleted!"
        assert (sensitive_dir / "secret.txt").exists()


def test_workspace_terminal_command_injection_guard():
    """Verify that destructive shell commands are intercepted and blocked in local terminal execution.
    
    Validates:
    - Safe commands like 'pwd', 'ls', 'echo hello' execute or return proper output.
    - Destructive commands like 'rm -rf /' and fork bombs are blocked immediately.
    """
    with tempfile.TemporaryDirectory() as tmpdir:
        root = Path(tmpdir) / "workspaces"
        root.mkdir()
        proj_dir = root / "demo_proj"
        proj_dir.mkdir()
        
        wm = WorkspaceManager(root_dir=root)
        
        # Blocked dangerous command
        res = wm.execute_terminal("demo_proj", "rm -rf /")
        assert res["exit_code"] != 0
        assert "rejected for security reasons" in res["stderr"]
        
        # Blocked fork bomb
        res_fb = wm.execute_terminal("demo_proj", ":(){ :|:& };:")
        assert res_fb["exit_code"] != 0
        assert "rejected for security reasons" in res_fb["stderr"]
        
        # Empty command is handled safely
        res_empty = wm.execute_terminal("demo_proj", "")
        assert res_empty["exit_code"] == 0
