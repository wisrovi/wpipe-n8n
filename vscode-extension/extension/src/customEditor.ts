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
    await this.setupWebview(webviewPanel, document);

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

    webviewPanel.onDidDispose(() => {
      changeDocumentSubscription.dispose();
    });
  }

  public async setupWebview(
    webviewPanel: vscode.WebviewPanel,
    document?: vscode.TextDocument
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
      if (document) {
        try {
          const text = document.getText();
          docContent = text ? JSON.parse(text) : {};
        } catch {
          docContent = {};
        }
      }

      webviewPanel.webview.postMessage({
        type: "init",
        data: docContent,
        license: licenseStatus,
        documentUri: document ? document.uri.toString() : "vscode://untitled/pipeline.wpipe",
      });
    };

    sendInitialData();

    // Listen to messages from Webview
    webviewPanel.webview.onDidReceiveMessage(async (msg) => {
      switch (msg.type) {
        case "ready": {
          sendInitialData();
          break;
        }

        case "saveCanvas": {
          if (document) {
            const edit = new vscode.WorkspaceEdit();
            const fullRange = new vscode.Range(
              document.positionAt(0),
              document.positionAt(document.getText().length)
            );
            edit.replace(document.uri, fullRange, JSON.stringify(msg.canvasIr, null, 2));
            await vscode.workspace.applyEdit(edit);
          } else {
            // Untitled canvas opened from toolbar or command
            const wsFolder = vscode.workspace.workspaceFolders?.[0];
            if (wsFolder) {
              const defaultUri = vscode.Uri.file(path.join(wsFolder.uri.fsPath, "pipeline.wpipe"));
              await vscode.workspace.fs.writeFile(
                defaultUri,
                Buffer.from(JSON.stringify(msg.canvasIr, null, 2), "utf8")
              );
            }
          }

          // Auto-compile to disk whenever canvas is saved or updated
          const projectObj = msg.canvasIr?.project || msg.canvasIr;
          const defaultName = document
            ? path.basename(document.uri.fsPath, path.extname(document.uri.fsPath))
            : "main_pipeline";
          const projectName = projectObj?.name || defaultName;
          const canvasPayload = projectObj?.canvas_ir || projectObj;
          const wsFolder = (document && vscode.workspace.getWorkspaceFolder(document.uri)) || vscode.workspace.workspaceFolders?.[0];

          if (wsFolder && canvasPayload && canvasPayload.nodes && canvasPayload.nodes.length > 0) {
            try {
              const res = await this.ipcClient.compilePipeline(canvasPayload, projectName);
              if (res && res.status === "success" && (res.files_dict || res.files)) {
                const filesMap: Record<string, string> = res.files_dict || {};
                if (!res.files_dict && Array.isArray(res.files)) {
                  for (const item of res.files) {
                    if (item && item.path && item.content) {
                      filesMap[item.path] = item.content;
                    }
                  }
                }
                for (const [relPath, content] of Object.entries(filesMap)) {
                  const targetUri = vscode.Uri.file(path.join(wsFolder.uri.fsPath, relPath));
                  await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(targetUri.fsPath)));
                  await vscode.workspace.fs.writeFile(targetUri, Buffer.from(content as string, "utf8"));
                }
                await vscode.commands.executeCommand("workbench.files.action.refreshFilesExplorer");
                await vscode.commands.executeCommand("wpipeSteps.refreshEntry");
              }
            } catch (err) {
              console.warn("Auto-compile on saveCanvas:", err);
            }
          }
          break;
        }

        case "compile": {
          const defaultName = document
            ? path.basename(document.uri.fsPath, path.extname(document.uri.fsPath))
            : "main_pipeline";
          const projectName = (msg.canvasIr && msg.canvasIr.name) || defaultName;
          const res = await this.ipcClient.compilePipeline(msg.canvasIr, projectName);

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
              (document && vscode.workspace.getWorkspaceFolder(document.uri)) ||
              vscode.workspace.workspaceFolders?.[0];
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
                const targetUri = vscode.Uri.file(path.join(wsFolder.uri.fsPath, relPath));
                await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(targetUri.fsPath)));
                await vscode.workspace.fs.writeFile(targetUri, Buffer.from(content as string, "utf8"));
              }
              vscode.window.showInformationMessage(`✅ Pipeline compiled successfully (${projectName})`);
              
              // Automatically open generated app/pipelines.py in editor and refresh file trees
              const mainPipeUri = vscode.Uri.file(path.join(wsFolder.uri.fsPath, "app", "pipelines.py"));
              try {
                const doc = await vscode.workspace.openTextDocument(mainPipeUri);
                await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Beside });
              } catch {}
              await vscode.commands.executeCommand("workbench.files.action.refreshFilesExplorer");
              await vscode.commands.executeCommand("wpipeSteps.refreshEntry");
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
  }

  public getHtmlForWebview(
    _webview: vscode.Webview,
    _document?: vscode.TextDocument,
    _license?: any
  ): string {
    const config = vscode.workspace.getConfiguration("wpipe");
    const rawUrl = config.get<string>("canvasUrl") || "http://127.0.0.1:49152";
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
      Connecting to WPipe Studio visual block canvas at <code>${canvasUrl}</code>.
    </p>
    <div style="display: flex; gap: 8px; flex-wrap: wrap; justify-content: center;">
      <button class="btn-retry" onclick="reloadFrame()">Reconnect Local Canvas</button>
      <button class="btn-retry" style="background: #334155;" onclick="loadCloudFallback()">Open Cloud PWA</button>
    </div>
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

    function loadCloudFallback() {
      fallback.style.display = 'none';
      frame.style.display = 'block';
      frame.src = 'https://studio.wisrovi.dev/?mode=vscode&t=' + Date.now();
    }

    // Health probe: if local engine is offline, seamlessly switch to cloud PWA
    fetch(baseUrl + '/health', { mode: 'cors' })
      .then((res) => {
        if (!res.ok) throw new Error('Daemon unhealthy');
      })
      .catch(() => {
        console.warn('Local engine offline, falling back to cloud PWA.');
        loadCloudFallback();
      });

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
