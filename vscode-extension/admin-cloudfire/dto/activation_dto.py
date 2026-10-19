"""DTO for Machine Activation (Lease).
Author: William Rodriguez (wisrovi.dev)
"""

from typing import Optional
from pydantic import BaseModel


class ActivationDTO(BaseModel):
    """Data Transfer Object representing a hardware machine activation."""

    id: str
    license_id: str
    license_key: Optional[str] = None
    customer_email: Optional[str] = None
    plan: Optional[str] = None
    machine_fingerprint: str
    hostname: Optional[str] = None
    os_name: Optional[str] = None
    last_verified_at: Optional[str] = None
    lease_expires_at: Optional[str] = None
    created_at: Optional[str] = None
