"""WPipe Engine - Cryptographic Licensing & Machine Fingerprinting
Verifies Ed25519 lease tokens issued by api.wisrovi.dev (Cloudflare Edge).
Author: William Rodriguez (wisrovi.dev)
"""

import base64
import hashlib
import json
import os
import platform
import socket
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from cryptography.hazmat.primitives.asymmetric import ed25519

import threading

# Embedded Ed25519 Public Key (32-byte raw hex) paired with Cloudflare Worker
DEFAULT_PUBLIC_KEY_HEX = "470531dc5170a830ff8028efa9e400b3717965404a28626ffa9cdbe3404e9ed1"
DEFAULT_LICENSE_SERVER_URL = "https://api.wisrovi.dev"
HEARTBEAT_INTERVAL_SECONDS = 1800  # 30 minutes


def _base64url_decode(input_str: str) -> bytes:
    """Decode standard RFC 7515 base64url string with proper padding."""
    rem = len(input_str) % 4
    if rem > 0:
        input_str += "=" * (4 - rem)
    return base64.urlsafe_b64decode(input_str)


def compute_machine_fingerprint() -> str:
    """Generate a reproducible, hardware-anchored SHA-256 fingerprint for this machine."""
    components: list[str] = [platform.system(), platform.machine()]

    # 1. OS-specific unique ID
    os_id = ""
    if sys.platform.startswith("linux"):
        for p in ("/etc/machine-id", "/var/lib/dbus/machine-id"):
            if os.path.exists(p):
                try:
                    os_id = Path(p).read_text().strip()
                    break
                except Exception:
                    pass
    elif sys.platform == "darwin":
        try:
            import subprocess
            out = subprocess.check_output(
                ["ioreg", "-rd1", "-c", "IOPlatformExpertDevice"], text=True
            )
            for line in out.splitlines():
                if "IOPlatformUUID" in line:
                    os_id = line.split("=")[-1].strip().replace('"', "")
                    break
        except Exception:
            pass
    elif sys.platform == "win32":
        try:
            import winreg
            key = winreg.OpenKey(
                winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\Microsoft\Cryptography"
            )
            os_id, _ = winreg.QueryValueEx(key, "MachineGuid")
        except Exception:
            pass

    components.append(os_id or socket.gethostname())

    # 2. Network MAC Address fallback
    try:
        import uuid
        mac = ":".join(
            ["{:02x}".format((uuid.getnode() >> ele) & 0xFF) for ele in range(0, 8 * 6, 8)][::-1]
        )
        components.append(mac)
    except Exception:
        pass

    raw = "||".join(components)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def verify_lease_token(
    token: str,
    public_key_hex: str = DEFAULT_PUBLIC_KEY_HEX,
    expected_fingerprint: Optional[str] = None,
) -> tuple[bool, dict[str, Any], str]:
    """Verify an Ed25519 compact signed lease token (header.payload.signature).

    Returns (is_valid, payload_dict, message).
    """
    if not token or "." not in token:
        return False, {}, "Token malformado o vacío"

    parts = token.split(".")
    if len(parts) != 3:
        return False, {}, "Estructura de token inválida (requiere 3 partes)"

    encoded_header, encoded_payload, encoded_signature = parts
    signed_data = f"{encoded_header}.{encoded_payload}".encode("utf-8")

    try:
        signature_bytes = _base64url_decode(encoded_signature)
        payload_bytes = _base64url_decode(encoded_payload)
        payload = json.loads(payload_bytes.decode("utf-8"))
    except Exception as e:
        return False, {}, f"Error al decodificar token: {e}"

    # 1. Verify Ed25519 Cryptographic Signature
    try:
        pub_bytes = bytes.fromhex(public_key_hex)
        pub_key = ed25519.Ed25519PublicKey.from_public_bytes(pub_bytes)
        pub_key.verify(signature_bytes, signed_data)
    except Exception as e:
        return False, payload, f"Firma criptográfica inválida o adulterada: {e}"

    # 2. Check Machine Fingerprint Binding
    target_fp = expected_fingerprint or compute_machine_fingerprint()
    token_fp = payload.get("mfp", "")
    if token_fp and token_fp != target_fp:
        return False, payload, "El token de licencia pertenece a otra máquina física."

    # 3. Check Expiration & Grace Period
    now_sec = int(time.time())
    exp_sec = payload.get("exp", 0)
    grace_days = payload.get("grace_days", 7)
    grace_sec = grace_days * 86400

    if now_sec > exp_sec:
        if now_sec <= (exp_sec + grace_sec):
            remaining_grace_days = max(1, (exp_sec + grace_sec - now_sec) // 86400)
            return True, payload, f"Licencia en período de gracia ({remaining_grace_days} días restantes para renovar)"
        return False, payload, "El período de arrendamiento de la licencia ha expirado"

    return True, payload, "Licencia activa y verificada"


class LicenseManager:
    """Manages persistent license storage, offline lease caching and heartbeat renewals."""

    def __init__(
        self,
        config_dir: Optional[Path] = None,
        public_key_hex: str = DEFAULT_PUBLIC_KEY_HEX,
        api_url: str = DEFAULT_LICENSE_SERVER_URL,
    ):
        self.config_dir = config_dir or (Path.home() / ".wpipe")
        self.license_file = self.config_dir / "license.json"
        self.public_key_hex = public_key_hex
        self.api_url = api_url.rstrip("/")
        self.config_dir.mkdir(parents=True, exist_ok=True)
        self._heartbeat_thread: Optional[threading.Thread] = None
        self._stop_heartbeat = threading.Event()
        self._start_heartbeat_loop_if_needed()

    def _start_heartbeat_loop_if_needed(self) -> None:
        """Start a daemon thread that sends periodic heartbeats every 30m to renew the 2h floating lease."""
        if self._heartbeat_thread is not None and self._heartbeat_thread.is_alive():
            return
        if not self.license_file.exists():
            return
        try:
            data = json.loads(self.license_file.read_text(encoding="utf-8"))
            if not data.get("lease_id"):
                return
        except Exception:
            return

        def _worker():
            while not self._stop_heartbeat.wait(HEARTBEAT_INTERVAL_SECONDS):
                try:
                    self.send_heartbeat()
                except Exception:
                    pass

        self._heartbeat_thread = threading.Thread(target=_worker, name="wpipe-lease-heartbeat", daemon=True)
        self._heartbeat_thread.start()

    def send_heartbeat(self) -> bool:
        """Ping Cloudflare Worker to renew the 2-hour floating seat lease TTL."""
        if not self.license_file.exists():
            return False
        try:
            data = json.loads(self.license_file.read_text(encoding="utf-8"))
            lease_id = data.get("lease_id")
            license_key = data.get("license_key")
            if not lease_id or not license_key:
                return False

            import urllib.request
            mfp = compute_machine_fingerprint()
            req = urllib.request.Request(
                f"{self.api_url}/v1/license/heartbeat",
                data=json.dumps({
                    "lease_id": lease_id,
                    "license_key": license_key,
                    "machine_fingerprint": mfp,
                }).encode("utf-8"),
                headers={"Content-Type": "application/json", "User-Agent": "wpipe-engine/1.0.0"},
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=10) as resp:
                res = json.loads(resp.read().decode("utf-8"))
                if res.get("status") == "renewed":
                    data["expires_at"] = res.get("expires_at")
                    self.license_file.write_text(json.dumps(data, indent=2), encoding="utf-8")
                    return True
        except Exception:
            pass
        return False

    def release_lease(self) -> bool:
        """Voluntarily release the active floating seat so another workstation can use it."""
        if not self.license_file.exists():
            return False
        try:
            data = json.loads(self.license_file.read_text(encoding="utf-8"))
            lease_id = data.get("lease_id")
            license_key = data.get("license_key")
            if not lease_id:
                return False

            import urllib.request
            mfp = compute_machine_fingerprint()
            req = urllib.request.Request(
                f"{self.api_url}/v1/license/release",
                data=json.dumps({
                    "lease_id": lease_id,
                    "license_key": license_key,
                    "machine_fingerprint": mfp,
                }).encode("utf-8"),
                headers={"Content-Type": "application/json", "User-Agent": "wpipe-engine/1.0.0"},
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=10) as resp:
                data.pop("lease_id", None)
                data.pop("lease_token", None)
                self.license_file.write_text(json.dumps(data, indent=2), encoding="utf-8")
                return True
        except Exception:
            pass
        return False

    def get_status(self) -> dict[str, Any]:
        """Return current licensing status (Free vs Pro)."""
        mfp = compute_machine_fingerprint()

        if not self.license_file.exists():
            return {
                "tier": "free",
                "is_pro": False,
                "max_blocks": 5,
                "features": {
                    "unlimited_blocks": False,
                    "parallel_blocks": False,
                    "background_tasks": False,
                    "ai_steps": False,
                    "live_debugging": False,
                },
                "machine_fingerprint": mfp,
                "message": "Plan Gratuito / Community (Máximo 5 bloques por pipeline)",
                "upgrade_url": "https://wisrovi.dev",
            }

        try:
            data = json.loads(self.license_file.read_text(encoding="utf-8"))
            if data.get("status") == "seats_exceeded":
                return {
                    "tier": "free",
                    "is_pro": False,
                    "max_blocks": 5,
                    "license_key": data.get("license_key", ""),
                    "features": {
                        "unlimited_blocks": False,
                        "parallel_blocks": False,
                        "background_tasks": False,
                        "ai_steps": False,
                        "live_debugging": False,
                    },
                    "machine_fingerprint": mfp,
                    "message": f"Capa Free Activa: Todos los asientos Pro de tu equipo ({data.get('active_seats', '?')}/{data.get('max_seats', '?')}) están en uso. Libera un puesto en https://portal.wisrovi.dev.",
                    "upgrade_url": "https://portal.wisrovi.dev",
                }

            lease_token = data.get("lease_token", "")
            is_valid, payload, msg = verify_lease_token(
                lease_token, self.public_key_hex, expected_fingerprint=mfp
            )

            if is_valid:
                plan = payload.get("plan", "pro")
                exp_dt = datetime.fromtimestamp(payload.get("exp", 0), timezone.utc)
                return {
                    "tier": plan,
                    "is_pro": True,
                    "license_key": payload.get("lic", data.get("license_key", "")),
                    "customer_name": data.get("customer_name", "Developer"),
                    "max_blocks": None,  # Unlimited
                    "features": {
                        "unlimited_blocks": True,
                        "parallel_blocks": True,
                        "background_tasks": True,
                        "ai_steps": True,
                        "live_debugging": True,
                    },
                    "machine_fingerprint": mfp,
                    "lease_expires_at": exp_dt.isoformat(),
                    "message": f"Plan {plan.capitalize()} Activo — {msg}",
                }
            else:
                return {
                    "tier": "free",
                    "is_pro": False,
                    "max_blocks": 5,
                    "features": {
                        "unlimited_blocks": False,
                        "parallel_blocks": False,
                        "background_tasks": False,
                        "ai_steps": False,
                        "live_debugging": False,
                    },
                    "machine_fingerprint": mfp,
                    "message": f"Licencia inactiva o degradada: {msg}",
                    "upgrade_url": "https://wisrovi.dev",
                }
        except Exception as e:
            return {
                "tier": "free",
                "is_pro": False,
                "max_blocks": 5,
                "machine_fingerprint": mfp,
                "message": f"Error al leer licencia local: {e}",
                "upgrade_url": "https://wisrovi.dev",
            }

    def activate_with_key(self, license_key: str, hostname: Optional[str] = None) -> tuple[bool, str]:
        """Activate license key against Cloudflare Edge API and store lease token locally."""
        import urllib.request
        import urllib.error

        clean_key = license_key.strip().upper()
        mfp = compute_machine_fingerprint()
        payload_data = {
            "license_key": clean_key,
            "machine_fingerprint": mfp,
            "hostname": hostname or socket.gethostname(),
            "os": platform.system().lower(),
        }

        # 1. First attempt Floating Lease API (/v1/license/lease)
        try:
            req = urllib.request.Request(
                f"{self.api_url}/v1/license/lease",
                data=json.dumps(payload_data).encode("utf-8"),
                headers={"Content-Type": "application/json", "User-Agent": "wpipe-engine/1.0.0"},
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=10) as resp:
                result = json.loads(resp.read().decode("utf-8"))
                lease_token = result.get("lease_token")
                if lease_token:
                    is_valid, payload, msg = verify_lease_token(
                        lease_token, self.public_key_hex, expected_fingerprint=mfp
                    )
                    if is_valid:
                        save_data = {
                            "license_key": clean_key,
                            "lease_id": result.get("lease_id"),
                            "customer_name": result.get("customer_name", "Developer"),
                            "plan": result.get("plan", "pro"),
                            "lease_token": lease_token,
                            "activated_at": datetime.now(timezone.utc).isoformat(),
                            "expires_at": result.get("expires_at"),
                            "is_floating": True,
                        }
                        self.license_file.write_text(json.dumps(save_data, indent=2), encoding="utf-8")
                        self._start_heartbeat_loop_if_needed()
                        return True, f"¡Asiento Pro Flotante activado exitosamente! ({result.get('plan', 'Pro').upper()})"
        except urllib.error.HTTPError as e:
            if e.code == 409:
                err_data = json.loads(e.read().decode("utf-8", errors="ignore"))
                # Save graceful fallback so engine continues in Free tier (≤ 5 blocks)
                save_data = {
                    "license_key": clean_key,
                    "status": "seats_exceeded",
                    "plan": "free",
                    "max_seats": err_data.get("max_seats"),
                    "active_seats": err_data.get("active_seats"),
                    "message": err_data.get("message"),
                }
                self.license_file.write_text(json.dumps(save_data, indent=2), encoding="utf-8")
                return False, f"Cupo lleno ({err_data.get('active_seats')}/{err_data.get('max_seats')} en uso). WPipe Studio funcionará en Capa Free (≤ 5 bloques). Libera un asiento en https://portal.wisrovi.dev."
            elif e.code == 404:
                return False, "Clave de licencia no encontrada o inválida."
        except Exception:
            pass

        # 2. Fallback to legacy activate endpoint
        req = urllib.request.Request(
            f"{self.api_url}/v1/license/activate",
            data=json.dumps(payload_data).encode("utf-8"),
            headers={"Content-Type": "application/json", "User-Agent": "wpipe-engine/1.0.0"},
            method="POST",
        )

        try:
            with urllib.request.urlopen(req, timeout=10) as resp:
                result = json.loads(resp.read().decode("utf-8"))
                lease_token = result.get("lease_token")
                if not lease_token:
                    return False, "La respuesta del servidor no incluyó el token de arrendamiento"

                # Verify locally before saving
                is_valid, payload, msg = verify_lease_token(
                    lease_token, self.public_key_hex, expected_fingerprint=mfp
                )
                if not is_valid:
                    return False, f"El token recibido falló la verificación criptográfica: {msg}"

                save_data = {
                    "license_key": clean_key,
                    "customer_name": result.get("customer_name", "Developer"),
                    "plan": result.get("plan", "pro"),
                    "lease_token": lease_token,
                    "activated_at": datetime.now(timezone.utc).isoformat(),
                    "expires_at": result.get("expires_at"),
                }
                self.license_file.write_text(json.dumps(save_data, indent=2), encoding="utf-8")
                return True, f"¡Licencia {result.get('plan', 'Pro').upper()} activada exitosamente!"
        except urllib.error.HTTPError as e:
            err_msg = e.read().decode("utf-8", errors="ignore")
            try:
                err_json = json.loads(err_msg)
                return False, err_json.get("message", f"HTTP {e.code}: {e.reason}")
            except Exception:
                return False, f"HTTP {e.code}: {e.reason}"
        except Exception as e:
            return False, f"Error de conexión con {self.api_url}: {e}"

    def install_offline_lease_token(self, lease_token: str, customer_name: str = "Developer") -> tuple[bool, str]:
        """Manually install an offline signed lease token (e.g. for air-gapped corporate environments)."""
        mfp = compute_machine_fingerprint()
        is_valid, payload, msg = verify_lease_token(
            lease_token, self.public_key_hex, expected_fingerprint=mfp
        )
        if not is_valid:
            return False, f"Token de arrendamiento inválido: {msg}"

        save_data = {
            "license_key": payload.get("lic", "OFFLINE-PRO"),
            "customer_name": customer_name,
            "plan": payload.get("plan", "pro"),
            "lease_token": lease_token,
            "activated_at": datetime.now(timezone.utc).isoformat(),
            "expires_at": datetime.fromtimestamp(payload.get("exp", 0), timezone.utc).isoformat(),
        }
        self.license_file.write_text(json.dumps(save_data, indent=2), encoding="utf-8")
        return True, "Token de arrendamiento offline instalado exitosamente"
