/**
 * Custom Text Editor Provider for Visual WPipe Canvas (.wpipe files)
 * Embeds the full-fidelity WPipe Studio interactive IDE with visual Blockly blocks,
 * zoom, pan, floating toolbar, palette, inspector, split view, and microservice generator.
 * 
 * Author: William Rodriguez (wisrovi.dev)
 */

import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { EngineIpcClient } from "./ipcClient";
import { PipelineDecompiler } from "./core/decompiler";
import { WorkspaceIndex } from "./core/workspaceIndex";

export class WPipeCanvasEditorProvider implements vscode.CustomTextEditorProvider {
  public static readonly viewType = "wpipe.canvasEditor";
  private static isInternalSyncing = false;
  private static activePanels = new Map<string, { panel: vscode.WebviewPanel; document?: vscode.TextDocument }>();
  private static decompileDebounceTimer: NodeJS.Timeout | null = null;
  private static autoCompileDebounceTimer: NodeJS.Timeout | null = null;
  private static lastOriginatingPanel: vscode.WebviewPanel | null = null;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly ipcClient: EngineIpcClient
  ) {}

  public static register(
    context: vscode.ExtensionContext,
    ipcClient: EngineIpcClient
  ): vscode.Disposable {
    const provider = new WPipeCanvasEditorProvider(context, ipcClient);

    const handleFileChange = async (uri: vscode.Uri) => {
      if (WPipeCanvasEditorProvider.isInternalSyncing) return;
      const fsPath = uri.fsPath;
      if (fsPath.endsWith("pipelines.py")) {
        try {
          await provider.handlePythonCodeChange(uri);
        } catch (e) {
          console.warn("Could not handle pipelines.py change:", e);
        }
      } else if (fsPath.includes("/states/") && fsPath.endsWith(".py")) {
        try {
          await WorkspaceIndex.indexWorkspace();
          await vscode.commands.executeCommand("wpipeSteps.refreshEntry");
          const wsFolder = vscode.workspace.getWorkspaceFolder(uri);
          if (wsFolder) {
            const pipeUri = vscode.Uri.file(path.join(wsFolder.uri.fsPath, "app", "pipelines.py"));
            await provider.handlePythonCodeChange(pipeUri);
          }
        } catch {}
      } else if (fsPath.endsWith(".wpipe") || fsPath.endsWith(".wpipe.json")) {
        // External .wpipe update: broadcast to active panels EXCEPT the one currently focused/editing
        try {
          const rawBytes = await vscode.workspace.fs.readFile(uri);
          const rawStr = Buffer.from(rawBytes).toString("utf8");
          const updatedJson = JSON.parse(rawStr);
          for (const [key, entry] of WPipeCanvasEditorProvider.activePanels.entries()) {
            if (entry.panel === WPipeCanvasEditorProvider.lastOriginatingPanel) {
              continue;
            }
            if (!entry.document || entry.document.uri.toString() === uri.toString()) {
              entry.panel.webview.postMessage({
                type: "update",
                data: updatedJson,
              });
            }
          }
        } catch {}
      }
    };

    // 1. Detect when document is saved in THIS VS Code instance
    const pythonWatcher = vscode.workspace.onDidSaveTextDocument(async (doc) => {
      await handleFileChange(doc.uri);
    });

    // 2. Detect live edits in THIS VS Code instance as user types or modifies (debounced by 300ms)
    const pythonDocChangeWatcher = vscode.workspace.onDidChangeTextDocument(async (e) => {
      if (WPipeCanvasEditorProvider.isInternalSyncing) return;
      const fsPath = e.document.uri.fsPath;
      if (fsPath.endsWith("pipelines.py")) {
        if (WPipeCanvasEditorProvider.decompileDebounceTimer) {
          clearTimeout(WPipeCanvasEditorProvider.decompileDebounceTimer);
        }
        WPipeCanvasEditorProvider.decompileDebounceTimer = setTimeout(async () => {
          try {
            await provider.handlePythonCodeChange(e.document);
          } catch (err) {
            console.warn("Live typing sync error:", err);
          }
        }, 300);
      }
    });

    // 3. Detect filesystem modifications from other containers/windows
    const pipelineFsWatcher = vscode.workspace.createFileSystemWatcher("**/pipelines.py");
    pipelineFsWatcher.onDidChange((uri) => handleFileChange(uri));
    pipelineFsWatcher.onDidCreate((uri) => handleFileChange(uri));

    const statesFsWatcher = vscode.workspace.createFileSystemWatcher("**/states/*.py");
    statesFsWatcher.onDidChange((uri) => handleFileChange(uri));
    statesFsWatcher.onDidCreate((uri) => handleFileChange(uri));

    const wpipeFsWatcher = vscode.workspace.createFileSystemWatcher("**/*.wpipe");
    wpipeFsWatcher.onDidChange((uri) => handleFileChange(uri));

    const customEditorReg = vscode.window.registerCustomEditorProvider(
      WPipeCanvasEditorProvider.viewType,
      provider,
      {
        webviewOptions: {
          retainContextWhenHidden: true,
        },
        supportsMultipleEditorsPerDocument: false,
      }
    );

    return vscode.Disposable.from(
      customEditorReg,
      pythonWatcher,
      pythonDocChangeWatcher,
      pipelineFsWatcher,
      statesFsWatcher,
      wpipeFsWatcher,
      {
        dispose: () => {
          if (WPipeCanvasEditorProvider.decompileDebounceTimer) {
            clearTimeout(WPipeCanvasEditorProvider.decompileDebounceTimer);
            WPipeCanvasEditorProvider.decompileDebounceTimer = null;
          }
        }
      }
    );
  }

  public async handlePythonCodeChange(pyUriOrDoc: vscode.Uri | vscode.TextDocument): Promise<void> {
    try {
      const uri = (pyUriOrDoc as vscode.TextDocument).uri || (pyUriOrDoc as vscode.Uri);
      let code = "";
      if ("getText" in pyUriOrDoc && typeof pyUriOrDoc.getText === "function") {
        code = pyUriOrDoc.getText();
      } else {
        try {
          const rawBytes = await vscode.workspace.fs.readFile(uri);
          code = Buffer.from(rawBytes).toString("utf8");
        } catch {
          return;
        }
      }
      if (!code || !code.trim()) return;

      // Always re-index workspace before decompiling to catch freshly created custom states
      await WorkspaceIndex.indexWorkspace();

      const workspaceState = PipelineDecompiler.decompile(code);
      if (!workspaceState) return;

      WPipeCanvasEditorProvider.isInternalSyncing = true;
      try {
        // 1. Update all open visual canvas panels EXCEPT the panel currently originating the user interaction
        for (const [docUriStr, entry] of WPipeCanvasEditorProvider.activePanels.entries()) {
          const { panel, document } = entry;
          if (panel === WPipeCanvasEditorProvider.lastOriginatingPanel) {
            continue;
          }
          const projectName = document 
            ? path.basename(document.uri.fsPath, path.extname(document.uri.fsPath))
            : "main_pipeline";

          panel.webview.postMessage({
            type: "update",
            data: {
              format: "wpipe",
              project: {
                name: projectName,
                canvas_ir: {
                  workspace_state: workspaceState,
                },
                workspace_state: workspaceState,
              },
            },
          });
        }

        // 2. Persist updated workspace_state in all matching .wpipe files in workspace
        const wpipeFiles = await vscode.workspace.findFiles("**/*.wpipe", "**/node_modules/**", 10);
        for (const wFileUri of wpipeFiles) {
          try {
            const rawBytes = await vscode.workspace.fs.readFile(wFileUri);
            const rawStr = Buffer.from(rawBytes).toString("utf8");
            let curObj: any = {};
            try {
              curObj = JSON.parse(rawStr);
            } catch {
              curObj = {};
            }
            if (!curObj.format) curObj.format = "wpipe";
            if (!curObj.project) curObj.project = {};
            curObj.project.name = curObj.project.name || path.basename(wFileUri.fsPath, path.extname(wFileUri.fsPath));
            curObj.project.workspace_state = workspaceState;
            if (!curObj.project.canvas_ir) curObj.project.canvas_ir = {};
            curObj.project.canvas_ir.workspace_state = workspaceState;
            curObj.workspace_state = workspaceState;
            curObj.canvas_ir = { workspace_state: workspaceState };

            await vscode.workspace.fs.writeFile(
              wFileUri,
              Buffer.from(JSON.stringify(curObj, null, 2), "utf8")
            );
          } catch (writeErr) {
            console.warn("Failed updating .wpipe file on python change:", writeErr);
          }
        }
      } finally {
        setTimeout(() => {
          WPipeCanvasEditorProvider.isInternalSyncing = false;
        }, 500);
      }
    } catch (err) {
      console.error("Error during Python -> Canvas decompilation:", err);
    }
  }

  public async resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken
  ): Promise<void> {
    const key = document.uri.toString();
    WPipeCanvasEditorProvider.activePanels.set(key, {
      panel: webviewPanel,
      document,
    });

    await this.setupWebview(webviewPanel, document);

    // Listen to in-memory changes in the text document
    const changeDocumentSubscription = vscode.workspace.onDidChangeTextDocument((e) => {
      if (WPipeCanvasEditorProvider.isInternalSyncing) return;
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
      WPipeCanvasEditorProvider.activePanels.delete(key);
      changeDocumentSubscription.dispose();
    });
  }

  public async setupWebview(
    webviewPanel: vscode.WebviewPanel,
    document?: vscode.TextDocument
  ): Promise<void> {
    // Also track panel if opened via wpipe.openCanvas (without a direct document)
    const panelKey = document ? document.uri.toString() : `standalone_${Date.now()}`;
    if (!WPipeCanvasEditorProvider.activePanels.has(panelKey)) {
      WPipeCanvasEditorProvider.activePanels.set(panelKey, {
        panel: webviewPanel,
        document,
      });
      webviewPanel.onDidDispose(() => {
        WPipeCanvasEditorProvider.activePanels.delete(panelKey);
      });
    }

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
    const sendInitialData = async () => {
      let docContent: any = {};
      if (document) {
        try {
          const rawBytes = await vscode.workspace.fs.readFile(document.uri);
          const text = Buffer.from(rawBytes).toString("utf8");
          docContent = text ? JSON.parse(text) : {};
        } catch {
          try {
            const text = document.getText();
            docContent = text ? JSON.parse(text) : {};
          } catch {
            docContent = {};
          }
        }
      }

      // Always ensure workspace_state reflects current app/pipelines.py if present
      const defaultName = document
        ? path.basename(document.uri.fsPath, path.extname(document.uri.fsPath))
        : "main_pipeline";

      try {
        const wsFolder = (document && vscode.workspace.getWorkspaceFolder(document.uri)) || vscode.workspace.workspaceFolders?.[0];
        if (wsFolder) {
          const pyUri = vscode.Uri.file(path.join(wsFolder.uri.fsPath, "app", "pipelines.py"));
          const pyBytes = await vscode.workspace.fs.readFile(pyUri);
          const pyCode = Buffer.from(pyBytes).toString("utf8");
          if (pyCode && pyCode.trim()) {
            await WorkspaceIndex.indexWorkspace();
            const decompiledState = PipelineDecompiler.decompile(pyCode);
            if (decompiledState) {
              if (!docContent.format) docContent.format = "wpipe";
              if (!docContent.project) docContent.project = {};
              docContent.project.name = docContent.project.name || defaultName;
              docContent.project.workspace_state = decompiledState;
              if (!docContent.project.canvas_ir) docContent.project.canvas_ir = {};
              docContent.project.canvas_ir.workspace_state = decompiledState;
              docContent.workspace_state = decompiledState;
              docContent.canvas_ir = { workspace_state: decompiledState };
            }
          }
        }
      } catch {}

      // Normalize docContent in all cases so both legacy and standard .wpipe formats are recognized
      if (!docContent.format) docContent.format = "wpipe";
      const actualWsState =
        docContent.project?.workspace_state ||
        docContent.workspace_state ||
        docContent.project?.canvas_ir?.workspace_state ||
        docContent.canvas_ir?.workspace_state;

      if (actualWsState) {
        if (!docContent.project) docContent.project = {};
        docContent.project.name = docContent.project.name || defaultName;
        docContent.project.workspace_state = actualWsState;
        if (!docContent.project.canvas_ir) docContent.project.canvas_ir = {};
        docContent.project.canvas_ir.workspace_state = actualWsState;
        docContent.workspace_state = actualWsState;
        docContent.canvas_ir = { workspace_state: actualWsState };
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
          WPipeCanvasEditorProvider.lastOriginatingPanel = webviewPanel;
          const wsFolder = (document && vscode.workspace.getWorkspaceFolder(document.uri)) || vscode.workspace.workspaceFolders?.[0];
          const projectObj = msg.canvasIr?.project || msg.canvasIr;
          const defaultName = document
            ? path.basename(document.uri.fsPath, path.extname(document.uri.fsPath))
            : "pipeline";
          const projectName = projectObj?.name || defaultName;
          const canvasPayload = projectObj?.canvas_ir || projectObj;

          // 1. Persist the .wpipe file directly to disk
          const wpipeFileUri = document 
            ? document.uri 
            : (wsFolder ? vscode.Uri.file(path.join(wsFolder.uri.fsPath, `${projectName}.wpipe`)) : undefined);

          // Guarantee standard format in saved .wpipe file
          const payloadToSave = msg.canvasIr || {};
          if (!payloadToSave.format) payloadToSave.format = "wpipe";
          if (!payloadToSave.project) payloadToSave.project = {};
          payloadToSave.project.name = projectName;
          const saveWsState =
            payloadToSave.project.workspace_state ||
            payloadToSave.workspace_state ||
            payloadToSave.project.canvas_ir?.workspace_state ||
            payloadToSave.canvas_ir?.workspace_state;
          if (saveWsState) {
            payloadToSave.project.workspace_state = saveWsState;
            payloadToSave.workspace_state = saveWsState;
            if (!payloadToSave.project.canvas_ir) payloadToSave.project.canvas_ir = {};
            payloadToSave.project.canvas_ir.workspace_state = saveWsState;
            payloadToSave.canvas_ir = { workspace_state: saveWsState };
          }

          if (wpipeFileUri) {
            try {
              if (document) {
                const edit = new vscode.WorkspaceEdit();
                const fullRange = new vscode.Range(
                  document.positionAt(0),
                  document.positionAt(document.getText().length)
                );
                edit.replace(document.uri, fullRange, JSON.stringify(payloadToSave, null, 2));
                await vscode.workspace.applyEdit(edit);
                await document.save();
              }
              await vscode.workspace.fs.writeFile(
                wpipeFileUri,
                Buffer.from(JSON.stringify(payloadToSave, null, 2), "utf8")
              );
            } catch (fsErr) {
              console.warn("Direct file save error:", fsErr);
            }
          }

          // 2. Debounce auto-compilation to app/pipelines.py to avoid interrupting active drag & drop
          if (wsFolder) {
            const rawNodes = canvasPayload?.nodes || [];
            const hasRealNodes = rawNodes.length > 0;
            const wsBlocks = canvasPayload?.workspace_state?.blocks?.blocks || [];
            const hasRealBlocks = wsBlocks.length > 0;

            if (hasRealNodes || hasRealBlocks) {
              if (WPipeCanvasEditorProvider.autoCompileDebounceTimer) {
                clearTimeout(WPipeCanvasEditorProvider.autoCompileDebounceTimer);
              }

              WPipeCanvasEditorProvider.autoCompileDebounceTimer = setTimeout(async () => {
                WPipeCanvasEditorProvider.isInternalSyncing = true;
                try {
                  let existingPyCode = "";
                  const pyTarget = vscode.Uri.file(path.join(wsFolder.uri.fsPath, "app", "pipelines.py"));
                  try {
                    const existingBytes = await vscode.workspace.fs.readFile(pyTarget);
                    existingPyCode = Buffer.from(existingBytes).toString("utf8");
                  } catch {}

                  const res = await this.ipcClient.compilePipeline(canvasPayload, projectName, existingPyCode);
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
                      if (typeof content !== "string" || !content.trim()) continue;

                      const targetUri = vscode.Uri.file(path.join(wsFolder.uri.fsPath, relPath));
                      let fileAlreadyExists = false;
                      try {
                        await vscode.workspace.fs.stat(targetUri);
                        fileAlreadyExists = true;
                      } catch {}

                      if (fileAlreadyExists && relPath.startsWith("app/states/") && !relPath.endsWith("__init__.py")) {
                        continue;
                      }

                      await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(targetUri.fsPath)));
                      await vscode.workspace.fs.writeFile(targetUri, Buffer.from(content as string, "utf8"));
                    }
                    await vscode.commands.executeCommand("workbench.files.action.refreshFilesExplorer");
                    await vscode.commands.executeCommand("wpipeSteps.refreshEntry");
                  }
                } catch (err) {
                  console.warn("Auto-compile on saveCanvas:", err);
                } finally {
                  setTimeout(() => {
                    WPipeCanvasEditorProvider.isInternalSyncing = false;
                    WPipeCanvasEditorProvider.lastOriginatingPanel = null;
                  }, 1000);
                }
              }, 1200);
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
                if (typeof content !== "string" || !content.trim()) continue;
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
    webview: vscode.Webview,
    _document?: vscode.TextDocument,
    _license?: any
  ): string {
    const canvasUri = webview.asWebviewUri(
      vscode.Uri.file(path.join(this.context.extensionPath, "media", "canvas"))
    );

    // Dynamic scan for latest built assets with fallback
    let scriptName = "index-C5oZqxyM.js";
    let cssName = "index-BjFwZUMG.css";
    try {
      const assetsDir = path.join(this.context.extensionPath, "media", "canvas", "assets");
      if (fs.existsSync(assetsDir)) {
        const files = fs.readdirSync(assetsDir);
        const jsFiles = files.filter((f: string) => f.startsWith("index-") && f.endsWith(".js"));
        const cssFiles = files.filter((f: string) => f.startsWith("index-") && f.endsWith(".css"));
        if (jsFiles.length > 0) {
          jsFiles.sort((a, b) => {
            const statA = fs.statSync(path.join(assetsDir, a));
            const statB = fs.statSync(path.join(assetsDir, b));
            return statB.mtimeMs - statA.mtimeMs;
          });
          scriptName = jsFiles[0];
        }
        if (cssFiles.length > 0) {
          cssFiles.sort((a, b) => {
            const statA = fs.statSync(path.join(assetsDir, a));
            const statB = fs.statSync(path.join(assetsDir, b));
            return statB.mtimeMs - statA.mtimeMs;
          });
          cssName = cssFiles[0];
        }
      }
    } catch (e) {
      console.warn("Could not read assets dir:", e);
    }

    const scriptUri = webview.asWebviewUri(
      vscode.Uri.file(path.join(this.context.extensionPath, "media", "canvas", "assets", scriptName))
    );
    const cssUri = webview.asWebviewUri(
      vscode.Uri.file(path.join(this.context.extensionPath, "media", "canvas", "assets", cssName))
    );

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data: blob: https:; script-src ${webview.cspSource} 'unsafe-inline' 'unsafe-eval'; style-src ${webview.cspSource} 'unsafe-inline' https:; font-src ${webview.cspSource} https://fonts.gstatic.com data:; connect-src ${webview.cspSource} http://127.0.0.1:* http://localhost:* ws: wss:;">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>WPipe Studio Canvas</title>
  <link rel="stylesheet" crossorigin href="${cssUri}">
  <style>
    html, body, #root {
      width: 100%;
      height: 100%;
      margin: 0;
      padding: 0;
      overflow: hidden;
      background-color: #07090e;
      color: #f8fafc;
    }
  </style>
</head>
<body class="bg-[#07090e] text-gray-100 antialiased font-sans w-full h-full m-0 p-0 overflow-hidden">
  <div id="root" class="w-full h-full min-h-screen"></div>

  <script>
    // Explicitly flag embedded VS Code environment before React bundle executes
    window.__WPIPE_VSCODE_EMBEDDED__ = true;
    try {
      const vscode = acquireVsCodeApi();
      window.vscode = vscode;
      window.__postToVsCode = (msg) => vscode.postMessage(msg);
    } catch (e) {
      console.warn("VS Code API init:", e);
    }
  </script>
  <script type="module" crossorigin src="${scriptUri}"></script>
</body>
</html>`;
  }
}
