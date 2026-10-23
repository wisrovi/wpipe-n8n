"""Unit tests for Multi-Tenant User Authentication, Password Hashing, Session Tokens and Projects APIs."""

import pytest
from fastapi.testclient import TestClient

from app.main import app


@pytest.fixture
def client():
    """FastAPI TestClient fixture."""
    return TestClient(app)


def test_list_and_get_users(client):
    """Test listing all system users."""
    response = client.get("/api/v1/auth/users")
    assert response.status_code == 200
    users = response.json()
    assert isinstance(users, list)
    assert len(users) >= 2
    usernames = [u["username"] for u in users]
    assert "william.rodriguez" in usernames
    assert "developer" in usernames


def test_auth_me_default_and_header(client):
    """Test /api/v1/auth/me fallback and X-User-ID resolution."""
    # Default without header falls back to william.rodriguez
    res_def = client.get("/api/v1/auth/me")
    assert res_def.status_code == 200
    assert res_def.json()["username"] == "william.rodriguez"

    # With explicit header for dev
    res_dev = client.get("/api/v1/auth/me", headers={"X-User-ID": "usr_developer"})
    assert res_dev.status_code == 200
    assert res_dev.json()["username"] == "developer"


def test_natural_login_with_password(client):
    """Test natural login with valid password returning session token."""
    # Valid login for pre-seeded user William
    res_valid = client.post(
        "/api/v1/auth/login",
        json={"username": "william.rodriguez", "password": "admin123"},
    )
    assert res_valid.status_code == 200
    data = res_valid.json()
    assert "token" in data
    assert len(data["token"]) > 20
    assert data["user"]["username"] == "william.rodriguez"

    # Invalid password rejection (HTTP 401)
    res_invalid = client.post(
        "/api/v1/auth/login",
        json={"username": "william.rodriguez", "password": "wrong_password"},
    )
    assert res_invalid.status_code == 401

    # Non-existent user rejection (HTTP 401)
    res_nonexistent = client.post(
        "/api/v1/auth/login",
        json={"username": "nobody_exists", "password": "some_password"},
    )
    assert res_nonexistent.status_code == 401


def test_register_and_logout(client):
    """Test registration with password, session creation, and logout."""
    new_user = "test_user_natural"
    res_reg = client.post(
        "/api/v1/auth/register",
        json={
            "username": new_user,
            "password": "securepassword123",
            "name": "Natural User",
            "role": "Lead Architect",
        },
    )
    assert res_reg.status_code == 201
    auth_data = res_reg.json()
    token = auth_data["token"]
    assert token
    assert auth_data["user"]["username"] == new_user

    # Verify /me with Bearer token
    res_me = client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert res_me.status_code == 200
    assert res_me.json()["username"] == new_user

    # Logout
    res_logout = client.post("/api/v1/auth/logout", headers={"Authorization": f"Bearer {token}"})
    assert res_logout.status_code == 200
    assert res_logout.json()["status"] == "success"

    # Login again with the password
    res_relogin = client.post(
        "/api/v1/auth/login",
        json={"username": new_user, "password": "securepassword123"},
    )
    assert res_relogin.status_code == 200
    assert res_relogin.json()["user"]["username"] == new_user


def test_projects_crud_and_isolation_with_tokens(client):
    """Test creating, reading, updating, duplicating and deleting projects with auth tokens and isolation."""
    # Login as William
    res_william = client.post(
        "/api/v1/auth/login",
        json={"username": "william.rodriguez", "password": "admin123"},
    )
    token_william = res_william.json()["token"]
    headers_william = {"Authorization": f"Bearer {token_william}"}

    # Login as Dev Engineer
    res_dev = client.post(
        "/api/v1/auth/login",
        json={"username": "developer", "password": "dev123"},
    )
    token_dev = res_dev.json()["token"]
    headers_dev = {"Authorization": f"Bearer {token_dev}"}

    # William creates a project
    res_create = client.post(
        "/api/v1/projects",
        headers=headers_william,
        json={
            "name": "Financial Risk Analyzer",
            "description": "Real-time risk scoring microservice",
            "protocol": "fastapi",
            "canvas_ir": {"nodes": [{"id": "node_1"}], "edges": []},
        },
    )
    assert res_create.status_code == 201
    proj_william = res_create.json()
    proj_id = proj_william["id"]
    assert proj_william["name"] == "financial_risk_analyzer"

    # William can get it
    res_get = client.get(f"/api/v1/projects/{proj_id}", headers=headers_william)
    assert res_get.status_code == 200
    assert res_get.json()["id"] == proj_id

    # Dev Engineer cannot see or access it (strict tenant isolation returns HTTP 404)
    res_get_denied = client.get(f"/api/v1/projects/{proj_id}", headers=headers_dev)
    assert res_get_denied.status_code == 404

    # Dev Engineer cannot update it
    res_put_denied = client.put(
        f"/api/v1/projects/{proj_id}",
        headers=headers_dev,
        json={"name": "Hacked Risk Analyzer"},
    )
    assert res_put_denied.status_code == 404

    # William can update it
    res_put = client.put(
        f"/api/v1/projects/{proj_id}",
        headers=headers_william,
        json={"description": "Updated risk scoring model", "protocol": "kafka"},
    )
    assert res_put.status_code == 200
    assert res_put.json()["description"] == "Updated risk scoring model"
    assert res_put.json()["protocol"] == "kafka"

    # William can duplicate it
    res_dup = client.post(f"/api/v1/projects/{proj_id}/duplicate", headers=headers_william)
    assert res_dup.status_code == 201
    cloned = res_dup.json()
    assert cloned["id"] != proj_id
    assert "copy" in cloned["name"]

    # William can delete it
    res_del = client.delete(f"/api/v1/projects/{proj_id}", headers=headers_william)
    assert res_del.status_code == 200

    # Verification: deleted project is gone
    res_after = client.get(f"/api/v1/projects/{proj_id}", headers=headers_william)
    assert res_after.status_code == 404
