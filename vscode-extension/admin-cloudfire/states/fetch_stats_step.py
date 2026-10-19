"""Step: Fetch D1 Statistics & KPIs.
Author: William Rodriguez (wisrovi.dev)
"""

from typing import Any
from wpipe import step, to_obj
from wpipe.timeout import timeout_sync
from client import CloudflareAdminClient
from dto.admin_context import AdminPipelineContext


@step(
    name="FetchStatsStep",
    version="v1.0",
    timeout=10,
    description="Fetches aggregated licensing and activation metrics from Cloudflare D1",
    tags=["admin", "metrics", "kpi"],
    retry_count=2,
    retry_delay=0.1,
)
class FetchStatsStep:
    """Step to load KPIs from D1 database into pipeline context."""

    def __init__(self, client: CloudflareAdminClient | None = None) -> None:
        self.client = client or CloudflareAdminClient()

    @timeout_sync(seconds=5)
    @to_obj(AdminPipelineContext)
    def __call__(self, context: Any) -> Any:
        try:
            stats = self.client.get_stats()
            if isinstance(context, dict):
                context["stats"] = stats
            else:
                context.stats = stats
        except Exception as e:
            if isinstance(context, dict):
                context["stats"] = {"total_licenses": 0, "active_licenses": 0, "total_activations": 0, "recent_logs_7d": 0}
                context["error"] = str(e)
            else:
                context.stats = {"total_licenses": 0, "active_licenses": 0, "total_activations": 0, "recent_logs_7d": 0}
                context.error = str(e)
        return context
