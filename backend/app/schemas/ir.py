from enum import Enum
from typing import Any, Literal
from pydantic import BaseModel, Field, model_validator


class StepOrigin(str, Enum):
    CATALOG = "catalog"
    USER_IMPORTED = "user_imported"
    DESCRIBED = "described"


class InferredLevel(str, Enum):
    EXACT = "exact"
    TRUSTED = "trusted"
    HEURISTIC = "heuristic"
    DECLARED = "declared"


class ContextContract(BaseModel):
    reads: list[str] = Field(default_factory=list)
    writes: list[str] = Field(default_factory=list)
    inferred: InferredLevel = InferredLevel.EXACT


class NodeData(BaseModel):
    label: str
    node_type: Literal["trigger", "step", "condition", "for", "while", "parallel", "background"] = "step"
    trigger_type: Literal["api", "kafka", "redis", "cron", "webhook", "cli"] | None = None
    trigger_param: str | None = None
    namespace: str | None = None
    func_name: str | None = None
    origin: StepOrigin = StepOrigin.CATALOG
    params: dict[str, Any] = Field(default_factory=dict)
    contract: ContextContract = Field(default_factory=ContextContract)
    condition_expression: str | None = None
    for_iterations: int | None = None
    merge_policy: Literal["accumulate", "last_wins"] = "accumulate"
    notes: str | None = None
    code_snippet: str | None = None
    parent_id: str | None = None
    slot_type: Literal["if_body", "else_body", "loop_body", "parallel_body", "background_body"] | None = None
    has_else: bool | None = None


class Position(BaseModel):
    x: float = 0.0
    y: float = 0.0


class CanvasNode(BaseModel):
    id: str
    type: str = "default"
    position: Position = Field(default_factory=Position)
    data: NodeData


class CanvasEdge(BaseModel):
    id: str
    source: str
    target: str
    label: str | None = None
    sourceHandle: str | None = None
    targetHandle: str | None = None


class Viewport(BaseModel):
    x: float = 0.0
    y: float = 0.0
    zoom: float = 1.0


class CanvasIR(BaseModel):
    nodes: list[CanvasNode] = Field(default_factory=list)
    edges: list[CanvasEdge] = Field(default_factory=list)
    viewport: Viewport = Field(default_factory=Viewport)

    @model_validator(mode="after")
    def validate_dag_acyclic(self) -> "CanvasIR":
        adj: dict[str, list[str]] = {node.id: [] for node in self.nodes}
        for edge in self.edges:
            if edge.source in adj and edge.target in adj:
                adj[edge.source].append(edge.target)

        visited: dict[str, int] = {node.id: 0 for node in self.nodes}  # 0: unvisited, 1: visiting, 2: visited

        def dfs(node_id: str) -> bool:
            visited[node_id] = 1
            for neighbor in adj.get(node_id, []):
                if visited[neighbor] == 1:
                    return True  # Cycle detected
                if visited[neighbor] == 0:
                    if dfs(neighbor):
                        return True
            visited[node_id] = 2
            return False

        for node in self.nodes:
            if visited[node.id] == 0:
                if dfs(node.id):
                    raise ValueError(f"Graph contains a cycle involving node '{node.id}'")

        return self


class SemanticStep(BaseModel):
    step_id: str
    name: str
    step_type: Literal["trigger", "step", "condition", "for", "while", "parallel", "background"] = "step"
    trigger_type: str | None = None
    trigger_param: str | None = None
    namespace: str | None = None
    func_name: str | None = None
    origin: StepOrigin = StepOrigin.CATALOG
    params: dict[str, Any] = Field(default_factory=dict)
    contract: ContextContract = Field(default_factory=ContextContract)
    condition_expression: str | None = None
    branch_true: list["SemanticStep"] = Field(default_factory=list)
    branch_false: list["SemanticStep"] = Field(default_factory=list)
    for_iterations: int | None = None
    loop_steps: list["SemanticStep"] = Field(default_factory=list)
    parallel_steps: list["SemanticStep"] = Field(default_factory=list)
    merge_policy: Literal["accumulate", "last_wins"] = "accumulate"
    notes: str | None = None
    code_snippet: str | None = None


class SemanticIR(BaseModel):
    pipeline_name: str = "main_pipeline"
    steps: list[SemanticStep] = Field(default_factory=list)
    global_context_reads: list[str] = Field(default_factory=list)
    global_context_writes: list[str] = Field(default_factory=list)


class TargetFile(BaseModel):
    path: str
    content: str


class TargetIR(BaseModel):
    project_name: str = "wpipe_microservice"
    files: list[TargetFile] = Field(default_factory=list)
