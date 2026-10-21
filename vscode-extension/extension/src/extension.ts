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

  // 2. Register Custom Editor for *.wpipe and *.wpipe.json files
  context.subscriptions.push(WPipeCanvasEditorProvider.register(context, ipcClient));

  // 3. Register Sidebar Provider (Activity Bar)
  const sidebarProvider = new WPipeSidebarProvider(context, ipcClient);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(WPipeSidebarProvider.viewType, sidebarProvider)
  );

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

  async function updateStatusAndUi() {
    await updateStatusBar();
    await sidebarProvider.refresh();
  }

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
    vscode.commands.registerCommand("wpipe.activateLicense", async (keyArg?: string) => {
      const key =
        typeof keyArg === "string" && keyArg.trim().length >= 8
          ? keyArg.trim()
          : await vscode.window.showInputBox({
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
            await daemonManager.ensureDaemonRunning();
            const res = await ipcClient.activateLicense(key.trim());
            if (res.success) {
              vscode.window.showInformationMessage(`🎉 ${res.message}`);
              await updateStatusAndUi();
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

  // 5. Register URI Handler for 1-click activation: vscode://wisrovi.wpipe-studio-vscode/activate?key=...
  context.subscriptions.push(
    vscode.window.registerUriHandler({
      handleUri(uri: vscode.Uri): vscode.ProviderResult<void> {
        if (uri.path === "/activate") {
          const params = new URLSearchParams(uri.query);
          const key = params.get("key");
          if (key) {
            vscode.commands.executeCommand("wpipe.activateLicense", key);
          }
        }
      },
    })
  );

  // 6. Auto-start daemon and initial status check
  daemonManager.ensureDaemonRunning().then(() => {
    updateStatusAndUi();
  });
}

/**
 * Sidebar View Provider for Activity Bar
 */
class WPipeSidebarProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "wpipe.sidebarView";
  private _view?: vscode.WebviewView;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly ipcClient: EngineIpcClient
  ) {}

  public async resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): Promise<void> {
    this._view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
    };

    await this.refresh();

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
        case "copyToClipboard":
          if (msg.text) {
            vscode.env.clipboard.writeText(msg.text);
            vscode.window.showInformationMessage("📋 Clave de licencia copiada al portapapeles.");
          }
          break;
      }
    });
  }

  public async refresh(): Promise<void> {
    if (!this._view) return;
    try {
      const status = await this.ipcClient.getLicenseStatus();
      this._view.webview.html = this.getSidebarHtml(status);
    } catch {
      this._view.webview.html = this.getSidebarHtml({
        tier: "free",
        is_pro: false,
        max_blocks: 5,
        message: "Plan Free",
      });
    }
  }

  private getSidebarHtml(status?: any): string {
    const isPro = Boolean(status && status.is_pro);
    const rawTier = (status?.tier || "FREE").toUpperCase();
    const tierName = escapeHtml(rawTier);
    const rawKey = status?.license_key || "";
    const cleanKey = escapeHtml(rawKey);
    const maskedKey = escapeHtml(maskKey(rawKey));

    const licenseCard = isPro
      ? `
  <div class="card card-pro">
    <div class="status-header">
      <span class="pro-title">👑 Plan Activo: ${tierName}</span>
      <span class="online-pill"><span class="pulse-dot"></span> En Línea</span>
    </div>
    <div class="features-list">
      <div class="feat-item"><span class="feat-icon">✓</span> Bloques y pasos ilimitados</div>
      <div class="feat-item"><span class="feat-icon">✓</span> Puesto flotante en Cloudflare Edge</div>
    </div>
    ${cleanKey ? `
    <div class="key-box">
      <div class="key-label">CLAVE DE LICENCIA</div>
      <div class="key-row">
        <code id="licenseDisplay" class="masked-code" data-masked="${maskedKey}" data-real="${cleanKey}">${maskedKey}</code>
        <div class="key-actions">
          <button id="btnToggleMask" class="icon-btn" title="Mostrar / Ocultar clave" onclick="toggleMask()">👁️</button>
          <button id="btnCopyKey" class="icon-btn" title="Copiar clave completa" onclick="copyKey()">📋</button>
        </div>
      </div>
      <div id="copyToast" class="copy-toast" style="display: none;">✓ Copiada al portapapeles</div>
    </div>` : ""}
    <button class="btn btn-secondary" style="margin-top: 6px; font-size: 11px; padding: 5px 8px;" onclick="send('activateLicense')">
      🔄 Cambiar Licencia
    </button>
  </div>`
      : `
  <div class="card card-free">
    <div style="font-weight: 700; color: #fbbf24; font-size: 12px; display: flex; align-items: center; justify-content: space-between;">
      <span>⚡ Plan Activo: FREE</span>
      <span style="font-size: 9px; background: rgba(251, 191, 36, 0.15); color: #fbbf24; padding: 2px 6px; border-radius: 4px; font-weight: 700;">LIMITADO</span>
    </div>
    <div style="color: var(--vscode-descriptionForeground); font-size: 11px; margin-top: 2px;">
      Límite: Máximo 5 bloques por pipeline
    </div>
    <button class="btn" style="margin-top: 6px; background: linear-gradient(135deg, #d97706, #f59e0b); color: #1e1e1e; font-size: 11px; padding: 6px 8px; font-weight: 700;" onclick="send('activateLicense')">
      ⭐ Activar Licencia Pro
    </button>
  </div>`;

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
    .card-pro {
      border: 1px solid rgba(16, 185, 129, 0.4);
      background: rgba(16, 185, 129, 0.08);
    }
    .status-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .pro-title {
      font-weight: 800;
      color: #34d399;
      font-size: 12px;
      letter-spacing: 0.5px;
    }
    .online-pill {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      font-size: 10px;
      font-weight: 600;
      color: #34d399;
      background: rgba(16, 185, 129, 0.18);
      border: 1px solid rgba(16, 185, 129, 0.35);
      padding: 2px 7px;
      border-radius: 999px;
    }
    .pulse-dot {
      width: 6px;
      height: 6px;
      background-color: #10b981;
      border-radius: 50%;
      display: inline-block;
      box-shadow: 0 0 0 rgba(16, 185, 129, 0.4);
      animation: pulse 2s infinite;
    }
    @keyframes pulse {
      0% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.7); }
      70% { transform: scale(1); box-shadow: 0 0 0 6px rgba(16, 185, 129, 0); }
      100% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(16, 185, 129, 0); }
    }
    .features-list {
      display: flex;
      flex-direction: column;
      gap: 3px;
      margin-top: 4px;
    }
    .feat-item {
      font-size: 11px;
      color: var(--vscode-foreground);
      display: flex;
      align-items: center;
      gap: 5px;
    }
    .feat-icon {
      color: #34d399;
      font-weight: bold;
    }
    .key-box {
      background: rgba(0, 0, 0, 0.35);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 6px;
      padding: 6px 8px;
      margin-top: 6px;
    }
    .key-label {
      font-size: 9px;
      font-weight: 700;
      color: var(--vscode-descriptionForeground);
      letter-spacing: 0.5px;
      margin-bottom: 4px;
    }
    .key-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 6px;
    }
    .masked-code {
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 10.5px;
      color: #cbd5e1;
      letter-spacing: 0.8px;
      word-break: break-all;
    }
    .key-actions {
      display: flex;
      gap: 4px;
    }
    .icon-btn {
      background: rgba(255, 255, 255, 0.08);
      border: 1px solid rgba(255, 255, 255, 0.12);
      color: var(--vscode-foreground);
      border-radius: 4px;
      padding: 2px 5px;
      font-size: 11px;
      cursor: pointer;
      line-height: 1;
      transition: all 0.15s ease;
    }
    .icon-btn:hover {
      background: rgba(255, 255, 255, 0.18);
      border-color: rgba(255, 255, 255, 0.25);
    }
    .copy-toast {
      font-size: 9.5px;
      color: #34d399;
      margin-top: 4px;
      text-align: right;
      font-weight: 600;
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

  ${licenseCard}

  <script>
    const vscode = acquireVsCodeApi();
    function send(type, data = {}) {
      vscode.postMessage({ type: type, ...data });
    }

    let isMasked = true;
    function toggleMask() {
      const el = document.getElementById('licenseDisplay');
      const btn = document.getElementById('btnToggleMask');
      if (!el || !btn) return;
      if (isMasked) {
        el.textContent = el.getAttribute('data-real');
        btn.textContent = '🙈';
        btn.title = 'Ocultar clave';
        isMasked = false;
      } else {
        el.textContent = el.getAttribute('data-masked');
        btn.textContent = '👁️';
        btn.title = 'Mostrar clave';
        isMasked = true;
      }
    }

    function copyKey() {
      const el = document.getElementById('licenseDisplay');
      if (!el) return;
      const realKey = el.getAttribute('data-real');
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(realKey).then(() => {
          showToast();
        }).catch(() => {
          send('copyToClipboard', { text: realKey });
          showToast();
        });
      } else {
        send('copyToClipboard', { text: realKey });
        showToast();
      }
    }

    function showToast() {
      const toast = document.getElementById('copyToast');
      if (toast) {
        toast.style.display = 'block';
        setTimeout(() => { toast.style.display = 'none'; }, 2200);
      }
    }
  </script>
</body>
</html>`;
  }
}

function maskKey(key: string): string {
  if (!key) return "";
  const parts = key.split("-");
  if (parts.length >= 4) {
    const maskedParts = parts.map((part, index) => {
      if (index <= 1 || index === parts.length - 1) {
        return part;
      }
      return "••••";
    });
    return maskedParts.join("-");
  }
  if (key.length > 8) {
    return `${key.slice(0, 4)}-••••-••••-${key.slice(-4)}`;
  }
  return "••••••••";
}

function escapeHtml(text: string): string {
  if (typeof text !== "string") return "";
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function deactivate() {
  if (statusBarItem) {
    statusBarItem.dispose();
  }
}
