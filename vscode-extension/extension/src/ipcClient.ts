/**
 * IPC Client for communicating with the local native daemon (wpipe-engine)
 * Supports Unix Domain Socket (/tmp/wpipe.sock) and Localhost HTTP fallback.
 * Author: William Rodriguez (wisrovi.dev)
 */

import * as http from "http";
import * as os from "os";

export interface LicenseStatus {
  tier: "free" | "pro" | "team" | "enterprise";
  is_pro: boolean;
  max_blocks: number | null;
  features?: {
    unlimited_blocks: boolean;
    parallel_blocks: boolean;
    background_tasks: boolean;
    ai_steps: boolean;
    live_debugging: boolean;
  };
  machine_fingerprint?: string;
  lease_expires_at?: string;
  message?: string;
  upgrade_url?: string;
}

export class EngineIpcClient {
  private socketPath: string;
  private httpHost: string;
  private httpPort: number;
  private useHttp: boolean;

  constructor(socketPath = "/tmp/wpipe.sock", httpHost = "127.0.0.1", httpPort = 49152) {
    this.socketPath = socketPath;
    this.httpHost = httpHost;
    this.httpPort = httpPort;
    this.useHttp = os.platform() === "win32";
  }

  public setTransport(useHttp: boolean): void {
    this.useHttp = useHttp;
  }

  private request(method: string, path: string, body?: any): Promise<any> {
    return new Promise((resolve, reject) => {
      const payload = body ? JSON.stringify(body) : undefined;
      const options: http.RequestOptions = {
        method,
        path,
        headers: {
          "Content-Type": "application/json",
          ...(payload ? { "Content-Length": Buffer.byteLength(payload) } : {}),
        },
        timeout: 10000,
      };

      if (this.useHttp) {
        options.host = this.httpHost;
        options.port = this.httpPort;
      } else {
        options.socketPath = this.socketPath;
      }

      const req = http.request(options, (res) => {
        let raw = "";
        res.on("data", (chunk) => (raw += chunk));
        res.on("end", () => {
          try {
            const parsed = raw ? JSON.parse(raw) : {};
            if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
              resolve(parsed);
            } else {
              // Return parsed error payload or reject
              resolve(parsed);
            }
          } catch {
            resolve({ raw, statusCode: res.statusCode });
          }
        });
      });

      req.on("error", (err) => reject(err));
      req.on("timeout", () => {
        req.destroy();
        reject(new Error("Request to wpipe-engine timed out"));
      });

      if (payload) {
        req.write(payload);
      }
      req.end();
    });
  }

  public async checkHealth(): Promise<boolean> {
    try {
      const res = await this.request("GET", "/health");
      return res && res.service === "wpipe-engine";
    } catch {
      return false;
    }
  }

  public async getLicenseStatus(): Promise<LicenseStatus> {
    try {
      return await this.request("GET", "/license/status");
    } catch {
      return {
        tier: "free",
        is_pro: FalseSafe(),
        max_blocks: 5,
        message: "wpipe-engine no está en ejecución. Modo Free (5 bloques).",
      };
    }
  }

  public async activateLicense(key: string): Promise<any> {
    return this.request("POST", "/license/activate", { license_key: key });
  }

  public async compilePipeline(
    canvasIr: any,
    projectName = "main_pipeline",
    existingPipelineCode = ""
  ): Promise<any> {
    return this.request("POST", "/pipeline/compile", {
      canvas_ir: canvasIr,
      project_name: projectName,
      existing_pipeline_code: existingPipelineCode,
    });
  }

  public async simulatePipeline(canvasIr: any, inputPayload = {}, breakpoints: string[] = []): Promise<any> {
    return this.request("POST", "/pipeline/simulate", {
      canvas_ir: canvasIr,
      input_payload: inputPayload,
      breakpoints,
    });
  }

  public async runTests(workspaceDir: string): Promise<any> {
    return this.request("POST", "/pipeline/test", { workspace_dir: workspaceDir });
  }
}

function FalseSafe(): boolean {
  return false;
}
