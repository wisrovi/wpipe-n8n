/**
 * Custom Text Editor Provider for Visual WPipe Canvas (.wpipe files)
 * Embeds the full-fidelity WPipe Studio interactive IDE with visual Blockly blocks,
 * zoom, pan, floating toolbar, palette, inspector, split view, and microservice generator.
 * 
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
      let docContent: any = {};
      try {
        const text = document.getText();
        docContent = text ? JSON.parse(text) : {};
      } catch {
        docContent = {};
      }

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

    // Listen to messages from Webview
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
          } else if (res.status === "success" && res.files) {
            const wsFolder = vscode.workspace.getWorkspaceFolder(document.uri);
            if (wsFolder) {
              for (const [relPath, content] of Object.entries(res.files)) {
                const targetUri = vscode.Uri.file(path.join(wsFolder.uri.fsPath, relPath));
                await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(targetUri.fsPath)));
                await vscode.workspace.fs.writeFile(targetUri, Buffer.from(content as string, "utf8"));
              }
              vscode.window.showInformationMessage(`✅ Pipeline compilado exitosamente (${projectName})`);
            }
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

  public getHtmlForWebview(
    _webview: vscode.Webview,
    _document?: vscode.TextDocument,
    _license?: any
  ): string {
    const config = vscode.workspace.getConfiguration("wpipe");
    const rawUrl = config.get<string>("canvasUrl") || "http://localhost:5173";
    const canvasUrl = rawUrl.replace(/\/+$/, "");

    return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src * 'unsafe-inline' 'unsafe-eval' data: blob:; frame-src * http://localhost:* http://127.0.0.1:* ${canvasUrl} https://*.wisrovi.dev https://*.pages.dev;">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>WPipe Studio Canvas</title>
  <style>
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }
    html, body {
      width: 100vw;
      height: 100vh;
      overflow: hidden;
      background-color: #0f172a;
      display: flex;
      flex-direction: column;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    }
    #studioFrame {
      width: 100%;
      height: 100%;
      border: none;
      flex: 1;
      display: block;
      background: #0f172a;
    }
    #fallback {
      display: none;
      flex: 1;
      width: 100%;
      height: 100%;
      align-items: center;
      justify-content: center;
      flex-direction: column;
      color: #94a3b8;
      text-align: center;
      padding: 24px;
      gap: 16px;
    }
    .logo-badge {
      width: 54px;
      height: 54px;
      border-radius: 14px;
      background: linear-gradient(135deg, #0284c7, #38bdf8);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 26px;
      font-weight: bold;
      color: white;
      box-shadow: 0 8px 24px rgba(2, 132, 199, 0.35);
    }
    .btn-retry {
      background: #0284c7;
      color: white;
      border: none;
      padding: 9px 20px;
      border-radius: 6px;
      font-weight: 600;
      cursor: pointer;
      font-size: 13px;
      transition: background 0.2s;
    }
    .btn-retry:hover {
      background: #0369a1;
    }
  </style>
</head>
<body>
  <iframe
    id="studioFrame"
    src="${canvasUrl}/?mode=vscode"
    allow="clipboard-read; clipboard-write; microphone; camera"
  ></iframe>

  <div id="fallback">
    <div class="logo-badge">W</div>
    <h2 style="color: #f8fafc; font-size: 20px; font-weight: 700;">WPipe Studio</h2>
    <p style="max-width: 440px; font-size: 13px; line-height: 1.6;">
      Iniciando el lienzo visual de bloques y entorno de desarrollo en <code>${canvasUrl}</code>.
    </p>
    <button class="btn-retry" onclick="reloadFrame()">Reconectar Lienzo</button>
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    const frame = document.getElementById('studioFrame');
    const fallback = document.getElementById('fallback');
    const baseUrl = ${JSON.stringify(canvasUrl)};

    function reloadFrame() {
      fallback.style.display = 'none';
      frame.style.display = 'block';
      frame.src = baseUrl + '/?mode=vscode&t=' + Date.now();
    }

    // Bridge message communication between iframe and VS Code extension
    window.addEventListener('message', (event) => {
      if (event.source === frame.contentWindow) {
        vscode.postMessage(event.data);
      } else if (event.data && frame.contentWindow) {
        frame.contentWindow.postMessage(event.data, '*');
      }
    });

    frame.onerror = () => {
      fallback.style.display = 'flex';
      frame.style.display = 'none';
    };
  </script>
</body>
</html>`;
  }
}
