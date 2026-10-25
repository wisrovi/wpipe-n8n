import * as vscode from 'vscode';
import * as fs from 'fs';
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
    const logPattern = /^.*? \| (ERROR|CRITICAL) \| (.*?):(.*?):(\d+) \| (.*)$/;

    for (const line of lines) {
        const match = line.match(logPattern);
        if (match) {
            errors.push({
                level: match[1],
                module: match[2],
                function: match[3],
                line: parseInt(match[4]) - 1, // 0-indexed for VS Code
                message: match[5]
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

    for (const error of errors) {
        const files = await vscode.workspace.findFiles(`**/${error.module}.py`);
        if (files.length > 0) {
            const fileUri = files[0];
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
        const stepNames = errors.map(e => e.function);
        DAGPanel.currentPanel.highlightNodes(stepNames, 'error');
    }
}
