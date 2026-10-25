import * as vscode from 'vscode';
import { parser } from '@lezer/python';

export class WPipeCodeActionProvider implements vscode.CodeActionProvider {
    public static readonly providedCodeActionKinds = [
        vscode.CodeActionKind.QuickFix
    ];

    public provideCodeActions(document: vscode.TextDocument, range: vscode.Range, context: vscode.CodeActionContext, token: vscode.CancellationToken): vscode.CodeAction[] {
        const actions: vscode.CodeAction[] = [];
        const content = document.getText();
        
        try {
            const tree = parser.parse(content);
            tree.iterate({
                enter: (node) => {
                    if (node.name === 'FunctionDefinition' || node.name === 'ClassDefinition') {
                        const targetRange = new vscode.Range(
                            document.positionAt(node.from),
                            document.positionAt(node.to)
                        );
                        
                        // Check if the current range (cursor) is within this definition
                        if (range.intersection(targetRange)) {
                            // Check if it already has a @step decorator
                            let hasStepDecorator = false;
                            let parent = node.node.parent;
                            let targetOffset = node.from;
                            if (parent) {
                                parent.getChildren('Decorator').forEach(dec => {
                                    const decText = content.substring(dec.from, dec.to);
                                    if (decText.startsWith('@step')) {
                                        hasStepDecorator = true;
                                    }
                                });
                                // If the statement is already decorated by another decorator, place @step above the whole decorated statement
                                if (parent.name === 'DecoratedStatement') {
                                    targetOffset = parent.from;
                                }
                            }

                            if (!hasStepDecorator) {
                                const action = new vscode.CodeAction('Convert to WPipe Step', vscode.CodeActionKind.QuickFix);
                                action.edit = new vscode.WorkspaceEdit();
                                
                                const nameNode = node.node.getChild('VariableName') || node.node.getChild('ClassName');
                                const rawName = nameNode ? content.substring(nameNode.from, nameNode.to) : 'my_step';
                                const stepName = rawName.endsWith('Step') ? rawName : `${rawName.charAt(0).toUpperCase()}${rawName.slice(1)}Step`;
                                
                                const decorator = `@step(name="${stepName}", version="1.0.0")\n`;
                                action.edit.insert(document.uri, document.positionAt(targetOffset), decorator);
                                
                                // Check if wpipe is imported
                                if (!content.includes('from wpipe import step') && !content.includes('from wpipe import')) {
                                    action.edit.insert(document.uri, new vscode.Position(0, 0), 'from wpipe import step\n');
                                }
                                
                                actions.push(action);
                            }
                        }
                    }
                }
            });
        } catch (e) {}

        return actions;
    }
}
