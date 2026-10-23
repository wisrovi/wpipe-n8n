"""Unit Tests for WPipe Engine Cryptographic Licensing & Fingerprinting
Author: William Rodriguez (wisrovi.dev)
"""

import base64
import json
import time
from pathlib import Path
from cryptography.hazmat.primitives.asymmetric import ed25519
from cryptography.hazmat.primitives import serialization

from wpipe_engine.core.licensing import (
    compute_machine_fingerprint,
    verify_lease_token,
    LicenseManager,
)


def _generate_test_token(
    sub="lic_test_123",
    lic="WPIPE-PRO-TEST-KEY",
    plan="pro",
    mfp="test_mfp",
    exp_offset_sec=3600,
    grace_days=7,
):
    # Generate ephemeral keypair
    priv = ed25519.Ed25519PrivateKey.generate()
    pub = priv.public_key()
    pub_hex = pub.public_bytes(
        encoding=serialization.Encoding.Raw,
        format=serialization.PublicFormat.Raw,
    ).hex()

    now = int(time.time())
    header = {"alg": "EdDSA", "typ": "JWT"}
    payload = {
        "sub": sub,
        "lic": lic,
        "plan": plan,
        "mfp": mfp,
        "iat": now,
        "exp": now + exp_offset_sec,
        "grace_days": grace_days,
        "iss": "https://api.wisrovi.dev",
    }

    def b64url(data: bytes) -> str:
        return base64.urlsafe_b64encode(data).decode().rstrip("=")

    h_enc = b64url(json.dumps(header).encode())
    p_enc = b64url(json.dumps(payload).encode())
    msg = f"{h_enc}.{p_enc}".encode()

    sig = priv.sign(msg)
    sig_enc = b64url(sig)

    token = f"{h_enc}.{p_enc}.{sig_enc}"
    return token, pub_hex


def test_machine_fingerprint_is_reproducible_and_sha256():
    fp1 = compute_machine_fingerprint()
    fp2 = compute_machine_fingerprint()
    assert fp1 == fp2
    assert len(fp1) == 64
    assert all(c in "0123456789abcdef" for c in fp1)


def test_verify_valid_lease_token():
    mfp = "machine_abc_123"
    token, pub_hex = _generate_test_token(mfp=mfp, exp_offset_sec=86400)
    is_valid, payload, msg = verify_lease_token(
        token, public_key_hex=pub_hex, expected_fingerprint=mfp
    )
    assert is_valid is True
    assert payload["plan"] == "pro"
    assert "activa" in msg.lower()


def test_verify_tampered_token_fails():
    mfp = "machine_abc_123"
    token, pub_hex = _generate_test_token(mfp=mfp, exp_offset_sec=86400)
    # Tamper with the payload part
    parts = token.split(".")
    tampered = f"{parts[0]}.eyJhZG1pbiI6dHJ1ZX0.{parts[2]}"
    is_valid, _, msg = verify_lease_token(
        tampered, public_key_hex=pub_hex, expected_fingerprint=mfp
    )
    assert is_valid is False
    assert "adulterada" in msg.lower() or "inválida" in msg.lower()


def test_verify_wrong_machine_fingerprint_fails():
    token, pub_hex = _generate_test_token(mfp="machine_office_pc", exp_offset_sec=86400)
    is_valid, _, msg = verify_lease_token(
        token, public_key_hex=pub_hex, expected_fingerprint="machine_laptop"
    )
    assert is_valid is False
    assert "otra máquina" in msg.lower()


def test_verify_expired_token_grace_period():
    # Expired 2 days ago, but grace period is 7 days
    token, pub_hex = _generate_test_token(exp_offset_sec=-2 * 86400, grace_days=7)
    is_valid, _, msg = verify_lease_token(
        token, public_key_hex=pub_hex, expected_fingerprint="test_mfp"
    )
    assert is_valid is True
    assert "gracia" in msg.lower()


def test_verify_totally_expired_token_fails():
    # Expired 30 days ago (past 7 days grace)
    token, pub_hex = _generate_test_token(exp_offset_sec=-30 * 86400, grace_days=7)
    is_valid, _, msg = verify_lease_token(
        token, public_key_hex=pub_hex, expected_fingerprint="test_mfp"
    )
    assert is_valid is False
    assert "expirado" in msg.lower()


def test_license_manager_offline_installation(tmp_path):
    mgr = LicenseManager(config_dir=tmp_path)
    status_initial = mgr.get_status()
    assert status_initial["tier"] == "free"
    assert status_initial["is_pro"] is False
    assert status_initial["max_blocks"] == 5

    # Generate token matching the current machine's fingerprint
    current_mfp = compute_machine_fingerprint()
    token, pub_hex = _generate_test_token(mfp=current_mfp, exp_offset_sec=86400)
    mgr.public_key_hex = pub_hex

    ok, msg = mgr.install_offline_lease_token(token, customer_name="William R.")
    assert ok is True

    status_pro = mgr.get_status()
    assert status_pro["tier"] == "pro"
    assert status_pro["is_pro"] is True
    assert status_pro["max_blocks"] is None
    assert status_pro["customer_name"] == "William R."


def test_seats_exceeded_fallback_to_free_tier(tmp_path):
    mgr = LicenseManager(config_dir=tmp_path)
    # Simulate a seats_exceeded state saved in license.json
    mgr.license_file.write_text(json.dumps({
        "license_key": "WPIPE-PRO-TEST",
        "status": "seats_exceeded",
        "plan": "free",
        "max_seats": 5,
        "active_seats": 5,
        "message": "All 5 seats in use"
    }))

    status = mgr.get_status()
    assert status["tier"] == "free"
    assert status["is_pro"] is False
    assert status["max_blocks"] == 5
    assert "Free tier active" in status["message"]
    assert "portal.wisrovi.dev" in status["message"]
