/**
 * Zero-Egress Binary Downloads Route Handler (Cloudflare R2)
 * Endpoint: GET /v1/downloads/*
 * Author: William Rodriguez (wisrovi.dev)
 */

import { Env } from "./activate";

export async function handleDownloads(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/v1\/downloads\/?/, "");

  if (!path || path === "latest" || path === "manifest") {
    // Return release metadata manifest
    const manifest = {
      version: "1.0.0",
      release_date: "2026-10-19",
      binaries: {
        "linux-x64": {
          filename: "wpipe-engine-linux-x64.tar.gz",
          url: "https://downloads.wisrovi.dev/wpipe-engine/latest/wpipe-engine-linux-x64.tar.gz",
        },
        "linux-arm64": {
          filename: "wpipe-engine-linux-arm64.tar.gz",
          url: "https://downloads.wisrovi.dev/wpipe-engine/latest/wpipe-engine-linux-arm64.tar.gz",
        },
        "darwin-arm64": {
          filename: "wpipe-engine-darwin-arm64.tar.gz",
          url: "https://downloads.wisrovi.dev/wpipe-engine/latest/wpipe-engine-darwin-arm64.tar.gz",
        },
        "windows-x64": {
          filename: "wpipe-engine-windows-x64.zip",
          url: "https://downloads.wisrovi.dev/wpipe-engine/latest/wpipe-engine-windows-x64.zip",
        },
      },
    };
    return new Response(JSON.stringify(manifest, null, 2), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Stream binary from Cloudflare R2 bucket if bound
  if (env.DOWNLOADS) {
    const object = await env.DOWNLOADS.get(path);
    if (!object) {
      return new Response(JSON.stringify({ error: "BINARY_NOT_FOUND", file: path }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set("etag", object.httpEtag);
    headers.set("Content-Disposition", `attachment; filename="${path.split("/").pop()}"`);

    return new Response(object.body, { headers });
  }

  // Fallback redirect to public R2 CDN url
  const redirectUrl = `https://downloads.wisrovi.dev/${path}`;
  return Response.redirect(redirectUrl, 302);
}
