"""Cloudflare D1 & R2 Admin Client
Provides direct REST and Wrangler API interface to manage licenses, activations and audit logs.
Author: William Rodriguez (wisrovi.dev)
"""

from __future__ import annotations

import json
import logging
import os
import secrets
import string
import subprocess
import urllib.error
import urllib.request
from typing import Any, Optional

logger = logging.getLogger("admin_cloudfire.client")

DEFAULT_ACCOUNT_ID = "e3a420c454b6c6ca891b31aea00ac53f"
DEFAULT_DATABASE_ID = "44bf0372-587d-446d-84c3-1153c4183b99"
DEFAULT_DB_NAME = "wpipe_licenses"


def generate_license_key(prefix: str = "WPIPE-PRO") -> str:
    """Generate a clean cryptographically strong license key format: PREFIX-XXXX-XXXX-XXXX."""
    chars = string.ascii_uppercase + string.digits
    chars = chars.replace("O", "").replace("0", "").replace("I", "").replace("1", "")  # remove ambiguous chars
    part1 = "".join(secrets.choice(chars) for _ in range(4))
    part2 = "".join(secrets.choice(chars) for _ in range(4))
    part3 = "".join(secrets.choice(chars) for _ in range(4))
    return f"{prefix}-{part1}-{part2}-{part3}"


class CloudflareAdminClient:
    """Admin client communicating with Cloudflare D1 and Worker Edge APIs."""

    def __init__(
        self,
        account_id: Optional[str] = None,
        database_id: Optional[str] = None,
        api_token: Optional[str] = None,
        api_base_url: Optional[str] = None,
    ) -> None:
        self.account_id = account_id or os.environ.get("CLOUDFLARE_ACCOUNT_ID", DEFAULT_ACCOUNT_ID)
        self.database_id = database_id or os.environ.get("CLOUDFLARE_D1_DATABASE_ID", DEFAULT_DATABASE_ID)
        self.api_token = api_token or os.environ.get("CLOUDFLARE_API_TOKEN", "")
        self.api_base_url = (api_base_url or os.environ.get("API_BASE_URL", "https://api.wisrovi.dev")).rstrip("/")

    def execute_query(self, sql: str, params: Optional[list[Any]] = None) -> list[dict[str, Any]]:
        """Execute SQL query against Cloudflare D1.

        Uses Cloudflare REST API when API token is provided, or Wrangler CLI as fallback.
        """
        if self.api_token:
            return self._query_via_rest(sql, params)
        return self._query_via_wrangler(sql, params)

    def _query_via_rest(self, sql: str, params: Optional[list[Any]] = None) -> list[dict[str, Any]]:
        """Execute SQL query via Cloudflare REST API."""
        url = f"https://api.cloudflare.com/client/v4/accounts/{self.account_id}/d1/database/{self.database_id}/query"
        payload = {"sql": sql, "params": params or []}

        req = urllib.request.Request(
            url,
            data=json.dumps(payload).encode("utf-8"),
            headers={
                "Authorization": f"Bearer {self.api_token}",
                "Content-Type": "application/json",
                "User-Agent": "wpipe-admin-dashboard/1.0.0",
            },
            method="POST",
        )

        try:
            with urllib.request.urlopen(req, timeout=15) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                if not data.get("success"):
                    errors = data.get("errors", [])
                    raise RuntimeError(f"Cloudflare D1 error: {errors}")
                result = data.get("result", [])
                if result and isinstance(result, list):
                    return result[0].get("results", [])
                return []
        except urllib.error.HTTPError as e:
            err_body = e.read().decode("utf-8")
            raise RuntimeError(f"HTTP {e.code} querying Cloudflare D1: {err_body}") from e
        except Exception as e:
            raise RuntimeError(f"Failed to query Cloudflare D1: {e}") from e

    def _query_via_wrangler(self, sql: str, params: Optional[list[Any]] = None) -> list[dict[str, Any]]:
        """Fallback execution via local Wrangler CLI."""
        # Interpolate params safely if needed
        interpolated_sql = sql
        if params:
            for p in params:
                if p is None:
                    val = "NULL"
                elif isinstance(p, (int, float)):
                    val = str(p)
                else:
                    escaped = str(p).replace("'", "''")
                    val = f"'{escaped}'"
                interpolated_sql = interpolated_sql.replace("?", val, 1)

        cmd = [
            "npx",
            "wrangler",
            "d1",
            "execute",
            DEFAULT_DB_NAME,
            "--remote",
            "--json",
            f"--command={interpolated_sql}",
        ]

        try:
            proc = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                check=True,
                timeout=20,
            )
            data = json.loads(proc.stdout)
            if isinstance(data, list) and len(data) > 0:
                return data[0].get("results", [])
            return []
        except subprocess.CalledProcessError as e:
            raise RuntimeError(f"Wrangler error: {e.stderr or e.stdout}") from e
        except Exception as e:
            raise RuntimeError(f"Wrangler execution failed: {e}") from e

    # -------------------------------------------------------------------------
    # High-level Business Operations
    # -------------------------------------------------------------------------

    def get_stats(self) -> dict[str, Any]:
        """Fetch dashboard statistics."""
        try:
            total_licenses = self.execute_query("SELECT COUNT(*) as count FROM licenses")[0]["count"]
            active_licenses = self.execute_query("SELECT COUNT(*) as count FROM licenses WHERE status = 'active'")[0]["count"]
            total_activations = self.execute_query("SELECT COUNT(*) as count FROM activations")[0]["count"]
            recent_logs = self.execute_query("SELECT COUNT(*) as count FROM audit_logs WHERE created_at >= datetime('now', '-7 days')")[0]["count"]
            return {
                "total_licenses": total_licenses,
                "active_licenses": active_licenses,
                "total_activations": total_activations,
                "recent_logs_7d": recent_logs,
            }
        except Exception as e:
            logger.error("Failed to load stats: %s", e)
            return {
                "total_licenses": 0,
                "active_licenses": 0,
                "total_activations": 0,
                "recent_logs_7d": 0,
            }

    def list_licenses(self, search: Optional[str] = None, status_filter: Optional[str] = None) -> list[dict[str, Any]]:
        """List licenses with optional search filtering."""
        query = "SELECT * FROM licenses"
        conditions = []
        params = []

        if status_filter and status_filter != "all":
            conditions.append("status = ?")
            params.append(status_filter)

        if search:
            clean_search = f"%{search.strip().lower()}%"
            conditions.append("(LOWER(license_key) LIKE ? OR LOWER(customer_email) LIKE ? OR LOWER(customer_name) LIKE ?)")
            params.extend([clean_search, clean_search, clean_search])

        if conditions:
            query += " WHERE " + " AND ".join(conditions)

        query += " ORDER BY created_at DESC"
        return self.execute_query(query, params)

    def create_license(
        self,
        customer_email: str,
        customer_name: str,
        plan: str = "pro",
        max_machines: int = 2,
        expires_at: Optional[str] = None,
        custom_key: Optional[str] = None,
    ) -> dict[str, Any]:
        """Create a new license in Cloudflare D1."""
        clean_email = customer_email.strip().lower()
        clean_name = customer_name.strip()
        clean_plan = plan.strip().lower()
        prefix = f"WPIPE-{clean_plan.upper()}"
        license_key = (custom_key or generate_license_key(prefix)).strip().upper()
        license_id = f"lic_{secrets.token_hex(8)}"

        sql = """
            INSERT INTO licenses (id, license_key, customer_email, customer_name, plan, status, max_machines, expires_at, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, 'active', ?, ?, datetime('now'), datetime('now'))
        """
        params = [license_id, license_key, clean_email, clean_name, clean_plan, max_machines, expires_at]
        self.execute_query(sql, params)

        return {
            "id": license_id,
            "license_key": license_key,
            "customer_email": clean_email,
            "customer_name": clean_name,
            "plan": clean_plan,
            "status": "active",
            "max_machines": max_machines,
            "expires_at": expires_at,
        }

    def update_license_status(self, license_id: str, new_status: str) -> bool:
        """Update license status ('active', 'suspended', 'revoked')."""
        sql = "UPDATE licenses SET status = ?, updated_at = datetime('now') WHERE id = ?"
        self.execute_query(sql, [new_status, license_id])
        return True

    def delete_license(self, license_id: str) -> bool:
        """Delete license and cascade delete activations."""
        self.execute_query("DELETE FROM activations WHERE license_id = ?", [license_id])
        self.execute_query("DELETE FROM licenses WHERE id = ?", [license_id])
        return True

    def list_activations(self) -> list[dict[str, Any]]:
        """List all machine activations with joined license key and customer email."""
        sql = """
            SELECT a.id, a.license_id, l.license_key, l.customer_email, l.plan,
                   a.machine_fingerprint, a.hostname, a.os_name,
                   a.last_verified_at, a.lease_expires_at, a.created_at
            FROM activations a
            JOIN licenses l ON a.license_id = l.id
            ORDER BY a.last_verified_at DESC
        """
        return self.execute_query(sql)

    def delete_activation(self, activation_id: str) -> bool:
        """Delete/unlink an activation so customer can bind a different machine."""
        sql = "DELETE FROM activations WHERE id = ?"
        self.execute_query(sql, [activation_id])
        return True

    def list_audit_logs(self, limit: int = 100, event_type: Optional[str] = None) -> list[dict[str, Any]]:
        """List audit logs chronologically."""
        if event_type and event_type != "all":
            sql = "SELECT * FROM audit_logs WHERE event_type = ? ORDER BY created_at DESC LIMIT ?"
            return self.execute_query(sql, [event_type, limit])
        sql = "SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT ?"
        return self.execute_query(sql, [limit])
