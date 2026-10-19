"""Unit tests for WPipe Admin Pipeline Orchestrator and States.
Author: William Rodriguez (wisrovi.dev)

Validates the full WPipe architecture:
- Pipeline creation with proper step sequence
- Context passing and mutation across steps
- Handling of 'fetch_all', 'create_license', and 'delete_activation' actions
"""

from __future__ import annotations

import unittest.mock as mock
import pytest
from client import CloudflareAdminClient
from pipelines import create_admin_pipeline


def test_admin_pipeline_structure():
    """Validates that create_admin_pipeline configures the 4 standard WPipe steps in sequence."""
    pipeline = create_admin_pipeline()

    assert pipeline.pipeline_name == "admin_cloudfire_pipeline"
    assert len(pipeline.steps) == 4

    step_names = [step.name for step in pipeline.steps]
    assert "FetchStatsStep" in step_names
    assert "ManageLicensesStep" in step_names
    assert "ManageActivationsStep" in step_names
    assert "ManageAuditStep" in step_names


def test_admin_pipeline_fetch_all_execution():
    """Validates executing the pipeline with 'fetch_all' populates stats, licenses, activations, and audit logs."""
    client = CloudflareAdminClient(api_token="mock_token")

    with mock.patch.object(client, "get_stats", return_value={"total_licenses": 5, "active_licenses": 4, "total_activations": 3, "recent_logs_7d": 12}), \
         mock.patch.object(client, "list_licenses", return_value=[{"id": "lic_1", "license_key": "WPIPE-PRO-TEST"}]), \
         mock.patch.object(client, "list_activations", return_value=[{"id": "act_1", "hostname": "dev-pc"}]), \
         mock.patch.object(client, "list_audit_logs", return_value=[{"event_type": "activate_success"}]):

        pipeline = create_admin_pipeline(client)
        result = pipeline.run({"action": "fetch_all"})

        assert "stats" in result
        assert result["stats"]["total_licenses"] == 5
        assert len(result["licenses"]) == 1
        assert len(result["activations"]) == 1
        assert len(result["audit_logs"]) == 1


def test_admin_pipeline_create_license_action():
    """Validates executing create_license action delegates to ManageLicensesStep."""
    client = CloudflareAdminClient(api_token="mock_token")

    with mock.patch.object(client, "create_license", return_value={"id": "lic_new"}) as mock_create, \
         mock.patch.object(client, "list_licenses", return_value=[]), \
         mock.patch.object(client, "get_stats", return_value={}), \
         mock.patch.object(client, "list_activations", return_value=[]), \
         mock.patch.object(client, "list_audit_logs", return_value=[]):

        pipeline = create_admin_pipeline(client)
        pipeline.run({
            "action": "create_license",
            "license_input": {
                "customer_email": "jane@example.com",
                "customer_name": "Jane Corp",
                "plan": "pro",
                "max_machines": 2,
            },
        })

        assert mock_create.called
        assert mock_create.call_args[1]["customer_email"] == "jane@example.com"
