/**
 * WPipe Studio VS Code Extension - Main Entrypoint
 * Provides Activity Bar Icon, Sidebar View, Commands, and Custom Canvas Editor.
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
  const editorProvider = new WPipeCanvasEditorProvider(context, ipcClient);

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

  // 3. Register Sidebar Provider (Activity Bar)
  const sidebarProvider = new WPipeSidebarProvider(context, ipcClient);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(WPipeSidebarProvider.viewType, sidebarProvider)
  );

  // 4. Register Commands
  context.subscriptions.push(
    vscode.commands.registerCommand("wpipe.openCanvas", () => {
      const panel = vscode.window.createWebviewPanel(
        "wpipe.fullCanvas",
        "WPipe Studio — Visual IDE",
        vscode.ViewColumn.One,
        {
          enableScripts: true,
          retainContextWhenHidden: true,
        }
      );
      panel.iconPath = vscode.Uri.file(path.join(context.extensionPath, "media", "icon.svg"));
      panel.webview.html = editorProvider.getHtmlForWebview(panel.webview);
    })
  );

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

  // 5. Auto-start daemon and initial status check
  daemonManager.ensureDaemonRunning().then(() => {
    updateStatusBar();
  });
}

/**
 * Sidebar View Provider for Activity Bar
 */
class WPipeSidebarProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "wpipe.sidebarView";

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly ipcClient: EngineIpcClient
  ) {}

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    webviewView.webview.options = {
      enableScripts: true,
    };

    webviewView.webview.html = this.getSidebarHtml();

    webviewView.webview.onDidReceiveMessage((msg) => {
      switch (msg.type) {
        case "openCanvas":
          vscode.commands.executeCommand("wpipe.openCanvas");
          break;
        case "newPipeline":
          vscode.commands.executeCommand("wpipe.newPipeline");
          break;
        case "openDemo":
          const demoUri = vscode.Uri.file(
            path.join(this.context.extensionPath, "..", "demo_pipeline.wpipe")
          );
          vscode.commands.executeCommand("vscode.openWith", demoUri, WPipeCanvasEditorProvider.viewType);
          break;
        case "checkLicense":
          vscode.commands.executeCommand("wpipe.checkLicenseStatus");
          break;
        case "activateLicense":
          vscode.commands.executeCommand("wpipe.activateLicense");
          break;
      }
    });
  }

  private getSidebarHtml(): string {
    return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      padding: 14px;
      color: var(--vscode-foreground);
      background: var(--vscode-sideBar-background);
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .header {
      display: flex;
      align-items: center;
      gap: 10px;
      padding-bottom: 12px;
      border-bottom: 1px solid var(--vscode-widget-border, #333);
    }
    .logo {
      width: 32px;
      height: 32px;
      background: linear-gradient(135deg, #0284c7, #38bdf8);
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      color: white;
      font-weight: 800;
      font-size: 16px;
      box-shadow: 0 4px 12px rgba(2, 132, 199, 0.3);
    }
    .title {
      font-size: 13px;
      font-weight: 700;
      color: var(--vscode-foreground);
    }
    .subtitle {
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
    }
    .btn {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
      padding: 9px 12px;
      border-radius: 5px;
      cursor: pointer;
      font-size: 12px;
      font-weight: 600;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      width: 100%;
      transition: background 0.15s ease;
    }
    .btn:hover {
      background: var(--vscode-button-hoverBackground);
    }
    .btn-secondary {
      background: var(--vscode-button-secondaryBackground, #2d2d2d);
      color: var(--vscode-button-secondaryForeground, #ccc);
    }
    .card {
      background: rgba(255, 255, 255, 0.04);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 6px;
      padding: 12px;
      display: flex;
      flex-direction: column;
      gap: 6px;
      font-size: 11px;
    }
  </style>
</head>
<body>
  <div class="header">
    <div class="logo">W</div>
    <div>
      <div class="title">WPipe Studio</div>
      <div class="subtitle">Visual Pipeline Designer</div>
    </div>
  </div>

  <button class="btn" onclick="send('openCanvas')">
    🚀 Abrir WPipe Studio (Full Canvas)
  </button>

  <button class="btn btn-secondary" onclick="send('newPipeline')">
    ➕ Crear Nuevo Pipeline (.wpipe)
  </button>

  <button class="btn btn-secondary" onclick="send('openDemo')">
    📂 Abrir Pipeline de Ejemplo
  </button>

  <div class="card">
    <div style="font-weight: 700; color: #fbbf24; font-size: 12px;">⚡ Plan Activo: FREE</div>
    <div style="color: var(--vscode-descriptionForeground);">Límite: Máximo 5 bloques por pipeline</div>
    <button class="btn" style="margin-top: 6px; background: linear-gradient(135deg, #d97706, #f59e0b); color: #1e1e1e; font-size: 11px; padding: 6px 8px; font-weight: 700;" onclick="send('activateLicense')">
      ⭐ Activar Licencia Pro
    </button>
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    function send(type) {
      vscode.postMessage({ type: type });
    }
  </script>
</body>
</html>`;
  }
}

export function deactivate() {
  if (statusBarItem) {
    statusBarItem.dispose();
  }
}
