/**
 * IPC Client for communicating with the local native daemon (wpipe-engine)
 * Supports Unix Domain Socket (/tmp/wpipe.sock) and Localhost HTTP fallback.
 * Author: William Rodriguez (wisrovi.dev)
 */

import * as http from "http";
import * as os from "os";
import * as vscode from "vscode";

export interface LicenseStatus {
  tier: "free" | "pro" | "team" | "enterprise";
  is_pro: boolean;
  license_key?: string;
  customer_name?: string;
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
  activated_at?: string;
  is_floating?: boolean;
  message?: string;
  upgrade_url?: string;
  engine?: {
    pid: number;
    version: string;
    python_version: string;
    hostname: string;
    os: string;
    transport: string;
  };
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
    
    // Check if user or environment configured custom engineUrl
    try {
      const config = vscode.workspace.getConfiguration("wpipe");
      const customUrl = config.get<string>("engineUrl") || config.get<string>("canvasUrl");
      if (customUrl) {
        const u = new URL(customUrl);
        this.httpHost = u.hostname || "127.0.0.1";
        this.httpPort = parseInt(u.port, 10) || 49152;
        this.useHttp = true;
      } else {
        this.useHttp = os.platform() === "win32";
      }
    } catch {
      this.useHttp = os.platform() === "win32";
    }
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
        timeout: 30000,
      };

      const makeReq = (useHttpMode: boolean) => {
        const reqOpts: http.RequestOptions = { ...options };
        if (useHttpMode) {
          reqOpts.host = this.httpHost;
          reqOpts.port = this.httpPort;
          delete reqOpts.socketPath;
        } else {
          reqOpts.socketPath = this.socketPath;
          delete reqOpts.host;
          delete reqOpts.port;
        }

        const req = http.request(reqOpts, (res) => {
          let raw = "";
          res.on("data", (chunk) => (raw += chunk));
          res.on("end", () => {
            try {
              const parsed = raw ? JSON.parse(raw) : {};
              resolve(parsed);
            } catch {
              resolve({ raw, statusCode: res.statusCode });
            }
          });
        });

        req.on("error", (err) => {
          // If Unix socket failed and we haven't tried HTTP yet, seamlessly fallback to HTTP
          if (!useHttpMode) {
            this.useHttp = true;
            makeReq(true);
          } else {
            reject(err);
          }
        });

        req.on("timeout", () => {
          req.destroy();
          reject(new Error("Request to wpipe-engine timed out"));
        });

        if (payload) {
          req.write(payload);
        }
        req.end();
      };

      makeReq(this.useHttp);
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

  public async shutdownEngine(): Promise<any> {
    try {
      return await this.request("POST", "/engine/shutdown");
    } catch (e: any) {
      return { status: "error", message: e.message };
    }
  }

  public async runTests(workspaceDir: string): Promise<any> {
    return this.request("POST", "/pipeline/test", { workspace_dir: workspaceDir });
  }
}

function FalseSafe(): boolean {
  return false;
}
