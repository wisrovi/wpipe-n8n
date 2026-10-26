import * as vscode from 'vscode';
import * as path from 'path';
import { DAGPanel } from '../webviews/dagPanel';

interface LogError {
    module: string;
    function: string;
    line: number;
    message: string;
    level: string;
}

const errorDecorationType = vscode.window.createTextEditorDecorationType({
    backgroundColor: 'rgba(255, 0, 0, 0.2)',
    isWholeLine: true,
    overviewRulerColor: 'red',
    overviewRulerLane: vscode.OverviewRulerLane.Full,
    after: {
        contentText: ' ⚠️ WPipe Error',
        color: 'red',
        margin: '0 0 0 1em'
    }
});

export async function replayLogErrors() {
    const logUri = await vscode.window.showOpenDialog({
        canSelectFiles: true,
        canSelectFolders: false,
        canSelectMany: false,
        filters: { 'Log Files': ['log'] },
        title: 'Select WPipe Log File'
    });

    if (!logUri || logUri.length === 0) return;

    const fileBytes = await vscode.workspace.fs.readFile(logUri[0]);
    const content = new TextDecoder().decode(fileBytes);
    const lines = content.split('\n');

    const errors: LogError[] = [];
    // Support standard wpipe new_logger and standard python logging formats:
    // 1) 2026-10-25 at 12:00:00 | ERROR | module:func:123 | message
    // 2) 2026-10-25 12:00:00,123 - logger - ERROR - message (with file.py:123)
    const logPattern1 = /^.*?\|\s*(ERROR|CRITICAL)\s*\|\s*(.*?):(.*?):(\d+)\s*\|\s*(.*)$/;
    const logPattern2 = /^.*?\b(ERROR|CRITICAL)\b.*?[/:]([A-Za-z0-9_-]+)\.py:(\d+)\b.*?[-|:]\s*(.*)$/;

    for (const line of lines) {
        const match1 = line.match(logPattern1);
        if (match1) {
            errors.push({
                level: match1[1],
                module: match1[2].trim(),
                function: match1[3].trim(),
                line: Math.max(0, parseInt(match1[4], 10) - 1), // 0-indexed for VS Code
                message: match1[5].trim()
            });
            continue;
        }
        const match2 = line.match(logPattern2);
        if (match2) {
            errors.push({
                level: match2[1],
                module: match2[2].trim(),
                function: match2[2].trim(),
                line: Math.max(0, parseInt(match2[3], 10) - 1),
                message: match2[4].trim()
            });
        }
    }

    if (errors.length === 0) {
        vscode.window.showInformationMessage('✅ No errors found in the selected log.');
        return;
    }

    vscode.window.showWarningMessage(`🔍 Found ${errors.length} errors in log. Highlighting in editor...`);

    // Group errors by file
    const fileToDecorations = new Map<string, { uri: vscode.Uri; decs: { range: vscode.Range; hoverMessage: string }[] }>();

    const defaultExcludes = '{**/node_modules/**,**/.venv/**,**/venv/**,**/__pycache__/**,**/.pytest_cache/**,**/build/**,**/dist/**}';

    // Also look for workspace files by exact name to handle subfolder module paths (e.g. app/states/test_state)
    const allWorkspacePy = await vscode.workspace.findFiles('**/*.py', defaultExcludes);
    const pyMap = new Map<string, vscode.Uri>();
    for (const f of allWorkspacePy) {
        pyMap.set(path.basename(f.fsPath, '.py'), f);
    }

    for (const error of errors) {
        const cleanModule = error.module.replace(/\.py$/, '');
        const baseName = path.basename(cleanModule);
        let fileUri = pyMap.get(cleanModule) || pyMap.get(baseName);

        if (!fileUri) {
            const files = await vscode.workspace.findFiles(`**/${baseName}.py`, defaultExcludes, 1);
            if (files.length > 0) fileUri = files[0];
        }

        if (fileUri) {
            const fsPath = fileUri.fsPath;
            if (!fileToDecorations.has(fsPath)) {
                fileToDecorations.set(fsPath, { uri: fileUri, decs: [] });
            }
            fileToDecorations.get(fsPath)!.decs.push({
                range: new vscode.Range(error.line, 0, error.line, 0),
                hoverMessage: `**[WPipe ${error.level}]** ${error.message}`
            });
        }
    }

    let isFirst = true;
    for (const [_, item] of fileToDecorations) {
        const doc = await vscode.workspace.openTextDocument(item.uri);
        const editor = await vscode.window.showTextDocument(doc, { preview: false });
        editor.setDecorations(errorDecorationType, item.decs);
        if (isFirst && item.decs.length > 0) {
            editor.revealRange(item.decs[0].range, vscode.TextEditorRevealType.InCenter);
            isFirst = false;
        }
    }
    
    // Highlight nodes in the DAG if open
    if (DAGPanel.currentPanel) {
        const stepNames = errors.map(e => {
            const func = e.function || '';
            const mod = e.module ? path.basename(e.module, '.py') : '';
            return func || mod;
        }).filter(Boolean);
        DAGPanel.currentPanel.highlightNodes(stepNames, 'error');
    }
}
