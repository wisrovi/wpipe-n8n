/**
 * WPipe Studio - Super-Admin Route Handlers (Option A)
 * Exclusively for William Rodriguez (localhost:8502 Super-Admin Console)
 * Protected by ADMIN_MASTER_KEY / Cloudflare API Token
 * Author: William Rodriguez (wisrovi.dev)
 */

import { Env } from "./activate";

function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

function isAuthorizedAdmin(request: Request, env: Env): boolean {
  const masterKey = env.ADMIN_MASTER_KEY?.trim();
  if (!masterKey) return false;

  const auth = request.headers.get("Authorization");
  if (auth && auth.startsWith("Bearer ")) {
    const token = auth.slice(7).trim();
    if (constantTimeEquals(token, masterKey)) return true;
  }
  const headerKey = request.headers.get("x-admin-key");
  if (headerKey && constantTimeEquals(headerKey.trim(), masterKey)) return true;
  return false;
}

export async function handleAdmin(request: Request, env: Env, url: URL): Promise<Response> {
  const path = url.pathname;
  const masterKey = env.ADMIN_MASTER_KEY?.trim();

  // 0. POST /v1/admin/auth/verify (Validate Master Key)
  if (path === "/v1/admin/auth/verify" && request.method === "POST") {
    if (!masterKey) {
      return new Response(
        JSON.stringify({ error: "CONFIG_ERROR", message: "Clave maestra de Super-Admin no configurada en el servidor." }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    let body: any = {};
    try {
      body = await request.json();
    } catch {}

    const providedKey = (body.master_key || body.key || "").trim();
    if ((providedKey && constantTimeEquals(providedKey, masterKey)) || isAuthorizedAdmin(request, env)) {
      return new Response(
        JSON.stringify({
          status: "success",
          authorized: true,
          admin_name: "William Rodriguez",
          role: "Super-Admin",
          timestamp: new Date().toISOString(),
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ error: "INVALID_MASTER_KEY", message: "Contraseña maestra de Super-Admin no válida." }),
      { status: 401, headers: { "Content-Type": "application/json" } }
    );
  }

  if (!isAuthorizedAdmin(request, env)) {
    return new Response(
      JSON.stringify({ error: "FORBIDDEN", message: "Acceso no autorizado al panel Super-Admin." }),
      { status: 403, headers: { "Content-Type": "application/json" } }
    );
  }

  // 1. POST /v1/admin/sql (Direct D1 SQL Execution Console)
  if (path === "/v1/admin/sql" && request.method === "POST") {
    let body: any;
    try {
      body = await request.json();
    } catch {
      return new Response(JSON.stringify({ error: "INVALID_JSON_BODY" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const { sql, params } = body;
    if (!sql || typeof sql !== "string") {
      return new Response(JSON.stringify({ error: "MISSING_SQL_QUERY" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    try {
      const stmt = env.DB.prepare(sql);
      const boundStmt = params && Array.isArray(params) ? stmt.bind(...params) : stmt;
      const result = await boundStmt.all();

      return new Response(
        JSON.stringify({
          success: true,
          results: result.results || [],
          meta: result.meta,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    } catch (e: any) {
      return new Response(
        JSON.stringify({ error: "SQL_EXECUTION_ERROR", message: e.message || String(e) }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }
  }

  // 2. POST /v1/admin/licenses/vip (Master License Minter)
  if (path === "/v1/admin/licenses/vip" && request.method === "POST") {
    const body: any = await request.json();
    const {
      customer_email,
      customer_name,
      plan = "enterprise",
      max_seats = 5,
      expires_at = null,
      custom_key,
    } = body;

    const licenseId = `lic_vip_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
    const finalKey = (custom_key || `WPIPE-VIP-${crypto.randomUUID().slice(0, 8).toUpperCase()}`).trim().toUpperCase();
    const adminKey = `WPIPE-ADM-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;

    await env.DB.prepare(
      `INSERT INTO licenses (
        id, license_key, admin_key, customer_email, customer_name, plan, status, max_machines, max_seats, expires_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, datetime('now'), datetime('now'))`
    ).bind(licenseId, finalKey, adminKey, customer_email || "vip@wisrovi.dev", customer_name || "VIP Partner", plan, max_seats, max_seats, expires_at).run();

    return new Response(
      JSON.stringify({
        status: "success",
        license_id: licenseId,
        license_key: finalKey,
        admin_key: adminKey,
        max_seats,
        plan,
        expires_at,
      }),
      { status: 201, headers: { "Content-Type": "application/json" } }
    );
  }

  // 3. GET /v1/admin/stats (High-level dashboard aggregates)
  if (path === "/v1/admin/stats" && request.method === "GET") {
    const licStats = await env.DB.prepare(
      "SELECT count(*) as total, sum(case when status='active' then 1 else 0 end) as active FROM licenses"
    ).first<any>();

    const leaseStats = await env.DB.prepare(
      "SELECT count(*) as active_leases FROM leases WHERE lease_expires_at > datetime('now')"
    ).first<any>();

    const auditStats = await env.DB.prepare(
      "SELECT count(*) as total_events FROM audit_logs WHERE created_at > datetime('now', '-7 days')"
    ).first<any>();

    return new Response(
      JSON.stringify({
        total_licenses: licStats?.total || 0,
        active_licenses: licStats?.active || 0,
        active_floating_leases: leaseStats?.active_leases || 0,
        recent_audit_events_7d: auditStats?.total_events || 0,
        server_timestamp: new Date().toISOString(),
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }

  return new Response(JSON.stringify({ error: "NOT_FOUND", path }), {
    status: 404,
    headers: { "Content-Type": "application/json" },
  });
}
