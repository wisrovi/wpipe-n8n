/**
 * WPipe Studio - Web-to-Local Engine Bridge
 * Connects the web frontend to the local wpipe-engine daemon at 127.0.0.1:49152
 * Author: William Rodriguez (wisrovi.dev)
 */

import { verifyEd25519Token, DEFAULT_WISROVI_PUBLIC_KEY_HEX } from "./cryptoVerify";
import {
  listBrowserProjects,
  getBrowserProject,
  createBrowserProject,
  updateBrowserProject,
  duplicateBrowserProject,
  deleteBrowserProject,
  exportProjectToWpipeFile,
  parseWpipeFileContent,
  BrowserProject,
} from "./projectStorage";

export {
  exportProjectToWpipeFile,
  parseWpipeFileContent,
  type BrowserProject,
};

export const DEFAULT_ENGINE_PORT = 49152;
export const FALLBACK_ENGINE_PORTS = [49152, 49153, 49154];

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
  message?: string;
  error?: string;
}

export interface SimulationResult {
  status: "success" | "error";
  duration_ms: number;
  step_timeline: Array<{
    step: string;
    duration_ms: number;
    status: string;
    output?: any;
    error?: string;
  }>;
  context_egress: Record<string, any>;
  logs: string[];
  error?: string;
}

/**
 * Get active engine base URL (e.g. http://127.0.0.1:49152)
 */
export function getEngineBaseUrl(port: number = DEFAULT_ENGINE_PORT): string {
  // If running embedded in the engine canvas or local dev, use window.location if appropriate
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

      // Cryptographic verification of lease token if provided
      let verifiedCrypto = false;
      let verifiedTier = licenseData.tier || "free";
      if (licenseData.signed_token) {
        const cryptoResult = await verifyEd25519Token(
          licenseData.signed_token,
          licenseData.public_key_hex || DEFAULT_WISROVI_PUBLIC_KEY_HEX
        );
        if (cryptoResult.valid) {
          verifiedCrypto = true;
          verifiedTier = cryptoResult.tier;
        }
      } else if (licenseData.is_pro) {
        // If engine reports pro without signature, note unverified state
        verifiedCrypto = false;
      }

      const isPro = verifiedTier === "pro" || verifiedTier === "team" || verifiedTier === "enterprise";

      return {
        connected: true,
        tier: verifiedTier,
        isPro,
        customerName: licenseData.customer_name || "Desarrollador",
        licenseKey: licenseData.license_key,
        machineFingerprint: licenseData.machine_fingerprint,
        pid: health.pid || licenseData.engine?.pid,
        engineVersion: health.version || "1.0.0",
        pythonVersion: licenseData.engine?.python_version,
        port,
        verifiedCryptographically: verifiedCrypto,
        stepsCount,
        message: licenseData.message || "Motor local conectado",
      };
    } catch {
      // Try next port
    }
  }

  // If no ports responded, return disconnected mode
  return {
    connected: false,
    tier: "free",
    isPro: false,
    customerName: "Invitado",
    port: preferredPort,
    verifiedCryptographically: false,
    stepsCount: 0,
    message: "Modo Diseño (Sin motor local)",
    error: "wpipe-engine no responde en 127.0.0.1",
  };
}

/**
 * Execute simulation on the local engine
 */
export async function executeEngineSimulation(
  canvasIr: any,
  inputPayload: Record<string, any> = {},
  breakpoints: string[] = [],
  port: number = DEFAULT_ENGINE_PORT
): Promise<SimulationResult> {
  const baseUrl = getEngineBaseUrl(port);
  const resp = await fetch(`${baseUrl}/simulate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      canvas_ir: canvasIr,
      input_payload: inputPayload,
      breakpoints,
    }),
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => "Simulation request failed");
    throw new Error(`Error en el motor local (${resp.status}): ${errText}`);
  }

  return await resp.json();
}

/**
 * Fetch projects from Local Engine (if connected) with automatic fallback to Browser Storage.
 */
export async function fetchProjectsHybrid(
  engineConnected: boolean,
  port: number = DEFAULT_ENGINE_PORT
): Promise<{ projects: any[]; source: "engine" | "browser" }> {
  if (engineConnected) {
    try {
      const url = getEngineApiUrl("/api/v1/projects", port);
      const resp = await fetch(url);
      if (resp.ok) {
        const data = await resp.json();
        if (Array.isArray(data)) {
          return { projects: data, source: "engine" };
        }
      }
    } catch (e) {
      console.warn("Failed to fetch projects from engine, falling back to browser storage:", e);
    }
  }

  // Fallback to browser storage
  const browserList = listBrowserProjects();
  return { projects: browserList, source: "browser" };
}

/**
 * Load project details from Local Engine with browser fallback.
 */
export async function loadProjectHybrid(
  id: string,
  engineConnected: boolean,
  port: number = DEFAULT_ENGINE_PORT
): Promise<{ project: any; source: "engine" | "browser" }> {
  if (engineConnected) {
    try {
      const url = getEngineApiUrl(`/api/v1/projects/${id}`, port);
      const resp = await fetch(url);
      if (resp.ok) {
        const data = await resp.json();
        return { project: data, source: "engine" };
      }
    } catch (e) {
      console.warn("Failed to load project from engine, trying browser storage:", e);
    }
  }

  const browserProj = getBrowserProject(id);
  if (browserProj) {
    return { project: browserProj, source: "browser" };
  }
  throw new Error("Proyecto no encontrado");
}

/**
 * Save or update project in Local Engine or Browser storage.
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
): Promise<{ project: any; source: "engine" | "browser" }> {
  if (engineConnected) {
    try {
      if (data.id && !data.id.startsWith("proj_local_")) {
        // Update existing engine project
        const url = getEngineApiUrl(`/api/v1/projects/${data.id}`, port);
        const resp = await fetch(url, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        });
        if (resp.ok) {
          const resJson = await resp.json();
          return { project: resJson, source: "engine" };
        }
      } else {
        // Create new project in engine
        const url = getEngineApiUrl("/api/v1/projects", port);
        const resp = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        });
        if (resp.ok) {
          const resJson = await resp.json();
          return { project: resJson, source: "engine" };
        }
      }
    } catch (e) {
      console.warn("Failed to save project to engine, falling back to browser storage:", e);
    }
  }

  // Save to browser
  if (data.id && getBrowserProject(data.id)) {
    const { id: _, ...rest } = data;
    const updated = updateBrowserProject(data.id, rest as Partial<BrowserProject>);
    return { project: updated, source: "browser" };
  } else {
    const created = createBrowserProject(data);
    return { project: created, source: "browser" };
  }
}

/**
 * Duplicate a project either in engine or browser storage.
 */
export async function duplicateProjectHybrid(
  id: string,
  engineConnected: boolean,
  port: number = DEFAULT_ENGINE_PORT
): Promise<{ project: any; source: "engine" | "browser" }> {
  if (engineConnected && !id.startsWith("proj_local_")) {
    try {
      const url = getEngineApiUrl(`/api/v1/projects/${id}/duplicate`, port);
      const resp = await fetch(url, { method: "POST" });
      if (resp.ok) {
        const resJson = await resp.json();
        return { project: resJson, source: "engine" };
      }
    } catch (e) {
      console.warn("Engine duplicate failed, checking browser:", e);
    }
  }

  const dup = duplicateBrowserProject(id);
  if (dup) {
    return { project: dup, source: "browser" };
  }
  throw new Error("No se pudo duplicar el proyecto");
}

/**
 * Delete a project either from engine or browser storage.
 */
export async function deleteProjectHybrid(
  id: string,
  engineConnected: boolean,
  port: number = DEFAULT_ENGINE_PORT
): Promise<boolean> {
  if (engineConnected && !id.startsWith("proj_local_")) {
    try {
      const url = getEngineApiUrl(`/api/v1/projects/${id}`, port);
      const resp = await fetch(url, { method: "DELETE" });
      if (resp.ok) {
        return true;
      }
    } catch (e) {
      console.warn("Engine delete failed, trying browser:", e);
    }
  }

  return deleteBrowserProject(id);
}


