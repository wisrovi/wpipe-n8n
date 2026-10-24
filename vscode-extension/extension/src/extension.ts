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
import { CatalogManager, StepEntry } from "./core/catalog";
import { WPipeStepProvider, StepItem, LibraryItem } from "./providers/stepProvider";
import { DAGPanel } from "./webviews/dagPanel";
import { showCheatSheet } from "./webviews/cheatSheet";
import { showAiAssistant } from "./webviews/aiAssistant";
import { openDashboard } from "./commands/dashboard";
import { replayLogErrors } from "./commands/replayLogs";
import { findStepUsage } from "./commands/impactAnalysis";
import { WPipeCodeLensProvider } from "./providers/codeLensProvider";
import { WPipeHoverProvider } from "./providers/hoverProvider";
import { WPipeCodeActionProvider } from "./providers/codeActionProvider";
import { WorkspaceIndex } from "./core/workspaceIndex";
import { registerDiagnostics } from "./core/diagnostics";
import { createNewStepWizard } from "./wizards/stepWizard";

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

  const stepProvider = new WPipeStepProvider();
  stepProvider.setIpcClient(ipcClient);
  vscode.window.registerTreeDataProvider("wpipeSteps", stepProvider);

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
    stepProvider.refresh();
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
    vscode.commands.registerCommand("wpipe.stopDaemon", async () => {
      await daemonManager.stop();
      vscode.window.showInformationMessage("🛑 Native wpipe-engine stopped.");
      await updateStatusBar();
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

  // 6. Native WPipe Language & Workspace Services
  CatalogManager.init(context);
  WorkspaceIndex.indexWorkspace();
  registerDiagnostics(context);

  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider({ language: "python" }, new WPipeCodeLensProvider()),
    vscode.languages.registerHoverProvider({ language: "python" }, new WPipeHoverProvider()),
    vscode.languages.registerCodeActionsProvider({ language: "python" }, new WPipeCodeActionProvider(), {
      providedCodeActionKinds: WPipeCodeActionProvider.providedCodeActionKinds,
    })
  );

  // Native Tree & Step Commands
  context.subscriptions.push(
    vscode.commands.registerCommand("wpipeSteps.refreshEntry", () => stepProvider.refresh()),
    vscode.commands.registerCommand("wpipe-vscode.refreshCatalog", () => CatalogManager.update(context, true)),
    vscode.commands.registerCommand("wpipe-vscode.createNewStep", createNewStepWizard),
    vscode.commands.registerCommand("wpipeSteps.openFile", async (f: string, l: number) => {
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(f));
      const editor = await vscode.window.showTextDocument(doc);
      const p = new vscode.Position(l, 0);
      editor.selection = new vscode.Selection(p, p);
      editor.revealRange(new vscode.Range(p, p), vscode.TextEditorRevealType.InCenter);
    }),
    vscode.commands.registerCommand("wpipeSteps.insertStep", (step: StepEntry) => {
      const editor = vscode.window.activeTextEditor;
      if (editor) {
        editor.edit((eb) => {
          const importCode = `from ${step.namespace} import ${step.func_name}\n`;
          eb.insert(new vscode.Position(0, 0), importCode);
          const isClass = /^[A-Z]/.test(step.func_name);
          eb.insert(editor.selection.active, isClass ? `${step.func_name}(),` : `${step.func_name},`);
        });
        vscode.window.showInformationMessage(`✅ Step '${step.name}' inserted.`);
      }
    }),
    vscode.commands.registerCommand("wpipe-vscode.searchSteps", async () => {
      const items = CatalogManager.getSteps().map((s) => ({
        label: `$(rocket) ${s.name}`,
        description: `${s.repo} | Author: ${s.author || "Official"}`,
        detail: `Module: ${s.namespace}`,
        step: s,
      }));
      const sel = await vscode.window.showQuickPick(items, {
        placeHolder: "Search step in official catalog or community plugins...",
      });
      if (sel) {
        vscode.commands.executeCommand("wpipeSteps.insertStep", sel.step);
      }
    }),
    vscode.commands.registerCommand("wpipe-vscode.previewDAG", () => {
      const editor = vscode.window.activeTextEditor;
      if (editor) {
        DAGPanel.createOrShow(context.extensionUri, editor.document);
      } else {
        vscode.window.showWarningMessage("Open a Python pipeline file first to preview its DAG.");
      }
    }),
    vscode.commands.registerCommand("wpipe-vscode.openDashboard", (dbPath?: any) => openDashboard(context, dbPath)),
    vscode.commands.registerCommand("wpipe-vscode.replayLogs", replayLogErrors),
    vscode.commands.registerCommand("wpipe-vscode.findStepUsage", (stepName?: string) => findStepUsage(stepName)),
    vscode.commands.registerCommand("wpipe-vscode.showCheatSheet", showCheatSheet),
    vscode.commands.registerCommand("wpipe-vscode.openAiAssistant", () => showAiAssistant(context.extensionUri)),
    vscode.commands.registerCommand("wpipe-vscode.runPipeline", async (filePath: string) => {
      if (vscode.env.uiKind === vscode.UIKind.Web) {
        vscode.window.showErrorMessage("Running pipelines requires a local Python environment.");
        return;
      }
      const terminal = vscode.window.createTerminal(`Pipeline: ${path.basename(filePath)}`);
      terminal.show();
      terminal.sendText(`python "${filePath}"`);
    }),
    vscode.commands.registerCommand("wpipe-vscode.addLogicBlock", async (range: vscode.Range) => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;

      const text = editor.document.getText(range);
      const openBracketIndex = text.indexOf("[");

      if (openBracketIndex !== -1) {
        const offset = editor.document.offsetAt(range.start) + openBracketIndex + 1;
        const pos = editor.document.positionAt(offset);
        editor.selection = new vscode.Selection(pos, pos);
      }

      const items = [
        {
          label: "$(split-horizontal) Condition",
          detail: "Boolean branching (True/False)",
          snippet: "Condition(\n    expression=\"${1:value > 100}\",\n    branch_true=[${2:step_true}],\n    branch_false=[${3:step_false}]\n)",
        },
        {
          label: "$(sync) For Loop",
          detail: "Iterative loop with validation",
          snippet: "For(\n    iterations=${1:10},\n    validation_expression=\"${2:status != 'error'}\",\n    steps=[${3:step_to_repeat}]\n)",
        },
        {
          label: "$(zap) Parallel",
          detail: "Concurrent multi-step execution",
          snippet: "Parallel(\n    steps=[${1:step1}, ${2:step2}],\n    max_workers=${3:2}\n)",
        },
        {
          label: "$(run-all) Background",
          detail: "Asynchronous fire-and-forget task",
          snippet: "Background(${1:slow_step})",
        },
      ];

      const sel = await vscode.window.showQuickPick(items, {
        placeHolder: "Select a logic block to insert inside set_steps...",
      });
      if (sel) {
        editor.insertSnippet(new vscode.SnippetString(sel.snippet));
      }
    }),
    vscode.commands.registerCommand("wpipeSteps.runStep", async (item: StepItem) => {
      if (vscode.env.uiKind === vscode.UIKind.Web) {
        vscode.window.showErrorMessage("Running steps requires a local Python environment.");
        return;
      }
      if (!item || !item.filePath) return;

      const terminal = vscode.window.createTerminal(`Run Step: ${item.label}`);
      terminal.show();
      terminal.sendText(`python "${item.filePath}"`);
    }),
    vscode.commands.registerCommand("wpipeSteps.runStepFromCode", async (filePath: string, line: number) => {
      if (vscode.env.uiKind === vscode.UIKind.Web) {
        vscode.window.showErrorMessage("Running steps requires a local Python environment.");
        return;
      }
      const fileName = path.basename(filePath);
      const terminal = vscode.window.createTerminal(`Run Step: ${fileName}`);
      terminal.show();
      terminal.sendText(`python "${filePath}"`);
    }),
    vscode.commands.registerCommand("wpipeSteps.installRequirements", async (item: LibraryItem) => {
      if (vscode.env.uiKind === vscode.UIKind.Web) {
        vscode.window.showErrorMessage("Installing requirements requires a local environment.");
        return;
      }
      if (!item || !item.step || !item.step.requirements) {
        vscode.window.showWarningMessage("This step does not have external requirements defined.");
        return;
      }

      const reqUrl = item.step.requirements;
      const terminal = vscode.window.createTerminal(`Install: ${item.step.name}`);
      terminal.show();

      try {
        const response = await fetch(reqUrl);
        if (!response.ok) throw new Error(`Failed to download requirements file: ${response.statusText}`);
        const content = await response.text();

        let tempReqUri: vscode.Uri;
        const workspaceFolders = vscode.workspace.workspaceFolders;

        if (workspaceFolders && workspaceFolders.length > 0) {
          tempReqUri = vscode.Uri.joinPath(workspaceFolders[0].uri, `requirements_${item.step.name}.txt`);
        } else {
          await vscode.workspace.fs.createDirectory(context.globalStorageUri);
          tempReqUri = vscode.Uri.joinPath(context.globalStorageUri, `requirements_${item.step.name}.txt`);
        }

        await vscode.workspace.fs.writeFile(tempReqUri, new TextEncoder().encode(content));
        terminal.sendText(`pip install -r "${tempReqUri.fsPath}"`);
        vscode.window.showInformationMessage(`⏳ Installing dependencies for '${item.step.name}'...`);
      } catch (error) {
        vscode.window.showErrorMessage(`❌ Error preparing requirements: ${error}`);
      }
    }),
    vscode.commands.registerCommand("wpipeSteps.viewExamples", async (item: LibraryItem) => {
      if (!item || !item.step || !item.step.examples) {
        vscode.window.showWarningMessage("This step has no examples configured.");
        return;
      }

      let uiUrl = item.step.examples.replace("raw.githubusercontent.com", "github.com");
      const parts = uiUrl.split("/");
      if (parts.length >= 6) {
        const owner = parts[3];
        const repo = parts[4];
        const branch = parts[5];
        const rest = parts.slice(6).join("/");
        const type = item.step.examples.endsWith("/") ? "tree" : "blob";
        uiUrl = `https://github.com/${owner}/${repo}/${type}/${branch}/${rest}`;
      }

      vscode.env.openExternal(vscode.Uri.parse(uiUrl));
    }),
    vscode.commands.registerCommand("wpipeSteps.downloadExample", async (item: LibraryItem) => {
      if (!item || !item.step || !item.step.examples) {
        vscode.window.showWarningMessage("This step has no examples configured.");
        return;
      }

      let rawUrl = item.step.examples;

      try {
        if (rawUrl.endsWith("/")) {
          const parts = rawUrl.split("/");
          const owner = parts[3];
          const repo = parts[4];
          const branch = parts[5];
          const pathInRepo = parts.slice(6).join("/");

          const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${pathInRepo}?ref=${branch}`;
          const apiResponse = await fetch(apiUrl);
          if (!apiResponse.ok) throw new Error(`Failed to list directory contents: ${apiResponse.statusText}`);

          const files = await apiResponse.json();
          if (!Array.isArray(files)) throw new Error("Unexpected response from GitHub API.");

          const pyFiles = files
            .filter((f: any) => f.name.endsWith(".py"))
            .map((f: any) => ({
              label: `$(file-code) ${f.name}`,
              url: f.download_url,
              name: f.name,
            }));

          if (pyFiles.length === 0) {
            vscode.window.showInformationMessage("No example Python files found in this folder.");
            return;
          }

          const selected = await vscode.window.showQuickPick(pyFiles, {
            placeHolder: "Select an example to use as a template:",
          });

          if (!selected) return;
          rawUrl = selected.url;
        }

        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: `Downloading template...`,
            cancellable: false,
          },
          async () => {
            const response = await fetch(rawUrl);
            if (!response.ok) throw new Error(`Error ${response.status}: ${response.statusText}`);

            const content = await response.text();
            if (content.trim().startsWith("<!DOCTYPE html>")) {
              throw new Error("URL does not point to a valid raw file.");
            }

            const doc = await vscode.workspace.openTextDocument({
              content: content,
              language: "python",
            });
            await vscode.window.showTextDocument(doc);
            vscode.window.showInformationMessage(`✅ Template loaded successfully.`);
          }
        );
      } catch (error) {
        vscode.window.showErrorMessage(`❌ Failed to process template: ${error}`);
      }
    })
  );

  // 7. Auto-start daemon and initial status check
  daemonManager.ensureDaemonRunning().then(() => {
    updateStatusAndUi();
  });
}

export function deactivate() {
  if (statusBarItem) {
    statusBarItem.dispose();
  }
}
