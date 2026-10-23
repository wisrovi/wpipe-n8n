/**
 * WPipe Studio - Web-to-Local Engine Bridge
 * Connects the web frontend to the local wpipe-engine daemon at 127.0.0.1:49152
 *
 * Security model (UI only):
 * - Everything with value (code generation, real simulation, project persistence) happens
 *   inside wpipe-engine, which enforces plan limits server-side. The browser never decides.
 * - Plan limits shown in the UI come from the engine's signed lease token, re-verified here
 *   with WebCrypto against the embedded wisrovi public key. A fake local server cannot
 *   upgrade the UI with its own key, and even if the UI were tampered with in DevTools the
 *   engine would still reject the operation.
 *
 * Author: William Rodriguez (wisrovi.dev)
 */

import { verifyEd25519Token, DEFAULT_WISROVI_PUBLIC_KEY_HEX } from "./cryptoVerify";
import { exportProjectToWpipeFile, parseWpipeFileContent, BrowserProject } from "./projectStorage";

export {
  exportProjectToWpipeFile,
  parseWpipeFileContent,
  type BrowserProject,
};

export const DEFAULT_ENGINE_PORT = 49152;
export const FALLBACK_ENGINE_PORTS = [49152, 49153, 49154];

/** Plan limits (mirrors wpipe_engine.core.entitlements). Display-only in the browser. */
export interface Entitlements {
  max_blocks: number | null;
  parallel_blocks: boolean;
  background_blocks: boolean;
  ai_steps: boolean;
  real_simulation: boolean;
  zip_export: boolean;
  max_projects: number | null;
}

export const FREE_ENTITLEMENTS: Entitlements = {
  max_blocks: 5,
  parallel_blocks: false,
  background_blocks: false,
  ai_steps: false,
  real_simulation: true,
  zip_export: true,
  max_projects: null,
};

const UNLIMITED_ENTITLEMENTS: Entitlements = {
  max_blocks: null,
  parallel_blocks: true,
  background_blocks: true,
  ai_steps: true,
  real_simulation: true,
  zip_export: true,
  max_projects: null,
};

/** Resolve display entitlements from a *signature-verified* token payload. */
export function resolveEntitlements(plan: string | undefined, ent: any): Entitlements {
  const key = (plan || "free").toLowerCase();
  const base: Entitlements = key === "free" ? { ...FREE_ENTITLEMENTS } : { ...UNLIMITED_ENTITLEMENTS };
  if (ent && typeof ent === "object") {
    (["parallel_blocks", "background_blocks", "ai_steps", "real_simulation", "zip_export"] as const).forEach((k) => {
      if (typeof ent[k] === "boolean") base[k] = ent[k];
    });
    (["max_blocks", "max_projects"] as const).forEach((k) => {
      if (k in ent && (ent[k] === null || (Number.isInteger(ent[k]) && ent[k] >= 0))) base[k] = ent[k];
    });
  }
  return base;
}

export interface EngineStatus {
  connected: boolean;
  tier: "free" | "pro" | "team" | "enterprise";
  isPro: boolean;
  customerName: string;
  licenseKey?: string;
  machineFingerprint?: string;
  pid?: number;
  engineVersion?: string;
  pythonVersion?: string;
  port: number;
  verifiedCryptographically: boolean;
  stepsCount: number;
  entitlements: Entitlements;
  message?: string;
  error?: string;
}

export interface SimulationResult {
  status: "success" | "error" | "paused";
  duration_ms: number;
  steps_timeline: Array<{
    node_id?: string;
    label?: string;
    duration_ms: number;
    status: string;
  }>;
  output_context: Record<string, any>;
  paused_breakpoint?: string | null;
  error?: string;
}

/** Raised when an operation needs a running wpipe-engine. */
export class EngineRequiredError extends Error {
  constructor(message = "This action requires the local wpipe-engine (127.0.0.1:49152).") {
    super(message);
    this.name = "EngineRequiredError";
  }
}

/** Raised when wpipe-engine rejects an operation because of plan limits (HTTP 403). */
export class EngineLimitError extends Error {
  details: any;
  constructor(message: string, details: any) {
    super(message);
    this.name = "EngineLimitError";
    this.details = details;
  }
}

/** Parse an engine error response into a typed error. */
async function toEngineError(resp: Response, fallback: string): Promise<Error> {
  let body: any = null;
  try {
    body = await resp.json();
  } catch {
    body = null;
  }
  if (resp.status === 403 && body && body.error === "LIMIT_EXCEEDED") {
    return new EngineLimitError(body.message || "Plan limit exceeded", body.details || {});
  }
  return new Error(body?.message || `${fallback} (HTTP ${resp.status})`);
}

/**
 * Get active engine base URL (e.g. http://127.0.0.1:49152)
 */
export function getEngineBaseUrl(port: number = DEFAULT_ENGINE_PORT): string {
  if (
    typeof window !== "undefined" &&
    (window.location.hostname === "127.0.0.1" || window.location.hostname === "localhost") &&
    window.location.port === String(port)
  ) {
    return window.location.origin;
  }
  return `http://127.0.0.1:${port}`;
}

/**
 * Resolve API path: relative if on local engine, absolute if on studio.wisrovi.dev
 */
export function getEngineApiUrl(path: string, port: number = DEFAULT_ENGINE_PORT): string {
  if (
    typeof window !== "undefined" &&
    (window.location.hostname === "127.0.0.1" || window.location.hostname === "localhost") &&
    window.location.port === String(port)
  ) {
    return path;
  }
  return `http://127.0.0.1:${port}${path}`;
}

/** Disconnected status: no engine means Free display limits and no value-producing actions. */
export function disconnectedEngineStatus(port: number = DEFAULT_ENGINE_PORT): EngineStatus {
  return {
    connected: false,
    tier: "free",
    isPro: false,
    customerName: "Guest",
    port,
    verifiedCryptographically: false,
    stepsCount: 0,
    entitlements: { ...FREE_ENTITLEMENTS },
    message: "Design mode (no local engine)",
    error: "wpipe-engine is not responding on 127.0.0.1",
  };
}

/**
 * Probe local wpipe-engine health and cryptographic license status
 */
export async function probeEngineStatus(
  preferredPort: number = DEFAULT_ENGINE_PORT
): Promise<EngineStatus> {
  const portsToTry = [
    preferredPort,
    ...FALLBACK_ENGINE_PORTS.filter((p) => p !== preferredPort),
  ];

  for (const port of portsToTry) {
    const baseUrl = getEngineBaseUrl(port);
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 1200);

      const [healthResp, statusResp, catalogResp] = await Promise.allSettled([
        fetch(`${baseUrl}/health`, { signal: controller.signal }),
        fetch(`${baseUrl}/v1/license/status`, { signal: controller.signal }),
        fetch(`${baseUrl}/api/v1/catalog/steps`, { signal: controller.signal }),
      ]);

      clearTimeout(timeoutId);

      if (healthResp.status !== "fulfilled" || !healthResp.value.ok) {
        continue;
      }

      const health = await healthResp.value.json().catch(() => ({}));
      let licenseData: any = {};
      if (statusResp.status === "fulfilled" && statusResp.value.ok) {
        licenseData = await statusResp.value.json().catch(() => ({}));
      }

      let stepsCount = 0;
      if (catalogResp.status === "fulfilled" && catalogResp.value.ok) {
        const steps = await catalogResp.value.json().catch(() => []);
        if (Array.isArray(steps)) {
          stepsCount = steps.length;
        }
      }

      // Only a token signed by the embedded wisrovi key upgrades the UI. The engine-provided
      // public key is deliberately ignored so a fake local server cannot self-sign "Pro".
      let verifiedCrypto = false;
      let verifiedTier: EngineStatus["tier"] = "free";
      let entitlements: Entitlements = { ...FREE_ENTITLEMENTS };
      let customerName = "Local Engine (Free)";
      if (licenseData.signed_token) {
        const cryptoResult = await verifyEd25519Token(licenseData.signed_token, DEFAULT_WISROVI_PUBLIC_KEY_HEX);
        if (cryptoResult.valid && cryptoResult.payload) {
          verifiedCrypto = true;
          verifiedTier = cryptoResult.tier;
          entitlements = resolveEntitlements(cryptoResult.payload.plan, cryptoResult.payload.ent);
          customerName = cryptoResult.payload.name || licenseData.customer_name || "Licensed Developer";
        }
      }

      const isPro = verifiedCrypto && verifiedTier !== "free";

      return {
        connected: true,
        tier: verifiedTier,
        isPro,
        customerName,
        licenseKey: verifiedCrypto ? licenseData.license_key : undefined,
        machineFingerprint: licenseData.machine_fingerprint,
        pid: health.pid || licenseData.engine?.pid,
        engineVersion: health.version || "1.0.0",
        pythonVersion: licenseData.engine?.python_version,
        port,
        verifiedCryptographically: verifiedCrypto,
        stepsCount,
        entitlements,
        message: licenseData.message || "Local engine connected",
      };
    } catch {
      // Try next port
    }
  }

  return disconnectedEngineStatus(preferredPort);
}

/**
 * Execute a real simulation on the local engine (limits enforced by the engine).
 */
export async function executeEngineSimulation(
  canvasIr: any,
  inputPayload: Record<string, any> = {},
  breakpoints: string[] = [],
  port: number = DEFAULT_ENGINE_PORT
): Promise<SimulationResult> {
  const resp = await fetch(getEngineApiUrl("/api/v1/pipeline/simulate", port), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ canvas_ir: canvasIr, input_payload: inputPayload, breakpoints }),
  });
  if (!resp.ok) {
    throw await toEngineError(resp, "Local engine simulation failed");
  }
  return await resp.json();
}

/**
 * Compile the canvas into microservice files on the local engine (limits enforced by the engine).
 */
export async function compileOnEngine(
  canvasIr: any,
  projectName: string,
  port: number = DEFAULT_ENGINE_PORT
): Promise<{ path: string; content: string }[]> {
  const resp = await fetch(getEngineApiUrl("/api/v1/pipeline/compile", port), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ canvas_ir: canvasIr, project_name: projectName }),
  });
  if (!resp.ok) {
    throw await toEngineError(resp, "Local engine compilation failed");
  }
  const data = await resp.json();
  if (Array.isArray(data?.files)) return data.files;
  if (data?.files && typeof data.files === "object") {
    return Object.entries(data.files).map(([path, content]) => ({ path, content: String(content) }));
  }
  return [];
}

/**
 * Generic JSON call to the engine. Throws EngineRequiredError when the engine is offline.
 */
export async function engineJson(
  path: string,
  init: RequestInit = {},
  engineConnected: boolean,
  port: number = DEFAULT_ENGINE_PORT
): Promise<any> {
  if (!engineConnected) throw new EngineRequiredError();
  const resp = await fetch(getEngineApiUrl(path, port), {
    ...init,
    headers: { "Content-Type": "application/json", ...(init.headers || {}) },
  });
  if (!resp.ok) {
    throw await toEngineError(resp, `Engine request failed: ${path}`);
  }
  return await resp.json();
}

/**
 * List projects stored by the local engine (~/.wpipe/workspaces). No engine = no projects.
 */
export async function fetchProjectsHybrid(
  engineConnected: boolean,
  port: number = DEFAULT_ENGINE_PORT
): Promise<{ projects: any[]; source: "engine" | "none" }> {
  if (!engineConnected) {
    return { projects: [], source: "none" };
  }
  try {
    const data = await engineJson("/api/v1/projects", {}, true, port);
    return { projects: Array.isArray(data) ? data : [], source: "engine" };
  } catch (e) {
    console.warn("Failed to fetch projects from engine:", e);
    return { projects: [], source: "none" };
  }
}

/**
 * Load project details from the local engine.
 */
export async function loadProjectHybrid(
  id: string,
  engineConnected: boolean,
  port: number = DEFAULT_ENGINE_PORT
): Promise<{ project: any; source: "engine" }> {
  const data = await engineJson(`/api/v1/projects/${encodeURIComponent(id)}`, {}, engineConnected, port);
  return { project: data, source: "engine" };
}

/**
 * Create or update a project in the local engine. The engine regenerates the files itself.
 */
export async function saveProjectHybrid(
  data: {
    id?: string | null;
    name: string;
    description?: string;
    docker_image?: string;
    protocol?: string;
    canvas_ir?: any;
    generated_files?: any[];
  },
  engineConnected: boolean,
  port: number = DEFAULT_ENGINE_PORT
): Promise<{ project: any; source: "engine" }> {
  const isUpdate = Boolean(data.id && !data.id.startsWith("proj_local_"));
  const path = isUpdate ? `/api/v1/projects/${encodeURIComponent(data.id as string)}` : "/api/v1/projects";
  const resJson = await engineJson(
    path,
    { method: isUpdate ? "PUT" : "POST", body: JSON.stringify(data) },
    engineConnected,
    port
  );
  return { project: resJson, source: "engine" };
}

/**
 * Duplicate a project in the local engine.
 */
export async function duplicateProjectHybrid(
  id: string,
  engineConnected: boolean,
  port: number = DEFAULT_ENGINE_PORT
): Promise<{ project: any; source: "engine" }> {
  const resJson = await engineJson(
    `/api/v1/projects/${encodeURIComponent(id)}/duplicate`,
    { method: "POST" },
    engineConnected,
    port
  );
  return { project: resJson, source: "engine" };
}

/**
 * Delete a project from the local engine.
 */
export async function deleteProjectHybrid(
  id: string,
  engineConnected: boolean,
  port: number = DEFAULT_ENGINE_PORT
): Promise<boolean> {
  await engineJson(`/api/v1/projects/${encodeURIComponent(id)}`, { method: "DELETE" }, engineConnected, port);
  return true;
}
