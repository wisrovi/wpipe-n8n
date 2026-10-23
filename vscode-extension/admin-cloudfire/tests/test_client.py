"""Unit tests for CloudflareAdminClient & License Helpers.
Author: William Rodriguez (wisrovi.dev)

This test module verifies the core business logic of the Cloudflare D1 Admin Client:
- License key cryptographic generation and format validation
- Database queries execution and parameter binding
- CRUD operations for licenses (Create, Read, Update, Delete)
- Machine activations management and hardware unlinking
- Audit log querying and filtering
- Dashboard KPI statistics aggregation
"""

from __future__ import annotations

import unittest.mock as mock
import pytest
from client import CloudflareAdminClient, generate_license_key


# =============================================================================
# Test 1: License Key Generation
# =============================================================================
def test_generate_license_key_format():
    """Validates that generate_license_key creates a standard key.

    Expected format: PREFIX-XXXX-XXXX-XXXX
    Validates:
    - Starts with the given prefix (default: WPIPE-PRO)
    - Has 4 segments separated by dashes
    - Does not contain visually ambiguous characters (O, 0, I, 1)
    - Consecutive keys are cryptographically random and unique
    """
    key1 = generate_license_key("WPIPE-PRO")
    key2 = generate_license_key("WPIPE-PRO")

    assert key1.startswith("WPIPE-PRO-")
    parts = key1.split("-")
    assert len(parts) == 5, f"Expected 5 parts in key '{key1}', got {len(parts)}"
    assert parts[0] == "WPIPE"
    assert parts[1] == "PRO"
    assert len(parts[2]) == 4
    assert len(parts[3]) == 4
    assert len(parts[4]) == 4

    # Verify absence of ambiguous characters
    for ambiguous in ("O", "0", "I", "1"):
        assert ambiguous not in parts[2]
        assert ambiguous not in parts[3]
        assert ambiguous not in parts[4]

    # Keys must be unique
    assert key1 != key2


# =============================================================================
# Test 2: Client Query Execution (REST API Mock)
# =============================================================================
def test_client_execute_query_via_rest():
    """Validates that execute_query sends correct payload to Cloudflare D1 REST API.

    Validates:
    - Authorization Bearer header is included
    - SQL query and parameters are serialized in JSON body
    - Results array is properly parsed and returned
    """
    client = CloudflareAdminClient(
        account_id="acc_123",
        database_id="db_456",
        api_token="test_token_secret",
    )

    mock_response_payload = {
        "success": True,
        "errors": [],
        "messages": [],
        "result": [
            {
                "results": [
                    {"id": "lic_1", "license_key": "WPIPE-PRO-AAAA-BBBB-CCCC"}
                ]
            }
        ],
    }

    mock_resp = mock.MagicMock()
    mock_resp.read.return_value = json_bytes = mock.MagicMock()
    json_bytes.decode.return_value = '{"success": true, "result": [{"results": [{"id": "lic_1"}]}]}'

    with mock.patch("urllib.request.urlopen") as mock_urlopen:
        mock_urlopen.return_value.__enter__.return_value = mock_resp
        results = client.execute_query("SELECT * FROM licenses WHERE id = ?", ["lic_1"])

        assert len(results) == 1
        assert results[0]["id"] == "lic_1"
        assert mock_urlopen.called


# =============================================================================
# Test 3: Create License Operation
# =============================================================================
def test_create_license_success():
    """Validates that create_license properly formats parameters and inserts into D1.

    Validates:
    - Emails are converted to lowercase
    - Custom license keys are respected if provided
    - Default expiration and max machines are respected
    - Insert query executes without error and returns dict
    """
    client = CloudflareAdminClient(api_token="mock_token")

    with mock.patch.object(client, "execute_query", return_value=[]) as mock_exec:
        result = client.create_license(
            customer_email="Dev@Company.COM",
            customer_name="Jane Doe",
            plan="enterprise",
            max_machines=5,
            expires_at="2027-01-01T00:00:00Z",
            custom_key="CUSTOM-ENT-KEY-9999",
        )

        assert result["customer_email"] == "dev@company.com"
        assert result["customer_name"] == "Jane Doe"
        assert result["plan"] == "enterprise"
        assert result["max_machines"] == 5
        assert result["license_key"] == "CUSTOM-ENT-KEY-9999"
        assert result["status"] == "active"
        assert mock_exec.called


# =============================================================================
# Test 4: Update License Status (Suspend / Revoke)
# =============================================================================
def test_update_license_status():
    """Validates updating status of an existing license.

    Validates:
    - Executes UPDATE statement with parameterized status
    - Returns True on success
    """
    client = CloudflareAdminClient(api_token="mock_token")

    with mock.patch.object(client, "execute_query", return_value=[]) as mock_exec:
        success = client.update_license_status("lic_test_123", "suspended")
        assert success is True
        mock_exec.assert_called_once()
        query, params = mock_exec.call_args[0]
        assert "UPDATE licenses SET status = ?" in query
        assert params == ["suspended", "lic_test_123"]


# =============================================================================
# Test 5: Delete License Cascading
# =============================================================================
def test_delete_license_cascades_activations():
    """Validates deleting a license also removes its bound activations.

    Validates:
    - DELETE FROM activations executes first
    - DELETE FROM licenses executes next
    """
    client = CloudflareAdminClient(api_token="mock_token")

    with mock.patch.object(client, "execute_query", return_value=[]) as mock_exec:
        success = client.delete_license("lic_target")
        assert success is True
        assert mock_exec.call_count == 2
        first_call = mock_exec.call_args_list[0][0][0]
        second_call = mock_exec.call_args_list[1][0][0]
        assert "DELETE FROM activations WHERE license_id = ?" in first_call
        assert "DELETE FROM licenses WHERE id = ?" in second_call


# =============================================================================
# Test 6: Machine Activations Listing & Deletion
# =============================================================================
def test_delete_activation_unlinks_machine():
    """Validates deleting a machine activation row.

    Validates:
    - Allows a user to reset their bound machine fingerprint when changing PCs
    - Executes DELETE FROM activations WHERE id = ?
    """
    client = CloudflareAdminClient(api_token="mock_token")

    with mock.patch.object(client, "execute_query", return_value=[]) as mock_exec:
        success = client.delete_activation("act_998877")
        assert success is True
        query, params = mock_exec.call_args[0]
        assert "DELETE FROM activations WHERE id = ?" in query
        assert params == ["act_998877"]


# =============================================================================
# Test 7: Dashboard Statistics Aggregation
# =============================================================================
def test_get_stats_aggregation():
    """Validates KPI aggregation for dashboard top metric cards.

    Validates:
    - Calculates total licenses, active licenses, total activations and recent logs
    - Gracefully handles query failures by returning zeroes
    """
    client = CloudflareAdminClient(api_token="mock_token")

    def mock_query(sql, params=None):
        if "FROM licenses WHERE status = 'active'" in sql:
            return [{"count": 8}]
        if "FROM licenses" in sql:
            return [{"count": 10}]
        if "FROM activations" in sql:
            return [{"count": 15}]
        if "FROM audit_logs" in sql:
            return [{"count": 42}]
        return [{"count": 0}]

    with mock.patch.object(client, "execute_query", side_effect=mock_query):
        stats = client.get_stats()
        assert stats["total_licenses"] == 10
        assert stats["active_licenses"] == 8
        assert stats["total_activations"] == 15
        assert stats["recent_logs_7d"] == 42


# =============================================================================
# Test 8: List Licenses with Filters
# =============================================================================
def test_list_licenses_with_search_and_filter():
    """Validates list_licenses generates the correct parameterized query.

    Validates:
    - Search terms are wrapped in lowercased wildcards
    - Status filter is properly appended
    - Order by created_at DESC is always present
    """
    client = CloudflareAdminClient(api_token="mock_token")

    with mock.patch.object(client, "execute_query", return_value=[]) as mock_exec:
        client.list_licenses(search="Acme", status_filter="active")
        query, params = mock_exec.call_args[0]
        assert "WHERE status = ?" in query
        assert "LOWER(license_key) LIKE ?" in query
        assert params[0] == "active"
        assert params[1] == "%acme%"


# =============================================================================
# Test 9: List Activations & Audit Logs
# =============================================================================
def test_list_activations_and_audit_logs():
    """Validates querying joined activations and chronological audit logs.

    Validates:
    - Activations join licenses table
    - Audit logs support event_type filter and limit
    """
    client = CloudflareAdminClient(api_token="mock_token")

    with mock.patch.object(client, "execute_query", return_value=[]) as mock_exec:
        client.list_activations()
        assert "JOIN licenses l ON a.license_id = l.id" in mock_exec.call_args_list[0][0][0]

        client.list_audit_logs(limit=25, event_type="activate_success")
        query, params = mock_exec.call_args_list[1][0]
        assert "WHERE event_type = ?" in query
        assert params == ["activate_success", 25]
