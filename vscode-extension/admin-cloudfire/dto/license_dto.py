"""DTO for License Entity.
Author: William Rodriguez (wisrovi.dev)
"""

from typing import Optional
from pydantic import BaseModel


class LicenseDTO(BaseModel):
    """Data Transfer Object representing a software license."""

    id: Optional[str] = None
    license_key: str
    customer_email: str
    customer_name: str
    plan: str = "pro"
    status: str = "active"
    max_machines: int = 2
    expires_at: Optional[str] = None
    created_at: Optional[str] = None
    updated_at: Optional[str] = None
