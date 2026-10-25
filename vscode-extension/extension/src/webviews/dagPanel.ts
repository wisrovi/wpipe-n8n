import * as vscode from 'vscode';
import * as path from 'path';
import { parser } from '@lezer/python';
import { ConfigManager } from '../core/config';

export class DAGPanel {
    public static currentPanel: DAGPanel | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private _disposables: vscode.Disposable[] = [];

    public static async createOrShow(uri: vscode.Uri, doc: vscode.TextDocument) {
        if (DAGPanel.currentPanel) { 
            DAGPanel.currentPanel._panel.reveal(); 
            await DAGPanel.currentPanel.updateDocument(doc, true); 
            return; 
        }
        const p = vscode.window.createWebviewPanel('wpipeDAG', 'WPipe Analysis', vscode.ViewColumn.Two, { 
            enableScripts: true,
            retainContextWhenHidden: true
        });
        DAGPanel.currentPanel = new DAGPanel(p, doc);
    }

    public highlightNodes(nodeNames: string[], status: 'error' | 'success' | 'running') {
        this._panel.webview.postMessage({
            command: 'highlightNodes',
            nodes: nodeNames,
            status: status
        });
    }

    private constructor(p: vscode.WebviewPanel, doc: vscode.TextDocument) {
        this._panel = p;
        this._panel.onDidDispose(() => { DAGPanel.currentPanel = undefined; }, null, this._disposables);
        
        // Inicialización
        this.updateDocument(doc, true);
        
        this._panel.webview.onDidReceiveMessage(async message => {
            if (message.command === 'downloadImage') {
                const saveUri = await vscode.window.showSaveDialog({
                    defaultUri: vscode.Uri.file(message.fileName),
                    filters: message.format === 'png' ? { 'PNG Image': ['png'] } : { 'SVG Image': ['svg'] }
                });
                if (saveUri) {
                    let data: Uint8Array;
                    if (message.format === 'png') {
                        const base64Data = message.content.replace(/^data:image\/png;base64,/, "");
                        data = Buffer.from(base64Data, 'base64');
                    } else {
                        data = new TextEncoder().encode(message.content);
                    }
                    await vscode.workspace.fs.writeFile(saveUri, data);
                    vscode.window.showInformationMessage(`✅ DAG exported as ${message.format.toUpperCase()} successfully.`);
                }
            } else if (message.command === 'gotoLine') {
                const line = parseInt(message.line);
                if (!isNaN(line)) {
                    const editor = vscode.window.activeTextEditor;
                    if (editor && editor.document === doc) {
                        const pos = new vscode.Position(line, 0);
                        editor.selection = new vscode.Selection(pos, pos);
                        editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
                    } else {
                        const newDoc = await vscode.workspace.openTextDocument(doc.uri);
                        const newEditor = await vscode.window.showTextDocument(newDoc);
                        const pos = new vscode.Position(line, 0);
                        newEditor.selection = new vscode.Selection(pos, pos);
                        newEditor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
                    }
                }
            }
        }, null, this._disposables);

        // Actualizamos vista al guardar cualquier documento de python relevante en este editor
        vscode.workspace.onDidSaveTextDocument(async e => { 
            if (e.languageId === 'python') {
                if (e.uri.fsPath.endsWith('pipelines.py')) {
                    this.updateDocument(e, true);
                } else if (e.uri.fsPath.includes('/states/')) {
                    const wsFolder = vscode.workspace.getWorkspaceFolder(e.uri);
                    if (wsFolder) {
                        try {
                            const pipeUri = vscode.Uri.file(path.join(wsFolder.uri.fsPath, 'app', 'pipelines.py'));
                            const pipeDoc = await vscode.workspace.openTextDocument(pipeUri);
                            this.updateDocument(pipeDoc, false);
                        } catch {}
                    }
                } else if (e === doc) {
                    this.updateDocument(doc, true);
                }
            }
        }, null, this._disposables);

        // Filesystem Watchers separados para detectar cambios desde otros contenedores
        const pipeFsWatcher = vscode.workspace.createFileSystemWatcher("**/pipelines.py");
        const handleExternalPipelineChange = async (changedUri: vscode.Uri) => {
            try {
                const rawBytes = await vscode.workspace.fs.readFile(changedUri);
                const fileText = Buffer.from(rawBytes).toString("utf8");
                this.updateContent(path.basename(changedUri.fsPath), fileText, false);
            } catch (err) {
                console.warn("DAGPanel could not reload externally modified pipeline:", err);
            }
        };
        pipeFsWatcher.onDidChange(handleExternalPipelineChange, null, this._disposables);
        pipeFsWatcher.onDidCreate(handleExternalPipelineChange, null, this._disposables);
        this._disposables.push(pipeFsWatcher);

        const statesFsWatcher = vscode.workspace.createFileSystemWatcher("**/states/*.py");
        const handleExternalStateChange = async (stateUri: vscode.Uri) => {
            try {
                const wsFolder = vscode.workspace.getWorkspaceFolder(stateUri);
                if (wsFolder) {
                    const pipeUri = vscode.Uri.file(path.join(wsFolder.uri.fsPath, 'app', 'pipelines.py'));
                    const rawBytes = await vscode.workspace.fs.readFile(pipeUri);
                    const fileText = Buffer.from(rawBytes).toString("utf8");
                    this.updateContent("pipelines.py", fileText, false);
                }
            } catch {}
        };
        statesFsWatcher.onDidChange(handleExternalStateChange, null, this._disposables);
        statesFsWatcher.onDidCreate(handleExternalStateChange, null, this._disposables);
        this._disposables.push(statesFsWatcher);

        // Al cambiar de editor activo, actualizamos la vista
        vscode.window.onDidChangeActiveTextEditor(e => { 
            if (e && e.document.languageId === 'python') this.updateDocument(e.document, false); 
        }, null, this._disposables);
    }

    public async updateContent(fileName: string, content: string, forceBackup: boolean = false) {
        const res = this.parseString(content, fileName);
        this._panel.webview.html = this._getHtml(fileName, res.graph, res.stats, res.bigO, res.suggestions);
    }

    public async updateDocument(doc: vscode.TextDocument, forceBackup: boolean = false) {
        let text = "";
        try {
            const rawBytes = await vscode.workspace.fs.readFile(doc.uri);
            text = Buffer.from(rawBytes).toString("utf8");
        } catch {
            text = doc.getText();
        }
        await this.updateContent(path.basename(doc.fileName), text, forceBackup);
    }

    public parseString(text: string, fileName: string) {
        const tree = parser.parse(text);
        let steps: { name: string, isControl: boolean, line: number, type?: string, condition?: string }[] = [];
        let edges: { from: string, to: string, label?: string }[] = [];
        
        let inSetSteps = false;
        let isCollectingSteps = false;
        let currentPipeline = 'main';

        const lines = text.split('\n');

        tree.iterate({
            enter: (node) => {
                if (node.name === 'CallExpression') {
                    const callText = text.substring(node.from, node.to);
                    if (callText.includes('set_steps') || callText.includes('Pipeline(')) {
                        inSetSteps = true;
                    }
                }
                
                if (inSetSteps && node.name === 'ArrayExpression') {
                    isCollectingSteps = true;
                }

                if (isCollectingSteps && (node.name === 'CallExpression' || node.name === 'VariableName')) {
                    const nodeText = text.substring(node.from, node.to);
                    const line = text.substring(0, node.from).split('\n').length - 1;
                    
                    // Match Step, Condition, For, Parallel
                    if (nodeText.startsWith('Condition(')) {
                        const condMatch = nodeText.match(/expression\s*=\s*['"](.*?)['"]/);
                        steps.push({
                            name: `Cond_${steps.length}`,
                            isControl: true,
                            type: 'Condition',
                            condition: condMatch ? condMatch[1] : 'exp',
                            line
                        });
                    } else if (nodeText.startsWith('For(')) {
                        steps.push({
                            name: `Loop_${steps.length}`,
                            isControl: true,
                            type: 'For',
                            line
                        });
                    } else if (nodeText.startsWith('Parallel(')) {
                        steps.push({
                            name: `Parallel_${steps.length}`,
                            isControl: true,
                            type: 'Parallel',
                            line
                        });
                    } else if (!nodeText.includes('(') || nodeText.endsWith('()')) {
                        const name = nodeText.replace('()', '').trim();
                        if (name && !['Condition', 'For', 'Parallel', 'set_steps'].includes(name)) {
                            // Check not already added
                            if (!steps.find(s => s.name === name && s.line === line)) {
                                steps.push({
                                    name,
                                    isControl: false,
                                    line
                                });
                            }
                        }
                    }
                }
            },
            leave: (node) => {
                if (node.name === 'ArrayExpression' && isCollectingSteps) {
                    isCollectingSteps = false;
                    inSetSteps = false;
                }
            }
        });

        // Generar grafo Mermaid
        let graph = 'graph TD\n';
        graph += '  classDef default fill:#1e293b,stroke:#475569,stroke-width:1px,color:#f8fafc,rx:6px,ry:6px;\n';
        graph += '  classDef startEnd fill:#0f172a,stroke:#3b82f6,stroke-width:2px,color:#60a5fa,rx:10px,ry:10px;\n';
        graph += '  classDef control fill:#312e81,stroke:#6366f1,stroke-width:1px,color:#c7d2fe,rx:4px,ry:4px;\n';
        graph += '  classDef customStep fill:#064e3b,stroke:#10b981,stroke-width:1px,color:#a7f3d0,rx:6px,ry:6px;\n';
        graph += '  classDef errorState fill:#450a0a,stroke:#ef4444,stroke-width:2px,color:#fca5a5,rx:6px,ry:6px;\n';
        graph += '  classDef runningState fill:#78350f,stroke:#f59e0b,stroke-width:2px,color:#fde68a,rx:6px,ry:6px;\n';
        
        graph += '  Start([🚀 Iniciar Pipeline]):::startEnd --> ';

        if (steps.length === 0) {
            graph += 'End([🏁 Fin]):::startEnd\n';
        } else {
            let prevNode = 'Start';
            steps.forEach((s, idx) => {
                const nodeId = `Step_${idx}`;
                const label = s.isControl ? `${s.type}: ${s.condition || ''}` : s.name;
                const cssClass = s.isControl ? 'control' : 'customStep';
                
                graph += `${nodeId}["${label}"]:::${cssClass}\n`;
                if (idx > 0) {
                    graph += `  ${prevNode} --> ${nodeId}\n`;
                } else {
                    graph += `  Start --> ${nodeId}\n`;
                }
                prevNode = nodeId;
            });
            graph += `  ${prevNode} --> End([🏁 Fin]):::startEnd\n`;
        }

        // Estadísticas y Complejidad Big-O
        let loopsCount = steps.filter(s => s.type === 'For').length;
        let condCount = steps.filter(s => s.type === 'Condition').length;
        let parallelCount = steps.filter(s => s.type === 'Parallel').length;
        
        let bigO = 'O(N)';
        if (loopsCount > 1) bigO = 'O(N²+)';
        else if (loopsCount === 1) bigO = 'O(N)';
        else if (parallelCount > 0) bigO = 'O(N/k)';
        
        const stats = {
            totalSteps: steps.length,
            loops: loopsCount,
            conditions: condCount,
            parallels: parallelCount
        };

        const suggestions: string[] = [];
        if (loopsCount > 0 && parallelCount === 0) {
            suggestions.push('Considera paralelizar los bucles usando Parallel(...) si las iteraciones son independientes.');
        }
        if (steps.length > 8) {
            suggestions.push('El pipeline tiene más de 8 estados. Considera dividirlo en subpipelines acoplados.');
        }

        return { graph, stats, bigO, suggestions };
    }

    private _getHtml(fileName: string, mermaidGraph: string, stats: any, bigO: string, suggestions: string[]) {
        return `<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: data: http://localhost:* http://127.0.0.1:*; script-src 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net; style-src 'unsafe-inline' https:; font-src https: data:; connect-src http://localhost:* http://127.0.0.1:* https://cdn.jsdelivr.net ws: wss:;">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>WPipe DAG - ${fileName}</title>
    <script src="https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js"></script>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            background-color: #0b0f19;
            color: #f1f5f9;
            margin: 0;
            padding: 1.5rem;
            display: flex;
            flex-direction: column;
            gap: 1.5rem;
        }
        .header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            border-bottom: 1px solid #1e293b;
            padding-bottom: 1rem;
        }
        .title {
            font-size: 1.25rem;
            font-weight: 700;
            color: #38bdf8;
            display: flex;
            align-items: center;
            gap: 0.5rem;
        }
        .stats-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
            gap: 1rem;
        }
        .stat-card {
            background-color: #111827;
            border: 1px solid #1f2937;
            border-radius: 8px;
            padding: 1rem;
            text-align: center;
        }
        .stat-val {
            font-size: 1.5rem;
            font-weight: 800;
            color: #10b981;
        }
        .stat-label {
            font-size: 0.75rem;
            color: #94a3b8;
            text-transform: uppercase;
            letter-spacing: 0.05em;
        }
        .canvas-card {
            background-color: #0f172a;
            border: 1px solid #1e293b;
            border-radius: 8px;
            padding: 1.5rem;
            overflow-x: auto;
            display: flex;
            justify-content: center;
        }
        .suggestions {
            background-color: #172554;
            border: 1px solid #1e40af;
            border-radius: 8px;
            padding: 1rem;
            font-size: 0.875rem;
        }
        .suggestions h4 {
            margin: 0 0 0.5rem 0;
            color: #93c5fd;
            display: flex;
            align-items: center;
            gap: 0.5rem;
        }
        .suggestions ul {
            margin: 0;
            padding-left: 1.25rem;
            color: #bfdbfe;
        }
        .actions {
            display: flex;
            gap: 0.5rem;
        }
        button {
            background-color: #1e293b;
            color: #cbd5e1;
            border: 1px solid #334155;
            padding: 0.4rem 0.8rem;
            border-radius: 6px;
            cursor: pointer;
            font-size: 0.8rem;
            font-weight: 500;
            transition: all 0.2s;
        }
        button:hover {
            background-color: #334155;
            color: #f8fafc;
        }
    </style>
</head>
<body>
    <div class="header">
        <div class="title">
            <span>⚡ WPipe Pipeline DAG:</span>
            <span style="color: #f8fafc; font-weight: 400;">${fileName}</span>
        </div>
        <div class="actions">
            <button onclick="downloadSvg()">Descargar SVG</button>
        </div>
    </div>

    <div class="stats-grid">
        <div class="stat-card">
            <div class="stat-val">${stats.totalSteps}</div>
            <div class="stat-label">Estados Totales</div>
        </div>
        <div class="stat-card">
            <div class="stat-val" style="color: #6366f1;">${stats.conditions}</div>
            <div class="stat-label">Bifurcaciones</div>
        </div>
        <div class="stat-card">
            <div class="stat-val" style="color: #f59e0b;">${stats.loops}</div>
            <div class="stat-label">Bucles (For)</div>
        </div>
        <div class="stat-card">
            <div class="stat-val" style="color: #38bdf8;">${bigO}</div>
            <div class="stat-label">Complejidad Teórica</div>
        </div>
    </div>

    <div class="canvas-card">
        <div class="mermaid">
${mermaidGraph}
        </div>
    </div>

    ${suggestions.length > 0 ? `
    <div class="suggestions">
        <h4>💡 Recomendaciones Arquitectónicas</h4>
        <ul>
            ${suggestions.map(s => `<li>${s}</li>`).join('')}
        </ul>
    </div>
    ` : ''}

    <script>
        mermaid.initialize({
            startOnLoad: true,
            theme: 'dark',
            securityLevel: 'loose',
            themeVariables: {
                darkMode: true,
                background: '#0f172a',
                primaryColor: '#1e293b',
                primaryTextColor: '#f8fafc',
                primaryBorderColor: '#334155',
                lineColor: '#64748b'
            }
        });

        const vscode = acquireVsCodeApi();

        function downloadSvg() {
            const svgElement = document.querySelector('.mermaid svg');
            if (svgElement) {
                const svgString = new XMLSerializer().serializeToString(svgElement);
                vscode.postMessage({
                    command: 'downloadImage',
                    format: 'svg',
                    fileName: '${fileName}.dag.svg',
                    content: svgString
                });
            }
        }
    </script>
</body>
</html>`;
    }
}
