"""Step: Manage Machine Activations (Leases).
Author: William Rodriguez (wisrovi.dev)
"""

from typing import Any
from wpipe import step, to_obj
from wpipe.timeout import timeout_sync
from client import CloudflareAdminClient
from dto.admin_context import AdminPipelineContext


@step(
    name="ManageActivationsStep",
    version="v1.0",
    timeout=10,
    description="Handles hardware machine activations listing and unlinking",
    tags=["admin", "activations", "hardware"],
    retry_count=2,
    retry_delay=0.1,
)
class ManageActivationsStep:
    """Step to query or unlink bound hardware machines in Cloudflare D1."""

    def __init__(self, client: CloudflareAdminClient | None = None) -> None:
        self.client = client or CloudflareAdminClient()

    @timeout_sync(seconds=8)
    @to_obj(AdminPipelineContext)
    def __call__(self, context: Any) -> Any:
        action = getattr(context, "action", None) or (context.get("action") if isinstance(context, dict) else "fetch_all")
        target_id = getattr(context, "target_id", None) or (context.get("target_id") if isinstance(context, dict) else None)

        try:
            if action == "delete_activation" and target_id:
                self.client.delete_activation(target_id)

            activations = self.client.list_activations()
            if isinstance(context, dict):
                context["activations"] = activations
            else:
                context.activations = activations
        except Exception as e:
            if isinstance(context, dict):
                context["activations"] = []
                context["error"] = str(e)
            else:
                context.activations = []
                context.error = str(e)

        return context
