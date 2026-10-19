"""Unit tests for IDE enhancements: Simulation persistence, Terminal execution, Test runner, and .env management."""

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.schemas.projects import ProjectCreateRequest
from app.services.project_manager import get_project_manager

client = TestClient(app)


def test_simulation_history_persistence():
    """Verify storing, retrieving, and listing simulation execution records."""
    headers = {"X-User-Id": "usr_william"}
    proj_res = client.post(
        "/api/v1/projects",
        json={"name": "test_sim_proj", "protocol": "fastapi"},
        headers=headers,
    )
    assert proj_res.status_code == 201
    proj_id = proj_res.json()["id"]

    # 1. Create a simulation run
    sim_payload = {
        "status": "success",
        "duration_ms": 342,
        "input_payload": {"user_id": 42, "action": "checkout"},
        "output_context": {"user_id": 42, "status": "approved", "processed": True},
        "steps_timeline": [
            {"step": "validate_order", "duration_ms": 120, "status": "success"},
            {"step": "process_payment", "duration_ms": 222, "status": "success"},
        ],
        "logs": "[INFO] Pipeline executed cleanly.\n[SUCCESS] Context mutated.\n",
    }
    create_sim = client.post(
        f"/api/v1/projects/{proj_id}/simulations",
        json=sim_payload,
        headers=headers,
    )
    assert create_sim.status_code == 201
    sim_data = create_sim.json()
    assert sim_data["project_id"] == proj_id
    assert sim_data["status"] == "success"
    assert sim_data["duration_ms"] == 342
    sim_id = sim_data["id"]

    # 2. List simulations for project
    list_sims = client.get(
        f"/api/v1/projects/{proj_id}/simulations",
        headers=headers,
    )
    assert list_sims.status_code == 200
    sims_list = list_sims.json()
    assert len(sims_list) >= 1
    assert any(s["id"] == sim_id for s in sims_list)

    # 3. Get single simulation detail
    get_sim = client.get(
        f"/api/v1/projects/{proj_id}/simulations/{sim_id}",
        headers=headers,
    )
    assert get_sim.status_code == 200
    assert get_sim.json()["id"] == sim_id
    assert get_sim.json()["input_payload"]["user_id"] == 42


def test_terminal_command_execution():
    """Verify executing shell commands inside the sandboxed microservice directory."""
    headers = {"X-User-Id": "usr_william"}
    proj_res = client.post(
        "/api/v1/projects",
        json={"name": "test_term_proj", "protocol": "fastapi"},
        headers=headers,
    )
    assert proj_res.status_code == 201
    proj_id = proj_res.json()["id"]

    # Run 'pwd' or 'ls'
    term_res = client.post(
        f"/api/v1/projects/{proj_id}/terminal",
        json={"command": "pwd"},
        headers=headers,
    )
    assert term_res.status_code == 200
    data = term_res.json()
    assert data["exit_code"] == 0
    assert proj_id in data["cwd"] or "test_term_proj" in data["cwd"]

    # Run forbidden command
    forbidden_res = client.post(
        f"/api/v1/projects/{proj_id}/terminal",
        json={"command": "rm -rf /"},
        headers=headers,
    )
    assert forbidden_res.status_code == 200
    assert forbidden_res.json()["exit_code"] != 0
    assert "denegado" in forbidden_res.json()["stderr"]


def test_environment_variables_management():
    """Verify reading and updating .env variables for the microservice."""
    headers = {"X-User-Id": "usr_william"}
    proj_res = client.post(
        "/api/v1/projects",
        json={"name": "test_env_proj", "protocol": "fastapi"},
        headers=headers,
    )
    assert proj_res.status_code == 201
    proj_id = proj_res.json()["id"]

    # 1. Get default env vars
    get_env = client.get(
        f"/api/v1/projects/{proj_id}/env",
        headers=headers,
    )
    assert get_env.status_code == 200
    variables = get_env.json()["variables"]
    assert len(variables) > 0
    assert any(v["key"] == "PORT" for v in variables)

    # 2. Update env vars
    new_vars = [
        {"key": "PORT", "value": "9000"},
        {"key": "SECRET_KEY", "value": "super_secret_token_123"},
        {"key": "DATABASE_URL", "value": "postgresql://test:test@localhost:5432/testdb"},
    ]
    post_env = client.post(
        f"/api/v1/projects/{proj_id}/env",
        json={"variables": new_vars},
        headers=headers,
    )
    assert post_env.status_code == 200
    updated_vars = post_env.json()["variables"]
    assert any(v["key"] == "SECRET_KEY" and v["value"] == "super_secret_token_123" for v in updated_vars)


def test_run_project_tests_endpoint():
    """Verify automated pytest test execution in microservice directory."""
    headers = {"X-User-Id": "usr_william"}
    proj_res = client.post(
        "/api/v1/projects",
        json={"name": "test_runner_proj", "protocol": "fastapi"},
        headers=headers,
    )
    assert proj_res.status_code == 201
    proj_id = proj_res.json()["id"]

    test_res = client.post(
        f"/api/v1/projects/{proj_id}/run-tests",
        headers=headers,
    )
    assert test_res.status_code == 200
    data = test_res.json()
    assert "total" in data
    assert "passed" in data
    assert "output" in data
