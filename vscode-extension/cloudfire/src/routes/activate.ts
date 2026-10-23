/**
 * License Activation Route Handler
 * Endpoint: POST /v1/license/activate
 * Author: William Rodriguez (wisrovi.dev)
 */

import { signLeaseToken, LeasePayload } from "../crypto/ed25519";
import { loadEntitlements } from "../entitlements";

export interface Env {
  DB: D1Database;
  DOWNLOADS?: R2Bucket;
  LICENSE_PRIVATE_KEY: string;
  ISSUER?: string;
  GRACE_PERIOD_DAYS?: string;
  LEASE_DURATION_DAYS?: string;
  LEMONSQUEEZY_WEBHOOK_SECRET?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  ADMIN_MASTER_KEY?: string;
}

export async function handleActivate(request: Request, env: Env): Promise<Response> {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "INVALID_JSON_BODY" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { license_key, machine_fingerprint, hostname, os } = body;

  if (!license_key || typeof license_key !== "string" || !machine_fingerprint || typeof machine_fingerprint !== "string") {
    return new Response(
      JSON.stringify({ error: "MISSING_REQUIRED_FIELDS", message: "license_key and machine_fingerprint are required" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const cleanKey = license_key.trim().toUpperCase();
  const cleanMfp = machine_fingerprint.trim().toLowerCase();

  // 1. Fetch license from Cloudflare D1
  const license = await env.DB.prepare(
    "SELECT * FROM licenses WHERE license_key = ?"
  ).bind(cleanKey).first<any>();

  const clientIp = request.headers.get("cf-connecting-ip") || "0.0.0.0";

  if (!license) {
    await env.DB.prepare(
      "INSERT INTO audit_logs (event_type, license_key, machine_fingerprint, ip_address, details_json, created_at) VALUES (?, ?, ?, ?, ?, datetime('now'))"
    ).bind("activate_failed_not_found", cleanKey, cleanMfp, clientIp, JSON.stringify({ reason: "Key not found" })).run();

    return new Response(
      JSON.stringify({ error: "LICENSE_NOT_FOUND", message: "Clave de licencia no encontrada o inválida." }),
      { status: 404, headers: { "Content-Type": "application/json" } }
    );
  }

  if (license.status !== "active") {
    return new Response(
      JSON.stringify({ error: "LICENSE_INACTIVE", message: `La licencia se encuentra en estado: ${license.status}.` }),
      { status: 403, headers: { "Content-Type": "application/json" } }
    );
  }

  if (license.expires_at && new Date(license.expires_at).getTime() < Date.now()) {
    return new Response(
      JSON.stringify({ error: "LICENSE_EXPIRED", message: "La suscripción ha expirado. Por favor renuévela en wisrovi.dev." }),
      { status: 403, headers: { "Content-Type": "application/json" } }
    );
  }

  // 2. Check existing activations for this license and machine
  const existingActivation = await env.DB.prepare(
    "SELECT * FROM activations WHERE license_id = ? AND machine_fingerprint = ?"
  ).bind(license.id, cleanMfp).first<any>();

  const leaseDays = parseInt(env.LEASE_DURATION_DAYS || "30", 10);
  const graceDays = parseInt(env.GRACE_PERIOD_DAYS || "7", 10);
  const nowSec = Math.floor(Date.now() / 1000);
  const leaseExpSec = nowSec + leaseDays * 86400;
  const leaseExpIso = new Date(leaseExpSec * 1000).toISOString();

  if (existingActivation) {
    // Machine already registered: refresh lease
    await env.DB.prepare(
      "UPDATE activations SET last_verified_at = datetime('now'), lease_expires_at = ?, hostname = ?, os_name = ? WHERE id = ?"
    ).bind(leaseExpIso, hostname || null, os || null, existingActivation.id).run();
  } else {
    // New machine: check quota
    const countResult = await env.DB.prepare(
      "SELECT count(*) as count FROM activations WHERE license_id = ?"
    ).bind(license.id).first<{ count: number }>();

    const activeCount = countResult ? countResult.count : 0;
    if (activeCount >= license.max_machines) {
      await env.DB.prepare(
        "INSERT INTO audit_logs (event_type, license_key, machine_fingerprint, ip_address, details_json, created_at) VALUES (?, ?, ?, ?, ?, datetime('now'))"
      ).bind("activate_quota_exceeded", cleanKey, cleanMfp, clientIp, JSON.stringify({ active_machines: activeCount, max: license.max_machines })).run();

      return new Response(
        JSON.stringify({
          error: "MACHINE_LIMIT_REACHED",
          message: `Límite de activaciones alcanzado (${activeCount}/${license.max_machines} máquinas). Libere un equipo o actualice su plan en wisrovi.dev.`,
        }),
        { status: 403, headers: { "Content-Type": "application/json" } }
      );
    }

    const activationId = `act_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
    await env.DB.prepare(
      "INSERT INTO activations (id, license_id, machine_fingerprint, hostname, os_name, last_verified_at, lease_expires_at, created_at) VALUES (?, ?, ?, ?, ?, datetime('now'), ?, datetime('now'))"
    ).bind(activationId, license.id, cleanMfp, hostname || null, os || null, leaseExpIso).run();
  }

  // 3. Issue Cryptographic Ed25519 Lease Token
  const payload: LeasePayload = {
    sub: license.id,
    lic: cleanKey,
    plan: license.plan,
    mfp: cleanMfp,
    iat: nowSec,
    exp: leaseExpSec,
    grace_days: graceDays,
    iss: env.ISSUER || "https://api.wisrovi.dev",
    name: license.customer_name || undefined,
    // Database-driven limits, signed so neither the browser nor the local user can alter them.
    ent: await loadEntitlements(env.DB, license.plan),
  };

  const leaseToken = await signLeaseToken(payload, env.LICENSE_PRIVATE_KEY);

  // 4. Audit Log
  await env.DB.prepare(
    "INSERT INTO audit_logs (event_type, license_key, machine_fingerprint, ip_address, details_json, created_at) VALUES (?, ?, ?, ?, ?, datetime('now'))"
  ).bind("activate_success", cleanKey, cleanMfp, clientIp, JSON.stringify({ plan: license.plan, lease_expires_at: leaseExpIso })).run();

  return new Response(
    JSON.stringify({
      status: "success",
      plan: license.plan,
      customer_name: license.customer_name || "Developer",
      lease_token: leaseToken,
      expires_at: leaseExpIso,
      grace_period_days: graceDays,
      server_time: new Date().toISOString(),
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}
