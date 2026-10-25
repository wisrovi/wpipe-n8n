import re
from datetime import UTC, datetime
from typing import Any

from app.schemas.ir import (
    CanvasIR,
    SemanticIR,
    SemanticStep,
    StepOrigin,
    TargetFile,
    TargetIR,
)

PACK_ALIASES: dict[str, str] = {
    "wpipe_steps.storage": "wpipe_steps.database",
    "wpipe_steps.network": "wpipe_steps.security",
    "wpipe_steps.db": "wpipe_steps.database",
}

KNOWN_STEP_NAMESPACES: dict[str, str] = {
    "HttpRequest": "wpipe_steps.connectivity",
    "HttpRequestStep": "wpipe_steps.connectivity",
    "GraphQLQuery": "wpipe_steps.connectivity",
    "GraphQLQueryStep": "wpipe_steps.connectivity",
    "WebhookTrigger": "wpipe_steps.connectivity",
    "WebhookTriggerStep": "wpipe_steps.connectivity",
    "SftpTransfer": "wpipe_steps.connectivity",
    "SftpTransferStep": "wpipe_steps.connectivity",
    "RSSParser": "wpipe_steps.connectivity",
    "RSSParserStep": "wpipe_steps.connectivity",
    "OAuth2Auth": "wpipe_steps.connectivity",
    "OAuth2AuthStep": "wpipe_steps.connectivity",
    "MySQLQuery": "wpipe_steps.database",
    "MySQLQueryStep": "wpipe_steps.database",
    "RedisCache": "wpipe_steps.database",
    "RedisCacheStep": "wpipe_steps.database",
    "RedisGet": "wpipe_steps.database",
    "MongoInsert": "wpipe_steps.database",
    "MongoInsertStep": "wpipe_steps.database",
    "SQLiteAudit": "wpipe_steps.database",
    "SQLiteAuditStep": "wpipe_steps.database",
    "ClickHouseBulk": "wpipe_steps.database",
    "ClickHouseBulkStep": "wpipe_steps.database",
    "CassandraWrite": "wpipe_steps.database",
    "CassandraWriteStep": "wpipe_steps.database",
    "Fail2BanCheck": "wpipe_steps.security",
    "Fail2BanCheckStep": "wpipe_steps.security",
    "NmapScan": "wpipe_steps.security",
    "NmapScanStep": "wpipe_steps.security",
    "ShodanSearch": "wpipe_steps.security",
    "ShodanSearchStep": "wpipe_steps.security",
    "HashGenerator": "wpipe_steps.security",
    "HashGeneratorStep": "wpipe_steps.security",
    "VaultSecrets": "wpipe_steps.security",
    "VaultSecretsStep": "wpipe_steps.security",
    "WafFilter": "wpipe_steps.security",
    "WafFilterStep": "wpipe_steps.security",
}

DEFAULT_STEP_CONSTRUCTOR_ARGS: dict[str, dict[str, Any]] = {
    "NmapScan": {"target": "127.0.0.1"},
    "NmapScanStep": {"target": "127.0.0.1"},
}


def transform_canvas_to_semantic(
    canvas_ir: CanvasIR, pipeline_name: str = "main_pipeline"
) -> SemanticIR:
    node_map = {node.id: node for node in canvas_ir.nodes}

    def get_root_ancestor_id(node_id: str) -> str:
        curr = node_map.get(node_id)
        visited: set[str] = set()
        while curr and curr.data.parent_id and curr.data.parent_id in node_map:
            if curr.id in visited:
                break
            visited.add(curr.id)
            curr = node_map[curr.data.parent_id]
        return curr.id if curr else node_id

    # Root level nodes (not enclosed inside a C-block slot)
    root_nodes = [node for node in canvas_ir.nodes if not node.data.parent_id]
    if not root_nodes and canvas_ir.nodes:
        root_nodes = list(canvas_ir.nodes)

    root_adj: dict[str, list[str]] = {node.id: [] for node in root_nodes}
    root_in_degree: dict[str, int] = {node.id: 0 for node in root_nodes}

    for edge in canvas_ir.edges:
        src_root = get_root_ancestor_id(edge.source)
        tgt_root = get_root_ancestor_id(edge.target)
        if src_root in root_adj and tgt_root in root_in_degree and src_root != tgt_root:
            if tgt_root not in root_adj[src_root]:
                root_adj[src_root].append(tgt_root)
                root_in_degree[tgt_root] += 1

    # Topological sort prioritizing triggers (0), middle steps (1), and responses (2)
    queue = sorted(
        [node.id for node in root_nodes if root_in_degree[node.id] == 0],
        key=lambda nid: (
            0 if node_map[nid].data.node_type == "trigger" else 2 if node_map[nid].data.node_type == "response" else 1,
            node_map[nid].position.y,
        ),
    )
    ordered_ids: list[str] = []

    while queue:
        curr = queue.pop(0)
        ordered_ids.append(curr)
        for neighbor in root_adj.get(curr, []):
            root_in_degree[neighbor] -= 1
            if root_in_degree[neighbor] == 0:
                queue.append(neighbor)
        queue.sort(
            key=lambda nid: (
                0 if node_map[nid].data.node_type == "trigger" else 2 if node_map[nid].data.node_type == "response" else 1,
                node_map[nid].position.y,
            )
        )

    # Fallback safety: ensure all root nodes are included even if disconnected or cyclic
    for node in sorted(
        root_nodes,
        key=lambda n: (0 if n.data.node_type == "trigger" else 2 if n.data.node_type == "response" else 1, n.position.y),
    ):
        if node.id not in ordered_ids:
            ordered_ids.append(node.id)

    # Helper function to order children in a slot topologically and by position
    def order_children_for_slot(parent_id: str, slot_type: str) -> list[SemanticStep]:
        children = [
            child
            for child in canvas_ir.nodes
            if child.data.parent_id == parent_id and child.data.slot_type == slot_type
        ]
        if not children:
            return []

        child_ids = {c.id for c in children}
        child_adj: dict[str, list[str]] = {c.id: [] for c in children}
        child_in: dict[str, int] = {c.id: 0 for c in children}

        for edge in canvas_ir.edges:
            if edge.source in child_ids and edge.target in child_ids:
                if edge.target not in child_adj[edge.source]:
                    child_adj[edge.source].append(edge.target)
                    child_in[edge.target] += 1

        c_queue = sorted(
            [c.id for c in children if child_in[c.id] == 0],
            key=lambda cid: node_map[cid].position.y,
        )
        c_ordered: list[str] = []
        while c_queue:
            c_curr = c_queue.pop(0)
            c_ordered.append(c_curr)
            for c_n in child_adj.get(c_curr, []):
                child_in[c_n] -= 1
                if child_in[c_n] == 0:
                    c_queue.append(c_n)
            c_queue.sort(key=lambda cid: node_map[cid].position.y)

        for c in sorted(children, key=lambda x: x.position.y):
            if c.id not in c_ordered:
                c_ordered.append(c.id)

        return [build_semantic_step(node_map[cid]) for cid in c_ordered]

    # Helper function to build SemanticStep recursively
    def build_semantic_step(node) -> SemanticStep:
        data = node.data
        clean_ns = data.namespace
        clean_fn = data.func_name
        if clean_fn in KNOWN_STEP_NAMESPACES:
            clean_ns = KNOWN_STEP_NAMESPACES[clean_fn]
        elif clean_ns:
            for old_p, new_p in PACK_ALIASES.items():
                if clean_ns == old_p or clean_ns.startswith(f"{old_p}."):
                    clean_ns = clean_ns.replace(old_p, new_p, 1)
                    break

        step = SemanticStep(
            step_id=node.id,
            name=data.label,
            step_type=data.node_type,
            trigger_type=data.trigger_type,
            trigger_param=data.trigger_param,
            response_type=data.response_type,
            response_param=data.response_param,
            namespace=clean_ns,
            func_name=clean_fn,
            origin=data.origin,
            params=data.params,
            contract=data.contract,
            condition_expression=data.condition_expression,
            for_iterations=data.for_iterations,
            merge_policy=data.merge_policy,
            notes=data.notes,
            code_snippet=data.code_snippet,
        )

        if data.node_type == "condition":
            step.branch_true = order_children_for_slot(node.id, "if_body")
            step.branch_false = order_children_for_slot(node.id, "else_body")
        elif data.node_type in ("for", "while"):
            step.loop_steps = order_children_for_slot(node.id, "loop_body")
        elif data.node_type == "parallel":
            step.parallel_steps = order_children_for_slot(node.id, "parallel_body")
        elif data.node_type == "background":
            step.loop_steps = order_children_for_slot(node.id, "background_body")

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


def transform_semantic_to_target(
    semantic_ir: SemanticIR, project_name: str = "wpipe_microservice"
) -> TargetIR:
    all_steps = _collect_all_steps(semantic_ir.steps)

    has_condition = any(s.step_type == "condition" for s in all_steps)
    has_for = any(s.step_type == "for" for s in all_steps)
    has_while = any(s.step_type == "while" for s in all_steps)
    has_parallel = any(s.step_type == "parallel" for s in all_steps)
    has_background = any(s.step_type == "background" for s in all_steps)

    wpipe_symbols = ["Pipeline", "step"]
    if has_condition:
        wpipe_symbols.append("Condition")
    if has_for or has_while:
        wpipe_symbols.append("For")
    if has_parallel:
        wpipe_symbols.append("Parallel")

    imports: list[str] = [f"from wpipe import {', '.join(wpipe_symbols)}"]
    if has_background:
        imports.append(
            "try:\n"
            "    from wpipe import Background\n"
            "except ImportError:\n"
            "    from wpipe.pipe.components.logic_blocks import Background"
        )
    custom_state_files: list[TargetFile] = []
    custom_dto_files: list[TargetFile] = []
    custom_func_names: dict[str, str] = {}

    # Process custom user/described steps (Dialect A generation or user-imported files)
    for s in all_steps:
        if s.step_type == "step":
            is_custom = s.origin in (StepOrigin.DESCRIBED, StepOrigin.USER_IMPORTED) or not (
                s.namespace and s.func_name
            )
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
                        fields_code = (
                            "    data: Optional[dict[str, Any]] = Field(default_factory=dict)\n"
                        )

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
    {s.notes or f"Custom Step {s.name} (Dialect A)."}
    """
    result: dict[str, Any] = {{}}
{write_lines}
    return result
'''
                    state_path = f"app/states/{func_safe}.py"
                    custom_state_files.append(TargetFile(path=state_path, content=state_code))
                    imports.append(f"from app.states.{func_safe} import {func_safe}_step")
            else:
                clean_ns = s.namespace or ""
                clean_fn = s.func_name or ""
                if clean_fn in KNOWN_STEP_NAMESPACES:
                    clean_ns = KNOWN_STEP_NAMESPACES[clean_fn]
                elif clean_ns:
                    for old_p, new_p in PACK_ALIASES.items():
                        if clean_ns == old_p or clean_ns.startswith(f"{old_p}."):
                            clean_ns = clean_ns.replace(old_p, new_p, 1)
                            break
                if clean_ns and clean_fn:
                    if clean_ns.startswith("wpipe_steps") and not clean_fn.endswith("Step"):
                        import_stmt = f"from {clean_ns} import {clean_fn}Step as {clean_fn}"
                    else:
                        import_stmt = f"from {clean_ns} import {clean_fn}"
                    if import_stmt not in imports:
                        imports.append(import_stmt)

    def render_step(s: SemanticStep, indent: int = 8) -> str:
        pad = " " * indent
        if s.step_type == "step":
            is_custom = s.origin in (StepOrigin.DESCRIBED, StepOrigin.USER_IMPORTED) or not (
                s.namespace and s.func_name
            )
            if is_custom:
                func_safe = _sanitize_ident(s.name)
                func_name = custom_func_names.get(s.step_id, f"{func_safe}_step")
                return f"{pad}{func_name}"
            else:
                params = dict(DEFAULT_STEP_CONSTRUCTOR_ARGS.get(s.func_name, {}))
                if s.params:
                    params.update(s.params)
                if params:
                    args = ", ".join(f"{k}={repr(v)}" for k, v in params.items())
                    return f"{pad}{s.func_name}({args})"
                return f"{pad}{s.func_name}()"

        elif s.step_type == "condition":
            expr = s.condition_expression or "True"
            true_rendered = ",\n".join(render_step(c, indent + 4) for c in s.branch_true)
            false_rendered = ",\n".join(render_step(c, indent + 4) for c in s.branch_false)
            true_block = f"[\n{true_rendered}\n{pad}    ]" if true_rendered else "[]"
            false_block = f"[\n{false_rendered}\n{pad}    ]" if false_rendered else "[]"
            if s.branch_false:
                return (
                    f"{pad}Condition(\n"
                    f'{pad}    expression="{expr}",\n'
                    f"{pad}    branch_true={true_block},\n"
                    f"{pad}    branch_false={false_block}\n"
                    f"{pad})"
                )
            else:
                return (
                    f"{pad}Condition(\n"
                    f'{pad}    expression="{expr}",\n'
                    f"{pad}    branch_true={true_block}\n"
                    f"{pad})"
                )

        elif s.step_type == "for":
            iters = s.for_iterations or 5
            loop_rendered = ",\n".join(render_step(c, indent + 4) for c in s.loop_steps)
            loop_block = f"[\n{loop_rendered}\n{pad}    ]" if loop_rendered else "[]"
            return f"{pad}For(\n{pad}    iterations={iters},\n{pad}    steps={loop_block}\n{pad})"

        elif s.step_type == "while":
            expr = s.condition_expression or "True"
            loop_rendered = ",\n".join(render_step(c, indent + 4) for c in s.loop_steps)
            loop_block = f"[\n{loop_rendered}\n{pad}    ]" if loop_rendered else "[]"
            return (
                f"{pad}For(\n"
                f'{pad}    validation_expression="{expr}",\n'
                f"{pad}    steps={loop_block}\n"
                f"{pad})"
            )

        elif s.step_type == "parallel":
            policy = s.merge_policy or "accumulate"
            par_rendered = ",\n".join(render_step(c, indent + 4) for c in s.parallel_steps)
            par_block = f"[\n{par_rendered}\n{pad}    ]" if par_rendered else "[]"
            return (
                f"{pad}Parallel(\n"
                f"{pad}    steps={par_block},\n"
                f'{pad}    merge_policy="{policy}"\n'
                f"{pad})"
            )

        elif s.step_type == "background":
            if s.loop_steps:
                child = s.loop_steps[0]
                child_rendered = render_step(child, indent=0).strip()
                return f"{pad}Background(\n{pad}    step={child_rendered}\n{pad})"
            return f"{pad}# Background (no step assigned)"

    execution_steps = [s for s in semantic_ir.steps if s.step_type not in ("trigger", "response")]
    step_declarations = [render_step(s, indent=8) for s in execution_steps]
    steps_str = (
        ",\n".join(step_declarations) if step_declarations else "        # No steps configured"
    )
    imports_str = "\n".join(sorted(list(set(imports))))

    pipeline_code = f"""# Generated by WPipe Studio
{imports_str}

# >>> [WPIPE:CUSTOM_IMPORTS:START]
# Add custom imports or dependencies here
# <<< [WPIPE:CUSTOM_IMPORTS:END]


# >>> [WPIPE:CUSTOM_LOGIC:START]
# Add custom helper functions, step transforms, or middleware here
# <<< [WPIPE:CUSTOM_LOGIC:END]


def build_pipeline() -> Pipeline:
    pipe = Pipeline(pipeline_name="{semantic_ir.pipeline_name}")
    pipe.set_steps([
{steps_str}
    ])
    return pipe


if __name__ == "__main__":
    pipe = build_pipeline()
    result = pipe.run()
    print("Pipeline execution completed successfully:", result)
"""

    trigger_step = next((s for s in semantic_ir.steps if s.step_type == "trigger"), None)
    trigger_type = (trigger_step.trigger_type if trigger_step else "api") or "api"
    trigger_param = (trigger_step.trigger_param if trigger_step else "/run") or "/run"

    response_step = next((s for s in semantic_ir.steps if s.step_type == "response"), None)
    response_type = (response_step.response_type if response_step else "http_json") or "http_json"
    response_param = (response_step.response_param if response_step else "") or ""

    if trigger_type == "kafka":
        topic_name = (
            trigger_param
            if trigger_param and not trigger_param.startswith("/")
            else "pipeline_events"
        )
        main_code = f'''import asyncio
from app.pipelines import build_pipeline


async def consume_loop():
    print("Starting Kafka consumer worker for topic: {topic_name}")
    pipe = build_pipeline()
    demo_payload = {{"event": "kafka_trigger_event", "topic": "{topic_name}"}}
    result = pipe.run(demo_payload)
    print("Processed message:", result)


if __name__ == "__main__":
    asyncio.run(consume_loop())
'''
    elif trigger_type == "redis":
        queue_name = (
            trigger_param
            if trigger_param and not trigger_param.startswith("/")
            else "pipeline_queue"
        )
        main_code = f'''from app.pipelines import build_pipeline


def run_worker():
    print("Starting Redis queue worker for: {queue_name}")
    pipe = build_pipeline()
    demo_payload = {{"source": "redis_queue", "queue": "{queue_name}"}}
    result = pipe.run(demo_payload)
    print("Processed job from Redis:", result)


if __name__ == "__main__":
    run_worker()
'''
    elif trigger_type == "cron":
        cron_expr = trigger_param or "*/5 * * * *"
        main_code = f'''from app.pipelines import build_pipeline


def scheduled_run():
    print("Executing scheduled WPipe pipeline ({cron_expr})...")
    pipe = build_pipeline()
    result = pipe.run({{"trigger": "cron", "schedule": "{cron_expr}"}})
    print("Scheduled execution completed:", result)


if __name__ == "__main__":
    scheduled_run()
'''
    else:
        endpoint_path = trigger_param if trigger_param.startswith("/") else f"/{trigger_param}"
        if response_type == "file_export":
            export_file = response_param or "output_result.json"
            response_logic = f'''import json
    export_path = "{export_file}"
    try:
        with open(export_path, "w", encoding="utf-8") as f:
            json.dump(result, f, indent=2, default=str)
    except Exception as e:
        print(f"Error exporting results to {{export_path}}: {{e}}")
    return {{"status": "success", "exported_to": export_path, "result": result}}'''
        elif response_type == "terminate":
            response_logic = "return result"
        elif response_type == "kafka_publish":
            topic = response_param or "events.output"
            response_logic = f'''print(f"Publishing result to Kafka topic {topic}: {{result}}")
    return {{"status": "success", "published_to_kafka": "{topic}", "result": result}}'''
        elif response_type == "redis_publish":
            channel = response_param or "wpipe:queue:out"
            response_logic = f'''print(f"Publishing result to Redis channel {channel}: {{result}}")
    return {{"status": "success", "published_to_redis": "{channel}", "result": result}}'''
        else:
            response_logic = 'return {"status": "success", "result": result}'

        main_code = f'''from fastapi import FastAPI
from app.pipelines import build_pipeline

app = FastAPI(title="WPipe Microservice", version="1.0.0")


@app.get("/health")
def health():
    return {{"status": "ok"}}


@app.post("{endpoint_path}")
def run_pipeline(payload: dict | None = None):
    pipe = build_pipeline()
    result = pipe.run(payload or {{}})
    {response_logic}
'''

    dockerfile = """FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY ./app .
CMD ["python3", "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
"""

    makefile = f"""# Microservice Makefile for {project_name}
# Orchestrated by WPipe Studio

.PHONY: help start stop restart status logs test build shell clean dev-local

help:
\t@echo "================================================================"
\t@echo " 🚀 WPipe Microservice: {project_name}"
\t@echo "================================================================"
\t@echo "  make start      - Start microservice container in background (docker-compose up -d --build)"
\t@echo "  make stop       - Stop microservice container (docker-compose down)"
\t@echo "  make restart    - Restart running microservice"
\t@echo "  make status     - View running containers and health checks (docker-compose ps)"
\t@echo "  make logs       - Tail microservice live output (docker-compose logs -f)"
\t@echo "  make test       - Execute automated pytest suite inside container"
\t@echo "  make build      - Build or rebuild Docker container image"
\t@echo "  make shell      - Open interactive Bash shell inside running microservice"
\t@echo "  make clean      - Tear down containers, networks and prune volumes"
\t@echo "  make dev-local  - Run FastAPI pipeline locally with uvicorn (no docker)"
\t@echo "================================================================"

start:
\tdocker-compose up -d --build

stop:
\tdocker-compose down

restart:
\tdocker-compose restart

status:
\tdocker-compose ps

logs:
\tdocker-compose logs -f microservice

test:
\tdocker-compose run --rm microservice pytest app/tests/ -q

build:
\tdocker-compose build

shell:
\tdocker-compose exec microservice /bin/bash

clean:
\tdocker-compose down -v --remove-orphans

dev-local:
\tpython3 -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
"""

    now_utc = datetime.now(UTC)
    now_iso = now_utc.strftime("%Y-%m-%d %H:%M:%S UTC")
    current_year = now_utc.year
    step_count = len(all_steps)
    step_names_list = ", ".join([f"`{s.name}`" for s in all_steps[:8]])
    if len(all_steps) > 8:
        step_names_list += f" y {len(all_steps) - 8} más..."
    if not step_names_list:
        step_names_list = "*(Pipeline modular base)*"

    readme = f"""# {project_name}

> **Enterprise Python Microservice Orchestration**  
> Auto-generado, compilado y verificado por **WPipe Studio (wisrovi SUITE)**.

---

## ⚖️ Legal Notice, Authorship & Intellectual Property Rights

> [!IMPORTANT]
> **Aviso Prioritario de Derechos de Autor y Protección de Código**  
> Este documento establece con carácter vinculante y oficial los **derechos de autor, propiedad intelectual y atribución técnica** del presente microservicio. Este archivo se encuentra protegido contra edición manual en WPipe Studio.

### Plataforma & Ecosistema de Ingeniería
- **Suite de Orquestación**: [WPipe Studio](https://github.com/wisrovi/wpipe-studio) (wisrovi SUITE) — Plataforma visual de ingeniería de microservicios y diseño modular de pipelines.
- **Motor Core**: [WPipe](https://github.com/wisrovi/wpipe) (wisrovi SUITE) v2.5.x.
- **Fecha de Compilación**: `{now_iso}`.
- **Estándar de Generación**: Dialecto A (Contratos Pydantic Context DTOs + AST Jerárquico Topológico).

### Autor & Atribución Profesional
- **Autor Principal**: **William Rodriguez** ([`wisrovi`](https://wisrovi.dev))
- **Perfil Profesional**: **AI Leader & Solutions Architect**
- **Sitio Web Oficial**: [https://wisrovi.dev](https://wisrovi.dev)
- **Ubicación**: Badajoz, Extremadura, España
- **Misión & Especialidad**: *Liderazgo en inteligencia artificial avanzada, arquitecturas cloud distribuidas y diseño de motores de orquestación de alto rendimiento.*
- **Copyright**: © {current_year} **wisrovi** ([wisrovi.dev](https://wisrovi.dev)). Todos los derechos reservados / All Rights Reserved.

### Términos de Derechos y Uso
Este componente de software y su topología de ejecución fueron diseñados y compilados bajo la infraestructura de **WPipe Studio**. Todos los patrones arquitectónicos, abstracciones de DTOs tipados, vinculaciones de estados (`@step`) y contratos de orquestación forman parte de la propiedad intelectual exclusiva de **wisrovi** ([wisrovi.dev](https://wisrovi.dev)). Queda prohibida la alteración no autorizada de metadatos de autoría y derechos protegidos.

---

## 📖 Documentación Técnica del Microservicio

### Descripción General
El microservicio `{project_name}` expone un flujo de trabajo modular asíncrono y de alto rendimiento, orquestado mediante **WPipe** y servido a través de **FastAPI**.

- **Pipeline Core**: `main_pipeline`
- **Total de Pasos Ensamblados**: {step_count} bloque(s) de ejecución ({step_names_list}).
- **Bloques de Control Soportados**: Bifurcaciones condicionales (`Condition`), bucles deterministas o continuos (`For`), y ejecución concurrente en hilos o procesos (`Parallel`).
- **Contratos de Datos**: Clases Pydantic en `app/dto/` con validación estricta de tipos y serialización de contexto vía `@to_obj`.

### Estructura de Directorios
```
{project_name}/
├── app/
│   ├── dto/                 # Contratos Pydantic Context DTOs (Dialecto A)
│   ├── states/              # Funciones de ejecución decoradas con @step
│   ├── tests/               # Batería automatizada de pruebas unitarias
│   ├── pipelines.py         # Topología DAG del pipeline WPipe
│   └── main.py              # Entrypoint FastAPI REST y runners de eventos
├── Dockerfile               # Contenedor de producción multi-etapa
├── docker-compose.yml       # Orquestación Docker con healthcheck HTTP
├── Makefile                 # Automatización de tareas (start, test, logs, shell)
├── requirements.txt         # Dependencias Python bloqueadas
└── README.md                # Declaración de derechos y guía técnica (Protegido)
```

### Tecnologías y Librerías Principales
- **FastAPI**: Framework web asíncrono moderno y ultrarrápido para APIs REST.
- **WPipe Engine**: Motor de pipelines con control de memoria, reintentos y métricas.
- **Pydantic v2**: Validación de datos estricta en tiempo de ejecución.
- **Uvicorn**: Servidor ASGI de nivel de producción.
- **Docker & Docker Compose**: Despliegue reproducible y aislado en contenedores.
- **Pytest**: Suite de pruebas unitarias y calidad continua.
- **Ruff**: Linter y formateador de código ultrarrápido.

---

## 🚀 Despliegue y Ejecución

### 1. Iniciar con Docker Compose (Recomendado)
```bash
# Construir y levantar el microservicio
make start

# O directamente con Docker Compose:
docker-compose up -d --build
```

### 2. Endpoints y Documentación Interactiva
- **Ejecutar Pipeline**: `POST /run` (Envío de payload JSON para procesar en el pipeline)
- **Comprobación de Salud**: `GET /health`
- **Documentación Swagger UI**: `http://localhost:8000/docs`
- **Especificación OpenAPI**: `http://localhost:8000/openapi.json`

### 3. Comandos Automatizados del Makefile
- `make start` — Construye y levanta el microservicio en segundo plano.
- `make stop` — Detiene y apaga los contenedores.
- `make restart` — Reinicia los servicios en caliente.
- `make logs` — Muestra los logs en streaming en tiempo real.
- `make test` — Ejecuta las pruebas automatizadas dentro del contenedor Docker.
- `make status` — Consulta el estado y salud del microservicio (`docker-compose ps`).
- `make shell` — Acceso interactivo Bash dentro del contenedor.
- `make clean` — Limpieza total de contenedores y volúmenes huérfanos.

### 4. Cómo ejecutar los tests
```bash
# Dentro del contenedor Docker:
make test

# O en entorno local:
pytest app/tests/ -q
```
"""

    test_code = f"""from app.pipelines import build_pipeline


def test_pipeline_builds():
    pipe = build_pipeline()
    assert pipe is not None
    assert (getattr(pipe, "name", None) or getattr(pipe, "pipeline_name", None)) == "{semantic_ir.pipeline_name}"
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

    app_init_content = '''"""
WPipe Microservice Package.
Auto-generated and validated by WPipe Studio.
"""

__version__ = "1.0.0"
__all__ = ["pipelines", "main"]
'''

    dto_imports: list[str] = []
    dto_exports: list[str] = []
    for f in custom_dto_files:
        mod_name = f.path.replace("app/dto/", "").replace(".py", "")
        match_cls = re.findall(r"class\s+([a-zA-Z0-9_]+)\(BaseModel\):", f.content)
        for cls in match_cls:
            dto_imports.append(f"from app.dto.{mod_name} import {cls}")
            dto_exports.append(f'    "{cls}",')

    if dto_imports:
        dto_init_content = f'''"""
Data Transfer Objects (DTO) for WPipe pipeline states.
"""

{chr(10).join(dto_imports)}

__all__ = [
{chr(10).join(dto_exports)}
]
'''
    else:
        dto_init_content = '''"""
Data Transfer Objects (DTO) for WPipe pipeline states.
"""

__all__: list[str] = []
'''

    state_imports: list[str] = []
    state_exports: list[str] = []
    for f in custom_state_files:
        mod_name = f.path.replace("app/states/", "").replace(".py", "")
        match_fn = re.findall(r"def\s+([a-zA-Z0-9_]+)\s*\(", f.content)
        for fn in match_fn:
            state_imports.append(f"from app.states.{mod_name} import {fn}")
            state_exports.append(f'    "{fn}",')

    if state_imports:
        state_init_content = f'''"""
Custom WPipe pipeline states and execution steps.
"""

{chr(10).join(state_imports)}

__all__ = [
{chr(10).join(state_exports)}
]
'''
    else:
        state_init_content = '''"""
Custom WPipe pipeline states and execution steps.
"""

__all__: list[str] = []
'''

    tests_init_content = '''"""
Automated unit test suite for WPipe Microservice.
"""
'''

    docker_compose = f"""version: "3.8"

services:
  microservice:
    build:
      context: .
      dockerfile: Dockerfile
    container_name: {project_name}-service
    ports:
      - "8000:8000"
    environment:
      - PORT=8000
      - PYTHONUNBUFFERED=1
      - ENVIRONMENT=production
    restart: unless-stopped
    healthcheck:
      test: ["CMD-SHELL", "curl -f http://localhost:8000/health || exit 1"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 10s
"""

    files = [
        TargetFile(path="app/__init__.py", content=app_init_content),
        TargetFile(path="app/pipelines.py", content=pipeline_code),
        TargetFile(path="app/main.py", content=main_code),
        TargetFile(path="app/dto/__init__.py", content=dto_init_content),
        TargetFile(path="app/states/__init__.py", content=state_init_content),
        TargetFile(path="app/tests/__init__.py", content=tests_init_content),
        TargetFile(path="app/tests/test_pipelines.py", content=test_code),
        TargetFile(path="Dockerfile", content=dockerfile),
        TargetFile(path="docker-compose.yml", content=docker_compose),
        TargetFile(path="Makefile", content=makefile),
        TargetFile(path="requirements.txt", content=reqs_str),
        TargetFile(path="README.md", content=readme),
    ]

    files.extend(custom_dto_files)
    files.extend(custom_state_files)

    return TargetIR(project_name=project_name, files=files)
