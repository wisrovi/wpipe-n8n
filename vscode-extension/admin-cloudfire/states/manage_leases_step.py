"""Step: Manage Dynamic Floating Leases.
Author: William Rodriguez (wisrovi.dev)
"""

from typing import Any
from wpipe import step, to_obj
from wpipe.timeout import timeout_sync
from client import CloudflareAdminClient
from dto.admin_context import AdminPipelineContext


@step(
    name="ManageLeasesStep",
    version="v1.0",
    timeout=10,
    description="Handles dynamic floating leases listing, status tracking, and 1-click liberation",
    tags=["admin", "leases", "floating_seats", "concurrency"],
    retry_count=2,
    retry_delay=0.1,
)
class ManageLeasesStep:
    """Step to query or kick/liberate active floating leases in Cloudflare D1."""

    def __init__(self, client: CloudflareAdminClient | None = None) -> None:
        self.client = client or CloudflareAdminClient()

    @timeout_sync(seconds=8)
    @to_obj(AdminPipelineContext)
    def __call__(self, context: Any) -> Any:
        action = getattr(context, "action", None) or (context.get("action") if isinstance(context, dict) else "fetch_all")
        target_id = getattr(context, "target_id", None) or (context.get("target_id") if isinstance(context, dict) else None)

        try:
            if action == "delete_lease" and target_id:
                self.client.delete_lease(target_id)

            leases = self.client.list_leases()
            if isinstance(context, dict):
                context["leases"] = leases
            else:
                context.leases = leases
        except Exception as e:
            if isinstance(context, dict):
                context["leases"] = []
                context["error"] = str(e)
            else:
                context.leases = []
                context.error = str(e)

        return context
