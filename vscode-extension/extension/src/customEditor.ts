/**
 * Custom Text Editor Provider for Visual WPipe Canvas (.wpipe files)
 * Author: William Rodriguez (wisrovi.dev)
 */

import * as vscode from "vscode";
import * as path from "path";
import { EngineIpcClient } from "./ipcClient";

export class WPipeCanvasEditorProvider implements vscode.CustomTextEditorProvider {
  public static readonly viewType = "wpipe.canvasEditor";

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly ipcClient: EngineIpcClient
  ) {}

  public static register(
    context: vscode.ExtensionContext,
    ipcClient: EngineIpcClient
  ): vscode.Disposable {
    const provider = new WPipeCanvasEditorProvider(context, ipcClient);
    return vscode.window.registerCustomEditorProvider(
      WPipeCanvasEditorProvider.viewType,
      provider,
      {
        webviewOptions: {
          retainContextWhenHidden: true,
        },
        supportsMultipleEditorsPerDocument: false,
      }
    );
  }

  public async resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken
  ): Promise<void> {
    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.file(path.join(this.context.extensionPath, "media")),
        vscode.Uri.file(path.join(this.context.extensionPath, "dist")),
      ],
    };

    const licenseStatus = await this.ipcClient.getLicenseStatus();
    webviewPanel.webview.html = this.getHtmlForWebview(webviewPanel.webview, document, licenseStatus);

    // Synchronize initial document content
    const sendInitialData = () => {
      let docContent = {};
      try {
        docContent = document.getText() ? JSON.parse(document.getText()) : {};
      } catch {}

      webviewPanel.webview.postMessage({
        type: "init",
        data: docContent,
        license: licenseStatus,
        documentUri: document.uri.toString(),
      });
    };

    sendInitialData();

    // Listen to changes in the text document
    const changeDocumentSubscription = vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.uri.toString() === document.uri.toString()) {
        try {
          const updatedJson = JSON.parse(document.getText());
          webviewPanel.webview.postMessage({
            type: "update",
            data: updatedJson,
          });
        } catch {}
      }
    });

    // Listen to messages from the Webview
    webviewPanel.webview.onDidReceiveMessage(async (msg) => {
      switch (msg.type) {
        case "saveCanvas": {
          const edit = new vscode.WorkspaceEdit();
          edit.replace(
            document.uri,
            new vscode.Range(0, 0, document.lineCount, 0),
            JSON.stringify(msg.canvasIr, null, 2)
          );
          await vscode.workspace.applyEdit(edit);
          break;
        }

        case "compile": {
          const projectName = path.basename(document.uri.fsPath, path.extname(document.uri.fsPath));
          const res = await this.ipcClient.compilePipeline(msg.canvasIr, projectName);

          if (res.error === "LIMIT_EXCEEDED") {
            const action = await vscode.window.showWarningMessage(
              `⚠️ ${res.message}`,
              "Actualizar a WPipe Pro",
              "Entendido"
            );
            if (action === "Actualizar a WPipe Pro") {
              vscode.env.openExternal(vscode.Uri.parse(res.details?.upgrade_url || "https://wisrovi.dev"));
            }
            webviewPanel.webview.postMessage({
              type: "compileError",
              error: res,
            });
          } else if (res.status === "success" && res.files) {
            // Write generated files into workspace directory
            const wsFolder = vscode.workspace.getWorkspaceFolder(document.uri);
            if (wsFolder) {
              for (const [relPath, content] of Object.entries(res.files)) {
                const targetUri = vscode.Uri.file(path.join(wsFolder.uri.fsPath, relPath));
                await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(targetUri.fsPath)));
                await vscode.workspace.fs.writeFile(targetUri, Buffer.from(content as string, "utf8"));
              }
              vscode.window.showInformationMessage(`✅ Pipeline compilado exitosamente (${projectName})`);
            }
            webviewPanel.webview.postMessage({
              type: "compileSuccess",
              files: res.files,
            });
          }
          break;
        }

        case "simulate": {
          const res = await this.ipcClient.simulatePipeline(
            msg.canvasIr,
            msg.inputPayload,
            msg.breakpoints
          );
          webviewPanel.webview.postMessage({
            type: "simulateResult",
            result: res,
          });
          break;
        }

        case "requestUpgrade": {
          vscode.env.openExternal(vscode.Uri.parse("https://wisrovi.dev"));
          break;
        }

        case "activateLicense": {
          vscode.commands.executeCommand("wpipe.activateLicense");
          break;
        }
      }
    });

    webviewPanel.onDidDispose(() => {
      changeDocumentSubscription.dispose();
    });
  }

  private getHtmlForWebview(
    webview: vscode.Webview,
    document: vscode.TextDocument,
    license: any
  ): string {
    const isPro = Boolean(license?.is_pro);
    const tier = license?.tier || "free";
    const maxBlocks = license?.max_blocks ?? 5;

    return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>WPipe Studio Canvas</title>
  <style>
    body {
      margin: 0;
      padding: 0;
      background-color: #1e1e1e;
      color: #cccccc;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      display: flex;
      flex-direction: column;
      height: 100vh;
      overflow: hidden;
    }
    .toolbar {
      height: 40px;
      background: #252526;
      border-bottom: 1px solid #3c3c3c;
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 12px;
      font-size: 12px;
    }
    .toolbar-left, .toolbar-right {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .badge {
      padding: 2px 8px;
      border-radius: 4px;
      font-weight: 600;
      font-size: 11px;
    }
    .badge-free {
      background: #3a2e12;
      color: #f59e0b;
      border: 1px solid #78350f;
    }
    .badge-pro {
      background: #064e3b;
      color: #10b981;
      border: 1px solid #047857;
    }
    button {
      background: #0e639c;
      color: white;
      border: none;
      padding: 4px 10px;
      border-radius: 3px;
      cursor: pointer;
      font-size: 12px;
    }
    button:hover {
      background: #1177bb;
    }
    .btn-secondary {
      background: #3c3c3c;
    }
    .btn-secondary:hover {
      background: #4a4a4a;
    }
    .canvas-container {
      flex: 1;
      display: flex;
      position: relative;
    }
    .palette {
      width: 200px;
      background: #252526;
      border-right: 1px solid #3c3c3c;
      padding: 12px;
      display: flex;
      flex-direction: column;
      gap: 8px;
      overflow-y: auto;
    }
    .palette-item {
      background: #2d2d2d;
      border: 1px solid #454545;
      padding: 8px 10px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 12px;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .palette-item:hover {
      background: #37373d;
      border-color: #0e639c;
    }
    .palette-item.pro-only {
      opacity: 0.7;
      border-style: dashed;
    }
    .workspace-area {
      flex: 1;
      padding: 20px;
      overflow: auto;
      background: radial-gradient(circle, #2d2d2d 10%, transparent 11%);
      background-size: 20px 20px;
    }
    .block-card {
      background: #2d2d2d;
      border: 1px solid #0e639c;
      border-left: 5px solid #0e639c;
      border-radius: 4px;
      padding: 10px;
      margin-bottom: 8px;
      width: 280px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      box-shadow: 0 4px 6px rgba(0,0,0,0.3);
    }
    .modal-overlay {
      position: absolute;
      top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0,0,0,0.8);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 100;
    }
    .modal-box {
      background: #252526;
      border: 1px solid #f59e0b;
      padding: 24px;
      border-radius: 8px;
      max-width: 440px;
      text-align: center;
    }
    .modal-box h3 {
      color: #f59e0b;
      margin-top: 0;
    }
  </style>
</head>
<body>
  <div class="toolbar">
    <div class="toolbar-left">
      <strong>🧩 WPipe Studio</strong>
      <span class="badge ${isPro ? "badge-pro" : "badge-free"}">
        ${isPro ? "PRO ILIMITADO" : "FREE (Máx " + maxBlocks + " bloques)"}
      </span>
      <span id="blockCounter" style="color: #888;"></span>
    </div>
    <div class="toolbar-right">
      ${!isPro ? '<button onclick="upgrade()" style="background: #b45309;">✨ Desbloquear Pro</button>' : ''}
      <button class="btn-secondary" onclick="simulate()">▶ Simular</button>
      <button onclick="compile()">⚙️ Compilar a Python</button>
    </div>
  </div>

  <div class="canvas-container">
    <div class="palette">
      <div style="font-weight: 600; font-size: 11px; text-transform: uppercase; color: #888;">Bloques Estándar</div>
      <div class="palette-item" onclick="addBlock('trigger', 'API Ingress (/run)')">🚀 Trigger REST</div>
      <div class="palette-item" onclick="addBlock('step', 'HttpRequest')">🌐 HttpRequest</div>
      <div class="palette-item" onclick="addBlock('step', 'MySQLQuery')">🗄️ MySQLQuery</div>
      <div class="palette-item" onclick="addBlock('condition', 'Condition IF')">🔀 Condición IF</div>
      <div class="palette-item" onclick="addBlock('for', 'Loop For (5x)')">🔁 Bucle For</div>

      <div style="font-weight: 600; font-size: 11px; text-transform: uppercase; color: #f59e0b; margin-top: 8px;">
        Bloques Pro ${!isPro ? "🔒" : "⚡"}
      </div>
      <div class="palette-item ${!isPro ? "pro-only" : ""}" onclick="addBlock('wpipe_parallel', 'Parallel')">
        ⚡ Parallel Concurrency ${!isPro ? '<span style="font-size:10px; color:#f59e0b;">PRO</span>' : ''}
      </div>
      <div class="palette-item ${!isPro ? "pro-only" : ""}" onclick="addBlock('wpipe_background', 'Background')">
        ⏳ Background Worker ${!isPro ? '<span style="font-size:10px; color:#f59e0b;">PRO</span>' : ''}
      </div>
      <div class="palette-item ${!isPro ? "pro-only" : ""}" onclick="addBlock('wpipe_ai_step', 'AI Transform')">
        ✨ AI Natural Step ${!isPro ? '<span style="font-size:10px; color:#f59e0b;">PRO</span>' : ''}
      </div>
    </div>

    <div class="workspace-area" id="workspace">
      <!-- Blocks rendered dynamically -->
    </div>
  </div>

  <div id="upgradeModal" class="modal-overlay" style="display: none;">
    <div class="modal-box">
      <h3>🚀 Límite del Plan Free Alcanzado</h3>
      <p id="upgradeMessage">El plan gratuito permite hasta 5 bloques por pipeline.</p>
      <p style="font-size: 12px; color: #aaa;">Actualiza a WPipe Pro en wisrovi.dev para desbloquear bloques ilimitados, ejecución concurrente y tareas en segundo plano.</p>
      <div style="display: flex; gap: 8px; justify-content: center; margin-top: 16px;">
        <button class="btn-secondary" onclick="closeModal()">Cerrar</button>
        <button onclick="upgrade()" style="background: #10b981;">Obtener Licencia Pro en wisrovi.dev</button>
      </div>
    </div>
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    let isPro = ${isPro ? "true" : "false"};
    let maxFreeBlocks = ${maxBlocks};
    let canvasData = { nodes: [] };

    window.addEventListener('message', event => {
      const msg = event.data;
      if (msg.type === 'init' || msg.type === 'update') {
        if (msg.data && msg.data.nodes) {
          canvasData = msg.data;
        } else {
          // Default initial pipeline
          canvasData = {
            nodes: [
              { id: 'node_1', data: { node_type: 'trigger', label: 'Trigger REST (/run)' } },
              { id: 'node_2', data: { node_type: 'step', label: 'HttpRequest' } },
            ]
          };
        }
        renderBlocks();
      } else if (msg.type === 'compileError') {
        if (msg.error && msg.error.error === 'LIMIT_EXCEEDED') {
          showUpgradeModal(msg.error.message);
        }
      }
    });

    function renderBlocks() {
      const ws = document.getElementById('workspace');
      ws.innerHTML = '';
      canvasData.nodes.forEach((node, idx) => {
        const div = document.createElement('div');
        div.className = 'block-card';
        div.innerHTML = '<span>' + (idx + 1) + '. ' + node.data.label + '</span>' +
          '<button class="btn-secondary" style="padding:2px 6px;" onclick="removeBlock(\\'' + node.id + '\\')">✕</button>';
        ws.appendChild(div);
      });

      document.getElementById('blockCounter').innerText = '(' + canvasData.nodes.length + (isPro ? ' bloques)' : '/' + maxFreeBlocks + ' bloques)');
    }

    function addBlock(nodeType, label) {
      if (!isPro && (nodeType === 'wpipe_parallel' || nodeType === 'wpipe_background' || nodeType === 'wpipe_ai_step')) {
        showUpgradeModal("El bloque '" + label + "' requiere suscripción WPipe Pro activa.");
        return;
      }

      if (!isPro && canvasData.nodes.length >= maxFreeBlocks) {
        showUpgradeModal("Has alcanzado el límite de " + maxFreeBlocks + " bloques del plan Free.");
        return;
      }

      const id = 'node_' + Math.random().toString(36).substr(2, 9);
      canvasData.nodes.push({ id, data: { node_type: nodeType, label } });
      renderBlocks();
      save();
    }

    function removeBlock(id) {
      canvasData.nodes = canvasData.nodes.filter(n => n.id !== id);
      renderBlocks();
      save();
    }

    function save() {
      vscode.postMessage({ type: 'saveCanvas', canvasIr: canvasData });
    }

    function compile() {
      vscode.postMessage({ type: 'compile', canvasIr: canvasData });
    }

    function simulate() {
      vscode.postMessage({ type: 'simulate', canvasIr: canvasData });
    }

    function upgrade() {
      vscode.postMessage({ type: 'requestUpgrade' });
    }

    function showUpgradeModal(msg) {
      document.getElementById('upgradeMessage').innerText = msg;
      document.getElementById('upgradeModal').style.display = 'flex';
    }

    function closeModal() {
      document.getElementById('upgradeModal').style.display = 'none';
    }
  </script>
</body>
</html>`;
  }
}
