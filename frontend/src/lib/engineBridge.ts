/**
 * WPipe Studio - Web-to-Local Engine Bridge
 * Connects the web frontend to the local wpipe-engine daemon at 127.0.0.1:49152
 * Author: William Rodriguez (wisrovi.dev)
 */

import { verifyEd25519Token, DEFAULT_WISROVI_PUBLIC_KEY_HEX } from "./cryptoVerify";

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
 * Compile canvas IR to clean Python code via local engine AST
 */
export async function compileEngineAst(
  canvasIr: any,
  port: number = DEFAULT_ENGINE_PORT
): Promise<{ python_code: string; valid: boolean; errors?: string[] }> {
  const baseUrl = getEngineBaseUrl(port);
  const resp = await fetch(`${baseUrl}/compile`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      canvas_ir: canvasIr,
    }),
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => "Compilation request failed");
    throw new Error(`Error de compilación (${resp.status}): ${errText}`);
  }

  return await resp.json();
}
