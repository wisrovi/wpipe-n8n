import * as vscode from 'vscode';
import { CatalogManager, StepEntry } from '../core/catalog';
import { WorkspaceIndex } from '../core/workspaceIndex';

import { parser } from '@lezer/python';

export class WPipeStepProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<vscode.TreeItem | undefined | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private ipcClient?: any;

    setIpcClient(client: any) {
        this.ipcClient = client;
    }

    refresh() {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(e: vscode.TreeItem): vscode.TreeItem {
        return e;
    }

    async getChildren(e?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
        if (!e) {
            let engineLabel = '⚡ Engine & License';
            let engineDesc = 'Checking...';
            let engineTooltip = 'Native wpipe-engine status';

            if (this.ipcClient) {
                try {
                    const status = await this.ipcClient.getLicenseStatus();
                    if (status && status.is_pro) {
                        engineLabel = `⚡ Engine: Active (${(status.tier || 'PRO').toUpperCase()})`;
                        engineDesc = status.customer_name ? `Pro (${status.customer_name})` : 'Pro Active';
                        engineTooltip = `WPipe Engine Active\nTier: ${(status.tier || 'PRO').toUpperCase()}\nPID: ${status.engine?.pid || 'Running'}\nUnlimited Blocks`;
                    } else if (status) {
                        engineLabel = '⚡ Engine: Active (Free)';
                        engineDesc = 'Free Plan (≤5 blocks)';
                        engineTooltip = 'WPipe Engine Free Tier. Click to check license or upgrade.';
                    }
                } catch {
                    engineLabel = '⚡ Engine: Offline';
                    engineDesc = 'Click to start';
                    engineTooltip = 'wpipe-engine is not running. Click to start daemon.';
                }
            }

            const engineItem = new vscode.TreeItem(engineLabel, vscode.TreeItemCollapsibleState.None);
            engineItem.description = engineDesc;
            engineItem.tooltip = engineTooltip;
            engineItem.iconPath = new vscode.ThemeIcon(engineLabel.includes('Offline') ? 'warning' : 'pass');
            engineItem.command = {
                command: 'wpipe.checkLicenseStatus',
                title: 'Check License Status',
            };

            return [
                engineItem,
                new vscode.TreeItem('🚀 Workspace Pipelines', vscode.TreeItemCollapsibleState.Expanded),
                new vscode.TreeItem('🛠️ Workspace Steps', vscode.TreeItemCollapsibleState.Expanded),
                new vscode.TreeItem('📦 Official Library', vscode.TreeItemCollapsibleState.Collapsed),
                new vscode.TreeItem('🤝 Community Plugins', vscode.TreeItemCollapsibleState.Collapsed)
            ];
        }

        const label = e.label as string;
        if (label.includes('Pipelines')) return this.searchPipelines();
        if (label.includes('Workspace Steps')) return this.searchWorkspace();
        if (label.includes('Official')) return this.getLibItems('Official');
        if (label.includes('Community')) return this.getLibItems('Community');
        return [];
    }

    private getLibItems(repo: string): LibraryItem[] {
        return CatalogManager.getSteps()
            .filter(s => s.repo === repo)
            .map(s => new LibraryItem(s));
    }

    private async searchPipelines(): Promise<vscode.TreeItem[]> {
        const items: vscode.TreeItem[] = [];
        const files = await vscode.workspace.findFiles('**/{*.wpipe,*.wpipe.json,pipelines.py}', '**/node_modules/**');
        
        for (const file of files) {
            const relPath = vscode.workspace.asRelativePath(file);
            const isVisual = file.fsPath.endsWith('.wpipe') || file.fsPath.endsWith('.wpipe.json');
            const item = new vscode.TreeItem(relPath, vscode.TreeItemCollapsibleState.None);
            
            if (isVisual) {
                item.iconPath = new vscode.ThemeIcon('circuit-board');
                item.description = 'Visual Canvas';
                item.tooltip = `Visual WPipe Pipeline: ${relPath}\nClick to open in Canvas`;
                item.command = {
                    command: 'vscode.openWith',
                    title: 'Open Canvas',
                    arguments: [file, 'wpipe.canvasEditor']
                };
            } else {
                item.iconPath = new vscode.ThemeIcon('play-circle');
                item.description = 'Python Pipeline';
                item.tooltip = `Compiled Python Pipeline: ${relPath}\nClick to open source code`;
                item.command = {
                    command: 'vscode.open',
                    title: 'Open Code',
                    arguments: [file]
                };
            }
            items.push(item);
        }

        if (items.length === 0) {
            const emptyItem = new vscode.TreeItem('No pipelines found yet', vscode.TreeItemCollapsibleState.None);
            emptyItem.description = 'Create with command WPipe: Create New Visual Pipeline';
            emptyItem.iconPath = new vscode.ThemeIcon('info');
            return [emptyItem];
        }

        return items;
    }

    private async searchWorkspace(): Promise<StepItem[]> {
        await WorkspaceIndex.indexWorkspace();
        return WorkspaceIndex.getAllSteps().map(s => new StepItem(s.name, s.filePath, s.line));
    }
}

export class StepItem extends vscode.TreeItem {
    constructor(label: string, public filePath: string, public line: number) {
        super(label);
        this.iconPath = new vscode.ThemeIcon('rocket');
        this.description = label; // Simplified for web compatibility
        this.contextValue = 'workspaceStep';
        this.command = { command: 'wpipeSteps.openFile', title: 'Open', arguments: [filePath, line] };
    }
    public funcName: string = '';
}

export class LibraryItem extends vscode.TreeItem {
    constructor(public step: StepEntry) {
        super(step.name);
        this.iconPath = new vscode.ThemeIcon('cloud');
        this.description = step.version ? `v${step.version}` : step.namespace;
        
        const tooltip = new vscode.MarkdownString();
        tooltip.isTrusted = true;
        tooltip.appendMarkdown(`### 📦 ${step.name} \n`);
        if (step.version) tooltip.appendMarkdown(`*Version: ${step.version}*\n\n`);
        
        if (step.description) {
            tooltip.appendMarkdown(`> ${step.description}\n\n`);
        }

        tooltip.appendMarkdown(`---\n`);
        tooltip.appendMarkdown(`**Author:** ${step.author || "Official"}\n\n`);
        tooltip.appendMarkdown(`**Repo:** ${step.repo}\n\n`);
        tooltip.appendMarkdown(`**Module:** \`${step.namespace}\`\n\n`);

        if (step.requirements) {
            tooltip.appendMarkdown(`**Requirements:** \`${step.requirements}\`\n\n`);
        }

        if (step.how_to_use) {
            tooltip.appendMarkdown(`**Usage:**\n\`\`\`python\n${step.how_to_use}\n\`\`\`\n\n`);
        }

        if (step.examples) {
            tooltip.appendMarkdown(`[Explore Examples](${step.examples})\n\n`);
        }

        tooltip.appendMarkdown(`---\n*Click to insert import and usage.*`);
        
        this.tooltip = tooltip;
        this.contextValue = 'libraryStep';
        this.command = { command: 'wpipeSteps.insertStep', title: 'Insert', arguments: [step] };
    }
}
