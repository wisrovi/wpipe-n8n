import * as vscode from 'vscode';
import { parser } from '@lezer/python';

export interface WorkspaceStep {
    name: string;
    version: string;
    filePath: string;
    line: number;
    description?: string;
    tags?: string[];
    isAiStep?: boolean;
    aiPrompt?: string;
}

export class WorkspaceIndex {
    private static steps: Map<string, WorkspaceStep> = new Map();
    private static isIndexing: boolean = false;
    private static pendingIndex: boolean = false;
    private static debounceTimer: NodeJS.Timeout | null = null;

    public static debouncedIndex(delayMs: number = 600): Promise<void> {
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
        }
        return new Promise<void>((resolve) => {
            this.debounceTimer = setTimeout(async () => {
                this.debounceTimer = null;
                await this.indexWorkspace();
                resolve();
            }, delayMs);
        });
    }

    public static async indexWorkspace() {
        if (this.isIndexing) {
            this.pendingIndex = true;
            return;
        }
        this.isIndexing = true;
        try {
            const config = vscode.workspace.getConfiguration('wpipe');
            const userExcludes = config.get<string[]>('excludePaths', []);
            const maxFiles = config.get<number>('maxSearchFiles', 200);

            const defaultExcludes = [
                '**/node_modules/**', '**/.venv/**', '**/venv/**', '**/.env/**', '**/env/**',
                '**/.conda/**', '**/conda/**', '**/site-packages/**', '**/wpipe/wpipe/**',
                '**/__pycache__/**', '**/.pytest_cache/**', '**/.mypy_cache/**',
                '**/.ruff_cache/**', '**/.tox/**', '**/build/**', '**/dist/**', '**/*.egg-info/**',
                '**/.git/**', '**/.svn/**'
            ];

            const combinedExcludes = Array.from(new Set([...defaultExcludes, ...userExcludes]));
            const excludePattern = `{${combinedExcludes.join(',')}}`;

            // Focus search on state and step definitions to prevent scanning unrelated files
            const files = await vscode.workspace.findFiles('{**/states/*.py,**/app/**/*.py,**/steps/*.py,**/*step*.py}', excludePattern, maxFiles);
            
            const newSteps: Map<string, WorkspaceStep> = new Map();

            for (const f of files) {
                try {
                    const contentData = await vscode.workspace.fs.readFile(f);
                    if (contentData.length > 500000) continue;
                    
                    const content = new TextDecoder().decode(contentData);
                    if (!content.includes('@step')) continue;

                    const tree = parser.parse(content);
                
                tree.iterate({
                    enter: (node) => {
                        if (node.name === 'Decorator') {
                            const decText = content.substring(node.from, node.to);
                            if (decText.startsWith('@step')) {
                                let name = '';
                                let version = 'v1.0';
                                let description = '';
                                
                                const nameMatch = decText.match(/name\s*=\s*['"](.*?)['"]/);
                                if (nameMatch) name = nameMatch[1];

                                const verMatch = decText.match(/version\s*=\s*['"](.*?)['"]/);
                                if (verMatch) version = verMatch[1];

                                const descMatch = decText.match(/description\s*=\s*['"](.*?)['"]/);
                                if (descMatch) description = descMatch[1];
                                
                                if (!name && node.node.parent) {
                                    let funcDef = node.node.parent.getChild('FunctionDefinition') || node.node.parent.getChild('ClassDefinition');
                                    if (funcDef) {
                                        let varName = funcDef.getChild('VariableName') || funcDef.getChild('ClassName');
                                        if (varName) name = content.substring(varName.from, varName.to);
                                    }
                                }
                                
                                if (name) {
                                    const line = content.substring(0, node.from).split('\n').length - 1;
                                    const isAi = content.includes("AI AGENT PROMPT") || content.includes("intelligent_step") || decText.includes('"ai"');
                                    let aiPrompt: string | undefined;
                                    const promptMatch = content.match(/DIRECTIVA \/ PROMPT DEL USUARIO:\s*[\r\n]+["']([\s\S]*?)["']/);
                                    if (promptMatch) {
                                        aiPrompt = promptMatch[1].trim();
                                    }
                                    newSteps.set(name, { name, version, filePath: f.fsPath, line, description, isAiStep: isAi, aiPrompt });
                                }
                            }
                        }
                    }
                });
            } catch (e) {}
        }
        this.steps = newSteps;
    } finally {
        this.isIndexing = false;
        if (this.pendingIndex) {
            this.pendingIndex = false;
            this.debouncedIndex(300);
        }
    }
}

    public static getStep(name: string): WorkspaceStep | undefined {
        if (!name) return undefined;
        if (this.steps.has(name)) return this.steps.get(name);

        const clean = name.replace(/(?:[_\s-]*step)+$/i, "");
        if (this.steps.has(clean)) return this.steps.get(clean);
        if (this.steps.has(`${clean}Step`)) return this.steps.get(`${clean}Step`);

        const lowerName = name.toLowerCase();
        const lowerClean = clean.toLowerCase();
        for (const step of this.steps.values()) {
            const fileName = step.filePath.split(/[/\\]/).pop() || "";
            const fileStem = fileName.replace(/\.py$/, "").toLowerCase();
            if (
                fileStem === lowerName ||
                fileStem === lowerClean ||
                fileStem === `${lowerClean}_step` ||
                fileStem.replace(/(?:[_\s-]*step)+$/i, "") === lowerClean
            ) {
                return step;
            }
        }
        return undefined;
    }

    public static getAllSteps(): WorkspaceStep[] {
        return Array.from(this.steps.values());
    }
}
