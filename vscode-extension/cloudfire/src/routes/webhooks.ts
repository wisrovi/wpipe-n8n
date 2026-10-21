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

function generateAdminKey(): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0").toUpperCase())
    .join("");
  return `WPIPE-ADM-${hex.slice(0, 4)}-${hex.slice(4, 8)}-${hex.slice(8, 12)}`;
}

async function verifyLemonSignature(rawBody: string, signatureHex: string, secret: string): Promise<boolean> {
  try {
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      enc.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    const mac = await crypto.subtle.sign("HMAC", key, enc.encode(rawBody));
    const computedHex = Array.from(new Uint8Array(mac))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    return computedHex.toLowerCase() === signatureHex.toLowerCase();
  } catch {
    return false;
  }
}

async function verifyStripeSignature(rawBody: string, stripeHeader: string, secret: string): Promise<boolean> {
  try {
    const parts = stripeHeader.split(",").reduce((acc, item) => {
      const [k, v] = item.split("=");
      if (k && v) acc[k.trim()] = v.trim();
      return acc;
    }, {} as Record<string, string>);

    const timestamp = parts["t"];
    const signature = parts["v1"];
    if (!timestamp || !signature) return false;

    const signedPayload = `${timestamp}.${rawBody}`;
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      enc.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    const mac = await crypto.subtle.sign("HMAC", key, enc.encode(signedPayload));
    const computedHex = Array.from(new Uint8Array(mac))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    return computedHex.toLowerCase() === signature.toLowerCase();
  } catch {
    return false;
  }
}

export async function handleWebhooks(request: Request, env: Env): Promise<Response> {
  let rawBody: string;
  let payload: any;

  try {
    rawBody = await request.text();
    payload = JSON.parse(rawBody);
  } catch {
    return new Response(JSON.stringify({ error: "INVALID_JSON", message: "Request body must be valid JSON" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // 1. Signature Verification if Secrets Configured
  const lemonSignature = request.headers.get("x-signature");
  if (env.LEMONSQUEEZY_WEBHOOK_SECRET && lemonSignature) {
    const valid = await verifyLemonSignature(rawBody, lemonSignature, env.LEMONSQUEEZY_WEBHOOK_SECRET);
    if (!valid) {
      return new Response(JSON.stringify({ error: "INVALID_SIGNATURE", message: "Lemon Squeezy HMAC signature mismatch" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }
  }

  const stripeSignature = request.headers.get("stripe-signature");
  if (env.STRIPE_WEBHOOK_SECRET && stripeSignature) {
    const valid = await verifyStripeSignature(rawBody, stripeSignature, env.STRIPE_WEBHOOK_SECRET);
    if (!valid) {
      return new Response(JSON.stringify({ error: "INVALID_SIGNATURE", message: "Stripe HMAC signature mismatch" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }
  }

  // 2. Event and Customer Extraction
  const eventName = payload.meta?.event_name || payload.type || payload.event || "order_created";
  const customerEmail =
    payload.data?.attributes?.user_email ||
    payload.data?.object?.customer_details?.email ||
    payload.data?.object?.email ||
    payload.customer_email;
  const customerName =
    payload.data?.attributes?.user_name ||
    payload.data?.object?.customer_details?.name ||
    payload.customer_name ||
    "Developer";

  const isOrderEvent =
    eventName.includes("order_created") ||
    eventName.includes("subscription_created") ||
    eventName.includes("checkout.session.completed");

  if (isOrderEvent && !customerEmail) {
    return new Response(
      JSON.stringify({ error: "MISSING_CUSTOMER_EMAIL", message: "Webhook missing customer email" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const clientIp = request.headers.get("cf-connecting-ip") || "0.0.0.0";

  // 3. Plan detection (Pro, Team, Enterprise)
  const rawPlan = String(
    payload.meta?.custom_data?.plan ||
    payload.data?.attributes?.first_order_item?.variant_name ||
    payload.data?.object?.metadata?.plan ||
    payload.plan ||
    "pro"
  ).toLowerCase();

  let plan = "pro";
  let maxMachines = 2;
  let keyPrefix = "WPIPE-PRO";

  if (rawPlan.includes("enterprise") || rawPlan.includes("ent")) {
    plan = "enterprise";
    maxMachines = 20;
    keyPrefix = "WPIPE-ENT";
  } else if (rawPlan.includes("team")) {
    plan = "team";
    maxMachines = 5;
    keyPrefix = "WPIPE-TEAM";
  }

  // 4. Handle Order Completed / Subscription Created
  if (
    eventName.includes("order_created") ||
    eventName.includes("subscription_created") ||
    eventName.includes("checkout.session.completed")
  ) {
    const licenseId = `lic_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
    const newLicenseKey = generateLicenseKey(keyPrefix);
    const adminKey = generateAdminKey();
    const expiresAt = new Date(Date.now() + 365 * 86400 * 1000).toISOString(); // 1 year default

    await env.DB.prepare(
      `INSERT INTO licenses (
        id, license_key, admin_key, customer_email, customer_name, plan, status, max_machines, max_seats, expires_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, datetime('now'), datetime('now'))`
    ).bind(licenseId, newLicenseKey, adminKey, customerEmail.toLowerCase(), customerName, plan, maxMachines, maxMachines, expiresAt).run();

    await env.DB.prepare(
      "INSERT INTO audit_logs (event_type, license_key, ip_address, details_json, created_at) VALUES (?, ?, ?, ?, datetime('now'))"
    ).bind(
      "payment_new_license",
      newLicenseKey,
      clientIp,
      JSON.stringify({ email: customerEmail, event: eventName, plan, max_machines: maxMachines, max_seats: maxMachines })
    ).run();

    return new Response(
      JSON.stringify({
        status: "success",
        message: `Licencia ${plan.toUpperCase()} generada exitosamente`,
        license_key: newLicenseKey,
        admin_key: adminKey,
        customer_email: customerEmail,
        customer_name: customerName,
        plan: plan,
        max_seats: maxMachines,
        expires_at: expiresAt,
      }),
      { status: 201, headers: { "Content-Type": "application/json" } }
    );
  }

  // 5. Handle Subscription Cancelled
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
