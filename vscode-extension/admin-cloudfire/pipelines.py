"""WPipe Pipeline Orchestrator for Admin Cloudfire.
Author: William Rodriguez (wisrovi.dev)
"""

from __future__ import annotations

import os
from typing import Any
from wpipe import Pipeline
from client import CloudflareAdminClient
from states import (
    FetchStatsStep,
    ManageLicensesStep,
    ManageActivationsStep,
    ManageLeasesStep,
    ManageAuditStep,
)


def create_admin_pipeline(client: CloudflareAdminClient | None = None) -> Pipeline:
    """Creates and configures the WPipe orchestrator for administration operations."""
    os.makedirs("output", exist_ok=True)

    pipeline = Pipeline(
        pipeline_name="admin_cloudfire_pipeline",
        pipeline_version="1.1.0",
        tracking_db="output/admin_tracking.db",
        collect_system_metrics=False,
        show_progress=False,
        max_retries=2,
        retry_delay=0.1,
    )

    admin_client = client or CloudflareAdminClient()

    pipeline.set_steps([
        FetchStatsStep(client=admin_client),
        ManageLicensesStep(client=admin_client),
        ManageActivationsStep(client=admin_client),
        ManageLeasesStep(client=admin_client),
        ManageAuditStep(client=admin_client),
    ])

    return pipeline
