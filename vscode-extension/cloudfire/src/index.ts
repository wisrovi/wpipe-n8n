/**
 * WPipe Studio - Cloudflare Worker Entrypoint
 * Global Serverless Licensing & Binary Distribution Authority
 * Author: William Rodriguez (wisrovi.dev)
 */

import { Env, handleActivate } from "./routes/activate";
import { handleVerify } from "./routes/verify";
import { handleWebhooks } from "./routes/webhooks";
import { handleDownloads } from "./routes/downloads";
import { handleLease, handleHeartbeat, handleRelease } from "./routes/lease";
import { handlePortal } from "./routes/portal";
import { handleAdmin } from "./routes/admin";

function corsHeaders(): HeadersInit {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // 1. Handle CORS Preflight Requests
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(),
      });
    }

    try {
      let response: Response;

      // 2. Route Matching
      if (url.pathname === "/" || url.pathname === "/v1/health") {
        response = new Response(
          JSON.stringify({
            service: "WPipe Studio Licensing Authority",
            vendor: "wisrovi.dev",
            author: "William Rodriguez",
            version: "1.1.0",
            status: "healthy",
            features: ["floating_leases", "hardware_fingerprint", "enterprise_portal", "admin_sql"],
            timestamp: new Date().toISOString(),
          }, null, 2),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      } else if (url.pathname === "/v1/license/lease" && request.method === "POST") {
        response = await handleLease(request, env);
      } else if (url.pathname === "/v1/license/heartbeat" && request.method === "POST") {
        response = await handleHeartbeat(request, env);
      } else if (url.pathname === "/v1/license/release" && request.method === "POST") {
        response = await handleRelease(request, env);
      } else if (url.pathname.startsWith("/v1/portal")) {
        response = await handlePortal(request, env, url);
      } else if (url.pathname.startsWith("/v1/admin")) {
        response = await handleAdmin(request, env, url);
      } else if (url.pathname === "/v1/license/activate" && request.method === "POST") {
        response = await handleActivate(request, env);
      } else if (url.pathname === "/v1/license/verify" && request.method === "POST") {
        response = await handleVerify(request, env);
      } else if (url.pathname.startsWith("/v1/webhooks/") && request.method === "POST") {
        response = await handleWebhooks(request, env);
      } else if (url.pathname.startsWith("/v1/downloads")) {
        response = await handleDownloads(request, env);
      } else {
        response = new Response(
          JSON.stringify({ error: "NOT_FOUND", path: url.pathname }),
          { status: 404, headers: { "Content-Type": "application/json" } }
        );
      }

      // Add CORS headers to all responses
      const newHeaders = new Headers(response.headers);
      Object.entries(corsHeaders()).forEach(([k, v]) => newHeaders.set(k, v));
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: newHeaders,
      });
    } catch (err: any) {
      return new Response(
        JSON.stringify({
          error: "INTERNAL_SERVER_ERROR",
          message: err?.message || String(err),
        }),
        {
          status: 500,
          headers: {
            "Content-Type": "application/json",
            ...corsHeaders(),
          },
        }
      );
    }
  },
};
