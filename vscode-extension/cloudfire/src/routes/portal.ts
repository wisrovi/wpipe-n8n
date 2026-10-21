/**
 * WPipe Studio - Enterprise Customer Self-Service Portal Handlers
 * Serves portal.wisrovi.dev (Cloudflare Pages SPA at 0 €/month)
 * Multi-License Organization Management & Secure OTP Authentication
 * Endpoints:
 *  - POST   /v1/portal/otp/send   (Generate 6-digit OTP and send via email)
 *  - POST   /v1/portal/otp/verify (Validate OTP and issue signed admin session token)
 *  - POST   /v1/portal/login      (Authenticate with private admin_key; blocks terminal keys)
 *  - GET    /v1/portal/overview   (Dashboard stats: active key, connected devices, sibling licenses)
 *  - DELETE /v1/portal/seats/:id  (1-click kick/liberate broken or retired workstation)
 * Author: William Rodriguez (wisrovi.dev)
 */

import { Env } from "./activate";

// ---------------------------------------------------------------------------
// Cryptographic & Session Helpers
// ---------------------------------------------------------------------------

function base64UrlEncode(str: string): string {
  return btoa(unescape(encodeURIComponent(str)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function base64UrlDecode(str: string): string {
  let output = str.replace(/-/g, "+").replace(/_/g, "/");
  while (output.length % 4) output += "=";
  return decodeURIComponent(escape(atob(output)));
}

async function hashCode(code: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(code);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function generate6DigitOtp(): string {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  const code = 100000 + (buf[0] % 900000);
  return code.toString();
}

function getPortalSecret(env: Env): string {
  return env.ADMIN_MASTER_KEY || env.LICENSE_PRIVATE_KEY || "wpipe-portal-jwt-secret-2026";
}

async function createPortalSessionToken(email: string, secret: string): Promise<string> {
  const header = base64UrlEncode(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const exp = Math.floor(Date.now() / 1000) + 86400; // 24 hours
  const payload = base64UrlEncode(JSON.stringify({ email: email.toLowerCase(), exp, role: "admin" }));
  const dataToSign = `${header}.${payload}`;

  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, enc.encode(dataToSign));
  const sigStr = Array.from(new Uint8Array(signature))
    .map((b) => String.fromCharCode(b))
    .join("");
  const b64Signature = btoa(sigStr).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${dataToSign}.${b64Signature}`;
}

async function verifyPortalSessionToken(token: string, secret: string): Promise<{ email: string } | null> {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const [headerB64, payloadB64, sigB64] = parts;
    const dataToSign = `${headerB64}.${payloadB64}`;

    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      enc.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"]
    );

    const sigRaw = atob(sigB64.replace(/-/g, "+").replace(/_/g, "/"));
    const sigBytes = new Uint8Array(sigRaw.length);
    for (let i = 0; i < sigRaw.length; i++) {
      sigBytes[i] = sigRaw.charCodeAt(i);
    }

    const isValid = await crypto.subtle.verify("HMAC", key, sigBytes, enc.encode(dataToSign));
    if (!isValid) return null;

    const payload = JSON.parse(base64UrlDecode(payloadB64));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }
    return { email: payload.email };
  } catch {
    return null;
  }
}

async function sendOtpEmail(email: string, code: string, resendApiKey?: string): Promise<{ success: boolean; reason?: string }> {
  if (!resendApiKey) return { success: false, reason: "NO_API_KEY" };

  const senders = ["WPipe Studio <security@wisrovi.dev>", "WPipe Studio <onboarding@resend.dev>"];
  let lastError = "";

  for (const fromAddress of senders) {
    try {
      const resp = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${resendApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: fromAddress,
          to: [email],
          subject: `${code} es tu código de acceso al Portal WPipe Studio`,
          html: `
            <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 560px; margin: 0 auto; padding: 32px 24px; background: #0f172a; color: #f8fafc; border-radius: 12px; border: 1px solid #1e293b;">
              <h2 style="color: #38bdf8; margin-top: 0; font-size: 20px;">WPipe Studio Enterprise</h2>
              <p style="font-size: 14px; color: #94a3b8; line-height: 1.5;">Has solicitado acceder al Portal de Gestión de Licencias de tu empresa. Introduce el siguiente código de seguridad:</p>
              <div style="background: #1e293b; padding: 20px; border-radius: 8px; text-align: center; margin: 24px 0; border: 1px solid #334155;">
                <span style="font-family: monospace; font-size: 34px; font-weight: 700; letter-spacing: 6px; color: #38bdf8;">${code}</span>
              </div>
              <p style="font-size: 12px; color: #64748b;">Este código expira en 10 minutos. Si no has solicitado este acceso, puedes ignorar este correo de forma segura.</p>
              <hr style="border: 0; border-top: 1px solid #334155; margin: 24px 0;" />
              <p style="font-size: 11px; color: #475569;">WPipe Studio &bull; Plataforma Serverless de Licenciamiento Flotante &bull; portal.wisrovi.dev</p>
            </div>
          `,
        }),
      });

      if (resp.ok) {
        return { success: true };
      }

      const errJson: any = await resp.json().catch(() => ({}));
      lastError = errJson.message || "Error al enviar correo";

      // If unverified custom domain, fallback to onboarding@resend.dev
      if (fromAddress.includes("wisrovi.dev") && lastError.toLowerCase().includes("not verified")) {
        continue;
      }

      return { success: false, reason: lastError };
    } catch (err: any) {
      lastError = err?.message || String(err);
    }
  }

  return { success: false, reason: lastError };
}

async function resolveAuthorizedEmail(request: Request, env: Env): Promise<{ email: string; targetLicense?: any } | null> {
  const auth = request.headers.get("Authorization");
  const token = auth && auth.startsWith("Bearer ") ? auth.slice(7).trim() : request.headers.get("x-portal-token")?.trim();
  if (!token) return null;

  const secret = getPortalSecret(env);

  // 1. Try verify as signed JWT session token
  const session = await verifyPortalSessionToken(token, secret);
  if (session && session.email) {
    return { email: session.email.toLowerCase() };
  }

  // 2. Try lookup as admin_key (starts with WPIPE-ADM-)
  if (token.toUpperCase().startsWith("WPIPE-ADM-")) {
    const lic = await env.DB.prepare(
      "SELECT * FROM licenses WHERE admin_key = ? AND status = 'active'"
    ).bind(token.toUpperCase()).first<any>();
    if (lic) {
      return { email: lic.customer_email.toLowerCase(), targetLicense: lic };
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Main Route Handler
// ---------------------------------------------------------------------------

export async function handlePortal(request: Request, env: Env, url: URL): Promise<Response> {
  const path = url.pathname;
  const clientIp = request.headers.get("cf-connecting-ip") || "0.0.0.0";
  const secret = getPortalSecret(env);

  // 1. POST /v1/portal/otp/send (Request 6-digit OTP code to corporate email)
  if (path === "/v1/portal/otp/send" && request.method === "POST") {
    let body: any;
    try {
      body = await request.json();
    } catch {
      return new Response(JSON.stringify({ error: "INVALID_JSON_BODY" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const email = (body.email || "").trim().toLowerCase();
    if (!email || !email.includes("@")) {
      return new Response(
        JSON.stringify({ error: "INVALID_EMAIL", message: "Introduce un correo electrónico corporativo válido." }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // Verify if any active license exists for this email
    const license = await env.DB.prepare(
      "SELECT id FROM licenses WHERE LOWER(customer_email) = ? AND status = 'active' LIMIT 1"
    ).bind(email).first<any>();

    if (!license) {
      return new Response(
        JSON.stringify({
          error: "EMAIL_NOT_FOUND",
          message: "No se encontraron licencias activas asociadas a este correo electrónico.",
        }),
        { status: 404, headers: { "Content-Type": "application/json" } }
      );
    }

    // Rate-limiting check: max 5 OTP requests per 15 minutes
    const rateCheck = await env.DB.prepare(
      "SELECT count(*) as count FROM otp_codes WHERE LOWER(email) = ? AND created_at > datetime('now', '-15 minutes')"
    ).bind(email).first<any>();

    if (rateCheck && rateCheck.count >= 5) {
      return new Response(
        JSON.stringify({
          error: "RATE_LIMITED",
          message: "Demasiadas solicitudes de código. Por seguridad, espera 15 minutos antes de volver a intentar.",
        }),
        { status: 429, headers: { "Content-Type": "application/json" } }
      );
    }

    const code = generate6DigitOtp();
    const codeHash = await hashCode(code);
    const otpId = `otp_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;

    await env.DB.prepare(
      `INSERT INTO otp_codes (id, email, code_hash, attempts, expires_at, used, created_at)
       VALUES (?, ?, ?, 0, datetime('now', '+10 minutes'), 0, datetime('now'))`
    ).bind(otpId, email, codeHash).run();

    const emailResult = await sendOtpEmail(email, code, (env as any).RESEND_API_KEY);

    await env.DB.prepare(
      `INSERT INTO audit_logs (event_type, license_key, machine_fingerprint, ip_address, details_json, created_at)
       VALUES (?, ?, NULL, ?, ?, datetime('now'))`
    ).bind("portal_otp_requested", null, clientIp, JSON.stringify({ email, email_sent: emailResult.success, reason: emailResult.reason })).run();

    if (!emailResult.success) {
      if (emailResult.reason === "NO_API_KEY") {
        return new Response(
          JSON.stringify({
            error: "EMAIL_SERVICE_NOT_CONFIGURED",
            message: "El servicio de envío de correos transaccionales está pendiente de activación (falta RESEND_API_KEY). Utiliza tu Clave de Administración Corporativa (WPIPE-ADM-...) para acceder inmediatamente o contacta a soporte.",
          }),
          { status: 503, headers: { "Content-Type": "application/json" } }
        );
      }
      return new Response(
        JSON.stringify({
          error: "EMAIL_DELIVERY_FAILED",
          message: emailResult.reason || "No fue posible despachar el correo de verificación. Por favor, intenta acceder con tu Clave de Administración.",
        }),
        { status: 502, headers: { "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({
        status: "success",
        message: "Código de seguridad de 6 dígitos enviado a tu correo corporativo.",
        email,
        expires_in_minutes: 10,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }

  // 2. POST /v1/portal/otp/verify (Validate OTP and issue signed JWT session token)
  if (path === "/v1/portal/otp/verify" && request.method === "POST") {
    let body: any;
    try {
      body = await request.json();
    } catch {
      return new Response(JSON.stringify({ error: "INVALID_JSON_BODY" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const email = (body.email || "").trim().toLowerCase();
    const code = (body.code || "").trim();

    if (!email || !code || code.length !== 6) {
      return new Response(
        JSON.stringify({ error: "INVALID_PARAMETERS", message: "Correo y código de 6 dígitos requeridos." }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const otp = await env.DB.prepare(
      `SELECT * FROM otp_codes
       WHERE LOWER(email) = ? AND used = 0 AND expires_at > datetime('now')
       ORDER BY created_at DESC LIMIT 1`
    ).bind(email).first<any>();

    if (!otp) {
      return new Response(
        JSON.stringify({ error: "EXPIRED_OR_INVALID", message: "El código ha expirado o no es válido. Solicita un nuevo código." }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    if (otp.attempts >= 5) {
      return new Response(
        JSON.stringify({ error: "BLOCKED", message: "Límite de intentos superado. Solicita un nuevo código de seguridad." }),
        { status: 403, headers: { "Content-Type": "application/json" } }
      );
    }

    const inputHash = await hashCode(code);
    if (inputHash !== otp.code_hash) {
      await env.DB.prepare(
        "UPDATE otp_codes SET attempts = attempts + 1 WHERE id = ?"
      ).bind(otp.id).run();

      return new Response(
        JSON.stringify({ error: "WRONG_CODE", message: "Código de verificación incorrecto. Por favor, revísalo." }),
        { status: 401, headers: { "Content-Type": "application/json" } }
      );
    }

    // Mark OTP as used
    await env.DB.prepare(
      "UPDATE otp_codes SET used = 1 WHERE id = ?"
    ).bind(otp.id).run();

    // Create signed session JWT
    const sessionToken = await createPortalSessionToken(email, secret);

    // Fetch all active organization licenses
    const orgLicensesQuery = await env.DB.prepare(
      `SELECT l.id, l.license_key, l.admin_key, l.plan, l.status,
              COALESCE(l.max_seats, l.max_machines, 1) as max_seats,
              l.customer_name, l.customer_email, l.expires_at,
              (SELECT count(*) FROM leases le WHERE le.license_id = l.id AND le.lease_expires_at > datetime('now')) as active_seats
       FROM licenses l
       WHERE LOWER(l.customer_email) = ? AND l.status = 'active'
       ORDER BY l.created_at DESC`
    ).bind(email).all<any>();

    const organizationLicenses = orgLicensesQuery.results || [];
    const primaryLicense = organizationLicenses[0] || {};

    await env.DB.prepare(
      `INSERT INTO audit_logs (event_type, license_key, machine_fingerprint, ip_address, details_json, created_at)
       VALUES (?, ?, NULL, ?, ?, datetime('now'))`
    ).bind("portal_otp_login_success", primaryLicense.license_key || null, clientIp, JSON.stringify({ email })).run();

    return new Response(
      JSON.stringify({
        status: "success",
        token: sessionToken,
        customer_name: primaryLicense.customer_name || "Cliente Corporativo",
        customer_email: email,
        plan: primaryLicense.plan || "enterprise",
        max_seats: Number(primaryLicense.max_seats || 1),
        expires_at: primaryLicense.expires_at,
        admin_key: primaryLicense.admin_key,
        organization_licenses: organizationLicenses,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }

  // 3. POST /v1/portal/login (Authenticate via private admin_key; terminal keys rejected)
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

    const adminKey = (body.admin_key || body.key || body.identifier || "").trim().toUpperCase();

    // Check if input is a private admin key (starts with WPIPE-ADM-)
    if (adminKey.startsWith("WPIPE-ADM-")) {
      const license = await env.DB.prepare(
        "SELECT * FROM licenses WHERE admin_key = ?"
      ).bind(adminKey).first<any>();

      if (!license || license.status !== "active") {
        return new Response(
          JSON.stringify({ error: "INVALID_ADMIN_KEY", message: "Clave de administración no válida o inactiva." }),
          { status: 401, headers: { "Content-Type": "application/json" } }
        );
      }

      const emailLookup = license.customer_email.toLowerCase();
      const sessionToken = await createPortalSessionToken(emailLookup, secret);

      const orgLicensesQuery = await env.DB.prepare(
        `SELECT l.id, l.license_key, l.admin_key, l.plan, l.status,
                COALESCE(l.max_seats, l.max_machines, 1) as max_seats,
                l.customer_name, l.customer_email, l.expires_at,
                (SELECT count(*) FROM leases le WHERE le.license_id = l.id AND le.lease_expires_at > datetime('now')) as active_seats
         FROM licenses l
         WHERE LOWER(l.customer_email) = ? AND l.status = 'active'
         ORDER BY l.created_at DESC`
      ).bind(emailLookup).all<any>();

      return new Response(
        JSON.stringify({
          status: "success",
          token: sessionToken,
          customer_name: license.customer_name || "Cliente Corporativo",
          customer_email: license.customer_email,
          plan: license.plan,
          max_seats: Number(license.max_seats || license.max_machines || 1),
          expires_at: license.expires_at,
          admin_key: license.admin_key,
          organization_licenses: orgLicensesQuery.results || [],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    // Check if user accidentally entered a terminal seat key (WPIPE-PRO-, WPIPE-ENT-, WPIPE-TEAM-)
    if (adminKey.startsWith("WPIPE-")) {
      const terminalLicense = await env.DB.prepare(
        "SELECT id FROM licenses WHERE license_key = ?"
      ).bind(adminKey).first<any>();

      if (terminalLicense) {
        return new Response(
          JSON.stringify({
            error: "TERMINAL_KEY_NOT_ALLOWED",
            message:
              "Esta es una clave de puesto para VS Code. Por la seguridad de tu empresa, los puestos de desarrollo no tienen permisos de administración. Inicia sesión con tu Correo Corporativo (Código OTP) o ingresa tu Clave de Administración recibida al comprar.",
          }),
          { status: 403, headers: { "Content-Type": "application/json" } }
        );
      }
    }

    return new Response(
      JSON.stringify({
        error: "UNAUTHORIZED",
        message: "Para acceder al portal utiliza tu Correo Corporativo (Código OTP) o una Clave de Administración válida (WPIPE-ADM-...).",
      }),
      { status: 401, headers: { "Content-Type": "application/json" } }
    );
  }

  // ---------------------------------------------------------------------------
  // Protected Routes Gate (Requires verified session token or admin_key)
  // ---------------------------------------------------------------------------
  const authContext = await resolveAuthorizedEmail(request, env);
  if (!authContext) {
    return new Response(
      JSON.stringify({
        error: "UNAUTHORIZED",
        message: "Sesión no válida o expirada. Inicie sesión con su Correo Corporativo (OTP) o su Clave de Administración.",
      }),
      { status: 401, headers: { "Content-Type": "application/json" } }
    );
  }

  const { email: authEmail } = authContext;

  // 4. GET /v1/portal/overview
  if (path === "/v1/portal/overview" && request.method === "GET") {
    // Clean expired leases
    await env.DB.prepare(
      "DELETE FROM leases WHERE lease_expires_at < datetime('now')"
    ).run();

    // Fetch sibling licenses for this organization
    const orgLicensesQuery = await env.DB.prepare(
      `SELECT l.id, l.license_key, l.admin_key, l.plan, l.status,
              COALESCE(l.max_seats, l.max_machines, 1) as max_seats,
              l.customer_name, l.customer_email, l.expires_at,
              (SELECT count(*) FROM leases le WHERE le.license_id = l.id AND le.lease_expires_at > datetime('now')) as active_seats
       FROM licenses l
       WHERE LOWER(l.customer_email) = ? AND l.status = 'active'
       ORDER BY l.created_at DESC`
    ).bind(authEmail).all<any>();

    const organizationLicenses = orgLicensesQuery.results || [];
    if (organizationLicenses.length === 0) {
      return new Response(
        JSON.stringify({ error: "NO_ACTIVE_LICENSES", message: "No se encontraron licencias activas." }),
        { status: 404, headers: { "Content-Type": "application/json" } }
      );
    }

    // Determine target license
    const requestedKey = url.searchParams.get("key");
    let targetLicense = organizationLicenses[0];
    if (requestedKey) {
      const match = organizationLicenses.find(
        (l) => l.license_key.toUpperCase() === requestedKey.toUpperCase()
      );
      if (match) targetLicense = match;
    }

    // Fetch active leases for the target license
    const activeLeases = await env.DB.prepare(
      `SELECT id, machine_fingerprint, hostname, os_name, last_heartbeat_at, lease_expires_at, created_at
       FROM leases
       WHERE license_id = ?
       ORDER BY last_heartbeat_at DESC`
    ).bind(targetLicense.id).all<any>();

    const devices = activeLeases.results || [];
    const maxSeats = Number(targetLicense.max_seats || 1);
    const activeSeats = devices.length;
    const availableSeats = Math.max(0, maxSeats - activeSeats);

    return new Response(
      JSON.stringify({
        license_key: targetLicense.license_key,
        admin_key: targetLicense.admin_key,
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

  // 5. DELETE /v1/portal/seats/:id (1-click kick/liberate seat)
  if (path.startsWith("/v1/portal/seats") && request.method === "DELETE") {
    const parts = path.split("/");
    const leaseId = parts[parts.length - 1] !== "seats" ? parts[parts.length - 1] : url.searchParams.get("id");

    if (!leaseId) {
      return new Response(
        JSON.stringify({ error: "MISSING_LEASE_ID", message: "ID de puesto requerido" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // Delete lease only if it belongs to any license owned by this organization
    const delResult = await env.DB.prepare(
      `DELETE FROM leases
       WHERE id = ? AND license_id IN (SELECT id FROM licenses WHERE LOWER(customer_email) = ?)`
    ).bind(leaseId, authEmail).run();

    await env.DB.prepare(
      `INSERT INTO audit_logs (event_type, license_key, machine_fingerprint, ip_address, details_json, created_at)
       VALUES (?, NULL, NULL, ?, ?, datetime('now'))`
    ).bind("seat_liberated_via_portal", clientIp, JSON.stringify({ lease_id: leaseId, email: authEmail })).run();

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
