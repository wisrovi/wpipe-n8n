from fastapi.testclient import TestClient

from app.main import app
from app.services.catalog import CatalogService

client = TestClient(app)


def test_catalog_service_reads_manifest():
    service = CatalogService()
    entries = service.get_entries()
    assert len(entries) > 0
    categories = service.get_categories()
    assert len(categories) > 0


def test_catalog_api_categories():
    response = client.get("/api/v1/catalog/categories")
    assert response.status_code == 200
    categories = response.json()
    assert isinstance(categories, list)
    assert len(categories) > 0


def test_catalog_api_steps():
    response = client.get("/api/v1/catalog/steps")
    assert response.status_code == 200
    steps = response.json()
    assert isinstance(steps, list)
    assert len(steps) > 0


def test_catalog_api_stats():
    response = client.get("/api/v1/catalog/stats")
    assert response.status_code == 200
    stats = response.json()
    assert "total_steps" in stats
    assert stats["total_steps"] > 0
