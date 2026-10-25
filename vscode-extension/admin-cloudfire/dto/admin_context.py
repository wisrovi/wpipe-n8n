"""Context model for Admin Pipeline execution.
Author: William Rodriguez (wisrovi.dev)
"""

from typing import Any, Optional
from pydantic import BaseModel, model_validator
from dto.license_dto import LicenseDTO
from dto.activation_dto import ActivationDTO


class AdminPipelineContext(BaseModel):
    """Pipeline Context holding admin state, operations, and query results."""

    action: str = "fetch_all"  # 'fetch_all', 'create_license', 'update_license', 'delete_activation', etc.
    search_query: Optional[str] = None
    status_filter: Optional[str] = "all"

    # Inputs for mutation actions
    license_input: Optional[dict[str, Any]] = None
    target_id: Optional[str] = None
    target_status: Optional[str] = None

    # Outputs populated by steps
    stats: dict[str, Any] = {}
    licenses: list[dict[str, Any]] = []
    activations: list[dict[str, Any]] = []
    leases: list[dict[str, Any]] = []
    audit_logs: list[dict[str, Any]] = []

    # Execution status
    success: bool = True
    message: str = "Success"
    error: Optional[str] = None

    @model_validator(mode="before")
    @classmethod
    def normalize_wpipe_placeholders(cls, data: Any) -> Any:
        """Normalizes empty dictionary placeholders inserted by object_to_dict for None fields."""
        if isinstance(data, dict):
            for key in ["search_query", "target_id", "target_status", "error", "license_input"]:
                if key in data and isinstance(data[key], dict) and not data[key]:
                    data[key] = None
        return data
