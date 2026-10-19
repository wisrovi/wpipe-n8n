"""Step: Manage Licenses.
Author: William Rodriguez (wisrovi.dev)
"""

from typing import Any
from wpipe import step, to_obj
from wpipe.timeout import timeout_sync
from client import CloudflareAdminClient
from dto.admin_context import AdminPipelineContext


def _get(obj: Any, key: str, default: Any = None) -> Any:
    if obj is None:
        return default
    if isinstance(obj, dict):
        return obj.get(key, default)
    return getattr(obj, key, default)


@step(
    name="ManageLicensesStep",
    version="v1.0",
    timeout=10,
    description="Handles license operations: list, search, create, update status and delete",
    tags=["admin", "licenses", "crud"],
    retry_count=2,
    retry_delay=0.1,
)
class ManageLicensesStep:
    """Step to query or mutate licenses in Cloudflare D1."""

    def __init__(self, client: CloudflareAdminClient | None = None) -> None:
        self.client = client or CloudflareAdminClient()

    @timeout_sync(seconds=8)
    @to_obj(AdminPipelineContext)
    def __call__(self, context: Any) -> Any:
        action = _get(context, "action", "fetch_all")
        search = _get(context, "search_query", None)
        status_filter = _get(context, "status_filter", "all")

        try:
            # Handle Mutations
            if action == "create_license":
                lic_data = _get(context, "license_input", {}) or {}
                self.client.create_license(
                    customer_email=_get(lic_data, "customer_email", ""),
                    customer_name=_get(lic_data, "customer_name", ""),
                    plan=_get(lic_data, "plan", "pro"),
                    max_machines=int(_get(lic_data, "max_machines", 2) or 2),
                    expires_at=_get(lic_data, "expires_at", None),
                    custom_key=_get(lic_data, "custom_key", None),
                )
            elif action == "update_license":
                target_id = _get(context, "target_id", None)
                target_status = _get(context, "target_status", None)
                if target_id and target_status:
                    self.client.update_license_status(target_id, target_status)
            elif action == "delete_license":
                target_id = _get(context, "target_id", None)
                if target_id:
                    self.client.delete_license(target_id)

            # Query fresh list
            licenses = self.client.list_licenses(search=search, status_filter=status_filter)
            if isinstance(context, dict):
                context["licenses"] = licenses
            else:
                context.licenses = licenses
        except Exception as e:
            if isinstance(context, dict):
                context["licenses"] = []
                context["error"] = str(e)
            else:
                context.licenses = []
                context.error = str(e)

        return context
