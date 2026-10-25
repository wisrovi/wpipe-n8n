import * as vscode from 'vscode';
import { WorkspaceIndex } from '../core/workspaceIndex';
import { CatalogManager } from '../core/catalog';

export class WPipeHoverProvider implements vscode.HoverProvider {
    provideHover(document: vscode.TextDocument, position: vscode.Position): vscode.ProviderResult<vscode.Hover> {
        const range = document.getWordRangeAtPosition(position);
        if (!range) return null;

        const word = document.getText(range);
        
        // 1. Check Workspace
        const wsStep = WorkspaceIndex.getStep(word);
        if (wsStep) {
            const md = new vscode.MarkdownString();
            md.appendMarkdown(`### 🚀 WPipe Step: ${wsStep.name}\n`);
            md.appendMarkdown(`**Version:** ${wsStep.version}\n\n`);
            if (wsStep.description) md.appendMarkdown(`**Description:** ${wsStep.description}\n\n`);
            md.appendMarkdown(`---\n*Location:* ${vscode.workspace.asRelativePath(wsStep.filePath)}:${wsStep.line + 1}`);
            return new vscode.Hover(md);
        }

        // 2. Check Catalog
        const catStep = CatalogManager.getSteps().find(s => s.name === word || s.func_name === word);
        if (catStep) {
            const md = new vscode.MarkdownString();
            md.appendMarkdown(`### 📦 WPipe Library: ${catStep.func_name || catStep.name}\n`);
            md.appendMarkdown(`**Module:** \`${catStep.namespace}\`\n\n`);
            if (catStep.description) md.appendMarkdown(`**Description:** ${catStep.description}\n\n`);
            md.appendMarkdown(`**Author:** ${catStep.author || "William Steve Rodriguez Villamizar"}\n`);
            md.appendMarkdown(`**Repo:** ${catStep.repo}\n\n`);
            if (catStep.how_to_use) {
                md.appendMarkdown(`**Import:** \`${catStep.how_to_use}\`\n\n`);
            }
            md.appendMarkdown(`---\n*WPipe Official Steps Catalog*`);
            return new vscode.Hover(md);
        }

        return null;
    }
}
