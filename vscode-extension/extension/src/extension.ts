/**
 * WPipe Studio VS Code Extension - Main Entrypoint
 * Provides Activity Bar Icon, Sidebar View, Commands, and Custom Canvas Editor.
 * Author: William Rodriguez (wisrovi.dev)
 */

import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
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
        statusBarItem.tooltip = `WPipe Studio ${status.tier.toUpperCase()} Active — Unlimited blocks`;
        statusBarItem.backgroundColor = undefined;
      } else {
        statusBarItem.text = `$(circuit-board) WPipe: Free (≤5)`;
        statusBarItem.tooltip = "WPipe Studio Free Plan (Max 5 blocks). Click to check status or upgrade.";
        statusBarItem.backgroundColor = new vscode.ThemeColor("statusBarItem.warningBackground");
      }
    } catch {
      statusBarItem.text = `$(warning) WPipe: Offline`;
      statusBarItem.tooltip = "wpipe-engine is offline. Click to start.";
    }
  }

  async function updateStatusAndUi() {
    await updateStatusBar();
    await sidebarProvider.refresh();
  }

  // 4. Register Commands
  context.subscriptions.push(
    vscode.commands.registerCommand("wpipe.openCanvas", async () => {
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
      await editorProvider.setupWebview(panel);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("wpipe.startDaemon", async () => {
      const ok = await daemonManager.ensureDaemonRunning();
      if (ok) {
        vscode.window.showInformationMessage("✅ Native wpipe-engine started and ready.");
      } else {
        vscode.window.showErrorMessage("❌ Failed to start wpipe-engine.");
      }
      await updateStatusBar();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("wpipe.checkLicenseStatus", async () => {
      const status = await ipcClient.getLicenseStatus();
      const options = status.is_pro
        ? ["OK"]
        : ["Activate Pro License", "Buy at wisrovi.dev", "Close"];

      const choice = await vscode.window.showInformationMessage(
        `WPipe Studio — ${status.message || "License Status"}`,
        ...options
      );

      if (choice === "Activate Pro License") {
        vscode.commands.executeCommand("wpipe.activateLicense");
      } else if (choice === "Buy at wisrovi.dev") {
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
              prompt: "Enter your WPipe Pro license key",
              placeHolder: "WPIPE-PRO-XXXX-XXXX-XXXX",
              validateInput: (text) => {
                if (!text || text.trim().length < 8) {
                  return "Please enter a valid license key.";
                }
                return null;
              },
            });

      if (!key) return;

      vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "Verifying license key with Cloudflare Edge (api.wisrovi.dev)...",
        },
        async () => {
          try {
            await daemonManager.ensureDaemonRunning();
            const res = await ipcClient.activateLicense(key.trim());
            if (res.success) {
              vscode.window.showInformationMessage(`🎉 ${res.message}`);
              await updateStatusAndUi();
            } else {
              vscode.window.showErrorMessage(`❌ Activation failed: ${res.message}`);
            }
          } catch (e: any) {
            vscode.window.showErrorMessage(`Error communicating with wpipe-engine: ${e.message}`);
          }
        }
      );
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("wpipe.newPipeline", async () => {
      const wsFolder = vscode.workspace.workspaceFolders?.[0];
      if (!wsFolder) {
        vscode.window.showWarningMessage("Open a workspace folder first to create a pipeline.");
        return;
      }

      const defaultUri = vscode.Uri.file(path.join(wsFolder.uri.fsPath, "pipeline.wpipe"));
      const targetUri = await vscode.window.showSaveDialog({
        defaultUri,
        filters: { "WPipe Pipeline": ["wpipe"] },
      });

      if (!targetUri) return;

      const initialIr = {
        format: "wpipe",
        project: {
          id: `proj_${Date.now()}`,
          name: path.basename(targetUri.fsPath, ".wpipe"),
          protocol: "fastapi",
          docker_image: "python:3.11-slim",
          canvas_ir: {
            nodes: [
              { id: "node_1", data: { node_type: "trigger", label: "Trigger REST (/run)" } },
              { id: "node_2", data: { node_type: "step", label: "HttpRequest" } },
            ],
          },
        },
      };

      await vscode.workspace.fs.writeFile(
        targetUri,
        Buffer.from(JSON.stringify(initialIr, null, 2), "utf8")
      );
      await vscode.commands.executeCommand("vscode.openWith", targetUri, WPipeCanvasEditorProvider.viewType);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("wpipe.compileCurrentPipeline", async (uri?: vscode.Uri) => {
      let targetUri = uri;
      if (!targetUri) {
        const activeEditor = vscode.window.activeTextEditor;
        if (
          activeEditor &&
          (activeEditor.document.fileName.endsWith(".wpipe") ||
            activeEditor.document.fileName.endsWith(".wpipe.json"))
        ) {
          targetUri = activeEditor.document.uri;
        }
      }

      if (!targetUri) {
        const files = await vscode.workspace.findFiles("**/*.{wpipe,wpipe.json}", "**/node_modules/**", 10);
        if (files.length === 0) {
          vscode.window.showWarningMessage("No .wpipe or .wpipe.json pipeline files found in current workspace.");
          return;
        }
        const items = files.map((f) => ({
          label: path.basename(f.fsPath),
          uri: f,
          description: vscode.workspace.asRelativePath(f),
        }));
        const selected = await vscode.window.showQuickPick(items, {
          placeHolder: "Select a pipeline file to compile to Python",
        });
        if (!selected) return;
        targetUri = selected.uri;
      }

      try {
        const rawBytes = await vscode.workspace.fs.readFile(targetUri);
        const text = Buffer.from(rawBytes).toString("utf8");
        const parsed = text ? JSON.parse(text) : {};
        const projectName = path.basename(targetUri.fsPath, path.extname(targetUri.fsPath));
        await daemonManager.ensureDaemonRunning();
        const canvasPayload =
          parsed.canvas_ir || (parsed.project && parsed.project.canvas_ir) || parsed;
        const res = await ipcClient.compilePipeline(canvasPayload, projectName);

        if (res.error === "LIMIT_EXCEEDED") {
          const action = await vscode.window.showWarningMessage(
            `⚠️ ${res.message}`,
            "Upgrade to WPipe Pro",
            "Dismiss"
          );
          if (action === "Upgrade to WPipe Pro") {
            vscode.env.openExternal(vscode.Uri.parse(res.details?.upgrade_url || "https://wisrovi.dev"));
          }
        } else if (res.status === "success" && (res.files_dict || res.files)) {
          const wsFolder =
            vscode.workspace.getWorkspaceFolder(targetUri) || vscode.workspace.workspaceFolders?.[0];
          if (wsFolder) {
            const filesMap: Record<string, string> = res.files_dict || {};
            if (!res.files_dict && Array.isArray(res.files)) {
              for (const item of res.files) {
                if (item && item.path && item.content) {
                  filesMap[item.path] = item.content;
                }
              }
            }
            for (const [relPath, content] of Object.entries(filesMap)) {
              const fileUri = vscode.Uri.file(path.join(wsFolder.uri.fsPath, relPath));
              await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(fileUri.fsPath)));
              await vscode.workspace.fs.writeFile(fileUri, Buffer.from(content as string, "utf8"));
            }
            vscode.window.showInformationMessage(`✅ Pipeline successfully compiled to Python (${projectName})`);
            const mainPipeUri = vscode.Uri.file(path.join(wsFolder.uri.fsPath, "app", "pipelines.py"));
            if (fs.existsSync(mainPipeUri.fsPath)) {
              vscode.window.showTextDocument(mainPipeUri);
            }
          }
        } else {
          vscode.window.showErrorMessage(`❌ Compilation failed: ${res.message || "Unknown error"}`);
        }
      } catch (err: any) {
        vscode.window.showErrorMessage(`Error compiling pipeline: ${err.message}`);
      }
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
        case "openPortal":
          vscode.env.openExternal(vscode.Uri.parse("https://portal.wisrovi.dev"));
          break;
        case "restartDaemon":
          vscode.commands.executeCommand("wpipe.startDaemon");
          break;
        case "copyToClipboard":
          if (msg.text) {
            vscode.env.clipboard.writeText(msg.text);
            vscode.window.showInformationMessage("📋 License key copied to clipboard.");
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
        message: "Free Plan",
      });
    }
  }

  private getSidebarHtml(status?: any): string {
    const isPro = Boolean(status && status.is_pro);
    const rawTier = (status?.tier || "FREE").toUpperCase();
    const tierName = escapeHtml(rawTier);
    const customerName = status?.customer_name ? escapeHtml(status.customer_name) : "Developer";
    const rawKey = status?.license_key || "";
    const cleanKey = escapeHtml(rawKey);
    const maskedKey = escapeHtml(maskKey(rawKey));
    const rawMfp = status?.machine_fingerprint || "";
    const shortMfp = escapeHtml(formatFingerprint(rawMfp));
    const expInfo = formatExpiration(status?.lease_expires_at);

    // Engine metadata
    const enginePid = status?.engine?.pid ? escapeHtml(String(status.engine.pid)) : "Active";
    const pythonVer = status?.engine?.python_version ? escapeHtml(status.engine.python_version) : "3.13";
    const transportType = status?.engine?.transport === "unix_socket" ? "Unix Socket (/tmp/wpipe.sock)" : "HTTP Local (127.0.0.1:49152)";

    const licenseCard = isPro
      ? `
  <div class="card card-pro">
    <div class="status-header">
      <div class="tier-pill">
        <span class="crown">👑</span>
        <span class="tier-text">PLAN ${tierName}</span>
      </div>
      <span class="online-pill" title="Seat synchronized and verified with Cloudflare Edge">
        <span class="pulse-dot"></span> Active Seat
      </span>
    </div>

    <div class="meta-section">
      <div class="meta-row">
        <span class="meta-k">👤 Licensee:</span>
        <span class="meta-v font-bold">${customerName}</span>
      </div>
      <div class="meta-row">
        <span class="meta-k">📅 Validity:</span>
        <span class="meta-v ${expInfo.isNear ? 'text-warning' : 'text-success'}">
          ${escapeHtml(expInfo.formatted)} <span class="days-text">${escapeHtml(expInfo.daysLeftText)}</span>
        </span>
      </div>
      <div class="meta-row">
        <span class="meta-k">🖥️ Machine ID:</span>
        <span class="meta-v font-mono" title="Hardware fingerprint: ${escapeHtml(rawMfp)}">${shortMfp}</span>
      </div>
    </div>

    ${cleanKey ? `
    <div class="key-box">
      <div class="key-header">
        <span class="key-label">ASSIGNED KEY</span>
        <span class="key-shield">🔒 Protected</span>
      </div>
      <div class="key-row">
        <code id="licenseDisplay" class="masked-code" data-masked="${maskedKey}" data-real="${cleanKey}">${maskedKey}</code>
        <div class="key-actions">
          <button id="btnToggleMask" class="icon-btn" title="Show / hide key" onclick="toggleMask()">👁️</button>
          <button id="btnCopyKey" class="icon-btn" title="Copy full key" onclick="copyKey()">📋</button>
        </div>
      </div>
      <div id="copyToast" class="copy-toast" style="display: none;">✓ Copied to clipboard</div>
    </div>` : ""}

    <div class="capabilities-box">
      <div class="cap-title">Environment Capabilities:</div>
      <div class="cap-grid">
        <div class="cap-item"><span class="check">✓</span> Unlimited Blocks</div>
        <div class="cap-item"><span class="check">✓</span> Concurrency (Parallel)</div>
        <div class="cap-item"><span class="check">✓</span> Async Background</div>
        <div class="cap-item"><span class="check">✓</span> Live Debugging</div>
        <div class="cap-item"><span class="check">✓</span> Smart AST Merge</div>
        <div class="cap-item"><span class="check">✓</span> Docker & Test Gen</div>
      </div>
    </div>

    <div class="card-btn-row">
      <button class="btn btn-secondary btn-sm" onclick="send('activateLicense')" title="Change key or switch seat">
        🔄 Change License
      </button>
      <button class="btn btn-secondary btn-sm" onclick="send('openPortal')" title="Open web customer portal">
        🌐 Manage Seats
      </button>
    </div>
  </div>`
      : `
  <div class="card card-free">
    <div class="status-header">
      <div class="tier-pill-free">
        <span>⚡ PLAN FREE (Community)</span>
      </div>
      <span class="limited-pill">Max 5 blocks</span>
    </div>

    <p class="free-info">
      You are running the local Community plan. Ideal for testing and smaller pipelines.
    </p>

    <div class="limits-box">
      <div class="limit-row"><span class="limit-check">✓</span> Up to 5 blocks per pipeline</div>
      <div class="limit-row text-muted"><span class="limit-cross">✕</span> Concurrency (Parallel) locked</div>
      <div class="limit-row text-muted"><span class="limit-cross">✕</span> Background tasks locked</div>
      <div class="limit-row text-muted"><span class="limit-cross">✕</span> Breakpoints & live debugging</div>
    </div>

    <button class="btn btn-upgrade" onclick="send('activateLicense')">
      ⭐ Activate Pro License
    </button>
  </div>`;

    return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <style>
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      padding: 12px;
      color: var(--vscode-foreground);
      background: var(--vscode-sideBar-background);
      display: flex;
      flex-direction: column;
      gap: 12px;
      line-height: 1.4;
    }
    .header {
      display: flex;
      align-items: center;
      gap: 10px;
      padding-bottom: 10px;
      border-bottom: 1px solid var(--vscode-widget-border, rgba(255, 255, 255, 0.1));
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
      box-shadow: 0 4px 12px rgba(2, 132, 199, 0.35);
      flex-shrink: 0;
    }
    .title-row {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .title {
      font-size: 13px;
      font-weight: 700;
      color: var(--vscode-foreground);
    }
    .version-tag {
      font-size: 9px;
      font-weight: 700;
      background: rgba(2, 132, 199, 0.2);
      color: #38bdf8;
      padding: 1px 5px;
      border-radius: 4px;
      border: 1px solid rgba(56, 189, 248, 0.3);
    }
    .subtitle {
      font-size: 10.5px;
      color: var(--vscode-descriptionForeground);
    }
    .btn {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
      padding: 8px 12px;
      border-radius: 5px;
      cursor: pointer;
      font-size: 11.5px;
      font-weight: 600;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      width: 100%;
      transition: all 0.15s ease;
    }
    .btn:hover {
      background: var(--vscode-button-hoverBackground);
    }
    .btn-primary {
      background: linear-gradient(135deg, #0284c7, #0369a1);
      box-shadow: 0 2px 6px rgba(2, 132, 199, 0.3);
    }
    .btn-primary:hover {
      background: linear-gradient(135deg, #0369a1, #075985);
    }
    .btn-secondary {
      background: var(--vscode-button-secondaryBackground, #2d2d2d);
      color: var(--vscode-button-secondaryForeground, #ccc);
    }
    .btn-secondary:hover {
      background: var(--vscode-button-secondaryHoverBackground, #3a3a3a);
    }
    .btn-sm {
      padding: 5px 8px;
      font-size: 10.5px;
    }
    .btn-upgrade {
      background: linear-gradient(135deg, #d97706, #f59e0b);
      color: #111;
      font-weight: 700;
      padding: 8px;
    }
    .btn-upgrade:hover {
      background: linear-gradient(135deg, #b45309, #d97706);
    }
    .btn-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 6px;
    }
    .card {
      background: rgba(255, 255, 255, 0.03);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 7px;
      padding: 10px;
      display: flex;
      flex-direction: column;
      gap: 8px;
      font-size: 11px;
    }
    .card-pro {
      border: 1px solid rgba(16, 185, 129, 0.35);
      background: linear-gradient(180deg, rgba(16, 185, 129, 0.08) 0%, rgba(16, 185, 129, 0.02) 100%);
    }
    .card-free {
      border: 1px solid rgba(245, 158, 11, 0.3);
      background: rgba(245, 158, 11, 0.04);
    }
    .status-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 6px;
    }
    .tier-pill {
      display: flex;
      align-items: center;
      gap: 4px;
      font-weight: 800;
      color: #34d399;
      font-size: 11.5px;
      letter-spacing: 0.5px;
    }
    .tier-pill-free {
      font-weight: 700;
      color: #fbbf24;
      font-size: 11.5px;
    }
    .online-pill {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      font-size: 9.5px;
      font-weight: 600;
      color: #34d399;
      background: rgba(16, 185, 129, 0.15);
      border: 1px solid rgba(16, 185, 129, 0.3);
      padding: 2px 6px;
      border-radius: 999px;
    }
    .limited-pill {
      font-size: 9.5px;
      color: #fbbf24;
      background: rgba(251, 191, 36, 0.12);
      border: 1px solid rgba(251, 191, 36, 0.25);
      padding: 2px 6px;
      border-radius: 999px;
      font-weight: 600;
    }
    .pulse-dot {
      width: 6px;
      height: 6px;
      background-color: #10b981;
      border-radius: 50%;
      display: inline-block;
      animation: pulse 2s infinite;
    }
    @keyframes pulse {
      0% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.7); }
      70% { transform: scale(1); box-shadow: 0 0 0 5px rgba(16, 185, 129, 0); }
      100% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(16, 185, 129, 0); }
    }
    .meta-section {
      display: flex;
      flex-direction: column;
      gap: 3px;
      background: rgba(0, 0, 0, 0.2);
      padding: 6px 8px;
      border-radius: 5px;
      border: 1px solid rgba(255, 255, 255, 0.05);
    }
    .meta-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-size: 10.5px;
    }
    .meta-k {
      color: var(--vscode-descriptionForeground);
    }
    .meta-v {
      color: var(--vscode-foreground);
    }
    .font-bold {
      font-weight: 700;
    }
    .font-mono {
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 10px;
    }
    .text-success {
      color: #34d399;
      font-weight: 600;
    }
    .text-warning {
      color: #fbbf24;
      font-weight: 600;
    }
    .text-muted {
      color: var(--vscode-descriptionForeground);
    }
    .days-text {
      font-size: 9.5px;
      opacity: 0.85;
    }
    .key-box {
      background: rgba(0, 0, 0, 0.35);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 5px;
      padding: 6px 8px;
    }
    .key-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 4px;
    }
    .key-label {
      font-size: 9px;
      font-weight: 700;
      color: var(--vscode-descriptionForeground);
      letter-spacing: 0.5px;
    }
    .key-shield {
      font-size: 9px;
      color: #38bdf8;
      background: rgba(56, 189, 248, 0.12);
      padding: 1px 4px;
      border-radius: 3px;
    }
    .key-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 6px;
    }
    .masked-code {
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 10px;
      color: #cbd5e1;
      letter-spacing: 0.6px;
      word-break: break-all;
    }
    .key-actions {
      display: flex;
      gap: 3px;
      flex-shrink: 0;
    }
    .icon-btn {
      background: rgba(255, 255, 255, 0.08);
      border: 1px solid rgba(255, 255, 255, 0.12);
      color: var(--vscode-foreground);
      border-radius: 4px;
      padding: 2px 5px;
      font-size: 10px;
      cursor: pointer;
      line-height: 1.2;
      transition: all 0.15s ease;
    }
    .icon-btn:hover {
      background: rgba(255, 255, 255, 0.2);
    }
    .copy-toast {
      font-size: 9.5px;
      color: #34d399;
      margin-top: 3px;
      text-align: right;
      font-weight: 600;
    }
    .capabilities-box {
      border-top: 1px solid rgba(255, 255, 255, 0.06);
      padding-top: 6px;
    }
    .cap-title {
      font-size: 9.5px;
      font-weight: 700;
      color: var(--vscode-descriptionForeground);
      margin-bottom: 4px;
      letter-spacing: 0.3px;
    }
    .cap-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 3px 6px;
      font-size: 10px;
    }
    .cap-item {
      display: flex;
      align-items: center;
      gap: 4px;
      color: var(--vscode-foreground);
    }
    .check {
      color: #34d399;
      font-weight: 700;
      font-size: 11px;
    }
    .card-btn-row {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 6px;
      margin-top: 2px;
    }
    .free-info {
      font-size: 10.5px;
      color: var(--vscode-descriptionForeground);
      line-height: 1.4;
    }
    .limits-box {
      display: flex;
      flex-direction: column;
      gap: 3px;
      font-size: 10.5px;
    }
    .limit-row {
      display: flex;
      align-items: center;
      gap: 5px;
    }
    .limit-check {
      color: #fbbf24;
      font-weight: bold;
    }
    .limit-cross {
      color: #ef4444;
      font-weight: bold;
    }
    .tech-details {
      background: rgba(0, 0, 0, 0.15);
      border: 1px solid rgba(255, 255, 255, 0.06);
      border-radius: 6px;
      padding: 6px 8px;
      font-size: 10.5px;
    }
    .tech-summary {
      font-weight: 600;
      cursor: pointer;
      color: var(--vscode-foreground);
      font-size: 10.5px;
      outline: none;
      user-select: none;
    }
    .tech-content {
      margin-top: 6px;
      display: flex;
      flex-direction: column;
      gap: 3px;
      border-top: 1px solid rgba(255, 255, 255, 0.04);
      padding-top: 6px;
    }
    .tech-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .tech-k {
      color: var(--vscode-descriptionForeground);
      font-size: 10px;
    }
    .tech-v {
      font-size: 10px;
    }
    .text-accent {
      color: #38bdf8;
      font-weight: 600;
    }
  </style>
</head>
<body>
  <div class="header">
    <div class="logo">W</div>
    <div>
      <div class="title-row">
        <span class="title">WPipe Studio</span>
        <span class="version-tag">v1.0.0</span>
      </div>
      <div class="subtitle">Visual Pipeline Orchestrator</div>
    </div>
  </div>

  <button class="btn btn-primary" onclick="send('openCanvas')">
    🚀 Open Block Canvas
  </button>

  <div class="btn-grid">
    <button class="btn btn-secondary btn-sm" onclick="send('newPipeline')">
      ➕ New Pipeline
    </button>
    <button class="btn btn-secondary btn-sm" onclick="send('openDemo')">
      📂 Official Demo
    </button>
  </div>

  ${licenseCard}

  <details class="tech-details" open>
    <summary class="tech-summary">⚙️ Local Engine & Environment</summary>
    <div class="tech-content">
      <div class="tech-row">
        <span class="tech-k">Engine Status:</span>
        <span class="tech-v text-success">● Active (PID: ${enginePid})</span>
      </div>
      <div class="tech-row">
        <span class="tech-k">Python Runtime:</span>
        <span class="tech-v font-mono">${pythonVer}</span>
      </div>
      <div class="tech-row">
        <span class="tech-k">IPC Channel:</span>
        <span class="tech-v font-mono" title="${transportType}">${transportType.includes("Unix") ? "Unix Socket" : "HTTP Local"}</span>
      </div>
      <div class="tech-row">
        <span class="tech-k">Steps Catalog:</span>
        <span class="tech-v text-accent">196 official steps</span>
      </div>
      <button class="btn btn-secondary btn-sm" style="margin-top: 4px;" onclick="send('restartDaemon')">
        🔄 Restart Local Engine
      </button>
    </div>
  </details>

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
        btn.title = 'Hide key';
        isMasked = false;
      } else {
        el.textContent = el.getAttribute('data-masked');
        btn.textContent = '👁️';
        btn.title = 'Show real key';
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

function formatExpiration(isoDate?: string): { formatted: string; daysLeftText: string; isNear: boolean } {
  if (!isoDate) {
    return { formatted: "Permanent / Lifetime", daysLeftText: "♾️", isNear: false };
  }
  try {
    const d = new Date(isoDate);
    if (isNaN(d.getTime())) {
      return { formatted: isoDate, daysLeftText: "", isNear: false };
    }
    const now = new Date();
    const diffMs = d.getTime() - now.getTime();
    const daysLeft = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
    const day = String(d.getDate()).padStart(2, "0");
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const year = d.getFullYear();
    const formatted = `${day}/${month}/${year}`;
    if (daysLeft < 0) {
      return { formatted, daysLeftText: `(Expired ${Math.abs(daysLeft)}d ago)`, isNear: true };
    } else if (daysLeft === 0) {
      return { formatted, daysLeftText: "(Expires today)", isNear: true };
    } else {
      return { formatted, daysLeftText: `(${daysLeft}d left)`, isNear: daysLeft <= 15 };
    }
  } catch {
    return { formatted: isoDate, daysLeftText: "", isNear: false };
  }
}

function formatFingerprint(fp?: string): string {
  if (!fp) return "Local-Hardware";
  if (fp.length > 16) {
    return `${fp.slice(0, 8)}...${fp.slice(-6)}`;
  }
  return fp;
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
