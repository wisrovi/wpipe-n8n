"""Adversarial entitlement tests for the WPipe Engine HTTP server.

These tests attack the engine the same way a user with browser DevTools (or curl) would:
they bypass the web UI entirely and call the engine endpoints directly. The goal is to prove
that Free vs Pro restrictions are enforced server-side, in the engine, and cannot be unlocked
by editing frontend state, forging request bodies or tampering with license tokens.

Setup used by every test:
- A real ``ThreadedHTTPServer`` running ``EngineRequestHandler`` on an ephemeral port.
- A ``LicenseManager`` bound to a temporary config directory and to an ephemeral Ed25519
  keypair generated per test session (the private key plays the role of api.wisrovi.dev).
- The machine fingerprint is pinned to ``TEST_MFP`` so tokens can be bound to "this machine".
- A ``WorkspaceManager`` rooted in a temporary directory (never touches ~/.wpipe).

Author: William Rodriguez (wisrovi.dev)
"""

from __future__ import annotations

import base64
import json
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ed25519

from wpipe_engine.core import licensing
from wpipe_engine.core.compiler import ASTCompiler
from wpipe_engine.core.licensing import LicenseManager
from wpipe_engine.core.runner import LocalRunner
from wpipe_engine.core.workspace import WorkspaceManager
from wpipe_engine.ipc.server import EngineRequestHandler, ThreadedHTTPServer

TEST_MFP = "test_machine_fingerprint_sha256"


# ---------------------------------------------------------------------------
# Helpers: token minting, canvas builders, HTTP client
# ---------------------------------------------------------------------------


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode().rstrip("=")


def _keypair() -> tuple[ed25519.Ed25519PrivateKey, str]:
    """Generate an Ed25519 keypair and return (private_key, raw_public_key_hex)."""
    priv = ed25519.Ed25519PrivateKey.generate()
    pub_hex = priv.public_key().public_bytes(
        encoding=serialization.Encoding.Raw, format=serialization.PublicFormat.Raw
    ).hex()
    return priv, pub_hex


def _mint_token(priv: ed25519.Ed25519PrivateKey, **claims: Any) -> str:
    """Mint a compact EdDSA lease token exactly like the Cloudflare Worker does."""
    now = int(time.time())
    payload: dict[str, Any] = {
        "sub": "lic_test",
        "lic": "WPIPE-PRO-TEST-KEY",
        "plan": "pro",
        "mfp": TEST_MFP,
        "iat": now,
        "exp": now + 3600,
        "grace_days": 7,
        "iss": "https://api.wisrovi.dev",
    }
    payload.update(claims)
    payload = {k: v for k, v in payload.items() if v is not None}
    header = _b64url(json.dumps({"alg": "EdDSA", "typ": "JWT"}).encode())
    body = _b64url(json.dumps(payload).encode())
    sig = _b64url(priv.sign(f"{header}.{body}".encode()))
    return f"{header}.{body}.{sig}"


def _steps(count: int) -> list[dict[str, Any]]:
    """Build ``count`` plain catalog steps (no Pro features)."""
    return [
        {"id": f"s{i}", "data": {"node_type": "step", "label": f"HttpRequest{i}",
                                 "namespace": "wpipe_steps.connectivity", "origin": "catalog"}}
        for i in range(count)
    ]


def _canvas(nodes: list[dict[str, Any]]) -> dict[str, Any]:
    return {"nodes": nodes, "edges": []}


class EngineClient:
    """Minimal JSON HTTP client that returns (status_code, json_body)."""

    def __init__(self, base_url: str) -> None:
        self.base_url = base_url

    def call(self, method: str, path: str, body: Any = None) -> tuple[int, Any]:
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(
            f"{self.base_url}{path}",
            data=data,
            method=method,
            headers={"Content-Type": "application/json", "Origin": "https://studio.wisrovi.dev"},
        )
        try:
            with urllib.request.urlopen(req, timeout=10) as resp:
                return resp.status, json.loads(resp.read().decode() or "{}")
        except urllib.error.HTTPError as e:
            raw = e.read().decode() or "{}"
            try:
                return e.code, json.loads(raw)
            except json.JSONDecodeError:
                return e.code, {"raw": raw}


@pytest.fixture()
def engine(tmp_path, monkeypatch):
    """Start a real engine HTTP server with an isolated license and workspace.

    Yields a namespace with: ``client``, ``priv`` (trusted signing key), ``license_mgr``,
    ``workspace_root`` and ``install(token)`` to write a lease token into license.json.
    """
    monkeypatch.setattr(licensing, "compute_machine_fingerprint", lambda: TEST_MFP)
    priv, pub_hex = _keypair()

    license_mgr = LicenseManager(config_dir=tmp_path / "cfg", public_key_hex=pub_hex)
    workspace_root = tmp_path / "workspaces"
    server = ThreadedHTTPServer(("127.0.0.1", 0), EngineRequestHandler)
    server.license_mgr = license_mgr  # type: ignore[attr-defined]
    server.compiler = ASTCompiler()  # type: ignore[attr-defined]
    server.runner = LocalRunner()  # type: ignore[attr-defined]
    server.workspace_mgr = WorkspaceManager(root_dir=workspace_root)  # type: ignore[attr-defined]
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()

    def install(token: str) -> None:
        license_mgr.license_file.write_text(
            json.dumps({"license_key": "WPIPE-PRO-TEST-KEY", "lease_token": token,
                        "customer_name": "Test Customer"}),
            encoding="utf-8",
        )

    class NS:
        pass

    ns = NS()
    ns.client = EngineClient(f"http://127.0.0.1:{server.server_address[1]}")  # type: ignore[attr-defined]
    ns.priv = priv  # type: ignore[attr-defined]
    ns.license_mgr = license_mgr  # type: ignore[attr-defined]
    ns.workspace_root = workspace_root  # type: ignore[attr-defined]
    ns.install = install  # type: ignore[attr-defined]
    try:
        yield ns
    finally:
        server.shutdown()
        server.server_close()


# ---------------------------------------------------------------------------
# 1. Block-count limit enforced on EVERY value-producing endpoint (Free plan)
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "method,path,body_builder",
    [
        ("POST", "/api/v1/pipeline/compile", lambda c: {"canvas_ir": c, "project_name": "p"}),
        ("POST", "/api/v1/pipeline/transform", lambda c: c),  # raw IR body, as the UI sends it
        ("POST", "/api/v1/pipeline/transform", lambda c: {"canvas_ir": c}),
        ("POST", "/api/v1/pipeline/simulate", lambda c: {"canvas_ir": c, "input_payload": {}}),
        ("POST", "/api/v1/projects", lambda c: {"name": "big", "canvas_ir": c}),
    ],
)
def test_free_plan_rejects_six_blocks_on_all_endpoints(engine, method, path, body_builder):
    """A Free engine must answer 403 LIMIT_BLOCK_COUNT_EXCEEDED for 6 blocks everywhere.

    Before this hardening only /pipeline/compile was protected; /transform, /simulate and
    POST /projects compiled or ran pipelines of any size.
    """
    status, body = engine.client.call(method, path, body_builder(_canvas(_steps(6))))
    assert status == 403
    assert body["details"]["code"] == "LIMIT_BLOCK_COUNT_EXCEEDED"
    assert body["details"]["max_allowed"] == 5


def test_free_plan_allows_pipelines_within_limit(engine):
    """Sanity check: 4 plain blocks compile normally on the Free plan."""
    status, body = engine.client.call(
        "POST", "/api/v1/pipeline/compile", {"canvas_ir": _canvas(_steps(4)), "project_name": "ok"}
    )
    assert status == 200
    assert any(f["path"].endswith("pipeline.py") for f in body["files"])


def test_put_project_with_oversized_canvas_is_rejected(engine):
    """Updating an existing project with a 6-block canvas must be blocked (403)."""
    status, proj = engine.client.call("POST", "/api/v1/projects", {"name": "small", "canvas_ir": _canvas(_steps(3))})
    assert status == 201
    status, body = engine.client.call("PUT", f"/api/v1/projects/{proj['id']}", {"canvas_ir": _canvas(_steps(6))})
    assert status == 403
    assert body["details"]["code"] == "LIMIT_BLOCK_COUNT_EXCEEDED"


# ---------------------------------------------------------------------------
# 2. Pro-only block families, including hidden / disguised variants
# ---------------------------------------------------------------------------


def test_parallel_hidden_inside_nested_condition_is_rejected(engine):
    """A Parallel block nested inside a Condition (linked by parent_id) is still detected."""
    nodes = [
        {"id": "c1", "data": {"node_type": "condition", "condition_expression": "x == 1"}},
        {"id": "p1", "data": {"node_type": "parallel", "parent_id": "c1", "slot_type": "if_body"}},
        {"id": "s1", "data": {"node_type": "step", "label": "Http", "parent_id": "p1",
                              "slot_type": "parallel_body", "namespace": "wpipe_steps.connectivity"}},
    ]
    status, body = engine.client.call("POST", "/api/v1/pipeline/compile", {"canvas_ir": _canvas(nodes)})
    assert status == 403
    assert body["details"]["code"] == "PRO_FEATURE_REQUIRED"
    assert body["details"]["feature"] == "parallel"


def test_parallel_declared_via_node_type_substring_is_rejected(engine):
    """Types the compiler treats as Parallel by substring (e.g. 'my_parallel_x') are blocked too."""
    nodes = [{"id": "p1", "type": "custom", "data": {"node_type": "my_parallel_x"}}]
    status, body = engine.client.call("POST", "/api/v1/pipeline/transform", _canvas(nodes))
    assert status == 403
    assert body["details"]["feature"] == "parallel"


def test_background_block_rejected_on_free(engine):
    """Background workers are a Pro feature."""
    nodes = [{"id": "b1", "data": {"node_type": "background"}}]
    status, body = engine.client.call("POST", "/api/v1/pipeline/simulate", {"canvas_ir": _canvas(nodes)})
    assert status == 403
    assert body["details"]["feature"] == "background"


@pytest.mark.parametrize(
    "data",
    [
        {"node_type": "step", "label": "MyAI", "origin": "described", "namespace": "app.states.MyAI"},
        {"node_type": "step", "label": "AISentimentStep", "origin": "catalog"},  # origin forged
        {"node_type": "step", "label": "x", "block_type": "wpipe_ai_step", "origin": "catalog"},
    ],
)
def test_ai_step_disguises_are_rejected(engine, data):
    """AI steps are detected by what the compiler would emit, not by a single editable label."""
    status, body = engine.client.call(
        "POST", "/api/v1/pipeline/compile", {"canvas_ir": _canvas([{"id": "a1", "data": data}])}
    )
    assert status == 403
    assert body["details"]["feature"] == "ai"


def test_catalog_step_with_ai_substring_is_not_misclassified(engine):
    """Regression: names containing 'ai' (e.g. EmailParser) are plain steps, not AI steps."""
    nodes = [{"id": "e1", "data": {"node_type": "step", "label": "EmailParser", "origin": "catalog"}}]
    status, _ = engine.client.call("POST", "/api/v1/pipeline/compile", {"canvas_ir": _canvas(nodes)})
    assert status == 200


# ---------------------------------------------------------------------------
# 3. Forged request bodies and tampered / foreign tokens never unlock Pro
# ---------------------------------------------------------------------------


def test_forged_pro_flags_in_request_body_are_ignored(engine):
    """Clients cannot self-declare Pro: is_pro / tier / entitlements in the body are ignored."""
    body = {
        "canvas_ir": _canvas(_steps(8)),
        "is_pro": True,
        "tier": "enterprise",
        "entitlements": {"max_blocks": None},
        "license": {"is_pro": True},
    }
    status, resp = engine.client.call("POST", "/api/v1/pipeline/compile", body)
    assert status == 403
    assert resp["is_pro"] is False


def test_token_signed_by_untrusted_key_falls_back_to_free(engine):
    """A token signed with an attacker's own key is rejected; the engine stays on Free."""
    attacker_priv, _ = _keypair()
    engine.install(_mint_token(attacker_priv, plan="enterprise"))
    status_doc = engine.license_mgr.get_status()
    assert status_doc["verified"] is False and status_doc["tier"] == "free"
    status, _ = engine.client.call("POST", "/api/v1/pipeline/compile", {"canvas_ir": _canvas(_steps(6))})
    assert status == 403


def test_token_payload_edited_after_signing_is_rejected(engine):
    """Editing the payload of a genuine token (e.g. plan free -> pro) breaks the signature."""
    genuine = _mint_token(engine.priv, plan="free")
    header, _, sig = genuine.split(".")
    forged_payload = _b64url(json.dumps({"plan": "pro", "mfp": TEST_MFP, "exp": int(time.time()) + 999}).encode())
    engine.install(f"{header}.{forged_payload}.{sig}")
    assert engine.license_mgr.get_status()["verified"] is False


def test_valid_token_for_another_machine_falls_back_to_free(engine):
    """Copying a paying user's token to a different machine does not unlock Pro."""
    engine.install(_mint_token(engine.priv, mfp="someone_elses_machine"))
    assert engine.license_mgr.get_status()["tier"] == "free"


def test_unbound_token_without_machine_fingerprint_is_rejected(engine):
    """Tokens without an ``mfp`` claim could be replayed anywhere, so they are rejected."""
    engine.install(_mint_token(engine.priv, mfp=None))
    assert engine.license_mgr.get_status()["verified"] is False


# ---------------------------------------------------------------------------
# 4. Signed entitlements (issued from D1 plan_entitlements) drive the limits
# ---------------------------------------------------------------------------


def test_verified_pro_token_unlocks_unlimited_blocks_and_parallel(engine):
    """A genuine Pro token bound to this machine allows 15 blocks plus Parallel."""
    engine.install(_mint_token(engine.priv, plan="pro"))
    nodes = _steps(14) + [{"id": "p1", "data": {"node_type": "parallel"}}]
    status, body = engine.client.call("POST", "/api/v1/pipeline/compile", {"canvas_ir": _canvas(nodes)})
    assert status == 200, body
    assert body["license_tier"] == "pro"


def test_signed_ent_claim_can_narrow_block_limit(engine):
    """If D1 sets max_blocks=3 for a plan, the signed claim enforces 3 even on a paid plan."""
    engine.install(_mint_token(engine.priv, plan="pro", ent={"max_blocks": 3}))
    status, body = engine.client.call("POST", "/api/v1/pipeline/compile", {"canvas_ir": _canvas(_steps(4))})
    assert status == 403
    assert body["details"]["max_allowed"] == 3


def test_signed_ent_claim_can_widen_block_limit(engine):
    """A signed claim max_blocks=20 lets 15 blocks through (limits come from the database)."""
    engine.install(_mint_token(engine.priv, plan="team", ent={"max_blocks": 20, "parallel_blocks": False}))
    status, _ = engine.client.call("POST", "/api/v1/pipeline/compile", {"canvas_ir": _canvas(_steps(15))})
    assert status == 200
    status, body = engine.client.call(
        "POST", "/api/v1/pipeline/compile", {"canvas_ir": _canvas([{"id": "p", "data": {"node_type": "parallel"}}])}
    )
    assert status == 403 and body["details"]["feature"] == "parallel"


def test_malformed_ent_claim_values_are_ignored(engine):
    """Garbage claim values (negative, bool, string) never produce an unlimited plan."""
    engine.install(_mint_token(engine.priv, plan="free", ent={"max_blocks": -1, "parallel_blocks": "yes"}))
    ent = engine.license_mgr.get_status()["entitlements"]
    assert ent["max_blocks"] == 5
    assert ent["parallel_blocks"] is False


def test_project_quota_from_signed_entitlements(engine):
    """max_projects=1 in the signed claim blocks creating or duplicating a second project."""
    engine.install(_mint_token(engine.priv, plan="pro", ent={"max_projects": 1}))
    status, proj = engine.client.call("POST", "/api/v1/projects", {"name": "one", "canvas_ir": _canvas(_steps(2))})
    assert status == 201
    status, body = engine.client.call("POST", "/api/v1/projects", {"name": "two", "canvas_ir": _canvas(_steps(2))})
    assert status == 403 and body["details"]["code"] == "LIMIT_PROJECT_COUNT_EXCEEDED"
    status, _ = engine.client.call("POST", f"/api/v1/projects/{proj['id']}/duplicate", {})
    assert status == 403


def test_capabilities_endpoint_reports_verified_entitlements(engine):
    """/v1/capabilities exposes the effective (verified) limits for the UI."""
    status, caps = engine.client.call("GET", "/v1/capabilities")
    assert status == 200
    assert caps["verified"] is False and caps["entitlements"]["max_blocks"] == 5
    engine.install(_mint_token(engine.priv, plan="pro"))
    _, caps = engine.client.call("GET", "/v1/capabilities")
    assert caps["verified"] is True and caps["entitlements"]["max_blocks"] is None
    assert caps["signed_token"]


# ---------------------------------------------------------------------------
# 5. Code injection through generated_files and path traversal
# ---------------------------------------------------------------------------


def test_client_cannot_inject_extra_generated_files(engine):
    """POST /projects regenerates files in the engine; foreign or escaping paths are dropped.

    Edits to files the engine itself generated (app/pipelines.py) are preserved so users keep
    their manual changes.
    """
    body = {
        "name": "inject",
        "canvas_ir": _canvas(_steps(2)),
        "generated_files": [
            {"path": "app/pipelines.py", "content": "# user edit kept"},
            {"path": "app/pro_only_generated_elsewhere.py", "content": "stolen"},
            {"path": "../../escape.py", "content": "pwned"},
        ],
    }
    status, proj = engine.client.call("POST", "/api/v1/projects", body)
    assert status == 201
    files = {f["path"]: f["content"] for f in proj["generated_files"]}
    assert files.get("app/pipelines.py") == "# user edit kept"
    assert "app/pro_only_generated_elsewhere.py" not in files
    assert not (engine.workspace_root.parent / "escape.py").exists()


def test_put_generated_files_cannot_escape_project_directory(engine):
    """PUT /projects/{id} with traversal paths must never write outside the project."""
    _, proj = engine.client.call("POST", "/api/v1/projects", {"name": "trav", "canvas_ir": _canvas(_steps(1))})
    status, _ = engine.client.call(
        "PUT", f"/api/v1/projects/{proj['id']}",
        {"generated_files": [{"path": "../../../owned.txt", "content": "x"},
                             {"path": "/tmp/abs_owned.txt", "content": "x"}]},
    )
    assert status == 200
    assert not (engine.workspace_root.parent / "owned.txt").exists()
    assert not Path("/tmp/abs_owned.txt").exists()


def test_pytest_runner_restricted_to_workspace_root(engine, tmp_path):
    """/pipeline/test cannot execute test suites in arbitrary directories."""
    status, body = engine.client.call("POST", "/api/v1/pipeline/test", {"workspace_dir": str(tmp_path)})
    assert status == 403
    assert body["error"] == "WORKSPACE_OUTSIDE_ROOT"


def test_malformed_canvas_is_rejected_with_400(engine):
    """Non-list nodes are rejected instead of confusing counting or crashing the compiler."""
    status, body = engine.client.call("POST", "/api/v1/pipeline/compile", {"canvas_ir": {"nodes": {"a": 1}}})
    assert status == 400
    assert body["error"] == "INVALID_CANVAS_IR"


# ---------------------------------------------------------------------------
# 6. No hardcoded admin identity
# ---------------------------------------------------------------------------


def test_local_engine_has_no_hardcoded_admin_login(engine):
    """Any username/password used to return an admin session; now login is not supported."""
    status, body = engine.client.call("POST", "/api/v1/auth/login", {"username": "x", "password": "admin123"})
    assert status == 410
    assert body["user"]["role"] != "admin"
    status, _ = engine.client.call("GET", "/api/v1/auth/users")
    assert status == 404
    status, me = engine.client.call("GET", "/api/v1/auth/me")
    assert status == 200 and me["role"] == "free" and me["verified"] is False


def test_identity_comes_from_verified_license_holder(engine):
    """With a verified token the identity is the license holder, never an admin role."""
    engine.install(_mint_token(engine.priv, plan="pro"))
    _, me = engine.client.call("GET", "/api/v1/auth/me")
    assert me["name"] == "Test Customer"
    assert me["role"] == "pro" and me["verified"] is True
