/**
 * WPipe Studio - Enterprise Customer Self-Service Portal Handlers
 * Serves portal.wisrovi.dev (Cloudflare Pages SPA at 0 €/month)
 * Multi-License Organization Management (Switch between departmental keys)
 * Endpoints:
 *  - POST /v1/portal/login       (Authenticate customer with their license_key OR email)
 *  - GET /v1/portal/overview     (Dashboard stats: active key, connected devices, sibling licenses)
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

    const identifier = (body.license_key || body.email || body.identifier || "").trim();
    if (!identifier) {
      return new Response(
        JSON.stringify({ error: "MISSING_IDENTIFIER", message: "Clave de licencia o correo electrónico requerido" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    let license: any;
    let emailLookup: string;

    if (identifier.includes("@")) {
      // Lookup by customer email
      emailLookup = identifier.toLowerCase();
      license = await env.DB.prepare(
        "SELECT * FROM licenses WHERE LOWER(customer_email) = ? AND status = 'active' ORDER BY created_at DESC LIMIT 1"
      ).bind(emailLookup).first<any>();
    } else {
      // Lookup by specific license key
      const cleanKey = identifier.toUpperCase();
      license = await env.DB.prepare(
        "SELECT * FROM licenses WHERE license_key = ?"
      ).bind(cleanKey).first<any>();
      emailLookup = license?.customer_email?.toLowerCase();
    }

    if (!license) {
      return new Response(
        JSON.stringify({ error: "NOT_FOUND", message: "No se encontraron licencias activas para este identificador." }),
        { status: 404, headers: { "Content-Type": "application/json" } }
      );
    }

    if (license.status !== "active") {
      return new Response(
        JSON.stringify({ error: "SUSPENDED", message: `La licencia está: ${license.status}. Contacte a soporte.` }),
        { status: 403, headers: { "Content-Type": "application/json" } }
      );
    }

    // Fetch all licenses belonging to this organization / email
    const orgLicensesQuery = await env.DB.prepare(
      `SELECT l.id, l.license_key, l.plan, l.status,
              COALESCE(l.max_seats, l.max_machines, 1) as max_seats,
              l.customer_name, l.customer_email, l.expires_at,
              (SELECT count(*) FROM leases le WHERE le.license_id = l.id AND le.lease_expires_at > datetime('now')) as active_seats
       FROM licenses l
       WHERE LOWER(l.customer_email) = ? AND l.status = 'active'
       ORDER BY l.created_at DESC`
    ).bind(emailLookup).all<any>();

    const organizationLicenses = orgLicensesQuery.results || [];

    return new Response(
      JSON.stringify({
        status: "success",
        token: license.license_key,
        customer_name: license.customer_name || "Cliente Corporativo",
        customer_email: license.customer_email,
        plan: license.plan,
        max_seats: Number(license.max_seats || license.max_machines || 1),
        expires_at: license.expires_at,
        organization_licenses: organizationLicenses,
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

  // Fetch the authorized license
  const authLicense = await env.DB.prepare(
    "SELECT * FROM licenses WHERE license_key = ?"
  ).bind(cleanKey).first<any>();

  if (!authLicense || authLicense.status !== "active") {
    return new Response(
      JSON.stringify({ error: "UNAUTHORIZED", message: "Licencia no válida o inactiva." }),
      { status: 401, headers: { "Content-Type": "application/json" } }
    );
  }

  // Optional license switch within same customer email
  const requestedKey = url.searchParams.get("key");
  let targetLicense = authLicense;

  if (requestedKey && requestedKey.toUpperCase() !== authLicense.license_key) {
    const sibling = await env.DB.prepare(
      "SELECT * FROM licenses WHERE license_key = ? AND LOWER(customer_email) = LOWER(?)"
    ).bind(requestedKey.toUpperCase(), authLicense.customer_email).first<any>();

    if (sibling && sibling.status === "active") {
      targetLicense = sibling;
    }
  }

  // 2. GET /v1/portal/overview
  if (path === "/v1/portal/overview" && request.method === "GET") {
    // Clean expired leases
    await env.DB.prepare(
      "DELETE FROM leases WHERE license_id = ? AND lease_expires_at < datetime('now')"
    ).bind(targetLicense.id).run();

    // Fetch active leases for the target license
    const activeLeases = await env.DB.prepare(
      "SELECT id, machine_fingerprint, hostname, os_name, last_heartbeat_at, lease_expires_at, created_at FROM leases WHERE license_id = ? ORDER BY last_heartbeat_at DESC"
    ).bind(targetLicense.id).all<any>();

    const devices = activeLeases.results || [];
    const maxSeats = Number(targetLicense.max_seats || targetLicense.max_machines || 1);
    const activeSeats = devices.length;
    const availableSeats = Math.max(0, maxSeats - activeSeats);

    // Fetch sibling licenses for this organization
    const orgLicensesQuery = await env.DB.prepare(
      `SELECT l.id, l.license_key, l.plan, l.status,
              COALESCE(l.max_seats, l.max_machines, 1) as max_seats,
              l.customer_name, l.customer_email, l.expires_at,
              (SELECT count(*) FROM leases le WHERE le.license_id = l.id AND le.lease_expires_at > datetime('now')) as active_seats
       FROM licenses l
       WHERE LOWER(l.customer_email) = LOWER(?) AND l.status = 'active'
       ORDER BY l.created_at DESC`
    ).bind(authLicense.customer_email).all<any>();

    const organizationLicenses = orgLicensesQuery.results || [];

    return new Response(
      JSON.stringify({
        license_key: targetLicense.license_key,
        customer_name: targetLicense.customer_name,
        customer_email: targetLicense.customer_email,
        plan: targetLicense.plan,
        max_seats: maxSeats,
        active_seats: activeSeats,
        available_seats: availableSeats,
        expires_at: targetLicense.expires_at,
        devices,
        organization_licenses: organizationLicenses,
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

    // Delete lease for target license or any sibling license of this organization
    const delResult = await env.DB.prepare(
      "DELETE FROM leases WHERE id = ? AND license_id IN (SELECT id FROM licenses WHERE LOWER(customer_email) = LOWER(?))"
    ).bind(leaseId, authLicense.customer_email).run();

    await env.DB.prepare(
      "INSERT INTO audit_logs (event_type, license_key, machine_fingerprint, ip_address, details_json, created_at) VALUES (?, ?, ?, ?, ?, datetime('now'))"
    ).bind("seat_liberated_via_portal", targetLicense.license_key, null, clientIp, JSON.stringify({ lease_id: leaseId })).run();

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
