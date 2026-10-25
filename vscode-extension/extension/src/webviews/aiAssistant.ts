import * as vscode from 'vscode';

export function showAiAssistant(extensionUri: vscode.Uri) {
    const panel = vscode.window.createWebviewPanel(
        'wpipeAI',
        'WPipe AI Assistant',
        vscode.ViewColumn.Beside,
        {
            enableScripts: true,
            retainContextWhenHidden: true
        }
    );

    panel.webview.html = getHtml(panel.webview);

    panel.webview.onDidReceiveMessage(message => {
        if (message.command === 'generate') {
            const prompt = (message.text || '').toLowerCase();
            let code = '';

            if (prompt.includes('download') || prompt.includes('fetch') || prompt.includes('sqlite') || prompt.includes('database')) {
                code = `from wpipe import Pipeline, step, to_obj
from wpipe.timeout import timeout_sync
from pydantic import BaseModel
from typing import Any

class IngestionContext(BaseModel):
    data: dict[str, Any] = {}
    status: str = "PENDING"

@step(name="FetchDataStep", version="1.0.0")
class FetchDataStep:
    @timeout_sync(30)
    @to_obj(IngestionContext)
    def __call__(self, context: Any) -> Any:
        context.data = {"status": "ok", "items": [1, 2, 3]}
        context.status = "FETCHED"
        return context

@step(name="SaveToDbStep", version="1.0.0")
class SaveToDbStep:
    @timeout_sync(30)
    @to_obj(IngestionContext)
    def __call__(self, context: Any) -> Any:
        context.status = "SAVED"
        return context

pipe = Pipeline(
    pipeline_name="IngestionPipeline",
    tracking_db="output/data.db",
    collect_system_metrics=False,
    show_progress=False
)
pipe.set_steps([
    FetchDataStep(),
    SaveToDbStep(),
])

if __name__ == "__main__":
    result = pipe.run({"data": {}})
    print("Pipeline completed:", result)
`;
            } else if (prompt.includes('parallel') || prompt.includes('concurrent') || prompt.includes('multi')) {
                code = `from wpipe import Pipeline, Parallel, step, to_obj
from wpipe.timeout import timeout_sync
from pydantic import BaseModel
from typing import Any

class ParallelTaskContext(BaseModel):
    metrics: dict[str, Any] = {}

@step(name="TaskAlphaStep", version="1.0.0")
class TaskAlphaStep:
    @timeout_sync(15)
    @to_obj(ParallelTaskContext)
    def __call__(self, context: Any) -> Any:
        context.metrics["alpha"] = True
        return context

@step(name="TaskBetaStep", version="1.0.0")
class TaskBetaStep:
    @timeout_sync(15)
    @to_obj(ParallelTaskContext)
    def __call__(self, context: Any) -> Any:
        context.metrics["beta"] = True
        return context

pipe = Pipeline(
    pipeline_name="ParallelExecutionPipeline",
    tracking_db="output/parallel.db"
)
pipe.set_steps([
    Parallel(steps=[TaskAlphaStep(), TaskBetaStep()], max_workers=2)
])

if __name__ == "__main__":
    pipe.run({"metrics": {}})
`;
            } else {
                code = `from wpipe import Pipeline, step, to_obj
from pydantic import BaseModel
from typing import Any

class CustomStepContext(BaseModel):
    data: dict[str, Any] = {}

@step(name="CustomStep", version="1.0.0", description="User defined WPipe step")
class CustomStep:
    @to_obj(CustomStepContext)
    def __call__(self, context: Any) -> Any:
        # Implement your step logic here
        return context

pipe = Pipeline(pipeline_name="CustomPipeline", tracking_db="output/data.db")
pipe.set_steps([CustomStep()])
`;
            }

            panel.webview.postMessage({ command: 'result', code: code });
        } else if (message.command === 'insert') {
            const editor = vscode.window.activeTextEditor;
            if (editor) {
                editor.edit(eb => {
                    eb.insert(editor.selection.active, message.code);
                });
            } else {
                vscode.window.showWarningMessage("Open a Python file first to insert the generated code.");
            }
        }
    });
}

function getHtml(webview: vscode.Webview) {
    return `<!DOCTYPE html>
    <html>
    <head>
        <style>
            body { font-family: sans-serif; padding: 20px; background: #1e1e1e; color: #ccc; }
            input { width: 100%; padding: 10px; background: #333; color: white; border: 1px solid #444; border-radius: 4px; margin-bottom: 10px; }
            button { background: #007acc; color: white; border: none; padding: 10px 20px; border-radius: 4px; cursor: pointer; }
            pre { background: #000; padding: 15px; border-radius: 4px; overflow-x: auto; color: #9cdcfe; border: 1px solid #333; }
            .chat-msg { margin-bottom: 20px; }
        </style>
    </head>
    <body>
        <h2>🤖 WPipe AI Assistant</h2>
        <div class="chat-msg">
            <p>Describe what you want to build:</p>
            <input type="text" id="prompt" placeholder="e.g. A pipeline with parallel tasks...">
            <button onclick="generate()">Generate Structure</button>
        </div>
        <div id="output" style="display:none;">
            <h3>Generated Code:</h3>
            <pre id="code-block"></pre>
            <button onclick="insert()">Insert into Editor</button>
        </div>
        <script>
            const vscode = acquireVsCodeApi();
            function generate() {
                const text = document.getElementById('prompt').value;
                vscode.postMessage({ command: 'generate', text: text });
            }
            function insert() {
                const code = document.getElementById('code-block').innerText;
                vscode.postMessage({ command: 'insert', code: code });
            }
            window.addEventListener('message', event => {
                const message = event.data;
                if (message.command === 'result') {
                    document.getElementById('output').style.display = 'block';
                    document.getElementById('code-block').innerText = message.code;
                }
            });
        </script>
    </body>
    </html>`;
}
