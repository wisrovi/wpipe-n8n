/**
 * WPipe Studio - Enterprise Customer Self-Service Portal Handlers
 * Serves portal.wisrovi.dev (Cloudflare Pages SPA at 0 €/month)
 * Endpoints:
 *  - POST /v1/portal/login     (Authenticate customer with their license_key)
 *  - GET /v1/portal/overview   (Dashboard stats: contracted seats, active seats, connected devices)
 *  - DELETE /v1/portal/seats/:id (1-click kick/liberate broken or retired workstation)
 * Author: William Rodriguez (wisrovi.dev)
 */

import { Env } from "./activate";

function parseAuthKey(request: Request): string | null {
  const auth = request.headers.get("Authorization");
  if (auth && auth.startsWith("Bearer ")) {
    return auth.slice(7).trim().toUpperCase();
  }
  const headerKey = request.headers.get("x-license-key");
  if (headerKey) {
    return headerKey.trim().toUpperCase();
  }
  return null;
}

export async function handlePortal(request: Request, env: Env, url: URL): Promise<Response> {
  const path = url.pathname;
  const clientIp = request.headers.get("cf-connecting-ip") || "0.0.0.0";

  // 1. POST /v1/portal/login
  if (path === "/v1/portal/login" && request.method === "POST") {
    let body: any;
    try {
      body = await request.json();
    } catch {
      return new Response(JSON.stringify({ error: "INVALID_JSON_BODY" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const { license_key } = body;
    if (!license_key || typeof license_key !== "string") {
      return new Response(JSON.stringify({ error: "MISSING_LICENSE_KEY" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const cleanKey = license_key.trim().toUpperCase();
    const license = await env.DB.prepare(
      "SELECT * FROM licenses WHERE license_key = ?"
    ).bind(cleanKey).first<any>();

    if (!license) {
      return new Response(
        JSON.stringify({ error: "NOT_FOUND", message: "Clave de licencia no encontrada." }),
        { status: 404, headers: { "Content-Type": "application/json" } }
      );
    }

    if (license.status !== "active") {
      return new Response(
        JSON.stringify({ error: "SUSPENDED", message: `La licencia está: ${license.status}. Contacte a soporte.` }),
        { status: 403, headers: { "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({
        status: "success",
        token: cleanKey,
        customer_name: license.customer_name || "Cliente Corporativo",
        customer_email: license.customer_email,
        plan: license.plan,
        max_seats: Number(license.max_seats || license.max_machines || 1),
        expires_at: license.expires_at,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }

  // Auth gate for protected portal routes
  const cleanKey = parseAuthKey(request);
  if (!cleanKey) {
    return new Response(
      JSON.stringify({ error: "UNAUTHORIZED", message: "Proporcione Authorization: Bearer <LICENSE_KEY>" }),
      { status: 401, headers: { "Content-Type": "application/json" } }
    );
  }

  const license = await env.DB.prepare(
    "SELECT * FROM licenses WHERE license_key = ?"
  ).bind(cleanKey).first<any>();

  if (!license || license.status !== "active") {
    return new Response(
      JSON.stringify({ error: "UNAUTHORIZED", message: "Licencia no válida o inactiva." }),
      { status: 401, headers: { "Content-Type": "application/json" } }
    );
  }

  // 2. GET /v1/portal/overview
  if (path === "/v1/portal/overview" && request.method === "GET") {
    // Clean expired leases
    await env.DB.prepare(
      "DELETE FROM leases WHERE license_id = ? AND lease_expires_at < datetime('now')"
    ).bind(license.id).run();

    // Fetch active leases
    const activeLeases = await env.DB.prepare(
      "SELECT id, machine_fingerprint, hostname, os_name, last_heartbeat_at, lease_expires_at, created_at FROM leases WHERE license_id = ? ORDER BY last_heartbeat_at DESC"
    ).bind(license.id).all<any>();

    const devices = activeLeases.results || [];
    const maxSeats = Number(license.max_seats || license.max_machines || 1);
    const activeSeats = devices.length;
    const availableSeats = Math.max(0, maxSeats - activeSeats);

    return new Response(
      JSON.stringify({
        license_key: license.license_key,
        customer_name: license.customer_name,
        customer_email: license.customer_email,
        plan: license.plan,
        max_seats: maxSeats,
        active_seats: activeSeats,
        available_seats: availableSeats,
        expires_at: license.expires_at,
        devices,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }

  // 3. DELETE /v1/portal/seats/:id (or /v1/portal/seats?id=...)
  if (path.startsWith("/v1/portal/seats") && request.method === "DELETE") {
    const parts = path.split("/");
    const leaseId = parts[parts.length - 1] !== "seats" ? parts[parts.length - 1] : url.searchParams.get("id");

    if (!leaseId) {
      return new Response(
        JSON.stringify({ error: "MISSING_LEASE_ID", message: "ID de puesto/lease requerido" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const delResult = await env.DB.prepare(
      "DELETE FROM leases WHERE id = ? AND license_id = ?"
    ).bind(leaseId, license.id).run();

    await env.DB.prepare(
      "INSERT INTO audit_logs (event_type, license_key, machine_fingerprint, ip_address, details_json, created_at) VALUES (?, ?, ?, ?, ?, datetime('now'))"
    ).bind("seat_liberated_via_portal", cleanKey, null, clientIp, JSON.stringify({ lease_id: leaseId })).run();

    return new Response(
      JSON.stringify({
        status: "success",
        message: "Asiento liberado inmediatamente.",
        changes: delResult.meta.changes,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }

  return new Response(JSON.stringify({ error: "NOT_FOUND", path }), {
    status: 404,
    headers: { "Content-Type": "application/json" },
  });
}
