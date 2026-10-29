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

  public static resolvePythonUriForWpipe(wpipeUri: vscode.Uri, wsRoot: vscode.Uri): vscode.Uri {
    const baseName = path.basename(wpipeUri.fsPath, path.extname(wpipeUri.fsPath));

    // 1. Primary pipeline: main_pipeline, pipelines, or main -> app/pipelines.py
    if (["main_pipeline", "pipelines", "main"].includes(baseName)) {
      return vscode.Uri.file(path.join(wsRoot.fsPath, "app", "pipelines.py"));
    }

    // 2. Check if app/pipelines/${baseName}.py exists
    const inPipelinesDir = path.join(wsRoot.fsPath, "app", "pipelines", `${baseName}.py`);
    if (fs.existsSync(inPipelinesDir)) {
      return vscode.Uri.file(inPipelinesDir);
    }

    // 3. Check if app/${baseName}.py exists
    const directApp = path.join(wsRoot.fsPath, "app", `${baseName}.py`);
    if (fs.existsSync(directApp)) {
      return vscode.Uri.file(directApp);
    }

    // 4. Check if app/${baseName}_pipeline.py exists
    const suffixed = path.join(wsRoot.fsPath, "app", `${baseName}_pipeline.py`);
    if (fs.existsSync(suffixed)) {
      return vscode.Uri.file(suffixed);
    }

    // 5. Default target: if app/pipelines directory exists, use app/pipelines/${baseName}.py, else app/${baseName}.py
    const pipelinesDir = path.join(wsRoot.fsPath, "app", "pipelines");
    if (fs.existsSync(pipelinesDir) && fs.statSync(pipelinesDir).isDirectory()) {
      return vscode.Uri.file(inPipelinesDir);
    }
    return vscode.Uri.file(directApp);
  }

  public static isPipelinePythonFile(fsPath: string): boolean {
    if (!fsPath.endsWith(".py")) return false;
    if (fsPath.endsWith("pipelines.py")) return true;
    if (fsPath.includes("/app/pipelines/")) return true;
    if (fsPath.endsWith("_pipeline.py")) return true;
    if (
      fsPath.includes("/app/") &&
      !fsPath.includes("/app/states/") &&
      !fsPath.includes("/app/test/") &&
      !fsPath.includes("/app/dto/") &&
      !fsPath.includes("/app/config/") &&
      !fsPath.includes("/app/utils/") &&
      !fsPath.includes("/app/services/") &&
      !fsPath.endsWith("__init__.py") &&
      !fsPath.endsWith("main.py")
    ) {
      return true;
    }
    return false;
  }

  public static register(
    context: vscode.ExtensionContext,
    ipcClient: EngineIpcClient
  ): vscode.Disposable {
    const provider = new WPipeCanvasEditorProvider(context, ipcClient);

    const handleFileChange = async (uri: vscode.Uri) => {
      if (WPipeCanvasEditorProvider.isInternalSyncing) return;
      const fsPath = uri.fsPath;
      if (WPipeCanvasEditorProvider.isPipelinePythonFile(fsPath)) {
        try {
          await provider.handlePythonCodeChange(uri);
        } catch (e) {
          console.warn("Could not handle pipeline python change:", e);
        }
      } else if (fsPath.includes("/states/") && fsPath.endsWith(".py")) {
        try {
          await WorkspaceIndex.debouncedIndex(500);
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
      if (WPipeCanvasEditorProvider.isPipelinePythonFile(fsPath)) {
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
    const pipelineFsWatcher = vscode.workspace.createFileSystemWatcher("**/app/**/*.py");
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

      // Debounced indexing so typing and decompilation never block the UI thread
      WorkspaceIndex.debouncedIndex(800);

      const workspaceState = PipelineDecompiler.decompile(code);
      if (!workspaceState) return;

      const pyBase = path.basename(uri.fsPath, path.extname(uri.fsPath));
      const isMainPy = ["pipelines", "main_pipeline"].includes(pyBase);

      WPipeCanvasEditorProvider.isInternalSyncing = true;
      try {
        // 1. Update all open visual canvas panels matching this Python file
        // Note: never skip panels on python code change - python edits are authoritative
        WPipeCanvasEditorProvider.lastOriginatingPanel = null;
        for (const [docUriStr, entry] of WPipeCanvasEditorProvider.activePanels.entries()) {
          const { panel, document } = entry;
          const docBase = document 
            ? path.basename(document.uri.fsPath, path.extname(document.uri.fsPath))
            : "main_pipeline";
          const isMainDoc = ["pipelines", "main_pipeline"].includes(docBase);

          // Only sync panel if it targets the changed python file
          const matchesDoc = (isMainPy && isMainDoc) || (pyBase === docBase) || (pyBase === `${docBase}_pipeline`);
          if (!matchesDoc) {
            continue;
          }

          panel.webview.postMessage({
            type: "update",
            data: {
              format: "wpipe",
              project: {
                name: docBase,
                canvas_ir: {
                  workspace_state: workspaceState,
                },
                workspace_state: workspaceState,
              },
            },
          });
        }

        // 2. Persist updated workspace_state in matching .wpipe file in workspace
        const wpipeFiles = await vscode.workspace.findFiles("**/*.wpipe", "**/node_modules/**", 20);
        for (const wFileUri of wpipeFiles) {
          const wBase = path.basename(wFileUri.fsPath, path.extname(wFileUri.fsPath));
          const isMainW = ["pipelines", "main_pipeline"].includes(wBase);
          const matchesWpipe = (isMainPy && isMainW) || (pyBase === wBase) || (pyBase === `${wBase}_pipeline`);
          if (!matchesWpipe) {
            continue;
          }
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
            curObj.project.name = curObj.project.name || wBase;
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
      const wsFolder = (document && vscode.workspace.getWorkspaceFolder(document.uri)) || vscode.workspace.workspaceFolders?.[0];

      let targetWpipeUri: vscode.Uri | undefined = document ? document.uri : undefined;
      if (!targetWpipeUri && wsFolder) {
        const candidateMain = vscode.Uri.file(path.join(wsFolder.uri.fsPath, "main_pipeline.wpipe"));
        try {
          await vscode.workspace.fs.stat(candidateMain);
          targetWpipeUri = candidateMain;
        } catch {
          try {
            const foundW = await vscode.workspace.findFiles("**/*.wpipe", "**/node_modules/**", 1);
            if (foundW.length > 0) targetWpipeUri = foundW[0];
          } catch {}
        }
      }

      if (targetWpipeUri) {
        try {
          const rawBytes = await vscode.workspace.fs.readFile(targetWpipeUri);
          const text = Buffer.from(rawBytes).toString("utf8");
          docContent = text ? JSON.parse(text) : {};
        } catch {
          if (document) {
            try {
              const text = document.getText();
              docContent = text ? JSON.parse(text) : {};
            } catch {
              docContent = {};
            }
          }
        }
      }

      // Always ensure workspace_state reflects current app/pipelines.py if present
      const defaultName = document
        ? path.basename(document.uri.fsPath, path.extname(document.uri.fsPath))
        : (targetWpipeUri ? path.basename(targetWpipeUri.fsPath, path.extname(targetWpipeUri.fsPath)) : "main_pipeline");

      try {
        if (wsFolder) {
          const pyUri = targetWpipeUri
            ? WPipeCanvasEditorProvider.resolvePythonUriForWpipe(targetWpipeUri, wsFolder.uri)
            : vscode.Uri.file(path.join(wsFolder.uri.fsPath, "app", "pipelines.py"));
          try {
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
          } catch {}
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
        documentUri: document ? document.uri.toString() : (targetWpipeUri ? targetWpipeUri.toString() : "vscode://untitled/pipeline.wpipe"),
      });
    };

    // Auto re-sync canvas when user switches back to canvas tab after editing Python code
    webviewPanel.onDidChangeViewState(async (e) => {
      if (e.webviewPanel.visible) {
        try {
          await sendInitialData();
        } catch (err) {
          console.warn("Auto-sync error on view state change:", err);
        }
      }
    });

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
            : "main_pipeline";
          const projectName = projectObj?.name || defaultName;
          const canvasPayload = projectObj?.canvas_ir || projectObj;

          // 1. Persist the .wpipe file directly to disk
          const defaultWpipePath = wsFolder ? path.join(wsFolder.uri.fsPath, `${projectName}.wpipe`) : undefined;
          const wpipeFileUri = document 
            ? document.uri 
            : (defaultWpipePath ? vscode.Uri.file(defaultWpipePath) : undefined);

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
            if (!payloadToSave.project.canvas_ir) {
              payloadToSave.project.canvas_ir = {};
            }
            payloadToSave.project.canvas_ir.workspace_state = saveWsState;
            if (payloadToSave.canvas_ir && typeof payloadToSave.canvas_ir === "object") {
              payloadToSave.canvas_ir.workspace_state = saveWsState;
            } else {
              payloadToSave.canvas_ir = { workspace_state: saveWsState };
            }
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
            const rawNodes = canvasPayload?.nodes || canvasPayload?.project?.canvas_ir?.nodes || [];
            const hasRealNodes = rawNodes.length > 0;
            const wsBlocks =
              canvasPayload?.workspace_state?.blocks?.blocks ||
              canvasPayload?.project?.workspace_state?.blocks?.blocks ||
              saveWsState?.blocks?.blocks ||
              [];
            const hasRealBlocks = wsBlocks.length > 0;

            if (hasRealNodes || hasRealBlocks) {
              if (WPipeCanvasEditorProvider.autoCompileDebounceTimer) {
                clearTimeout(WPipeCanvasEditorProvider.autoCompileDebounceTimer);
              }

              WPipeCanvasEditorProvider.autoCompileDebounceTimer = setTimeout(async () => {
                WPipeCanvasEditorProvider.isInternalSyncing = true;
                try {
                  let existingPyCode = "";
                  const pyTarget = document 
                    ? WPipeCanvasEditorProvider.resolvePythonUriForWpipe(document.uri, wsFolder.uri)
                    : vscode.Uri.file(path.join(wsFolder.uri.fsPath, "app", "pipelines.py"));
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

                      // Determine if this file should be written during canvas auto-compilation
                      const isTargetPipeline = targetUri.fsPath === pyTarget.fsPath;
                      const isMainPipelineDefault = ["main_pipeline", "pipelines", "main"].includes(projectName) && relPath.endsWith("pipelines.py");
                      const isPipelineFile = isTargetPipeline || isMainPipelineDefault;
                      const isNewStateFile = relPath.startsWith("app/states/") && !fileAlreadyExists;

                      // If this is an existing project, only write the active pipeline file or newly created custom state files
                      // Do not overwrite user-customized infrastructure files (settings, main, Dockerfile) unless brand new project
                      if (isPipelineFile || isNewStateFile || !fileAlreadyExists) {
                        await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(targetUri.fsPath)));
                        await vscode.workspace.fs.writeFile(targetUri, Buffer.from(content as string, "utf8"));
                      }
                    }
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
