/**
 * Payment Webhook Handler (Stripe / Lemon Squeezy)
 * Endpoint: POST /v1/webhooks/payment
 * Author: William Rodriguez (wisrovi.dev)
 */

import { Env } from "./activate";

function generateLicenseKey(prefix = "WPIPE-PRO"): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0").toUpperCase())
    .join("");
  return `${prefix}-${hex.slice(0, 4)}-${hex.slice(4, 8)}-${hex.slice(8, 12)}`;
}

export async function handleWebhooks(request: Request, env: Env): Promise<Response> {
  let payload: any;
  try {
    payload = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "INVALID_JSON" }), { status: 400 });
  }

  // Handle standard payment events (Lemon Squeezy order_created or Stripe checkout.session.completed)
  const eventName = payload.meta?.event_name || payload.type || payload.event || "order_created";
  const customerEmail =
    payload.data?.attributes?.user_email ||
    payload.data?.object?.customer_details?.email ||
    payload.customer_email;
  const customerName =
    payload.data?.attributes?.user_name ||
    payload.data?.object?.customer_details?.name ||
    payload.customer_name ||
    "Developer";

  if (!customerEmail) {
    return new Response(
      JSON.stringify({ error: "MISSING_CUSTOMER_EMAIL", message: "Webhook missing customer email" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const clientIp = request.headers.get("cf-connecting-ip") || "0.0.0.0";

  if (eventName.includes("order_created") || eventName.includes("checkout.session.completed")) {
    const licenseId = `lic_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
    const newLicenseKey = generateLicenseKey();
    const expiresAt = new Date(Date.now() + 365 * 86400 * 1000).toISOString(); // 1 year subscription

    await env.DB.prepare(
      `INSERT INTO licenses (
        id, license_key, customer_email, customer_name, plan, status, max_machines, expires_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'pro', 'active', 2, ?, datetime('now'), datetime('now'))`
    ).bind(licenseId, newLicenseKey, customerEmail.toLowerCase(), customerName, expiresAt).run();

    await env.DB.prepare(
      "INSERT INTO audit_logs (event_type, license_key, ip_address, details_json, created_at) VALUES (?, ?, ?, ?, datetime('now'))"
    ).bind("payment_new_license", newLicenseKey, clientIp, JSON.stringify({ email: customerEmail, event: eventName })).run();

    return new Response(
      JSON.stringify({
        status: "success",
        message: "Licencia Pro generada exitosamente",
        license_key: newLicenseKey,
        customer_email: customerEmail,
        expires_at: expiresAt,
      }),
      { status: 201, headers: { "Content-Type": "application/json" } }
    );
  }

  // Handle subscription cancelled / failed
  if (eventName.includes("subscription_cancelled") || eventName.includes("customer.subscription.deleted")) {
    await env.DB.prepare(
      "UPDATE licenses SET status = 'expired', updated_at = datetime('now') WHERE customer_email = ?"
    ).bind(customerEmail.toLowerCase()).run();

    await env.DB.prepare(
      "INSERT INTO audit_logs (event_type, ip_address, details_json, created_at) VALUES (?, ?, ?, datetime('now'))"
    ).bind("subscription_cancelled", clientIp, JSON.stringify({ email: customerEmail, event: eventName })).run();

    return new Response(JSON.stringify({ status: "success", message: "Suscripción cancelada." }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ status: "ignored", event: eventName }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
