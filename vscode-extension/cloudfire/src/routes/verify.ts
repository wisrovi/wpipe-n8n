/**
 * License Heartbeat & Lease Renewal Route Handler
 * Endpoint: POST /v1/license/verify
 * Author: William Rodriguez (wisrovi.dev)
 */

import { signLeaseToken, LeasePayload } from "../crypto/ed25519";
import { Env } from "./activate";

export async function handleVerify(request: Request, env: Env): Promise<Response> {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "INVALID_JSON_BODY" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { license_key, machine_fingerprint } = body;

  if (!license_key || typeof license_key !== "string" || !machine_fingerprint || typeof machine_fingerprint !== "string") {
    return new Response(
      JSON.stringify({ error: "MISSING_REQUIRED_FIELDS", message: "license_key and machine_fingerprint are required" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const cleanKey = license_key.trim().toUpperCase();
  const cleanMfp = machine_fingerprint.trim().toLowerCase();

  // 1. Fetch license
  const license = await env.DB.prepare(
    "SELECT * FROM licenses WHERE license_key = ?"
  ).bind(cleanKey).first<any>();

  if (!license) {
    return new Response(
      JSON.stringify({ status: "revoked", error: "LICENSE_NOT_FOUND", message: "Licencia no válida o eliminada." }),
      { status: 404, headers: { "Content-Type": "application/json" } }
    );
  }

  if (license.status !== "active") {
    return new Response(
      JSON.stringify({ status: "suspended", error: "LICENSE_INACTIVE", message: `Suscripción ${license.status}.` }),
      { status: 403, headers: { "Content-Type": "application/json" } }
    );
  }

  if (license.expires_at && new Date(license.expires_at).getTime() < Date.now()) {
    return new Response(
      JSON.stringify({ status: "expired", error: "LICENSE_EXPIRED", message: "Suscripción expirada." }),
      { status: 403, headers: { "Content-Type": "application/json" } }
    );
  }

  // 2. Fetch machine activation
  const activation = await env.DB.prepare(
    "SELECT * FROM activations WHERE license_id = ? AND machine_fingerprint = ?"
  ).bind(license.id, cleanMfp).first<any>();

  if (!activation) {
    return new Response(
      JSON.stringify({ status: "unregistered", error: "MACHINE_NOT_ACTIVATED", message: "Esta máquina no está activada para esta licencia." }),
      { status: 403, headers: { "Content-Type": "application/json" } }
    );
  }

  const leaseDays = parseInt(env.LEASE_DURATION_DAYS || "30", 10);
  const graceDays = parseInt(env.GRACE_PERIOD_DAYS || "7", 10);
  const nowSec = Math.floor(Date.now() / 1000);
  const leaseExpSec = nowSec + leaseDays * 86400;
  const leaseExpIso = new Date(leaseExpSec * 1000).toISOString();

  // 3. Update activation record
  await env.DB.prepare(
    "UPDATE activations SET last_verified_at = datetime('now'), lease_expires_at = ? WHERE id = ?"
  ).bind(leaseExpIso, activation.id).run();

  // 4. Generate refreshed cryptographic lease token
  const payload: LeasePayload = {
    sub: license.id,
    lic: cleanKey,
    plan: license.plan,
    mfp: cleanMfp,
    iat: nowSec,
    exp: leaseExpSec,
    grace_days: graceDays,
    iss: env.ISSUER || "https://api.wisrovi.dev",
  };

  const leaseToken = await signLeaseToken(payload, env.LICENSE_PRIVATE_KEY);

  return new Response(
    JSON.stringify({
      status: "active",
      plan: license.plan,
      lease_token: leaseToken,
      expires_at: leaseExpIso,
      grace_period_days: graceDays,
      server_time: new Date().toISOString(),
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}
