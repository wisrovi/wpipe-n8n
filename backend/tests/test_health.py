from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_health_returns_ok() -> None:
    response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_health_is_documented_in_openapi() -> None:
    response = client.get("/openapi.json")

    assert response.status_code == 200
    assert "/health" in response.json()["paths"]


def test_v1_router_is_mounted() -> None:
    response = client.get("/openapi.json")

    assert response.status_code == 200
    paths = response.json()["paths"]
    assert any(path.startswith("/api/v1/") for path in paths)


def test_settings_start_without_env_vars() -> None:
    from app.core.config import Settings

    settings = Settings(_env_file=None)

    assert settings.app_name
    assert settings.api_v1_prefix.startswith("/")