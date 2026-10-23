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
        "No se pudo localizar el binario wpipe-engine. Las funciones avanzadas de compilación local estarán limitadas."
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
      "El motor nativo de WPipe (wpipe-engine) no está instalado. ¿Deseas descargarlo automáticamente para habilitar la compilación y depuración local?",
      "Descargar ahora",
      "Más tarde"
    );

    if (choice !== "Descargar ahora") {
      return null;
    }

    return vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "Descargando motor wpipe-engine desde Cloudflare Edge...",
        cancellable: false,
      },
      async (progress) => {
        try {
          fs.mkdirSync(path.dirname(targetPath), { recursive: true });
          progress.report({ increment: 10, message: "Obteniendo manifiesto de versiones..." });

          const manifestUrl = "https://api.wisrovi.dev/v1/downloads/latest";
          const manifestRes = await fetch(manifestUrl);
          if (!manifestRes.ok) {
            throw new Error(`Error HTTP al consultar manifiesto: ${manifestRes.status} ${manifestRes.statusText}`);
          }
          const manifest = (await manifestRes.json()) as any;

          const archKey = os.arch() === "arm64" ? "arm64" : "x64";
          const osKey = os.platform() === "darwin" ? "darwin" : os.platform() === "win32" ? "windows" : "linux";
          const targetKey = `${osKey}-${archKey}`;

          const entry = manifest.binaries?.[targetKey];
          if (!entry || !entry.binary_url) {
            throw new Error(`No se encontró un binario disponible para la arquitectura ${targetKey}`);
          }

          progress.report({ increment: 30, message: `Descargando binario (${entry.binary_filename || "wpipe-engine"})...` });

          const binaryRes = await fetch(entry.binary_url);
          if (!binaryRes.ok) {
            throw new Error(`Error HTTP al descargar binario: ${binaryRes.status} ${binaryRes.statusText}`);
          }

          const tmpPath = `${targetPath}.tmp`;
          const fileStream = fs.createWriteStream(tmpPath);
          const hasher = crypto.createHash("sha256");

          const reader = binaryRes.body?.getReader();
          if (!reader) {
            throw new Error("El cuerpo de la respuesta de descarga está vacío");
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

          progress.report({ increment: 30, message: "Verificando integridad criptográfica SHA-256..." });
          const calculatedSha256 = hasher.digest("hex");
          const expectedSha256 = entry.binary_sha256;

          if (expectedSha256 && calculatedSha256.toLowerCase() !== expectedSha256.toLowerCase()) {
            if (fs.existsSync(tmpPath)) {
              fs.unlinkSync(tmpPath);
            }
            throw new Error(
              `Fallo de verificación de integridad SHA-256. Esperado: ${expectedSha256}, Obtenido: ${calculatedSha256}`
            );
          }

          if (fs.existsSync(targetPath)) {
            fs.unlinkSync(targetPath);
          }
          fs.renameSync(tmpPath, targetPath);
          fs.chmodSync(targetPath, 0o755);

          progress.report({ increment: 30, message: "Instalación completada y verificada." });
          vscode.window.showInformationMessage(
            `Motor WPipe Engine instalado con éxito (SHA-256 verificado: ${calculatedSha256.slice(0, 8)}...).`
          );
          return targetPath;
        } catch (err: any) {
          // In offline development fallback or mock, create executable shell/python wrapper
          const devPath = path.resolve(__dirname, "../../daemon_os/wpipe_engine/main.py");
          if (fs.existsSync(devPath)) {
            const launcher = `#!/bin/sh\nexec python3 "${devPath}" "$@"\n`;
            fs.writeFileSync(targetPath, launcher, { mode: 0o755 });
            vscode.window.showWarningMessage(
              `Descarga fallida (${err.message}). Usando launcher de desarrollo local.`
            );
            return targetPath;
          }

          vscode.window.showErrorMessage(`Error al descargar wpipe-engine: ${err.message}`);
          return null;
        }
      }
    );
  }

  private async spawnDaemon(executablePath: string): Promise<boolean> {
    try {
      let proc: child_process.ChildProcess;
      if (executablePath.endsWith(".py")) {
        proc = child_process.spawn("python3", [executablePath, "daemon"], {
          detached: true,
          stdio: "ignore",
        });
      } else {
        proc = child_process.spawn(executablePath, ["daemon"], {
          detached: true,
          stdio: "ignore",
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
      vscode.window.showErrorMessage(`No se pudo iniciar el daemon wpipe-engine: ${e.message}`);
      return false;
    }
  }

  public stop(): void {
    if (this.daemonProcess && !this.daemonProcess.killed) {
      try {
        this.daemonProcess.kill();
      } catch {}
    }
  }
}
