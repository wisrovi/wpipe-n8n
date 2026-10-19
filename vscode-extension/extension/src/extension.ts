/**
 * WPipe Studio VS Code Extension - Main Entrypoint
 * Author: William Rodriguez (wisrovi.dev)
 */

import * as vscode from "vscode";
import * as path from "path";
import { EngineIpcClient } from "./ipcClient";
import { DaemonManager } from "./daemonManager";
import { WPipeCanvasEditorProvider } from "./customEditor";

let statusBarItem: vscode.StatusBarItem;

export async function activate(context: vscode.ExtensionContext) {
  const ipcClient = new EngineIpcClient();
  const daemonManager = new DaemonManager(context, ipcClient);

  // 1. Status Bar Indicator
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.command = "wpipe.checkLicenseStatus";
  context.subscriptions.push(statusBarItem);
  statusBarItem.show();

  async function updateStatusBar() {
    try {
      const status = await ipcClient.getLicenseStatus();
      if (status.is_pro) {
        statusBarItem.text = `$(check) WPipe: ${status.tier.toUpperCase()}`;
        statusBarItem.tooltip = `WPipe Studio ${status.tier.toUpperCase()} Activo — Bloques ilimitados`;
        statusBarItem.backgroundColor = undefined;
      } else {
        statusBarItem.text = `$(circuit-board) WPipe: Free (≤5)`;
        statusBarItem.tooltip = "WPipe Studio Plan Free (Máx 5 bloques). Clic para ver estado o actualizar.";
        statusBarItem.backgroundColor = new vscode.ThemeColor("statusBarItem.warningBackground");
      }
    } catch {
      statusBarItem.text = `$(warning) WPipe: Offline`;
      statusBarItem.tooltip = "wpipe-engine no responde. Clic para iniciar.";
    }
  }

  // 2. Register Custom Editor for *.wpipe and *.wpipe.json files
  context.subscriptions.push(WPipeCanvasEditorProvider.register(context, ipcClient));

  // 3. Register Commands
  context.subscriptions.push(
    vscode.commands.registerCommand("wpipe.startDaemon", async () => {
      const ok = await daemonManager.ensureDaemonRunning();
      if (ok) {
        vscode.window.showInformationMessage("✅ Motor nativo wpipe-engine iniciado y listo.");
      } else {
        vscode.window.showErrorMessage("❌ No se pudo iniciar el motor wpipe-engine.");
      }
      await updateStatusBar();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("wpipe.checkLicenseStatus", async () => {
      const status = await ipcClient.getLicenseStatus();
      const options = status.is_pro
        ? ["Aceptar"]
        : ["Activar Licencia Pro", "Comprar en wisrovi.dev", "Cerrar"];

      const choice = await vscode.window.showInformationMessage(
        `WPipe Studio — ${status.message}`,
        ...options
      );

      if (choice === "Activar Licencia Pro") {
        vscode.commands.executeCommand("wpipe.activateLicense");
      } else if (choice === "Comprar en wisrovi.dev") {
        vscode.env.openExternal(vscode.Uri.parse("https://wisrovi.dev"));
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("wpipe.activateLicense", async () => {
      const key = await vscode.window.showInputBox({
        prompt: "Introduce tu clave de licencia WPipe Pro",
        placeHolder: "WPIPE-PRO-XXXX-XXXX-XXXX",
        validateInput: (text) => {
          if (!text || text.trim().length < 8) {
            return "Introduce una clave de licencia válida.";
          }
          return null;
        },
      });

      if (!key) return;

      vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "Verificando clave de licencia con Cloudflare Edge (api.wisrovi.dev)...",
        },
        async () => {
          try {
            const res = await ipcClient.activateLicense(key.trim());
            if (res.success) {
              vscode.window.showInformationMessage(`🎉 ${res.message}`);
              await updateStatusBar();
            } else {
              vscode.window.showErrorMessage(`❌ Error de activación: ${res.message}`);
            }
          } catch (e: any) {
            vscode.window.showErrorMessage(`Error al contactar con wpipe-engine: ${e.message}`);
          }
        }
      );
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("wpipe.newPipeline", async () => {
      const wsFolder = vscode.workspace.workspaceFolders?.[0];
      if (!wsFolder) {
        vscode.window.showWarningMessage("Abre una carpeta de proyecto para crear un pipeline.");
        return;
      }

      const defaultUri = vscode.Uri.file(path.join(wsFolder.uri.fsPath, "pipeline.wpipe"));
      const targetUri = await vscode.window.showSaveDialog({
        defaultUri,
        filters: { "WPipe Pipeline": ["wpipe"] },
      });

      if (!targetUri) return;

      const initialIr = {
        nodes: [
          { id: "node_1", data: { node_type: "trigger", label: "Trigger REST (/run)" } },
          { id: "node_2", data: { node_type: "step", label: "HttpRequest" } },
        ],
      };

      await vscode.workspace.fs.writeFile(
        targetUri,
        Buffer.from(JSON.stringify(initialIr, null, 2), "utf8")
      );
      await vscode.commands.executeCommand("vscode.openWith", targetUri, WPipeCanvasEditorProvider.viewType);
    })
  );

  // 4. Auto-start daemon and initial status check
  daemonManager.ensureDaemonRunning().then(() => {
    updateStatusBar();
  });
}

export function deactivate() {
  if (statusBarItem) {
    statusBarItem.dispose();
  }
}
