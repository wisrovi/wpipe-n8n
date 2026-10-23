import pytest
from pydantic import ValidationError

from app.schemas.ir import (
    CanvasEdge,
    CanvasIR,
    CanvasNode,
    ContextContract,
    NodeData,
    Position,
    SemanticIR,
    SemanticStep,
    StepOrigin,
    TargetFile,
    TargetIR,
)


def test_canvas_ir_valid_dag():
    """
    Test that a valid acyclic CanvasIR graph is accepted.
    A -> B -> C
    """
    node_a = CanvasNode(
        id="node_a",
        position=Position(x=0, y=0),
        data=NodeData(label="Step A", node_type="step", origin=StepOrigin.CATALOG),
    )
    node_b = CanvasNode(
        id="node_b",
        position=Position(x=100, y=0),
        data=NodeData(label="Step B", node_type="step", origin=StepOrigin.CATALOG),
    )
    node_c = CanvasNode(
        id="node_c",
        position=Position(x=200, y=0),
        data=NodeData(label="Step C", node_type="step", origin=StepOrigin.CATALOG),
    )

    edge_1 = CanvasEdge(id="e1", source="node_a", target="node_b")
    edge_2 = CanvasEdge(id="e2", source="node_b", target="node_c")

    canvas_ir = CanvasIR(nodes=[node_a, node_b, node_c], edges=[edge_1, edge_2])
    assert len(canvas_ir.nodes) == 3
    assert len(canvas_ir.edges) == 2


def test_canvas_ir_cyclic_dag_raises_validation_error():
    """
    Test that a cyclic graph (A -> B -> C -> A) raises ValidationError.
    """
    node_a = CanvasNode(
        id="node_a",
        data=NodeData(label="Step A"),
    )
    node_b = CanvasNode(
        id="node_b",
        data=NodeData(label="Step B"),
    )
    node_c = CanvasNode(
        id="node_c",
        data=NodeData(label="Step C"),
    )

    edge_1 = CanvasEdge(id="e1", source="node_a", target="node_b")
    edge_2 = CanvasEdge(id="e2", source="node_b", target="node_c")
    edge_3 = CanvasEdge(id="e3", source="node_c", target="node_a")

    with pytest.raises(ValidationError) as exc_info:
        CanvasIR(nodes=[node_a, node_b, node_c], edges=[edge_1, edge_2, edge_3])

    assert "Graph contains a cycle" in str(exc_info.value)


def test_semantic_ir_serialization():
    """
    Test SemanticIR creation and contract assignments.
    """
    step = SemanticStep(
        step_id="step_1",
        name="HTTP Request",
        namespace="wpipe_steps.connectivity.http_request",
        func_name="HttpRequest",
        contract=ContextContract(reads=["url"], writes=["response"]),
    )
    semantic_ir = SemanticIR(
        pipeline_name="fetch_pipeline",
        steps=[step],
        global_context_reads=["url"],
        global_context_writes=["response"],
    )
    assert semantic_ir.pipeline_name == "fetch_pipeline"
    assert semantic_ir.steps[0].contract.reads == ["url"]


def test_target_ir():
    """
    Test TargetIR structure with emitted files.
    """
    file_1 = TargetFile(path="app/main.py", content="print('hello')")
    target_ir = TargetIR(project_name="my_service", files=[file_1])
    assert target_ir.project_name == "my_service"
    assert target_ir.files[0].path == "app/main.py"
