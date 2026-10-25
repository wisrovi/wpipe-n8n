import * as vscode from 'vscode';
import { DashboardPanel } from '../webviews/dashboardPanel';

export async function openDashboard(context: vscode.ExtensionContext, dbPath?: any) {
    console.log('🚀 WPipe: openDashboard called with:', dbPath);

    if (vscode.env.uiKind === vscode.UIKind.Web) {
        // If port is specified or we can connect, allow webview to render against remote or container daemon
        const defaultPort = '8035';
        DashboardPanel.createOrShow(context.extensionUri, defaultPort);
        vscode.window.showInformationMessage(`🌐 Opening WPipe Dashboard Webview (Port ${defaultPort})...`);
        return;
    }

    let finalDbPath: string | undefined;

    // Handle cases where VS Code might pass a URI or other object as the first arg
    let potentialDbPath = '';
    if (typeof dbPath === 'string' && dbPath.length > 0) {
        potentialDbPath = dbPath;
    } else if (dbPath && typeof dbPath === 'object' && 'fsPath' in dbPath) {
        potentialDbPath = dbPath.fsPath;
    }

    // Only auto-use the path if it actually looks like a database file
    if (potentialDbPath && (potentialDbPath.endsWith('.db') || potentialDbPath.endsWith('.sqlite') || potentialDbPath.endsWith('.sqlite3'))) {
        finalDbPath = potentialDbPath;
    }

    // Auto-detect tracking database in workspace before prompting dialog
    if (!finalDbPath) {
        const defaultExcludes = '{**/node_modules/**,**/.venv/**,**/venv/**,**/__pycache__/**,**/.pytest_cache/**,**/build/**,**/dist/**}';
        const dbFiles = await vscode.workspace.findFiles('**/*.{db,sqlite,sqlite3}', defaultExcludes, 10);
        if (dbFiles.length === 1) {
            finalDbPath = dbFiles[0].fsPath;
        } else if (dbFiles.length > 1) {
            const dbItems = dbFiles.map(f => ({
                label: path.basename(f.fsPath),
                description: vscode.workspace.asRelativePath(f),
                fsPath: f.fsPath
            }));
            const chosen = await vscode.window.showQuickPick(dbItems, {
                placeHolder: 'Select detected WPipe tracking database'
            });
            if (chosen) finalDbPath = chosen.fsPath;
        }
    }

    if (!finalDbPath) {
        const dbUri = await vscode.window.showOpenDialog({
            canSelectFiles: true,
            canSelectFolders: false,
            canSelectMany: false,
            filters: { 'Database': ['db', 'sqlite', 'sqlite3'], 'All Files': ['*'] },
            title: 'Select WPipe Tracking Database'
        });
        if (!dbUri) return; // User cancelled
        finalDbPath = dbUri[0].fsPath;
    }

    // Quick Pick for optional config instead of full dialog for better flow
    const useConfig = await vscode.window.showQuickPick(['No', 'Yes'], { placeHolder: 'Select WPipe Config Directory? (Optional)' });
    let configPath = '';
    if (useConfig === 'Yes') {
        const configUri = await vscode.window.showOpenDialog({
            canSelectFiles: false,
            canSelectFolders: true,
            canSelectMany: false,
            title: 'Select WPipe Config Directory'
        });
        if (configUri) configPath = configUri[0].fsPath;
    }

    const port = await vscode.window.showInputBox({
        placeHolder: '8035',
        prompt: 'Enter port for the dashboard',
        value: '8035'
    }) || '8035';

    const terminal = vscode.window.createTerminal('WPipe Dashboard');
    const pythonCmd = process.platform === "win32" ? "python" : "python3";
    let cmd = `${pythonCmd} -m wpipe.dashboard --db "${finalDbPath}" --port ${port}`;
    if (configPath) cmd += ` --config-dir "${configPath}"`;

    terminal.show();
    terminal.sendText(cmd);

    vscode.window.showInformationMessage(`🚀 Starting WPipe Dashboard inside VS Code...`);
    
    // Open the native Webview panel
    // We wait a bit for the server to start (similar to the previous timeout)
    setTimeout(() => {
        DashboardPanel.createOrShow(context.extensionUri, port);
    }, 2500);
}
