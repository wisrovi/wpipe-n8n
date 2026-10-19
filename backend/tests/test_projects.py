"""Unit tests for Multi-Tenant User Authentication and Projects APIs."""

import pytest
from fastapi.testclient import TestClient

from app.main import app


@pytest.fixture
def client():
    return TestClient(app)


def test_list_and_get_users(client):
    response = client.get("/api/v1/auth/users")
    assert response.status_code == 200
    users = response.json()
    assert isinstance(users, list)
    assert len(users) >= 2
    usernames = [u["username"] for u in users]
    assert "william.rodriguez" in usernames
    assert "developer" in usernames


def test_auth_me_default_and_header(client):
    # Default without header falls back to william.rodriguez
    res_def = client.get("/api/v1/auth/me")
    assert res_def.status_code == 200
    assert res_def.json()["username"] == "william.rodriguez"

    # With explicit header for dev
    res_dev = client.get("/api/v1/auth/me", headers={"X-User-ID": "usr_developer"})
    assert res_dev.status_code == 200
    assert res_dev.json()["username"] == "developer"


def test_register_and_login(client):
    new_user = "test_user_qa"
    res_reg = client.post(
        "/api/v1/auth/register",
        json={"username": new_user, "name": "QA Tester", "role": "QA Engineer"},
    )
    assert res_reg.status_code == 201
    user_data = res_reg.json()
    assert user_data["username"] == new_user
    assert user_data["role"] == "QA Engineer"

    # Login
    res_login = client.post("/api/v1/auth/login", json={"username": new_user})
    assert res_login.status_code == 200
    assert res_login.json()["id"] == user_data["id"]


def test_projects_crud_and_isolation(client):
    # User A creates a project
    user_a = "usr_william"
    res_create = client.post(
        "/api/v1/projects",
        headers={"X-User-ID": user_a},
        json={
            "name": "User A Private Service",
            "description": "Sensitive banking pipeline",
            "protocol": "fastapi",
            "canvas_ir": {"nodes": [{"id": "step1"}], "edges": []},
        },
    )
    assert res_create.status_code == 201
    proj_a = res_create.json()
    proj_id = proj_a["id"]
    assert proj_a["owner_id"] == user_a
    assert proj_a["name"] == "user_a_private_service"

    # User A can get it
    res_get_a = client.get(f"/api/v1/projects/{proj_id}", headers={"X-User-ID": user_a})
    assert res_get_a.status_code == 200
    assert res_get_a.json()["id"] == proj_id

    # User B cannot get it (multi-tenant isolation)
    user_b = "usr_developer"
    res_get_b = client.get(f"/api/v1/projects/{proj_id}", headers={"X-User-ID": user_b})
    assert res_get_b.status_code == 404

    # User B cannot update it
    res_put_b = client.put(
        f"/api/v1/projects/{proj_id}",
        headers={"X-User-ID": user_b},
        json={"name": "Hacked Name"},
    )
    assert res_put_b.status_code == 404

    # User A can update it
    res_put_a = client.put(
        f"/api/v1/projects/{proj_id}",
        headers={"X-User-ID": user_a},
        json={"description": "Updated description", "protocol": "kafka"},
    )
    assert res_put_a.status_code == 200
    assert res_put_a.json()["description"] == "Updated description"
    assert res_put_a.json()["protocol"] == "kafka"

    # User A can duplicate it
    res_dup = client.post(f"/api/v1/projects/{proj_id}/duplicate", headers={"X-User-ID": user_a})
    assert res_dup.status_code == 201
    cloned_proj = res_dup.json()
    assert cloned_proj["id"] != proj_id
    assert "copy" in cloned_proj["name"]

    # User A can delete it
    res_del = client.delete(f"/api/v1/projects/{proj_id}", headers={"X-User-ID": user_a})
    assert res_del.status_code == 200

    # User A cannot get it after deletion
    res_get_deleted = client.get(f"/api/v1/projects/{proj_id}", headers={"X-User-ID": user_a})
    assert res_get_deleted.status_code == 404
