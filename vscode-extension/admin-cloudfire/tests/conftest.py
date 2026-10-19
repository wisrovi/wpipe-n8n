"""Test configuration and fixtures for admin_cloudfire."""

import sys
from pathlib import Path
import pytest

# Add package root to sys.path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


@pytest.fixture
def mock_d1_response():
    """Returns sample D1 dataset for unit testing."""
    return [
        {
            "id": "lic_12345",
            "license_key": "WPIPE-PRO-TEST-1111-2222",
            "customer_email": "dev@test.com",
            "customer_name": "Test Developer",
            "plan": "pro",
            "status": "active",
            "max_machines": 2,
            "expires_at": None,
            "created_at": "2026-10-19 12:00:00",
            "updated_at": "2026-10-19 12:00:00",
        }
    ]
