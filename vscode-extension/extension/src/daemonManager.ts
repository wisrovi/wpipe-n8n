/**
 * Daemon Process Lifecycle Manager
 * Detects, starts, stops, and auto-downloads the native wpipe-engine binary if missing.
 * Author: William Rodriguez (wisrovi.dev)
 */

import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import * as child_process from "child_process";
import * as crypto from "crypto";
import * as https from "https";
import { EngineIpcClient } from "./ipcClient";

export class DaemonManager {
  private client: EngineIpcClient;
  private daemonProcess: child_process.ChildProcess | null = null;
  private context: vscode.ExtensionContext;

  constructor(context: vscode.ExtensionContext, client: EngineIpcClient) {
    this.context = context;
    this.client = client;
  }

  public async ensureDaemonRunning(): Promise<boolean> {
    const isAlive = await this.client.checkHealth();
    if (isAlive) {
      return true;
    }

    const binaryPath = await this.resolveOrDownloadBinary();
    if (!binaryPath) {
      vscode.window.showWarningMessage(
        "Could not locate the wpipe-engine binary. Advanced local compilation and simulation features will be limited."
      );
      return false;
    }

    return this.spawnDaemon(binaryPath);
  }

  private async resolveOrDownloadBinary(): Promise<string | null> {
    const config = vscode.workspace.getConfiguration("wpipe");
    const configuredPath = config.get<string>("daemonPath");
    if (configuredPath && fs.existsSync(configuredPath)) {
      return configuredPath;
    }

    // 1. Check Development Monorepo sibling path
    const devPath = path.resolve(__dirname, "../../daemon_os/wpipe_engine/main.py");
    if (fs.existsSync(devPath)) {
      return devPath;
    }

    // 2. Check ~/.wpipe/bin/wpipe-engine
    const userBinDir = path.join(os.homedir(), ".wpipe", "bin");
    const localBinary = path.join(userBinDir, os.platform() === "win32" ? "wpipe-engine.exe" : "wpipe-engine");
    if (fs.existsSync(localBinary)) {
      return localBinary;
    }

    // 3. Check system PATH
    const systemBinary = this.findInPath(os.platform() === "win32" ? "wpipe-engine.exe" : "wpipe-engine");
    if (systemBinary) {
      return systemBinary;
    }

    // 4. Auto-Download binary from Cloudflare R2
    return this.downloadBinaryFromR2(localBinary);
  }

  private findInPath(binaryName: string): string | null {
    const paths = (process.env.PATH || "").split(path.delimiter);
    for (const p of paths) {
      const full = path.join(p, binaryName);
      if (fs.existsSync(full)) {
        return full;
      }
    }
    return null;
  }

  private async downloadBinaryFromR2(targetPath: string): Promise<string | null> {
    const choice = await vscode.window.showInformationMessage(
      "WPipe Engine (wpipe-engine) is not installed. Would you like to automatically download it to enable local compilation, zero-latency execution, and hardware licensing?",
      "Download Now",
      "Later"
    );

    if (choice !== "Download Now") {
      return null;
    }

    return vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "Downloading wpipe-engine from Cloudflare Edge...",
        cancellable: false,
      },
      async (progress) => {
        try {
          fs.mkdirSync(path.dirname(targetPath), { recursive: true });
          progress.report({ increment: 10, message: "Fetching release manifest..." });

          const manifestUrl = "https://api.wisrovi.dev/v1/downloads/latest";
          const manifestRes = await fetch(manifestUrl);
          if (!manifestRes.ok) {
            throw new Error(`HTTP Error fetching manifest: ${manifestRes.status} ${manifestRes.statusText}`);
          }
          const manifest = (await manifestRes.json()) as any;

          const archKey = os.arch() === "arm64" ? "arm64" : "x64";
          const osKey = os.platform() === "darwin" ? "darwin" : os.platform() === "win32" ? "windows" : "linux";
          const targetKey = `${osKey}-${archKey}`;

          const entry = manifest.binaries?.[targetKey];
          if (!entry || !entry.binary_url) {
            throw new Error(`No binary found for target architecture ${targetKey}`);
          }

          progress.report({ increment: 30, message: `Downloading binary (${entry.binary_filename || "wpipe-engine"})...` });

          const binaryRes = await fetch(entry.binary_url);
          if (!binaryRes.ok) {
            throw new Error(`HTTP Error downloading binary: ${binaryRes.status} ${binaryRes.statusText}`);
          }

          const tmpPath = `${targetPath}.tmp`;
          const fileStream = fs.createWriteStream(tmpPath);
          const hasher = crypto.createHash("sha256");

          const reader = binaryRes.body?.getReader();
          if (!reader) {
            throw new Error("Response body is empty");
          }

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            fileStream.write(value);
            hasher.update(value);
          }
          fileStream.end();
          await new Promise<void>((resolve, reject) => {
            fileStream.on("finish", () => resolve());
            fileStream.on("error", reject);
          });

          progress.report({ increment: 30, message: "Verifying SHA-256 cryptographic integrity..." });
          const calculatedSha256 = hasher.digest("hex");
          const expectedSha256 = entry.binary_sha256;

          if (expectedSha256 && calculatedSha256.toLowerCase() !== expectedSha256.toLowerCase()) {
            if (fs.existsSync(tmpPath)) {
              fs.unlinkSync(tmpPath);
            }
            throw new Error(
              `SHA-256 integrity check failed. Expected: ${expectedSha256}, Got: ${calculatedSha256}`
            );
          }

          if (fs.existsSync(targetPath)) {
            fs.unlinkSync(targetPath);
          }
          fs.renameSync(tmpPath, targetPath);
          fs.chmodSync(targetPath, 0o755);

          progress.report({ increment: 30, message: "Installation completed and verified." });
          vscode.window.showInformationMessage(
            `WPipe Engine installed successfully (SHA-256 verified: ${calculatedSha256.slice(0, 8)}...).`
          );
          return targetPath;
        } catch (err: any) {
          // In offline development fallback or mock, create executable shell/python wrapper
          const devPath = path.resolve(__dirname, "../../daemon_os/wpipe_engine/main.py");
          if (fs.existsSync(devPath)) {
            const launcher = `#!/bin/sh\nexec python3 "${devPath}" "$@"\n`;
            fs.writeFileSync(targetPath, launcher, { mode: 0o755 });
            vscode.window.showWarningMessage(
              `Download failed (${err.message}). Using local development launcher.`
            );
            return targetPath;
          }

          vscode.window.showErrorMessage(`Failed to download wpipe-engine: ${err.message}`);
          return null;
        }
      }
    );
  }

  private async spawnDaemon(executablePath: string): Promise<boolean> {
    try {
      // Ensure SSL_CERT_FILE is defined in child environment if available in OS
      const caCandidates = [
        "/etc/ssl/certs/ca-certificates.crt",
        "/etc/pki/tls/certs/ca-bundle.crt",
        "/etc/ssl/ca-bundle.pem",
        "/usr/local/share/certs/ca-root-nss.crt",
        "/etc/ssl/cert.pem",
      ];
      let sslCertFile = process.env.SSL_CERT_FILE;
      if (!sslCertFile) {
        for (const candidate of caCandidates) {
          if (fs.existsSync(candidate)) {
            sslCertFile = candidate;
            break;
          }
        }
      }

      const env = {
        ...process.env,
        ...(sslCertFile ? { SSL_CERT_FILE: sslCertFile } : {}),
      };

      let proc: child_process.ChildProcess;
      if (executablePath.endsWith(".py")) {
        proc = child_process.spawn("python3", [executablePath, "daemon"], {
          detached: true,
          stdio: "ignore",
          env,
        });
      } else {
        proc = child_process.spawn(executablePath, ["daemon"], {
          detached: true,
          stdio: "ignore",
          env,
        });
      }

      proc.unref();
      this.daemonProcess = proc;

      // Poll up to 4 seconds for socket readiness
      for (let i = 0; i < 8; i++) {
        await new Promise((r) => setTimeout(r, 500));
        const ok = await this.client.checkHealth();
        if (ok) {
          return true;
        }
      }
      return false;
    } catch (e: any) {
      vscode.window.showErrorMessage(`Could not start wpipe-engine daemon: ${e.message}`);
      return false;
    }
  }

  public async stop(): Promise<void> {
    if (this.daemonProcess && !this.daemonProcess.killed) {
      try {
        this.daemonProcess.kill();
      } catch {}
    }
    // Also trigger HTTP/IPC graceful shutdown in case it was started externally
    try {
      await this.client.shutdownEngine();
    } catch {}

    // On Linux/macOS, kill any stray wpipe-engine process
    if (process.platform !== "win32") {
      try {
        child_process.execSync("pkill -f 'wpipe-engine daemon' || true", { stdio: "ignore" });
      } catch {}
    }
  }
}
