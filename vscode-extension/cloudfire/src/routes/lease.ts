/**
 * WPipe Studio - Floating Concurrent Seat Lease Route Handlers
 * Endpoints:
 *  - POST /v1/license/lease      (Acquire or refresh dynamic floating seat)
 *  - POST /v1/license/heartbeat  (Periodic ping every 30m, extends lease TTL by 2 hours)
 *  - POST /v1/license/release    (Graceful voluntary release on app close)
 * Author: William Rodriguez (wisrovi.dev)
 */

import { signLeaseToken, LeasePayload } from "../crypto/ed25519";
import { Env } from "./activate";

export const LEASE_TTL_SECONDS = 7200; // 2 hours
export const HEARTBEAT_INTERVAL_SECONDS = 1800; // 30 minutes

export async function handleLease(request: Request, env: Env): Promise<Response> {
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
      JSON.stringify({
        error: "MISSING_REQUIRED_FIELDS",
        message: "license_key and machine_fingerprint are required",
      }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const cleanKey = license_key.trim().toUpperCase();
  const cleanMfp = machine_fingerprint.trim().toLowerCase();
  const clientIp = request.headers.get("cf-connecting-ip") || "0.0.0.0";

  // 1. Fetch license from Cloudflare D1
  const license = await env.DB.prepare(
    "SELECT * FROM licenses WHERE license_key = ?"
  ).bind(cleanKey).first<any>();

  if (!license) {
    await env.DB.prepare(
      "INSERT INTO audit_logs (event_type, license_key, machine_fingerprint, ip_address, details_json, created_at) VALUES (?, ?, ?, ?, ?, datetime('now'))"
    ).bind("lease_failed_not_found", cleanKey, cleanMfp, clientIp, JSON.stringify({ reason: "Key not found" })).run();

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

  const maxSeats = Number(license.max_seats || license.max_machines || 1);
  const nowSec = Math.floor(Date.now() / 1000);
  const leaseExpSec = nowSec + LEASE_TTL_SECONDS;
  const leaseExpIso = new Date(leaseExpSec * 1000).toISOString();

  // 2. Clean up expired leases for this license
  await env.DB.prepare(
    "DELETE FROM leases WHERE license_id = ? AND lease_expires_at < datetime('now')"
  ).bind(license.id).run();

  // 3. Check if this machine already holds an active lease
  const existingLease = await env.DB.prepare(
    "SELECT * FROM leases WHERE license_id = ? AND machine_fingerprint = ?"
  ).bind(license.id, cleanMfp).first<any>();

  let leaseId: string;

  if (existingLease) {
    // Machine already owns a lease: refresh TTL and update metadata
    leaseId = existingLease.id;
    await env.DB.prepare(
      "UPDATE leases SET last_heartbeat_at = datetime('now'), lease_expires_at = ?, hostname = ?, os_name = ? WHERE id = ?"
    ).bind(leaseExpIso, hostname || existingLease.hostname || null, os || existingLease.os_name || null, leaseId).run();
  } else {
    // New machine attempting to acquire a lease: check available seats
    const countResult = await env.DB.prepare(
      "SELECT count(*) as count FROM leases WHERE license_id = ?"
    ).bind(license.id).first<{ count: number }>();

    const activeCount = countResult ? countResult.count : 0;

    if (activeCount >= maxSeats) {
      await env.DB.prepare(
        "INSERT INTO audit_logs (event_type, license_key, machine_fingerprint, ip_address, details_json, created_at) VALUES (?, ?, ?, ?, ?, datetime('now'))"
      ).bind("lease_quota_exceeded", cleanKey, cleanMfp, clientIp, JSON.stringify({ active_seats: activeCount, max_seats: maxSeats })).run();

      return new Response(
        JSON.stringify({
          error: "SEATS_EXCEEDED",
          message: `Todos los asientos Pro contratados (${activeCount}/${maxSeats}) están actualmente en uso por su equipo.`,
          tier: "free",
          free_block_limit: 5,
          active_seats: activeCount,
          max_seats: maxSeats,
        }),
        { status: 409, headers: { "Content-Type": "application/json" } }
      );
    }

    leaseId = `lease_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
    await env.DB.prepare(
      "INSERT INTO leases (id, license_id, machine_fingerprint, hostname, os_name, last_heartbeat_at, lease_expires_at, created_at) VALUES (?, ?, ?, ?, ?, datetime('now'), ?, datetime('now'))"
    ).bind(leaseId, license.id, cleanMfp, hostname || null, os || null, leaseExpIso).run();
  }

  // 4. Issue Cryptographic Ed25519 Lease Token
  const graceDays = parseInt(env.GRACE_PERIOD_DAYS || "7", 10);
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

  // 5. Audit Log
  await env.DB.prepare(
    "INSERT INTO audit_logs (event_type, license_key, machine_fingerprint, ip_address, details_json, created_at) VALUES (?, ?, ?, ?, ?, datetime('now'))"
  ).bind("lease_acquired", cleanKey, cleanMfp, clientIp, JSON.stringify({ lease_id: leaseId, plan: license.plan, expires_at: leaseExpIso })).run();

  return new Response(
    JSON.stringify({
      status: "success",
      lease_id: leaseId,
      plan: license.plan,
      customer_name: license.customer_name || "WPipe Developer",
      lease_token: leaseToken,
      expires_at: leaseExpIso,
      ttl_seconds: LEASE_TTL_SECONDS,
      heartbeat_interval_seconds: HEARTBEAT_INTERVAL_SECONDS,
      grace_period_days: graceDays,
      server_time: new Date().toISOString(),
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}

export async function handleHeartbeat(request: Request, env: Env): Promise<Response> {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "INVALID_JSON_BODY" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { lease_id, license_key, machine_fingerprint } = body;

  if (!lease_id || !license_key || !machine_fingerprint) {
    return new Response(
      JSON.stringify({ error: "MISSING_REQUIRED_FIELDS", message: "lease_id, license_key, and machine_fingerprint are required" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const cleanMfp = machine_fingerprint.trim().toLowerCase();
  const nowSec = Math.floor(Date.now() / 1000);
  const leaseExpSec = nowSec + LEASE_TTL_SECONDS;
  const leaseExpIso = new Date(leaseExpSec * 1000).toISOString();

  // Extend lease if valid
  const result = await env.DB.prepare(
    "UPDATE leases SET last_heartbeat_at = datetime('now'), lease_expires_at = ? WHERE id = ? AND machine_fingerprint = ?"
  ).bind(leaseExpIso, lease_id, cleanMfp).run();

  if (!result.meta.changes || result.meta.changes === 0) {
    return new Response(
      JSON.stringify({ error: "LEASE_EXPIRED_OR_REVOKED", message: "Lease session has expired or was liberated from portal." }),
      { status: 404, headers: { "Content-Type": "application/json" } }
    );
  }

  return new Response(
    JSON.stringify({
      status: "renewed",
      lease_id,
      expires_at: leaseExpIso,
      ttl_seconds: LEASE_TTL_SECONDS,
      heartbeat_interval_seconds: HEARTBEAT_INTERVAL_SECONDS,
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}

export async function handleRelease(request: Request, env: Env): Promise<Response> {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "INVALID_JSON_BODY" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { lease_id, license_key, machine_fingerprint } = body;
  const cleanKey = (license_key || "").trim().toUpperCase();
  const cleanMfp = (machine_fingerprint || "").trim().toLowerCase();
  const clientIp = request.headers.get("cf-connecting-ip") || "0.0.0.0";

  if (lease_id) {
    await env.DB.prepare("DELETE FROM leases WHERE id = ?").bind(lease_id).run();
  } else if (cleanKey && cleanMfp) {
    await env.DB.prepare(
      "DELETE FROM leases WHERE machine_fingerprint = ? AND license_id IN (SELECT id FROM licenses WHERE license_key = ?)"
    ).bind(cleanMfp, cleanKey).run();
  }

  await env.DB.prepare(
    "INSERT INTO audit_logs (event_type, license_key, machine_fingerprint, ip_address, details_json, created_at) VALUES (?, ?, ?, ?, ?, datetime('now'))"
  ).bind("seat_released_gracefully", cleanKey, cleanMfp, clientIp, JSON.stringify({ lease_id })).run();

  return new Response(
    JSON.stringify({ status: "success", message: "Seat released successfully." }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}
