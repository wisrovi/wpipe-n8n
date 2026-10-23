"""Context model for Admin Pipeline execution.
Author: William Rodriguez (wisrovi.dev)
"""

from typing import Any, Optional
from pydantic import BaseModel
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
