import re
from typing import Any
from app.schemas.ir import (
    CanvasIR,
    SemanticIR,
    SemanticStep,
    TargetIR,
    TargetFile,
    StepOrigin,
)


def transform_canvas_to_semantic(canvas_ir: CanvasIR, pipeline_name: str = "main_pipeline") -> SemanticIR:
    node_map = {node.id: node for node in canvas_ir.nodes}
    adj: dict[str, list[str]] = {node.id: [] for node in canvas_ir.nodes}
    in_degree: dict[str, int] = {node.id: 0 for node in canvas_ir.nodes}

    # Separate root level nodes from nested nodes attached to parent C-blocks
    root_nodes = [node for node in canvas_ir.nodes if not node.data.parent_id]

    for edge in canvas_ir.edges:
        if edge.source in adj and edge.target in in_degree:
            adj[edge.source].append(edge.target)
            in_degree[edge.target] += 1

    # Topological sort for execution order
    queue = [node.id for node in root_nodes if in_degree[node.id] == 0]
    ordered_ids: list[str] = []

    while queue:
        curr = queue.pop(0)
        ordered_ids.append(curr)
        for neighbor in adj.get(curr, []):
            in_degree[neighbor] -= 1
            if in_degree[neighbor] == 0 and not node_map[neighbor].data.parent_id:
                queue.append(neighbor)

    # Helper function to build SemanticStep recursively
    def build_semantic_step(node) -> SemanticStep:
        data = node.data
        step = SemanticStep(
            step_id=node.id,
            name=data.label,
            step_type=data.node_type,
            namespace=data.namespace,
            func_name=data.func_name,
            origin=data.origin,
            params=data.params,
            contract=data.contract,
            condition_expression=data.condition_expression,
            for_iterations=data.for_iterations,
            merge_policy=data.merge_policy,
            notes=data.notes,
            code_snippet=data.code_snippet,
        )

        # Children nested inside slots
        if_children = [
            build_semantic_step(child)
            for child in canvas_ir.nodes
            if child.data.parent_id == node.id and child.data.slot_type in ("if_body", "loop_body", "parallel_body")
        ]
        else_children = [
            build_semantic_step(child)
            for child in canvas_ir.nodes
            if child.data.parent_id == node.id and child.data.slot_type == "else_body"
        ]

        if data.node_type == "condition":
            step.branch_true = if_children
            step.branch_false = else_children
        elif data.node_type == "for":
            step.loop_steps = if_children
        elif data.node_type == "parallel":
            step.parallel_steps = if_children

        return step

    steps: list[SemanticStep] = []
    global_reads: set[str] = set()
    global_writes: set[str] = set()

    for node_id in ordered_ids:
        node = node_map[node_id]
        step = build_semantic_step(node)
        steps.append(step)

        global_reads.update(node.data.contract.reads)
        global_writes.update(node.data.contract.writes)

    return SemanticIR(
        pipeline_name=pipeline_name,
        steps=steps,
        global_context_reads=sorted(list(global_reads)),
        global_context_writes=sorted(list(global_writes)),
    )


def _sanitize_ident(name: str) -> str:
    cleaned = re.sub(r"[^a-zA-Z0-9_]", "_", name).lower()
    return cleaned.strip("_") or "step"


def _pascal_case(name: str) -> str:
    parts = _sanitize_ident(name).split("_")
    return "".join(p.capitalize() for p in parts if p) or "Step"


def _collect_all_steps(steps: list[SemanticStep]) -> list[SemanticStep]:
    all_s: list[SemanticStep] = []
    for s in steps:
        all_s.append(s)
        if s.branch_true:
            all_s.extend(_collect_all_steps(s.branch_true))
        if s.branch_false:
            all_s.extend(_collect_all_steps(s.branch_false))
        if s.loop_steps:
            all_s.extend(_collect_all_steps(s.loop_steps))
        if s.parallel_steps:
            all_s.extend(_collect_all_steps(s.parallel_steps))
    return all_s


def transform_semantic_to_target(semantic_ir: SemanticIR, project_name: str = "wpipe_microservice") -> TargetIR:
    all_steps = _collect_all_steps(semantic_ir.steps)

    has_condition = any(s.step_type == "condition" for s in all_steps)
    has_for = any(s.step_type == "for" for s in all_steps)
    has_parallel = any(s.step_type == "parallel" for s in all_steps)

    wpipe_symbols = ["Pipeline", "step"]
    if has_condition:
        wpipe_symbols.append("Condition")
    if has_for:
        wpipe_symbols.append("For")
    if has_parallel:
        wpipe_symbols.append("Parallel")

    imports: list[str] = [f"from wpipe import {', '.join(wpipe_symbols)}"]
    custom_state_files: list[TargetFile] = []
    custom_dto_files: list[TargetFile] = []
    custom_func_names: dict[str, str] = {}

    # Process custom user/described steps (Dialect A generation or user-imported files)
    for s in all_steps:
        if s.step_type == "step":
            is_custom = s.origin in (StepOrigin.DESCRIBED, StepOrigin.USER_IMPORTED) or not (s.namespace and s.func_name)
            if is_custom:
                func_safe = _sanitize_ident(s.name)
                pascal = _pascal_case(s.name)

                # If the user attached a concrete .py file with code_snippet, preserve their code directly
                if s.code_snippet and s.code_snippet.strip():
                    user_code = s.code_snippet.strip() + "\n"
                    match_def = re.search(r"def\s+([a-zA-Z0-9_]+)\s*\(", user_code)
                    actual_func = match_def.group(1) if match_def else f"{func_safe}_step"
                    custom_func_names[s.step_id] = actual_func

                    state_path = f"app/states/{func_safe}.py"
                    custom_state_files.append(TargetFile(path=state_path, content=user_code))
                    imports.append(f"from app.states.{func_safe} import {actual_func}")
                else:
                    # AI-described or scaffolded step: emit Dialect A DTO + typed state
                    actual_func = f"{func_safe}_step"
                    custom_func_names[s.step_id] = actual_func

                    # DTO code
                    fields_code = ""
                    all_fields = sorted(list(set(s.contract.reads + s.contract.writes)))
                    if all_fields:
                        for f in all_fields:
                            fields_code += f"    {f}: Optional[Any] = Field(default=None, description='Contract field {f}')\n"
                    else:
                        fields_code = "    data: Optional[dict[str, Any]] = Field(default_factory=dict)\n"

                    dto_code = f'''from typing import Any, Optional
from pydantic import BaseModel, Field


class {pascal}Context(BaseModel):
    """Data Transfer Object for {s.name}."""
{fields_code}
'''
                    dto_path = f"app/dto/{func_safe}_dto.py"
                    custom_dto_files.append(TargetFile(path=dto_path, content=dto_code))

                    # State code (Dialect A)
                    write_lines = ""
                    for w in s.contract.writes:
                        write_lines += f'    result["{w}"] = getattr(context, "{w}", None) or "processed_{w}"\n'
                    if not write_lines:
                        write_lines = '    result["status"] = "success"\n'

                    state_code = f'''from typing import Any
from wpipe import step, to_obj
from app.dto.{func_safe}_dto import {pascal}Context


@step(name="{s.name}")
@to_obj({pascal}Context)
def {func_safe}_step(context: {pascal}Context) -> dict[str, Any]:
    """
    {s.notes or f'Custom Step {s.name} (Dialect A).'}
    """
    result: dict[str, Any] = {{}}
{write_lines}
    return result
'''
                    state_path = f"app/states/{func_safe}.py"
                    custom_state_files.append(TargetFile(path=state_path, content=state_code))
                    imports.append(f"from app.states.{func_safe} import {func_safe}_step")
            else:
                imports.append(f"from {s.namespace} import {s.func_name}")

    def render_step(s: SemanticStep, indent: int = 8) -> str:
        pad = " " * indent
        if s.step_type == "step":
            is_custom = s.origin in (StepOrigin.DESCRIBED, StepOrigin.USER_IMPORTED) or not (s.namespace and s.func_name)
            if is_custom:
                func_safe = _sanitize_ident(s.name)
                func_name = custom_func_names.get(s.step_id, f"{func_safe}_step")
                return f"{pad}{func_name}"
            else:
                if s.params:
                    args = ", ".join(f"{k}={repr(v)}" for k, v in s.params.items())
                    return f"{pad}{s.func_name}({args})"
                return f"{pad}{s.func_name}()"

        elif s.step_type == "condition":
            expr = s.condition_expression or "True"
            true_rendered = ",\n".join(render_step(c, indent + 4) for c in s.branch_true)
            false_rendered = ",\n".join(render_step(c, indent + 4) for c in s.branch_false)
            true_block = f"[\n{true_rendered}\n{pad}    ]" if true_rendered else "[]"
            false_block = f"[\n{false_rendered}\n{pad}    ]" if false_rendered else "[]"
            return (
                f'{pad}Condition(\n'
                f'{pad}    expression="{expr}",\n'
                f'{pad}    branch_true={true_block},\n'
                f'{pad}    branch_false={false_block}\n'
                f'{pad})'
            )

        elif s.step_type == "for":
            iters = s.for_iterations or 5
            loop_rendered = ",\n".join(render_step(c, indent + 4) for c in s.loop_steps)
            loop_block = f"[\n{loop_rendered}\n{pad}    ]" if loop_rendered else "[]"
            return (
                f'{pad}For(\n'
                f'{pad}    iterations={iters},\n'
                f'{pad}    steps={loop_block}\n'
                f'{pad})'
            )

        elif s.step_type == "parallel":
            policy = s.merge_policy or "accumulate"
            par_rendered = ",\n".join(render_step(c, indent + 4) for c in s.parallel_steps)
            par_block = f"[\n{par_rendered}\n{pad}    ]" if par_rendered else "[]"
            return (
                f'{pad}Parallel(\n'
                f'{pad}    steps={par_block},\n'
                f'{pad}    merge_policy="{policy}"\n'
                f'{pad})'
            )
        return f"{pad}# Unknown step {s.name}"

    step_declarations = [render_step(s, indent=8) for s in semantic_ir.steps]
    steps_str = ",\n".join(step_declarations) if step_declarations else "        # No steps configured"
    imports_str = "\n".join(sorted(list(set(imports))))

    pipeline_code = f"""# Generated by WPipe Studio
{imports_str}


def build_pipeline() -> Pipeline:
    pipe = Pipeline(name="{semantic_ir.pipeline_name}")
    pipe.set_steps([
{steps_str}
    ])
    return pipe


if __name__ == "__main__":
    pipe = build_pipeline()
    result = pipe.run()
    print("Pipeline execution completed successfully:", result)
"""

    main_code = """from fastapi import FastAPI
from app.pipelines import build_pipeline

app = FastAPI(title="WPipe Microservice", version="1.0.0")


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/run")
def run_pipeline(payload: dict | None = None):
    pipe = build_pipeline()
    result = pipe.run(payload or {})
    return {"status": "success", "result": result}
"""

    dockerfile = """FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
CMD ["python3", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
"""

    makefile = """help:
\t@echo "Available commands: install, dev, test, lint, format"

install:
\tpip install -r requirements.txt

dev:
\tuvicorn app.main:app --reload

test:
\tpytest app/tests/ -q

lint:
\truff check app/

format:
\truff format app/
"""

    readme = f"""# {project_name}

Microservicio Python auto-generado y verificado por **WPipe Studio**.

## Tecnologías y Librerías Principales
- **FastAPI**: Framework web asíncrono para exponer endpoints HTTP.
- **WPipe**: Motor de orquestación de pipelines y flujos de trabajo de alto rendimiento.
- **Pydantic**: Validación estricta de esquemas de datos y DTOs de contexto.
- **Uvicorn**: Servidor ASGI de producción.
- **Pytest**: Suite de pruebas unitarias automatizadas.
- **Ruff**: Linter y formateador ultrarrápido.

## Cómo ejecutar los tests
```bash
pytest app/tests/ -q
```
"""

    test_code = """from app.pipelines import build_pipeline


def test_pipeline_builds():
    pipe = build_pipeline()
    assert pipe is not None
    assert pipe.name == "main_pipeline"
    assert len(pipe.tasks_list) >= 0
"""

    # Dynamic requirements resolution
    reqs: set[str] = {
        "fastapi>=0.110.0",
        "uvicorn>=0.28.0",
        "wpipe>=2.5.10",
        "pydantic>=2.0.0",
        "pytest>=8.0.0",
        "ruff>=0.3.0",
    }

    for s in all_steps:
        ns = (s.namespace or "").lower()
        if "wpipe_steps" in ns:
            reqs.add("wpipe-steps>=0.1.0")
        if "wpipe_plugins" in ns:
            reqs.add("wpipe-plugins>=0.1.2")
        if "vision" in ns or "yolo" in ns:
            reqs.add("torch>=2.0.0")
            reqs.add("ultralytics>=8.0.0")
            reqs.add("opencv-python>=4.8.0")
        if "redis" in ns:
            reqs.add("redis>=5.0.0")
        if "http" in ns or "connectivity" in ns:
            reqs.add("requests>=2.31.0")
            reqs.add("httpx>=0.27.0")

    reqs_str = "\n".join(sorted(list(reqs))) + "\n"

    files = [
        TargetFile(path="app/__init__.py", content=""),
        TargetFile(path="app/pipelines.py", content=pipeline_code),
        TargetFile(path="app/main.py", content=main_code),
        TargetFile(path="app/dto/__init__.py", content=""),
        TargetFile(path="app/states/__init__.py", content=""),
        TargetFile(path="app/tests/__init__.py", content=""),
        TargetFile(path="app/tests/test_pipelines.py", content=test_code),
        TargetFile(path="Dockerfile", content=dockerfile),
        TargetFile(path="Makefile", content=makefile),
        TargetFile(path="requirements.txt", content=reqs_str),
        TargetFile(path="README.md", content=readme),
    ]

    files.extend(custom_dto_files)
    files.extend(custom_state_files)

    return TargetIR(project_name=project_name, files=files)
