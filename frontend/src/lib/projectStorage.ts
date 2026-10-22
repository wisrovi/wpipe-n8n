/**
 * Browser-based Local Project Persistence Manager (IndexedDB / LocalStorage)
 * Enables full multi-project management, offline canvas editing, and .wpipe file import/export
 * when operating without a cloud backend or local engine.
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

const STORAGE_KEY = "wpipe_browser_projects";

/**
 * Get all projects saved in the browser's local storage.
 */
export function listBrowserProjects(): BrowserProject[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    console.error("Error reading browser projects:", e);
    return [];
  }
}

/**
 * Get a specific project by its ID from browser storage.
 */
export function getBrowserProject(id: string): BrowserProject | null {
  const all = listBrowserProjects();
  return all.find((p) => p.id === id) || null;
}

/**
 * Create a new project in browser local storage.
 */
export function createBrowserProject(data: {
  name: string;
  description?: string;
  docker_image?: string;
  protocol?: string;
  canvas_ir?: any;
  generated_files?: { path: string; content: string }[];
}): BrowserProject {
  const all = listBrowserProjects();
  const now = new Date().toISOString();
  const id = `proj_local_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
  const nodeCount = data.canvas_ir?.nodes?.length || 0;

  const newProj: BrowserProject = {
    id,
    name: data.name.trim().replace(/[^a-zA-Z0-9_-]/g, "_") || "main_pipeline",
    description: data.description || `Microservicio local ${data.name}`,
    owner_id: "browser_local_user",
    docker_image: data.docker_image || "python:3.11-slim",
    protocol: data.protocol || "fastapi",
    canvas_ir: data.canvas_ir || null,
    generated_files: data.generated_files || [],
    files: data.generated_files || [],
    node_count: nodeCount,
    created_at: now,
    updated_at: now,
  };

  all.unshift(newProj);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch (e) {
    console.error("Error saving browser project to localStorage:", e);
  }
  return newProj;
}

/**
 * Update an existing project in browser local storage.
 */
export function updateBrowserProject(
  id: string,
  data: Partial<BrowserProject>
): BrowserProject | null {
  const all = listBrowserProjects();
  const idx = all.findIndex((p) => p.id === id);
  if (idx === -1) return null;

  const current = all[idx];
  const now = new Date().toISOString();
  const updatedNodes = data.canvas_ir?.nodes?.length ?? current.node_count ?? 0;

  const updated: BrowserProject = {
    ...current,
    ...data,
    id: current.id,
    node_count: updatedNodes,
    updated_at: now,
  };

  all[idx] = updated;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch (e) {
    console.error("Error updating browser project in localStorage:", e);
  }
  return updated;
}

/**
 * Duplicate a project in browser storage.
 */
export function duplicateBrowserProject(id: string): BrowserProject | null {
  const source = getBrowserProject(id);
  if (!source) return null;

  return createBrowserProject({
    name: `${source.name}_copy`,
    description: `Copia de ${source.name}`,
    docker_image: source.docker_image,
    protocol: source.protocol,
    canvas_ir: source.canvas_ir,
    generated_files: source.generated_files || source.files,
  });
}

/**
 * Delete a project from browser storage.
 */
export function deleteBrowserProject(id: string): boolean {
  const all = listBrowserProjects();
  const filtered = all.filter((p) => p.id !== id);
  if (filtered.length === all.length) return false;

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
    return true;
  } catch (e) {
    console.error("Error deleting browser project:", e);
    return false;
  }
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
 * Import a `.wpipe` file content into a structured BrowserProject.
 */
export function parseWpipeFileContent(rawContent: string): BrowserProject {
  const parsed = JSON.parse(rawContent);

  // Case 1: Structured .wpipe wrapper
  if (parsed.format === "wpipe" && parsed.project) {
    const p = parsed.project;
    return {
      id: p.id || `proj_imported_${Date.now()}`,
      name: p.name || "imported_pipeline",
      description: p.description || "Importado desde archivo .wpipe",
      owner_id: "browser_local_user",
      docker_image: p.docker_image || "python:3.11-slim",
      protocol: p.protocol || "fastapi",
      canvas_ir: p.canvas_ir || null,
      generated_files: p.generated_files || p.files || [],
      files: p.generated_files || p.files || [],
      node_count: p.canvas_ir?.nodes?.length || 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
  }

  // Case 2: Raw ProjectDetail
  if (parsed.canvas_ir && parsed.name) {
    return {
      id: parsed.id || `proj_imported_${Date.now()}`,
      name: parsed.name,
      description: parsed.description || "Importado desde archivo .wpipe",
      owner_id: "browser_local_user",
      docker_image: parsed.docker_image || "python:3.11-slim",
      protocol: parsed.protocol || "fastapi",
      canvas_ir: parsed.canvas_ir,
      generated_files: parsed.generated_files || parsed.files || [],
      files: parsed.generated_files || parsed.files || [],
      node_count: parsed.canvas_ir?.nodes?.length || 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
  }

  // Case 3: Raw CanvasIR (nodes and edges directly)
  if (Array.isArray(parsed.nodes)) {
    return {
      id: parsed.id || `proj_imported_${Date.now()}`,
      name: parsed.name || "imported_pipeline",
      description: parsed.description || "Pipeline imported from canvas IR",
      owner_id: "browser_local_user",
      docker_image: parsed.docker_image || "python:3.11-slim",
      protocol: parsed.protocol || "fastapi",
      canvas_ir: parsed,
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
    return {
      id: parsed.id || `proj_imported_${Date.now()}`,
      name: parsed.name || "demo_pipeline",
      description: parsed.description || "Pipeline imported from steps specification",
      owner_id: "browser_local_user",
      docker_image: parsed.docker_image || "python:3.11-slim",
      protocol: parsed.protocol || "fastapi",
      canvas_ir: { nodes },
      generated_files: [],
      files: [],
      node_count: nodes.length,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
  }

  // Case 5: Workspace state only or arbitrary pipeline object fallback
  if (parsed && typeof parsed === "object") {
    const wsState = parsed.workspace_state || (parsed.canvas_ir && parsed.canvas_ir.workspace_state) || null;
    const nodes = (parsed.canvas_ir && parsed.canvas_ir.nodes) || parsed.nodes || [];
    return {
      id: parsed.id || `proj_imported_${Date.now()}`,
      name: parsed.name || "pipeline",
      description: parsed.description || "Imported WPipe Pipeline",
      owner_id: "browser_local_user",
      docker_image: parsed.docker_image || "python:3.11-slim",
      protocol: parsed.protocol || "fastapi",
      canvas_ir: {
        nodes: Array.isArray(nodes) ? nodes : [],
        workspace_state: wsState,
      },
      generated_files: parsed.generated_files || parsed.files || [],
      files: parsed.generated_files || parsed.files || [],
      node_count: Array.isArray(nodes) ? nodes.length : 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
  }

  throw new Error("Formato de archivo .wpipe no reconocido.");
}
