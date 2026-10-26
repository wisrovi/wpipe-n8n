/**
 * Portable `.wpipe` design file helpers (export / import / workspace-state synthesis).
 *
 * Project persistence lives exclusively in the local wpipe-engine (~/.wpipe/workspaces),
 * which enforces plan limits server-side. The browser only exports and imports the canvas
 * design; importing it into the engine re-applies every limit.
 * 
 * Author: William Rodriguez (wisrovi.dev)
 */

export interface BrowserProject {
  id: string;
  name: string;
  description: string;
  owner_id: string;
  docker_image?: string;
  protocol?: string;
  canvas_ir: any | null;
  files?: { path: string; content: string }[];
  generated_files?: { path: string; content: string }[];
  node_count?: number;
  created_at: string;
  updated_at: string;
}

/**
 * Export a project definition as a portable `.wpipe` JSON file.
 * Compatible with VS Code WPipe Extension and web canvas import.
 */
export function exportProjectToWpipeFile(project: BrowserProject): void {
  const exportData = {
    format: "wpipe",
    version: "2.0",
    generator: "WPipe Studio (wisrovi.dev)",
    exported_at: new Date().toISOString(),
    project: {
      id: project.id,
      name: project.name,
      description: project.description,
      docker_image: project.docker_image,
      protocol: project.protocol,
      canvas_ir: project.canvas_ir,
      generated_files: project.generated_files || project.files,
    },
  };

  const blob = new Blob([JSON.stringify(exportData, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${project.name || "pipeline"}.wpipe`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Automatically synthesize a Blockly serialized workspace state from a list of steps or nodes.
 */
export function buildWorkspaceStateFromStepsOrNodes(items: any[]): any {
  if (!Array.isArray(items) || items.length === 0) return null;

  const isNodes = items.some((it) => it && (it.data || it.node_type));
  const stepsList = isNodes
    ? items
        .filter((n) => {
          const nt = n.data?.node_type || n.node_type;
          return nt !== "trigger" && nt !== "response";
        })
        .map((n, idx) => ({
          id: n.id || `step_${idx + 1}`,
          name: n.data?.step_name || n.data?.label || n.name || n.id,
          namespace: n.data?.namespace || n.namespace || "wpipe_steps.connectivity",
        }))
    : items.map((s, idx) => ({
        id: s.id || `step_${idx + 1}`,
        name: s.type || s.name || `Step_${idx + 1}`,
        namespace: s.namespace || "wpipe_steps.connectivity",
      }));

  let currentBlock: any = {
    type: "wpipe_response",
    id: "block_response",
    fields: {
      RESPONSE_TYPE: "http_json",
      RESPONSE_PARAM: '{"status": "success", "data": context}',
    },
  };

  for (let i = stepsList.length - 1; i >= 0; i--) {
    const s = stepsList[i];
    currentBlock = {
      type: "wpipe_step",
      id: s.id,
      fields: {
        STEP_NAME: s.name,
        NAMESPACE: s.namespace,
      },
      next: {
        block: currentBlock,
      },
    };
  }

  const rootBlock: any = {
    type: "wpipe_trigger",
    id: "block_trigger",
    x: 80,
    y: 50,
    fields: {
      TRIGGER_TYPE: "api",
      TRIGGER_PARAM: "/run",
    },
    next: {
      block: currentBlock,
    },
  };

  return {
    blocks: {
      languageVersion: 0,
      blocks: [rootBlock],
    },
  };
}

/**
 * Import a `.wpipe` file content into a structured BrowserProject.
 */
export function parseWpipeFileContent(rawContent: string): BrowserProject {
  const parsed = JSON.parse(rawContent);

  // Case 1: Structured .wpipe wrapper
  if (parsed.format === "wpipe" && parsed.project) {
    const p = parsed.project;
    const wsState =
      p.workspace_state ||
      p.canvas_ir?.workspace_state ||
      buildWorkspaceStateFromStepsOrNodes(p.canvas_ir?.nodes || p.steps);
    const canvasIr = p.canvas_ir
      ? { ...p.canvas_ir, workspace_state: wsState }
      : wsState
      ? { nodes: [], workspace_state: wsState }
      : null;
    return {
      id: p.id || `proj_imported_${Date.now()}`,
      name: p.name || "imported_pipeline",
      description: p.description || "Imported from .wpipe file",
      owner_id: "browser_local_user",
      docker_image: p.docker_image || "python:3.11-slim",
      protocol: p.protocol || "fastapi",
      canvas_ir: canvasIr,
      generated_files: p.generated_files || p.files || [],
      files: p.generated_files || p.files || [],
      node_count: p.canvas_ir?.nodes?.length || 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
  }

  // Case 2: Raw ProjectDetail
  if (parsed.canvas_ir && parsed.name) {
    const wsState =
      parsed.workspace_state ||
      parsed.canvas_ir?.workspace_state ||
      buildWorkspaceStateFromStepsOrNodes(parsed.canvas_ir?.nodes || parsed.steps);
    return {
      id: parsed.id || `proj_imported_${Date.now()}`,
      name: parsed.name,
      description: parsed.description || "Imported from .wpipe file",
      owner_id: "browser_local_user",
      docker_image: parsed.docker_image || "python:3.11-slim",
      protocol: parsed.protocol || "fastapi",
      canvas_ir: { ...parsed.canvas_ir, workspace_state: wsState },
      generated_files: parsed.generated_files || parsed.files || [],
      files: parsed.generated_files || parsed.files || [],
      node_count: parsed.canvas_ir?.nodes?.length || 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
  }

  // Case 3: Raw CanvasIR (nodes and edges directly)
  if (Array.isArray(parsed.nodes)) {
    const wsState = parsed.workspace_state || buildWorkspaceStateFromStepsOrNodes(parsed.nodes);
    return {
      id: parsed.id || `proj_imported_${Date.now()}`,
      name: parsed.name || "imported_pipeline",
      description: parsed.description || "Pipeline imported from canvas IR",
      owner_id: "browser_local_user",
      docker_image: parsed.docker_image || "python:3.11-slim",
      protocol: parsed.protocol || "fastapi",
      canvas_ir: { ...parsed, workspace_state: wsState },
      generated_files: parsed.generated_files || parsed.files || [],
      files: parsed.generated_files || parsed.files || [],
      node_count: parsed.nodes.length,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
  }

  // Case 4: Pipeline definition with steps array (e.g. demo_pipeline.wpipe)
  if (Array.isArray(parsed.steps)) {
    const nodes = [
      { id: "node_trigger", data: { node_type: "trigger", label: "Trigger REST (/run)", trigger_type: "api", trigger_param: "/run" } },
      ...parsed.steps.map((s: any, idx: number) => ({
        id: s.id || `step_${idx + 1}`,
        data: {
          node_type: "step",
          label: s.name || s.type || `Step ${idx + 1}`,
          step_name: s.type || s.name,
          category: "connectivity",
          params: s.params || {},
        },
      })),
      { id: "node_response", data: { node_type: "response", label: "Response Cap (HTTP 200)", response_type: "http_json" } },
    ];
    const wsState = buildWorkspaceStateFromStepsOrNodes(parsed.steps);
    return {
      id: parsed.id || `proj_imported_${Date.now()}`,
      name: parsed.name || "demo_pipeline",
      description: parsed.description || "Pipeline imported from steps specification",
      owner_id: "browser_local_user",
      docker_image: parsed.docker_image || "python:3.11-slim",
      protocol: parsed.protocol || "fastapi",
      canvas_ir: { nodes, workspace_state: wsState },
      generated_files: [],
      files: [],
      node_count: nodes.length,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
  }

  // Case 5: Workspace state only or arbitrary pipeline object fallback
  if (parsed && typeof parsed === "object") {
    const rawProject = parsed.project || parsed;
    const nodes = (rawProject.canvas_ir && rawProject.canvas_ir.nodes) || rawProject.nodes || [];
    const wsState =
      rawProject.workspace_state ||
      (rawProject.canvas_ir && rawProject.canvas_ir.workspace_state) ||
      buildWorkspaceStateFromStepsOrNodes(Array.isArray(nodes) ? nodes : rawProject.steps);
    return {
      id: rawProject.id || parsed.id || `proj_imported_${Date.now()}`,
      name: rawProject.name || parsed.name || "pipeline",
      description: rawProject.description || parsed.description || "Imported WPipe Pipeline",
      owner_id: "browser_local_user",
      docker_image: rawProject.docker_image || parsed.docker_image || "python:3.11-slim",
      protocol: rawProject.protocol || parsed.protocol || "fastapi",
      canvas_ir: {
        nodes: Array.isArray(nodes) ? nodes : [],
        workspace_state: wsState,
      },
      generated_files: rawProject.generated_files || rawProject.files || parsed.generated_files || parsed.files || [],
      files: rawProject.generated_files || rawProject.files || parsed.generated_files || parsed.files || [],
      node_count: Array.isArray(nodes) ? nodes.length : 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
  }

  throw new Error("Formato de archivo .wpipe no reconocido.");
}
