"""FastAPI endpoint integration tests."""

from fastapi.testclient import TestClient

from config.settings import settings
from main import app

client: TestClient = TestClient(app)


def test_healthcheck() -> None:
    """Verify healthcheck endpoint returns HTTP 200 OK."""
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_app_version_and_root_path() -> None:
    """Verify FastAPI application uses version and root_path from settings."""
    assert app.version == settings.version
    assert app.root_path == settings.root_path


def test_run_endpoint() -> None:
    """Verify /run endpoint triggers pipeline execution and returns response DTO."""
    payload = {"transaction_id": "tx_api_1", "payload": {"metric": "value", "url": "https://httpbin.org/get", "method": "GET"}}
    response = client.post("/run", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "success"
    assert data["transaction_id"] == "tx_api_1"
