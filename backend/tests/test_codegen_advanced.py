import ast

from app.schemas.ir import (
    CanvasEdge,
    CanvasIR,
    CanvasNode,
    ContextContract,
    NodeData,
    StepOrigin,
)
from app.services.ir_transformer import transform_canvas_to_semantic, transform_semantic_to_target


def test_codegen_control_blocks_and_dialect_a():
    """
    Test real code generation for Condition, For, Parallel and Dialect A states/DTOs.
    """
    # 1. Custom Step (AI described)
    custom_node = CanvasNode(
        id="node_custom",
        data=NodeData(
            label="SummarizeText",
            node_type="step",
            origin=StepOrigin.DESCRIBED,
            contract=ContextContract(reads=["raw_text"], writes=["summary_result"]),
        ),
    )

    # 2. Condition node with nested custom step in branch_true
    cond_node = CanvasNode(
        id="node_cond",
        data=NodeData(
            label="CheckLength",
            node_type="condition",
            condition_expression="len(raw_text) > 100",
        ),
    )
    branch_child = CanvasNode(
        id="node_branch_child",
        data=NodeData(
            label="BranchAction",
            node_type="step",
            origin=StepOrigin.DESCRIBED,
            contract=ContextContract(reads=["raw_text"], writes=["action_flag"]),
            parent_id="node_cond",
            slot_type="if_body",
        ),
    )

    # 3. For Loop node with nested step
    for_node = CanvasNode(
        id="node_for",
        data=NodeData(
            label="RetryLoop",
            node_type="for",
            for_iterations=3,
        ),
    )
    for_child = CanvasNode(
        id="node_for_child",
        data=NodeData(
            label="LoopAction",
            node_type="step",
            origin=StepOrigin.DESCRIBED,
            parent_id="node_for",
            slot_type="loop_body",
        ),
    )

    # 4. Parallel node
    parallel_node = CanvasNode(
        id="node_parallel",
        data=NodeData(
            label="ParallelWorkers",
            node_type="parallel",
            merge_policy="accumulate",
        ),
    )

    # Connect root nodes in order: custom_node -> cond_node -> for_node -> parallel_node
    edges = [
        CanvasEdge(id="e1", source="node_custom", target="node_cond"),
        CanvasEdge(id="e2", source="node_cond", target="node_for"),
        CanvasEdge(id="e3", source="node_for", target="node_parallel"),
    ]

    canvas_ir = CanvasIR(
        nodes=[custom_node, cond_node, branch_child, for_node, for_child, parallel_node],
        edges=edges,
    )

    semantic_ir = transform_canvas_to_semantic(canvas_ir, pipeline_name="advanced_pipeline")
    target_ir = transform_semantic_to_target(semantic_ir, project_name="test_service")

    file_map = {f.path: f.content for f in target_ir.files}

    # Verify pipelines.py
    assert "app/pipelines.py" in file_map
    pipelines_code = file_map["app/pipelines.py"]
    assert "from wpipe import Pipeline, step, Condition, For, Parallel" in pipelines_code
    assert "Condition(" in pipelines_code
    assert 'expression="len(raw_text) > 100"' in pipelines_code
    assert "For(" in pipelines_code
    assert "iterations=3" in pipelines_code
    assert "Parallel(" in pipelines_code
    assert 'merge_policy="accumulate"' in pipelines_code

    # Syntax validation of generated python code using ast.parse
    ast.parse(pipelines_code)

    # Verify custom DTO generation (Dialect A)
    assert "app/dto/summarizetext_dto.py" in file_map
    dto_code = file_map["app/dto/summarizetext_dto.py"]
    assert "class SummarizetextContext(BaseModel):" in dto_code
    assert "raw_text:" in dto_code
    assert "summary_result:" in dto_code
    ast.parse(dto_code)

    # Verify custom state generation (Dialect A)
    assert "app/states/summarizetext.py" in file_map
    state_code = file_map["app/states/summarizetext.py"]
    assert "@step(name=\"SummarizeText\")" in state_code
    assert "@to_obj(SummarizetextContext)" in state_code
    assert "def summarizetext_step(context: SummarizetextContext)" in state_code
    ast.parse(state_code)

    # Verify requirements.txt
    assert "requirements.txt" in file_map
    reqs = file_map["requirements.txt"]
    assert "wpipe>=2.5.10" in reqs
    assert "pydantic>=2.0.0" in reqs

    # Verify protected README.md with legal notice and author attribution
    assert "README.md" in file_map
    readme_content = file_map["README.md"]
    assert "William Rodriguez" in readme_content
    assert "wisrovi" in readme_content
    assert "eCaptureDtech" in readme_content
    assert "Badajoz, Extremadura, España" in readme_content
    assert "AI Leader & Solutions Architect" in readme_content
    assert "WPipe Studio (wisrovi SUITE)" in readme_content
    assert "Legal Notice, Authorship & Intellectual Property Rights" in readme_content
    assert "All Rights Reserved" in readme_content
    assert "docker-compose" in readme_content
    assert "Makefile" in readme_content

