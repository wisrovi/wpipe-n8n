import React, { useState, useEffect, useRef } from "react";
import { CanvasNode, CanvasEdge, CanvasIR, StepOrigin } from "./lib/ir/schemas";
import {
  BlocklyComponent,
  addTriggerBlockToWorkspace,
  addResponseBlockToWorkspace,
  addStepBlockToWorkspace,
  addAiStepBlockToWorkspace,
  addUserFileStepBlockToWorkspace,
  addControlBlockToWorkspace,
  collapseAllBlocksInWorkspace,
  expandAllBlocksInWorkspace,
  zoomFitWorkspace,
  centerWorkspace,
  undoWorkspace,
  clearWorkspace,
  setBlocklyCatalog,
  attachedFilesRegistry,
  getMermaidFromBlocklyWorkspace,
  getWorkPlanFromBlocklyWorkspace,
  getCanvasIRFromBlocklyWorkspace,
  highlightBlocklyBlock,
  getWorkspaceStateJson,
  loadWorkspaceStateJson,
  updateBlockFieldValue,
  toggleBlockBreakpoint,
  globalBreakpoints,
  updateBreakpointVisuals,
  setCanvasLimits,
  setCanvasLimitViolationHandler,
  getWorkspaceBlockCount,
  CanvasLimitViolation,
} from "./components/BlocklyWorkspace";
import mermaid from "mermaid";
import Prism from "prismjs";
import "prismjs/components/prism-python";
import "prismjs/components/prism-yaml";
import "prismjs/components/prism-docker";
import "prismjs/components/prism-makefile";
import "prismjs/components/prism-bash";
import "prismjs/components/prism-json";
import "prismjs/themes/prism-tomorrow.css";
import { renderMarkdown } from "./lib/markdown";
import {
  GitBranch,
  GitCommit,
  FileText,
  ArrowLeft,
  Play,
  Square,
  Folder,
  FolderOpen,
  Save,
  FileCode,
  CheckCircle,
  AlertTriangle,
  RefreshCw,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Minimize2,
  Download,
  Copy,
  Sparkles,
  BookOpen,
  HelpCircle,
  Info,
  Layers,
  ChevronDown,
  ChevronRight,
  ChevronLeft,
  PanelLeft,
  PanelLeftClose,
  GitMerge,
  Check,
  Search,
  Plus,
  Terminal,
  Cpu,
  Database,
  ArrowRight,
  Undo,
  Redo,
  Trash2,
  Edit3,
  Move,
  User,
  Users,
  ShieldCheck,
  LogOut,
  Clock,
  FolderPlus,
  X,
  Eye,
  EyeOff,
  Code,
  File,
  Settings,
  MoreHorizontal,
  FilePlus,
  Split,
  Sliders,
  Bug,
  FlaskConical,
  History,
  StepForward,
  FastForward,
} from "lucide-react";
import { EngineStatusWidget, LicenseProBadge, ConnectEngineModal, ProLicenseModal } from "./components/EngineStatusWidget";
import {
  probeEngineStatus,
  EngineStatus,
  DEFAULT_ENGINE_PORT,
  getEngineApiUrl,
  disconnectedEngineStatus,
  compileOnEngine,
  executeEngineSimulation,
  engineJson,
  EngineLimitError,
  EngineRequiredError,
  fetchProjectsHybrid,
  loadProjectHybrid,
  saveProjectHybrid,
  duplicateProjectHybrid,
  deleteProjectHybrid,
  exportProjectToWpipeFile,
  parseWpipeFileContent,
} from "./lib/engineBridge";
import JSZip from "jszip";

export interface UserProfile {
  id: string;
  username: string;
  name: string;
  role: string;
  avatar?: string;
  avatar_color?: string;
  created_at?: string;
}

export interface ProjectSummary {
  id: string;
  name: string;
  description: string;
  owner_id: string;
  docker_image?: string;
  protocol?: string;
  node_count?: number;
  step_count?: number;
  created_at: string;
  updated_at: string;
}

export interface ProjectDetail {
  id: string;
  name: string;
  description: string;
  owner_id: string;
  docker_image?: string;
  protocol?: string;
  canvas_ir: CanvasIR | null;
  files?: { path: string; content: string }[];
  generated_files?: { path: string; content: string }[];
  node_count?: number;
  created_at: string;
  updated_at: string;
}


interface ParamSpec {
  name: string;
  annotation?: string;
  default?: any;
}

interface CatalogStep {
  name: string;
  func_name: string;
  namespace: string;
  category: string;
  subcategory1?: string;
  subcategory2?: string;
  description: string;
  repo: string; // "Official" or "Plugin" / "User"
  code_snippet?: string;
  version?: string;
  how_to_use?: string;
  params?: ParamSpec[];
}

interface FaqItem {
  id: string;
  question: string;
  answer: string;
  category: "General" | "Architecture" | "Sandbox" | "AI";
}

interface SimStepResult {
  id: string;
  name: string;
  status: "idle" | "running" | "success" | "error";
  durationMs: number;
  reads: string[];
  writes: string[];
  outputData?: Record<string, any>;
  errorMessage?: string;
}

interface FileTreeNode {
  name: string;
  path: string;
  isFolder: boolean;
  children: FileTreeNode[];
  fileIdx?: number;
  file?: { path: string; content: string };
}

function buildFileTree(files: { path: string; content: string }[]): FileTreeNode {
  const root: FileTreeNode = { name: "wpipe_microservice", path: "", isFolder: true, children: [] };

  files.forEach((file, idx) => {
    const parts = file.path.split("/");
    let current = root;
    let accumulatedPath = "";

    parts.forEach((part, partIdx) => {
      accumulatedPath = accumulatedPath ? `${accumulatedPath}/${part}` : part;
      const isFile = partIdx === parts.length - 1;

      if (isFile) {
        current.children.push({
          name: part,
          path: file.path,
          isFolder: false,
          children: [],
          fileIdx: idx,
          file,
        });
      } else {
        let folder = current.children.find((c) => c.isFolder && c.name === part);
        if (!folder) {
          folder = {
            name: part,
            path: accumulatedPath,
            isFolder: true,
            children: [],
          };
          current.children.push(folder);
        }
        current = folder;
      }
    });
  });

  return root;
}

const FileTreeItem: React.FC<{
  node: FileTreeNode;
  selectedPath: string | null;
  onSelectFile: (file: { path: string; content: string }) => void;
  onSelectFolder: (path: string) => void;
  expandedFolders: Record<string, boolean>;
  onToggleFolder: (path: string) => void;
  level?: number;
  modifiedFiles?: Set<string>;
}> = ({
  node,
  selectedPath,
  onSelectFile,
  onSelectFolder,
  expandedFolders,
  onToggleFolder,
  level = 0,
  modifiedFiles,
}) => {
  const isExpanded = expandedFolders[node.path] !== false; // default expanded

  if (node.isFolder) {
    const isSelected = selectedPath === node.path;
    return (
      <div className="select-none text-xs">
        <div
          onClick={() => onSelectFolder(node.path)}
          style={{ paddingLeft: `${level * 12 + 6}px` }}
          className={`flex items-center gap-1.5 py-1 px-2 rounded cursor-pointer font-medium transition ${
            isSelected
              ? "bg-[#37373d] text-white font-semibold"
              : "text-[#cccccc] hover:bg-[#2a2d2e] hover:text-white"
          }`}
        >
          <span
            onClick={(e) => {
              e.stopPropagation();
              onToggleFolder(node.path);
            }}
            className="p-0.5 hover:bg-[#3c3c3c] rounded text-[#858585] hover:text-white transition"
          >
            <ChevronRight
              size={12}
              className={`transition-transform duration-150 ${isExpanded ? "rotate-90" : ""}`}
            />
          </span>
          {isExpanded ? (
            <FolderOpen size={14} className="text-[#dcb67a] shrink-0" />
          ) : (
            <Folder size={14} className="text-[#dcb67a] shrink-0" />
          )}
          <span className="truncate flex-1">{node.name}</span>
        </div>
        {isExpanded && (
          <div className="flex flex-col">
            {node.children.map((child) => (
              <FileTreeItem
                key={child.path || child.name}
                node={child}
                selectedPath={selectedPath}
                onSelectFile={onSelectFile}
                onSelectFolder={onSelectFolder}
                expandedFolders={expandedFolders}
                onToggleFolder={onToggleFolder}
                level={level + 1}
                modifiedFiles={modifiedFiles}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  const isSelected = selectedPath === node.path;
  const isModified = modifiedFiles && modifiedFiles.has(node.path);

  return (
    <div
      onClick={() => {
        if (node.file) {
          onSelectFile(node.file);
        }
      }}
      style={{ paddingLeft: `${level * 12 + 20}px` }}
      className={`flex items-center gap-2 py-1 px-2 rounded cursor-pointer text-xs font-mono transition select-none ${
        isSelected
          ? "bg-[#094771] text-white font-semibold"
          : "text-[#cccccc] hover:text-white hover:bg-[#2a2d2e]"
      }`}
    >
      {getGitHubFileIcon(node.name)}
      <span className="truncate flex-1">{node.name}</span>
      {isModified && (
        <span className="w-1.5 h-1.5 rounded-full bg-[#e2c08d] shrink-0" title="Archivo editado" />
      )}
    </div>
  );
};

function getGitHubFileDescription(filePath: string): string {
  if (filePath.endsWith("main.py")) return "FastAPI application entrypoint & pipeline runner";
  if (filePath.endsWith("Dockerfile")) return "Multi-stage Docker container for production deployment";
  if (filePath.endsWith("pyproject.toml")) return "Package dependencies and metadata configuration";
  if (filePath.endsWith("requirements.txt")) return "Locked production Python requirements";
  if (filePath.endsWith("run_tests_docker.sh")) return "Dockerized test execution script";
  if (filePath.endsWith("README.md")) return "Derechos de autor (wisrovi / WPipe Studio) & Documentación (Protegido)";
  if (filePath.includes("test_")) return "Automated unit tests & regression quality gates";
  if (filePath.includes("dto")) return "Pydantic Context DTO contracts (Dialect A)";
  if (filePath.includes("states")) return "WPipe state execution functions with @step decorator";
  if (filePath.endsWith("__init__.py")) return "Package namespace initialization";
  return "Generated microservice component";
}

function getGitHubFolderDescription(folderName: string): string {
  if (folderName === "app") return "Microservice application source code";
  if (folderName === "dto") return "Pydantic Context DTOs (Dialect A)";
  if (folderName === "states") return "Step functions and pipeline tasks";
  if (folderName === "tests") return "Automated unit and regression tests";
  return "Directory modules";
}

function getGitHubFileIcon(name: string) {
  if (name.endsWith(".py")) return <span className="text-[#4B8BBE] font-bold text-xs select-none">🐍</span>;
  if (name.includes("Dockerfile")) return <span className="text-[#2496ED] font-bold text-xs select-none">🐳</span>;
  if (name.endsWith(".toml") || name.endsWith(".json") || name.endsWith(".yaml") || name.endsWith(".yml")) return <span className="text-[#cbcb41] font-bold text-xs select-none">⚙️</span>;
  if (name.endsWith(".md")) return <span className="text-[#519aba] font-bold text-xs select-none">📝</span>;
  if (name.endsWith(".sh")) return <span className="text-[#4d9375] font-bold text-xs select-none">💻</span>;
  return <FileCode size={14} className="text-[#8a99a8] shrink-0" />;
}

function getLanguageFromPath(filePath: string): string {
  if (filePath.endsWith(".py")) return "Python";
  if (filePath.endsWith(".md")) return "Markdown";
  if (filePath.includes("Dockerfile")) return "Dockerfile";
  if (filePath.endsWith(".json")) return "JSON";
  if (filePath.endsWith(".toml")) return "TOML";
  if (filePath.endsWith(".yaml") || filePath.endsWith(".yml")) return "YAML";
  if (filePath.endsWith(".sh")) return "Shell Script";
  if (filePath.endsWith(".txt")) return "Plain Text";
  return "Plain Text";
}

function highlightCode(code: string, filePath: string): string {
  if (!code) return "";
  let grammar = Prism.languages.python;
  let lang = "python";
  if (filePath.endsWith(".py")) {
    grammar = Prism.languages.python;
    lang = "python";
  } else if (filePath.endsWith(".yaml") || filePath.endsWith(".yml")) {
    grammar = Prism.languages.yaml;
    lang = "yaml";
  } else if (filePath.endsWith("Dockerfile")) {
    grammar = Prism.languages.docker;
    lang = "docker";
  } else if (filePath.endsWith("Makefile")) {
    grammar = Prism.languages.makefile;
    lang = "makefile";
  } else if (filePath.endsWith(".sh")) {
    grammar = Prism.languages.bash;
    lang = "bash";
  } else if (filePath.endsWith(".json")) {
    grammar = Prism.languages.json;
    lang = "json";
  }
  if (grammar) {
    try {
      return Prism.highlight(code, grammar, lang);
    } catch {
      return code;
    }
  }
  return code;
}

interface GitHubDirItem {
  name: string;
  fullPath: string;
  isFolder: boolean;
  description: string;
  sizeStr?: string;
  lineCount?: number;
  file?: { path: string; content: string };
}

function getGitHubDirectoryItems(files: { path: string; content: string }[], currentDir: string): GitHubDirItem[] {
  const foldersMap = new Map<string, GitHubDirItem>();
  const fileItems: GitHubDirItem[] = [];

  const prefix = currentDir ? (currentDir.endsWith("/") ? currentDir : `${currentDir}/`) : "";

  files.forEach((f) => {
    let rel = f.path;
    if (prefix) {
      if (!f.path.startsWith(prefix)) return;
      rel = f.path.slice(prefix.length);
    }

    const parts = rel.split("/");
    if (parts.length > 1) {
      const folderName = parts[0];
      const folderFullPath = prefix ? `${prefix}${folderName}` : folderName;
      if (!foldersMap.has(folderName)) {
        foldersMap.set(folderName, {
          name: folderName,
          fullPath: folderFullPath,
          isFolder: true,
          description: getGitHubFolderDescription(folderName),
        });
      }
    } else {
      const fileName = parts[0];
      const lines = f.content.split("\n").length;
      const bytes = new Blob([f.content]).size;
      const sizeStr = bytes > 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${bytes} B`;
      fileItems.push({
        name: fileName,
        fullPath: f.path,
        isFolder: false,
        description: getGitHubFileDescription(f.path),
        sizeStr,
        lineCount: lines,
        file: f,
      });
    }
  });

  const sortedFolders = Array.from(foldersMap.values()).sort((a, b) => a.name.localeCompare(b.name));
  const sortedFiles = fileItems.sort((a, b) => a.name.localeCompare(b.name));
  return [...sortedFolders, ...sortedFiles];
}

export default function App() {
  // Splash Screen
  const [showSplash, setShowSplash] = useState<boolean>(true);
  const [splashProgress, setSplashProgress] = useState<number>(0);
  const [splashFadeOut, setSplashFadeOut] = useState<boolean>(false);

  // Top Menu State
  const [projectName, setProjectName] = useState<string>("main_pipeline");
  const [activeMenu, setActiveMenu] = useState<"file" | "microservices" | "edit" | "view" | "run" | "help" | null>(null);
  const [showAboutModal, setShowAboutModal] = useState<boolean>(false);
  const [turboMode, setTurboMode] = useState<boolean>(false);

  // Main Tabs: 'code' (Blockly) | 'simulation' (Dedicated Stage) | 'flowchart' (Mermaid) | 'python' (TargetIR Preview)
  // GitHub / VS Code Repository Navigation State (Microservicio Python)
  const [githubCurrentDir, setGithubCurrentDir] = useState<string>("");
  const [githubViewingFile, setGithubViewingFile] = useState<{ path: string; content: string } | null>(null);
  const [githubFileSearch, setGithubFileSearch] = useState<string>("");
  const [showSidebar, setShowSidebar] = useState<boolean>(true);
  const githubShowTreeSidebar = showSidebar;
  const setGithubShowTreeSidebar = setShowSidebar;
  const [githubRawMode, setGithubRawMode] = useState<boolean>(false);
  const [isEditingFile, setIsEditingFile] = useState<boolean>(false);
  const [editingFileContent, setEditingFileContent] = useState<string>("");
  const [modifiedFiles, setModifiedFiles] = useState<Set<string>>(new Set());
  const [customDockerImage, setCustomDockerImage] = useState<string>("");
  const [activeMainTab, setActiveMainTab] = useState<"code" | "simulation" | "flowchart" | "python">("code");
  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({});
  const toggleFolder = (path: string) =>
    setExpandedFolders((prev) => ({ ...prev, [path]: prev[path] === false ? true : false }));

  // Global Unified Sidebar & VS Code Experience State
  const [openTabs, setOpenTabs] = useState<{ path: string; content: string }[]>([]);
  const [activeActivityTab, setActiveActivityTab] = useState<
    "blocks" | "explorer" | "simulation" | "flowchart" | "search" | "git" | "settings"
  >("blocks");
  const [cursorPos, setCursorPos] = useState<{ line: number; col: number }>({ line: 1, col: 1 });
  const [readmePreviewMode, setReadmePreviewMode] = useState<boolean>(false);

  // --- VS CODE SUITE: 9 ENHANCEMENTS STATE ---
  // 1. Retractable Bottom Panel (Terminal, Output, Problems, Debug, Tests)
  const [bottomPanelOpen, setBottomPanelOpen] = useState<boolean>(false);
  const [bottomPanelTab, setBottomPanelTab] = useState<"terminal" | "output" | "problems" | "debug" | "tests" | "history">("terminal");
  const [bottomPanelMaximized, setBottomPanelMaximized] = useState<boolean>(false);
  const [terminalHistory, setTerminalHistory] = useState<
    Array<{ command: string; stdout: string; stderr: string; exit_code: number; cwd?: string }>
  >([
    {
      command: "info",
      stdout: "WPipe Studio Shell v2.5.10 listo. Directorio de microservicio activo.\nEscribe comandos como 'ls', 'pytest', 'cat .env'...",
      stderr: "",
      exit_code: 0,
    },
  ]);
  const [terminalInput, setTerminalInput] = useState<string>("");
  const [isExecutingTerminal, setIsExecutingTerminal] = useState<boolean>(false);
  const [testRunData, setTestRunData] = useState<any | null>(null);
  const [isTestingRunning, setIsTestingRunning] = useState<boolean>(false);

  // 2. Command Palette (Ctrl+Shift+P / Ctrl+P)
  const [commandPaletteOpen, setCommandPaletteOpen] = useState<boolean>(false);
  const [commandQuery, setCommandQuery] = useState<string>("");
  const [commandSelectedIndex, setCommandSelectedIndex] = useState<number>(0);

  // 3. Live Split View (Canvas + Python Code)
  const [isSplitView, setIsSplitView] = useState<boolean>(false);
  const [livePipelineCode, setLivePipelineCode] = useState<string>("");

  // 4. Step Property Inspector
  const [inspectorOpen, setInspectorOpen] = useState<boolean>(false);
  const [selectedBlockData, setSelectedBlockData] = useState<any | null>(null);

  // 5. Visual .env Manager
  const [showEnvModal, setShowEnvModal] = useState<boolean>(false);
  const [envVars, setEnvVars] = useState<Array<{ key: string; value: string; showSecret?: boolean }>>([]);
  const [isSavingEnv, setIsSavingEnv] = useState<boolean>(false);

  // 6. Breakpoints and Step-by-Step Debugger
  const [breakpoints, setBreakpoints] = useState<Set<string>>(new Set());
  const [isPausedAtBreakpoint, setIsPausedAtBreakpoint] = useState<boolean>(false);
  const [pausedStepName, setPausedStepName] = useState<string>("");
  const [debugContext, setDebugContext] = useState<Record<string, any>>({});
  const resumeSimulationResolveRef = useRef<(() => void) | null>(null);

  // 7. Simulation History (PostgreSQL)
  const [simulationHistory, setSimulationHistory] = useState<any[]>([]);
  const [selectedHistoricalRun, setSelectedHistoricalRun] = useState<any | null>(null);
  const [showDiffModal, setShowDiffModal] = useState<boolean>(false);

  // 8. Web-to-Local Engine Bridge & Licensing Status
  const [engineStatus, setEngineStatus] = useState<EngineStatus>({
    ...disconnectedEngineStatus(DEFAULT_ENGINE_PORT),
    message: "Detecting local engine...",
  });
  // Canvas plan-limit UX state (authoritative enforcement happens inside wpipe-engine)
  const [canvasBlockCount, setCanvasBlockCount] = useState<number>(4);
  const [limitNotice, setLimitNotice] = useState<{ title: string; message: string; needsEngine?: boolean } | null>(null);
  const [filesFromEngine, setFilesFromEngine] = useState<boolean>(false);

  const showEngineRequired = (action: string) => {
    setLimitNotice({
      title: "Local Engine Required (wpipe-engine)",
      message: `${action} requires the local wpipe-engine running on this machine (127.0.0.1:49152). Code generation, real simulation and project storage only happen inside the engine.`,
      needsEngine: true,
    });
  };

  const handleEngineError = (err: any, action: string): boolean => {
    if (err instanceof EngineLimitError) {
      const d = err.details || {};
      const title = d.code === "PRO_FEATURE_REQUIRED" ? "PRO Feature Required" : "Plan Limit Reached";
      setLimitNotice({ title, message: err.message });
      setStatusMessage(`🔒 ${title}: ${err.message}`);
      return true;
    }
    if (err instanceof EngineRequiredError) {
      showEngineRequired(action);
      return true;
    }
    return false;
  };
  const [showEngineModal, setShowEngineModal] = useState<boolean>(false);
  const [showProModal, setShowProModal] = useState<boolean>(false);

  const checkEngine = async (preferredPort?: number) => {
    const status = await probeEngineStatus(preferredPort || engineStatus.port);
    setEngineStatus(status);
    const hasSession = Boolean(localStorage.getItem("studio_session_token"));
    if (status.connected && status.verifiedCryptographically) {
      // Identity of the verified license holder (signed token), never a hardcoded profile.
      setCurrentUser((prev) => {
        if (!prev || prev.id === "engine_user") {
          return {
            id: "engine_user",
            username: status.customerName.toLowerCase().replace(/\s+/g, "."),
            name: status.customerName,
            role: status.isPro ? "pro" : "user",
          };
        }
        return prev;
      });
    } else if (!hasSession) {
      setCurrentUser((prev) => (prev && prev.id !== "engine_user" ? prev : null));
    }
  };

  useEffect(() => {
    checkEngine();
    const interval = setInterval(() => checkEngine(), 20000);
    return () => clearInterval(interval);
  }, []);

  // Mirror the (signature-verified) plan limits into the canvas guards. UX only: the engine
  // re-checks every compile / simulation / save against the signed entitlements.
  useEffect(() => {
    setCanvasLimits({
      max_blocks: engineStatus.entitlements.max_blocks,
      parallel_blocks: engineStatus.entitlements.parallel_blocks,
      background_blocks: engineStatus.entitlements.background_blocks,
      ai_steps: engineStatus.entitlements.ai_steps,
    });
    setCanvasBlockCount(getWorkspaceBlockCount());
  }, [engineStatus.entitlements]);

  useEffect(() => {
    setCanvasLimitViolationHandler((v: CanvasLimitViolation) => {
      const proNames: Record<string, string> = {
        wpipe_parallel: "Parallel",
        wpipe_background: "Background",
        wpipe_ai_step: "AI Step",
      };
      if (v.code === "PRO_FEATURE_REQUIRED") {
        setLimitNotice({
          title: "PRO Feature Required",
          message: `The '${proNames[v.blockType || ""] || v.blockType}' block requires a verified WPipe Pro license in the local wpipe-engine.`,
        });
      } else {
        setLimitNotice({
          title: "Free Plan Limit Reached",
          message: `The Free plan allows up to ${v.max} blocks per pipeline. Activate a Pro license in wpipe-engine to design unlimited pipelines.`,
        });
      }
      setCanvasBlockCount(getWorkspaceBlockCount());
    });
    return () => setCanvasLimitViolationHandler(null);
  }, []);

  // Refresh engine-dependent data whenever the engine connects or disconnects.
  useEffect(() => {
    fetchUserProjects();
    if (activeMainTab === "python") handleSyncPythonCode();
    if (!engineStatus.connected) {
      setGeneratedFiles([]);
      setFilesFromEngine(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engineStatus.connected, engineStatus.verifiedCryptographically]);

  // Synchronized Tab Switching for Unified Activity Bar & Sub-Header Tabs
  const switchMainTab = (tab: "code" | "simulation" | "flowchart" | "python") => {
    setActiveMainTab(tab);
    if (tab === "code") {
      setActiveActivityTab("blocks");
      setShowSidebar(true);
    } else if (tab === "python") {
      setActiveActivityTab("explorer");
      setShowSidebar(true);
    } else if (tab === "simulation") {
      setActiveActivityTab("simulation");
    } else if (tab === "flowchart") {
      setActiveActivityTab("flowchart");
      handleOpenFlowchart();
    }
  };

  const handleActivityTabClick = (
    tab: "blocks" | "explorer" | "simulation" | "flowchart" | "search" | "git"
  ) => {
    if (activeActivityTab === tab) {
      setShowSidebar((prev) => !prev);
    } else {
      setActiveActivityTab(tab);
      setShowSidebar(true);
      if (tab === "blocks") setActiveMainTab("code");
      else if (tab === "explorer") setActiveMainTab("python");
      else if (tab === "simulation") setActiveMainTab("simulation");
      else if (tab === "flowchart") {
        setActiveMainTab("flowchart");
        handleOpenFlowchart();
      }
    }
  };

  const handleSaveProjectRef = useRef<() => void>(() => {});

  // Keyboard shortcuts (Ctrl+B, Ctrl+`, Ctrl+Shift+P, Ctrl+S, F5, F10)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      const inInput = tag === "input" || tag === "textarea";

      // 1. Toggle Sidebar: Ctrl+B / Cmd+B
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "b") {
        if (!inInput) {
          e.preventDefault();
          setShowSidebar((prev) => !prev);
        }
      }

      // 2. Toggle Bottom Panel: Ctrl+` / Cmd+` (or Ctrl+ñ)
      if ((e.ctrlKey || e.metaKey) && (e.key === "`" || e.key === "ñ" || e.code === "Backquote")) {
        e.preventDefault();
        setBottomPanelOpen((prev) => !prev);
      }

      // 3. Command Palette: Ctrl+Shift+P / Cmd+Shift+P or Ctrl+P or F1
      if (
        ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === "p")) ||
        e.key === "F1"
      ) {
        e.preventDefault();
        setCommandPaletteOpen((prev) => !prev);
        setCommandQuery("");
        setCommandSelectedIndex(0);
      }

      // 4. Toggle Split View: Ctrl+\
      if ((e.ctrlKey || e.metaKey) && e.key === "\\") {
        e.preventDefault();
        setIsSplitView((prev) => !prev);
      }

      // 5. Resume paused simulation: F5
      if (e.key === "F5" && isPausedAtBreakpoint && resumeSimulationResolveRef.current) {
        e.preventDefault();
        resumeSimulationResolveRef.current();
        resumeSimulationResolveRef.current = null;
        setIsPausedAtBreakpoint(false);
      }

      // 6. Save Project: Ctrl+S / Cmd+S
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        handleSaveProjectRef.current();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isPausedAtBreakpoint]);

  // Trigger resize event for Blockly & Mermaid when sidebar toggles or tab changes
  useEffect(() => {
    const timer = setTimeout(() => {
      window.dispatchEvent(new Event("resize"));
    }, 120);
    return () => clearTimeout(timer);
  }, [showSidebar, activeMainTab]);

  const openFileInTab = (file: { path: string; content: string }) => {
    setIsEditingFile(false);
    setReadmePreviewMode(false);
    setGithubViewingFile(file);
    setOpenTabs((prev) => {
      if (prev.some((t) => t.path === file.path)) return prev;
      return [...prev, file];
    });
    setGithubCurrentDir(file.path.split("/").slice(0, -1).join("/"));
  };

  const closeTab = (path: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setOpenTabs((prev) => {
      const nextTabs = prev.filter((t) => t.path !== path);
      if (githubViewingFile?.path === path) {
        if (nextTabs.length > 0) {
          const fallback = nextTabs[nextTabs.length - 1];
          setGithubViewingFile(fallback);
          setGithubCurrentDir(fallback.path.split("/").slice(0, -1).join("/"));
        } else {
          setGithubViewingFile(null);
        }
      }
      return nextTabs;
    });
  };

  const updateCursorPosition = (textarea: HTMLTextAreaElement) => {
    const selStart = textarea.selectionStart;
    const textBefore = textarea.value.substring(0, selStart);
    const lines = textBefore.split("\n");
    const currentLine = lines.length;
    const currentCol = lines[lines.length - 1].length + 1;
    setCursorPos({ line: currentLine, col: currentCol });
  };

  // Scratch Category Selector (all, trigger, steps, control, loops, parallel, custom)
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [categorySearch, setCategorySearch] = useState<string>("");

  // Multi-Tenant User & Projects State
  // No identity until a real session or a verified engine license provides one.
  const [currentUser, setCurrentUser] = useState<UserProfile | null>(null);
  const [sessionToken, setSessionToken] = useState<string | null>(() => localStorage.getItem("studio_session_token"));
  const [isCheckingAuth, setIsCheckingAuth] = useState<boolean>(false);
  const [availableUsers, setAvailableUsers] = useState<UserProfile[]>([]);
  const [userProjects, setUserProjects] = useState<ProjectSummary[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [isSavingProject, setIsSavingProject] = useState<boolean>(false);
  const [storageSource, setStorageSource] = useState<"engine" | "none">("none");

  // Natural Login / Register Form State
  const [showAuthModal, setShowAuthModal] = useState<boolean>(false);
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [loginUsername, setLoginUsername] = useState<string>("");
  const [loginPassword, setLoginPassword] = useState<string>("");
  const [registerUsername, setRegisterUsername] = useState<string>("");
  const [registerPassword, setRegisterPassword] = useState<string>("");
  const [registerName, setRegisterName] = useState<string>("");
  const [registerRole, setRegisterRole] = useState<string>("");
  const [authError, setAuthError] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState<boolean>(false);
  const [showUserMenu, setShowUserMenu] = useState<boolean>(false);

  // Modals for Projects
  const [showProjectsModal, setShowProjectsModal] = useState<boolean>(false);
  const [projectSearch, setProjectSearch] = useState<string>("");

  // New Project Form in ProjectsModal
  const [isCreatingProject, setIsCreatingProject] = useState<boolean>(false);
  const [newProjectName, setNewProjectName] = useState<string>("");
  const [newProjectDesc, setNewProjectDesc] = useState<string>("");
  const [newProjectDockerImage, setNewProjectDockerImage] = useState<string>("python:3.11-slim");

  // FAQ Modal
  const [showFaqModal, setShowFaqModal] = useState<boolean>(false);
  const [openFaqId, setOpenFaqId] = useState<string | null>("faq_1");
  const [faqSearch, setFaqSearch] = useState<string>("");

  // Work Plan Modal
  const [showWorkPlanModal, setShowWorkPlanModal] = useState<boolean>(false);

  // Flowchart View state (Interactive Pan & Zoom)
  const [mermaidCode, setMermaidCode] = useState<string>("");
  const [mermaidZoom, setMermaidZoom] = useState<number>(1.0);
  const [mermaidPan, setMermaidPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [mermaidIsDragging, setMermaidIsDragging] = useState<boolean>(false);
  const mermaidZoomRef = useRef<number>(1.0);
  const mermaidPanRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const mermaidDragStart = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const mermaidContainerRef = useRef<HTMLDivElement>(null);
  const mermaidFullRef = useRef<HTMLDivElement>(null);

  mermaidZoomRef.current = mermaidZoom;
  mermaidPanRef.current = mermaidPan;

  // Live Syntax-Highlighted Editor Refs
  const editorTextareaRef = useRef<HTMLTextAreaElement>(null);
  const editorPreRef = useRef<HTMLPreElement>(null);
  const editorLineNumbersRef = useRef<HTMLDivElement>(null);

  // Generated Microservice Preview State
  const [generatedFiles, setGeneratedFiles] = useState<{ path: string; content: string }[]>([]);
  const [selectedFileIdx, setSelectedFileIdx] = useState<number>(0);
  const [previewLoading, setPreviewLoading] = useState<boolean>(false);

  // Verification & Status
  const [verificationModal, setVerificationModal] = useState<any | null>(null);
  const [dryRunLoading, setDryRunLoading] = useState<boolean>(false);
  const [zipLoading, setZipLoading] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string>("Ready — Click 🏁 Green Flag to simulate pipeline");

  // Simulation Stage State
  const [isSimulating, setIsSimulating] = useState<boolean>(false);
  const [stageViewMode, setStageViewMode] = useState<"compact" | "normal" | "fullscreen">("normal");
  const [testPayloadText, setTestPayloadText] = useState<string>(
    JSON.stringify({ url: "https://api.example.com/v1/data", query: "vision analysis", batch_size: 10 }, null, 2)
  );
  const [simSteps, setSimSteps] = useState<SimStepResult[]>([]);
  const [simContext, setSimContext] = useState<Record<string, any>>({});
  const [simLogs, setSimLogs] = useState<{ time: string; level: string; msg: string }[]>([]);
  const [cpuUsage, setCpuUsage] = useState<number>(0);
  const [ramUsage, setRamUsage] = useState<number>(142);
  const simulationAbortRef = useRef<boolean>(false);
  const vsCodeSyncTimerRef = useRef<any>(null);

  // Step Parameters Modal State
  const [configModalBlock, setConfigModalBlock] = useState<any | null>(null);
  const [dynamicFields, setDynamicFields] = useState<ParamSpec[]>([]);
  const [blockParamValues, setBlockParamValues] = useState<Record<string, any>>({});

  // AI Prompt Modal
  const [showAiModal, setShowAiModal] = useState<boolean>(false);
  const [aiPrompt, setAiPrompt] = useState<string>("");
  const [aiStepName, setAiStepName] = useState<string>("");

  // AI Step Configuration Modal State
  const [showAiConfigModal, setShowAiConfigModal] = useState<boolean>(false);
  const [targetAiBlock, setTargetAiBlock] = useState<any | null>(null);
  const [aiStepNameInput, setAiStepNameInput] = useState<string>("custom_ai_state");
  const [aiPromptInput, setAiPromptInput] = useState<string>("");

  // User File Attachment State
  const [targetUserFileBlock, setTargetUserFileBlock] = useState<any | null>(null);
  const userFileInputRef = useRef<HTMLInputElement>(null);

  // Block Palette Hover Tooltip State
  const [hoveredPaletteBlock, setHoveredPaletteBlock] = useState<any | null>(null);
  const [paletteTooltipPos, setPaletteTooltipPos] = useState<{ top: number; left: number } | null>(null);
  const hoverTimerRef = useRef<any>(null);

  const handleBlockMouseEnter = (block: any, e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = setTimeout(() => {
      setHoveredPaletteBlock(block);
      const estHeight = 390;
      const top = Math.max(60, Math.min(window.innerHeight - estHeight - 20, rect.top - 15));
      const left = Math.min(window.innerWidth - 410, rect.right + 14);
      setPaletteTooltipPos({ top, left });
    }, 180);
  };

  const handleBlockMouseLeave = () => {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    setHoveredPaletteBlock(null);
  };

  // Catalog Data
  const [catalog, setCatalog] = useState<CatalogStep[]>([]);
  const [userStates, setUserStates] = useState<CatalogStep[]>([]);

  const handleUserFileSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !targetUserFileBlock) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const code = (event.target?.result as string) || "";
      const matchDef = code.match(/def\s+([a-zA-Z0-9_]+)\s*\(/);
      const detectedName = matchDef ? matchDef[1] : file.name.replace(/\.py$/, "");
      targetUserFileBlock.setFieldValue(detectedName, "STEP_NAME");
      targetUserFileBlock.setFieldValue(file.name, "FILE_NAME");
      targetUserFileBlock.setFieldValue(`✅ ${file.name} (${Math.round((file.size / 1024) * 10) / 10} KB)`, "FILE_STATUS");

      attachedFilesRegistry[targetUserFileBlock.id] = {
        fileName: file.name,
        code: code,
        stepName: detectedName,
      };
      setStatusMessage(`Archivo adjuntado: ${file.name} (función: ${detectedName})`);
    };
    reader.readAsText(file);
  };

  // Close menu dropdowns on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest(".menu-dropdown-container")) {
        setActiveMenu(null);
      }
      if (!target.closest(".user-menu-container")) {
        setShowUserMenu(false);
      }
    };
    window.addEventListener("mousedown", handleClickOutside);
    return () => window.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Register AI and File Upload handlers for Blockly workspace
  useEffect(() => {
    (window as any).onOpenAiPromptModal = (block: any) => {
      setTargetAiBlock(block);
      setAiStepNameInput(block.getFieldValue("STEP_NAME") || "custom_ai_state");
      setAiPromptInput(block.getFieldValue("AI_PROMPT") || "");
      setShowAiConfigModal(true);
    };

    (window as any).onAttachUserFile = (block: any) => {
      setTargetUserFileBlock(block);
      if (userFileInputRef.current) {
        userFileInputRef.current.value = "";
        userFileInputRef.current.click();
      }
    };

    return () => {
      delete (window as any).onOpenAiPromptModal;
      delete (window as any).onAttachUserFile;
    };
  }, []);

  // FAQ Items Database
  const faqList: FaqItem[] = [
    {
      id: "faq_1",
      category: "Sandbox",
      question: "How does the Docker Sandbox verification loop work?",
      answer: "When you click 'Verify (Dry-Run)' or build a production ZIP, WPipe Studio validates the pipeline against 6 strict quality gates: acyclic DAG check, AST python syntax parsing, Ruff linter, Mypy typechecking, Pytest unit tests, and dry_run_pipeline. Only if all gates pass is the microservice ZIP released.",
    },
    {
      id: "faq_2",
      category: "Architecture",
      question: "How does the Scratux Visual Architecture map to WPipe?",
      answer: "Scratux (Scratch 3.0 Desktop) organizes work into 4 clear zones: 1) Top Menu Bar for project control and export; 2) Vertical Category Strip (Motion, Looks, Events, Control, Sensing) for palette navigation; 3) Blockly Workspace with drag-and-drop interlocking blocks; and 4) Live Simulation Stage (Green Flag 🏁 / Stop 🛑) for step-by-step pipeline execution and context debugging.",
    },
    {
      id: "faq_3",
      category: "General",
      question: "How do I upload custom Python (.py) state files?",
      answer: "Go to the 'Mis Estados' (My Blocks) category and click 'Upload .py File'. Your Python functions decorated with @step will be parsed into reusable Scratch blocks and emitted into app/states/ and app/dto/ following Dialect A standards.",
    },
    {
      id: "faq_4",
      category: "AI",
      question: "What is Dialect A code generation?",
      answer: "Dialect A pairs each step function with a dedicated Pydantic Context DTO (e.g. app/dto/step_dto.py and app/states/step.py). This eliminates global untyped state and ensures type safety and autocompletion.",
    },
    {
      id: "faq_5",
      category: "Architecture",
      question: "How does the Release Catalog sync with wpipe-steps?",
      answer: "CatalogService reads the official release manifest steps_catalog.json (196 curated steps) with SHA-256 caching. It never scans unstable filesystem trees, ensuring only release-grade steps appear in the palette.",
    },
  ];

  // Splash Screen initial loader
  useEffect(() => {
    let progress = 0;
    const timer = setInterval(() => {
      progress += 25;
      setSplashProgress(progress);
      if (progress >= 100) {
        clearInterval(timer);
        setTimeout(() => {
          setSplashFadeOut(true);
          setTimeout(() => setShowSplash(false), 400);
        }, 300);
      }
    }, 150);
  }, []);

  // Synchronize Python Preview with current workspace blocks (generated ONLY by wpipe-engine)
  const handleSyncPythonCode = () => {
    if (!engineStatus.connected) {
      setGeneratedFiles([]);
      setFilesFromEngine(false);
      setStatusMessage("🔒 Python microservice generation requires the local wpipe-engine.");
      return;
    }
    setPreviewLoading(true);
    setStatusMessage("Generating the Python microservice in the local engine...");
    const canvasIr = getCanvasIRFromBlocklyWorkspace(catalog);

    compileOnEngine(canvasIr, projectName, engineStatus.port)
      .then((files) => {
        setGeneratedFiles(files);
        setFilesFromEngine(files.length > 0);
        setSelectedFileIdx(0);
        if (githubViewingFile) {
          const updatedView = files.find((f: any) => f.path === githubViewingFile.path);
          if (updatedView) {
            setGithubViewingFile(updatedView);
            setEditingFileContent(updatedView.content);
          }
        }
        setStatusMessage("Python microservice regenerated by wpipe-engine ✓");
      })
      .catch((err) => {
        setGeneratedFiles([]);
        setFilesFromEngine(false);
        if (!handleEngineError(err, "Generating the microservice")) {
          setStatusMessage(`Engine compilation error: ${err.message}`);
        }
      })
      .finally(() => {
        setPreviewLoading(false);
      });
  };

  // Switch to file editing mode (README.md is strictly protected against editing)
  const handleStartEditingFile = () => {
    if (!githubViewingFile) return;
    if (githubViewingFile.path === "README.md" || githubViewingFile.path.endsWith("/README.md")) {
      setStatusMessage("🔒 El archivo README.md está protegido contra edición (contiene derechos de autor de wisrovi y metadatos oficiales de WPipe Studio).");
      return;
    }
    setEditingFileContent(githubViewingFile.content);
    setIsEditingFile(true);
  };

  // Support Tab key indentation inside editor textarea
  const handleEditorKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Tab") {
      e.preventDefault();
      const textarea = e.currentTarget;
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const value = textarea.value;
      const newValue = value.substring(0, start) + "    " + value.substring(end);
      setEditingFileContent(newValue);
      setTimeout(() => {
        if (editorTextareaRef.current) {
          editorTextareaRef.current.selectionStart = editorTextareaRef.current.selectionEnd = start + 4;
        }
      }, 0);
    }
  };

  // Synchronize scroll between interactive textarea, live syntax layer, and line numbers gutter
  const handleEditorScroll = (e: React.UIEvent<HTMLTextAreaElement>) => {
    const { scrollTop, scrollLeft } = e.currentTarget;
    if (editorPreRef.current) {
      editorPreRef.current.scrollTop = scrollTop;
      editorPreRef.current.scrollLeft = scrollLeft;
    }
    if (editorLineNumbersRef.current) {
      editorLineNumbersRef.current.scrollTop = scrollTop;
    }
  };

  // Save changes to current file
  const handleSaveFileChanges = () => {
    if (!githubViewingFile) return;
    const updatedFiles = generatedFiles.map((f) =>
      f.path === githubViewingFile.path ? { ...f, content: editingFileContent } : f
    );
    setGeneratedFiles(updatedFiles);
    setGithubViewingFile({ ...githubViewingFile, content: editingFileContent });
    setOpenTabs((prev) =>
      prev.map((t) => (t.path === githubViewingFile.path ? { ...t, content: editingFileContent } : t))
    );
    setModifiedFiles((prev) => new Set(prev).add(githubViewingFile.path));
    setIsEditingFile(false);
    setStatusMessage(`Cambios guardados en ${githubViewingFile.path} ✓ (Preservado para exportación ZIP)`);
  };

  // Cancel file editing
  const handleCancelFileEditing = () => {
    if (githubViewingFile) {
      setEditingFileContent(githubViewingFile.content);
    }
    setIsEditingFile(false);
  };

  // Docker base image quick selector
  const handleSelectDockerBaseImage = (imageTag: string) => {
    if (!githubViewingFile) return;
    const currentCode = isEditingFile ? editingFileContent : githubViewingFile.content;
    const fromRegex = /FROM\s+[^\s\n]+/i;
    let newCode: string;
    if (fromRegex.test(currentCode)) {
      newCode = currentCode.replace(fromRegex, `FROM ${imageTag}`);
    } else {
      newCode = `FROM ${imageTag}\n` + currentCode;
    }
    setEditingFileContent(newCode);
    const updatedFiles = generatedFiles.map((f) =>
      f.path === githubViewingFile.path ? { ...f, content: newCode } : f
    );
    setGeneratedFiles(updatedFiles);
    setGithubViewingFile({ ...githubViewingFile, content: newCode });
    setStatusMessage(`Imagen base de Docker actualizada a '${imageTag}' ✓`);
  };

  // Fetch Release Catalog from Backend & Trigger Initial Codegen
  useEffect(() => {
    // 1. Load static release catalog immediately (offline/PWA support)
    fetch("/steps_catalog.json")
      .then((res) => (res.ok ? res.json() : null))
      .then((staticCatalog) => {
        if (Array.isArray(staticCatalog) && staticCatalog.length > 0) {
          setCatalog(staticCatalog);
          setBlocklyCatalog(staticCatalog);
        }
      })
      .catch(() => {});

    // 2. Query live engine for updated/custom steps if connected
    fetch(getEngineApiUrl("/api/v1/catalog/steps"))
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const cType = res.headers.get("content-type") || "";
        if (!cType.includes("application/json")) throw new Error("Not JSON");
        return res.json();
      })
      .then((data) => {
        if (Array.isArray(data) && data.length > 0) {
          setCatalog(data);
          setBlocklyCatalog(data);
        }
      })
      .catch(() => {
        // Fallback silently if engine not available
      });

    // Ensure microservice files are generated from initial canvas
    const timer = setTimeout(() => {
      handleSyncPythonCode();
    }, 500);
    return () => clearTimeout(timer);
  }, []);

  // User Avatar Background Color Helper
  const getUserColor = (user?: UserProfile | null) => {
    if (user?.avatar_color) return user.avatar_color;
    const username = user?.username || "user";
    const colors = ["#0284c7", "#4f46e5", "#059669", "#db2777", "#d97706", "#7c3aed", "#e11d48"];
    let hash = 0;
    for (let i = 0; i < username.length; i++) {
      hash = username.charCodeAt(i) + ((hash << 5) - hash);
    }
    return colors[Math.abs(hash) % colors.length];
  };

  // Helper for Authenticated Requests
  const getAuthHeaders = (overrideToken?: string) => {
    const headers: Record<string, string> = {};
    const token = overrideToken || sessionToken || localStorage.getItem("studio_session_token");
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
      headers["X-Session-Token"] = token;
    }
    if (currentUser?.id) {
      headers["X-User-ID"] = currentUser.id;
    }
    return headers;
  };

  // Check Active Session Token and Load Identity on Mount.
  // Without a real session the visitor is a guest; identity can also come from the verified engine license.
  useEffect(() => {
    const token = localStorage.getItem("studio_session_token");

    if (!token) {
      setCurrentUser(null);
      setIsCheckingAuth(false);
      return;
    }

    fetch("/api/v1/auth/me", {
      headers: {
        Authorization: `Bearer ${token}`,
        "X-Session-Token": token,
      },
    })
      .then((res) => {
        if (!res.ok) throw new Error("Invalid session token");
        const cType = res.headers.get("content-type") || "";
        if (!cType.includes("application/json")) throw new Error("No auth backend");
        return res.json();
      })
      .then((user: UserProfile) => {
        setCurrentUser(user);
        setSessionToken(token);
        localStorage.setItem("studio_user_id", user.id);
      })
      .catch(() => {
        localStorage.removeItem("studio_session_token");
        setSessionToken(null);
        setCurrentUser(null);
      })
      .finally(() => {
        setIsCheckingAuth(false);
      });
  }, []);

  // VS Code Webview Bridge Event Listener
  useEffect(() => {
    const isVSCode = window.location.search.includes("mode=vscode") || window.self !== window.top;
    if (!isVSCode) return;

    // Notify parent VS Code webview that the studio canvas is mounted and ready
    try {
      window.parent.postMessage({ type: "ready" }, "*");
    } catch {}

    const handleVsCodeMessage = (event: MessageEvent) => {
      const msg = event.data;
      if (!msg || typeof msg !== "object") return;

      if (msg.type === "init") {
        try {
          if (msg.documentUri) {
            const rawName = msg.documentUri.split("/").pop() || "pipeline";
            const cleanName = rawName.replace(/\.(wpipe|wpipe\.json|json)$/, "");
            if (cleanName) setProjectName(cleanName);
          }
          if (msg.data && Object.keys(msg.data).length > 0) {
            const raw = typeof msg.data === "string" ? msg.data : JSON.stringify(msg.data);
            const project = parseWpipeFileContent(raw);
            if (project.name && project.name !== "pipeline" && project.name !== "imported_pipeline") {
              setProjectName(project.name);
            }
            if (project.canvas_ir && (project.canvas_ir as any).workspace_state) {
              loadWorkspaceStateJson((project.canvas_ir as any).workspace_state);
            }
            if (project.generated_files && project.generated_files.length > 0) {
              setGeneratedFiles(project.generated_files);
            }
          }
          if (msg.license) {
            // Never trust license flags sent through postMessage: re-probe the engine and
            // verify its signed token instead (any parent frame could forge this message).
            checkEngine();
          }
        } catch (err: any) {
          console.warn("Failed to load initial VS Code pipeline:", err);
        }
      } else if (msg.type === "update") {
        try {
          if (msg.data) {
            const raw = typeof msg.data === "string" ? msg.data : JSON.stringify(msg.data);
            const project = parseWpipeFileContent(raw);
            if (project.canvas_ir && (project.canvas_ir as any).workspace_state) {
              loadWorkspaceStateJson((project.canvas_ir as any).workspace_state);
            }
          }
        } catch {}
      } else if (msg.type === "simulateResult") {
        if (msg.result) {
          setIsSimulating(false);
          if (msg.result.logs) {
            setSimLogs(
              msg.result.logs.map((l: string) => ({
                time: new Date().toLocaleTimeString(),
                level: "INFO",
                msg: l,
              }))
            );
          }
          if (msg.result.context_egress) {
            setSimContext(msg.result.context_egress);
          }
          setStatusMessage("✓ Simulation completed via VS Code engine");
        }
      }
    };

    window.addEventListener("message", handleVsCodeMessage);
    return () => {
      window.removeEventListener("message", handleVsCodeMessage);
    };
  }, []);

  // Fetch Projects using Hybrid Engine / Browser Dispatcher
  const fetchUserProjects = async (userId?: string, tokenOverride?: string) => {
    try {
      const res = await fetchProjectsHybrid(engineStatus.connected, engineStatus.port);
      setUserProjects(res.projects);
      setStorageSource(res.source);
    } catch (err) {
      console.error("Error fetching projects:", err);
    }
  };

  // Open / Load a Microservice Project into Workspace
  const handleOpenProject = async (projectId: string) => {
    if (!engineStatus.connected) {
      showEngineRequired("Opening microservices");
      return;
    }
    try {
      setStatusMessage("Loading microservice...");
      const res = await loadProjectHybrid(projectId, engineStatus.connected, engineStatus.port);
      const project: ProjectDetail = res.project;
      setActiveProjectId(project.id);
      setProjectName(project.name);
      setCustomDockerImage(project.docker_image || "python:3.11-slim");
      const files = (project.generated_files && project.generated_files.length > 0)
        ? project.generated_files
        : ((project as any).files || []);
      if (files.length > 0) {
        setGeneratedFiles(files);
        setSelectedFileIdx(0);
        setGithubViewingFile(null);
        setGithubCurrentDir("");
      }
      if (project.canvas_ir && (project.canvas_ir as any).workspace_state) {
        loadWorkspaceStateJson((project.canvas_ir as any).workspace_state);
      }
      loadSimulationHistory(project.id);
      loadProjectEnv(project.id);
      setFilesFromEngine(files.length > 0);
      setStatusMessage(`Microservice '${project.name}' loaded from Local PC ✓`);
      setShowProjectsModal(false);
    } catch (err: any) {
      setStatusMessage(`Error: ${err.message}`);
    }
  };

  // 1. Simulation History Loader
  const loadSimulationHistory = async (projId: string) => {
    if (!engineStatus.connected) return;
    try {
      const data = await engineJson(`/api/v1/projects/${projId}/simulations`, {}, true, engineStatus.port);
      if (Array.isArray(data)) setSimulationHistory(data);
    } catch {}
  };

  // 2. Environment Variables (.env) Loader & Saver
  const loadProjectEnv = async (projId: string) => {
    if (!engineStatus.connected) return;
    try {
      const data = await engineJson(`/api/v1/projects/${projId}/env`, {}, true, engineStatus.port);
      setEnvVars(data.variables || []);
    } catch {}
  };

  const handleSaveEnv = async () => {
    if (!activeProjectId) return;
    if (!engineStatus.connected) {
      showEngineRequired("Saving .env variables");
      return;
    }
    setIsSavingEnv(true);
    try {
      await engineJson(
        `/api/v1/projects/${activeProjectId}/env`,
        { method: "POST", body: JSON.stringify({ variables: envVars }) },
        true,
        engineStatus.port
      );
      setStatusMessage(".env variables saved ✓");
      setShowEnvModal(false);
    } catch (e: any) {
      setStatusMessage(`Error saving .env: ${e.message}`);
    } finally {
      setIsSavingEnv(false);
    }
  };

  // 3. Interactive Shell Terminal Execution
  const handleExecuteTerminal = async (cmdToRun?: string) => {
    const cmd = (cmdToRun !== undefined ? cmdToRun : terminalInput).trim();
    if (!cmd) return;
    setTerminalInput("");
    setIsExecutingTerminal(true);

    if (cmd === "clear") {
      setTerminalHistory([]);
      setIsExecutingTerminal(false);
      return;
    }

    if (!activeProjectId) {
      setTerminalHistory((prev) => [
        ...prev,
        { command: cmd, stdout: "", stderr: "No hay microservicio seleccionado en el workspace.", exit_code: 1 },
      ]);
      setIsExecutingTerminal(false);
      return;
    }

    if (!engineStatus.connected) {
      setTerminalHistory((prev) => [
        ...prev,
        { command: cmd, stdout: "", stderr: "The terminal requires the local wpipe-engine (127.0.0.1:49152).", exit_code: 1 },
      ]);
      setIsExecutingTerminal(false);
      return;
    }

    try {
      const data = await engineJson(
        `/api/v1/projects/${activeProjectId}/terminal`,
        { method: "POST", body: JSON.stringify({ command: cmd }) },
        true,
        engineStatus.port
      );
      setTerminalHistory((prev) => [
        ...prev,
        { command: cmd, stdout: data.stdout, stderr: data.stderr, exit_code: data.exit_code, cwd: data.cwd },
      ]);
    } catch (e: any) {
      setTerminalHistory((prev) => [
        ...prev,
        { command: cmd, stdout: "", stderr: `Error de red: ${e.message}`, exit_code: 1 },
      ]);
    } finally {
      setIsExecutingTerminal(false);
    }
  };

  // 4. Test Runner (pytest tests/)
  const handleRunTests = async () => {
    if (!activeProjectId) {
      setStatusMessage("Selecciona o crea un microservicio para ejecutar pruebas unitarias.");
      return;
    }
    if (!engineStatus.connected) {
      showEngineRequired("Running the test suite");
      return;
    }
    setIsTestingRunning(true);
    setBottomPanelOpen(true);
    setBottomPanelTab("tests");
    try {
      const data = await engineJson(
        `/api/v1/projects/${activeProjectId}/run-tests`,
        { method: "POST" },
        true,
        engineStatus.port
      );
      setTestRunData(data);
      setStatusMessage(`Tests completados: ${data.passed}/${data.total} pasados en ${data.duration_sec}s`);
    } catch (e: any) {
      setStatusMessage(`Error ejecutando tests: ${e.message}`);
    } finally {
      setIsTestingRunning(false);
    }
  };

  // 5. Breakpoints and Step Inspector
  const handleBlockSelected = (blockData: any) => {
    setSelectedBlockData(blockData);
    if (blockData) {
      setInspectorOpen(true);
    }
  };

  const handleToggleBreakpoint = (id: string, name: string) => {
    const isNowSet = toggleBlockBreakpoint(id);
    toggleBlockBreakpoint(name);
    setBreakpoints(new Set(globalBreakpoints));
    if (selectedBlockData && (selectedBlockData.id === id || selectedBlockData.stepName === name)) {
      setSelectedBlockData({
        ...selectedBlockData,
        isBreakpoint: isNowSet,
      });
    }
    setStatusMessage(isNowSet ? `🔴 Punto de interrupción fijado en ${name}` : `Punto de interrupción removido de ${name}`);
  };

  const handleResumeSimulation = () => {
    if (resumeSimulationResolveRef.current) {
      resumeSimulationResolveRef.current();
      resumeSimulationResolveRef.current = null;
      setIsPausedAtBreakpoint(false);
      setStatusMessage("Continuando simulación...");
    }
  };

  // 6. Live Split View Workspace Sync & VS Code Document Auto-Save
  const handleWorkspaceChanged = (ws: any) => {
    setCanvasBlockCount(getWorkspaceBlockCount());
    if (isSplitView) {
      if (!engineStatus.connected) {
        setLivePipelineCode("# Live Python preview requires the local wpipe-engine (127.0.0.1:49152).");
      } else {
        const cIr = getCanvasIRFromBlocklyWorkspace(catalog);
        compileOnEngine(cIr, projectName, engineStatus.port)
          .then((files) => {
            const pipeFile = files.find((f) => f.path === "app/pipelines.py" || f.path === "app/pipeline.py");
            if (pipeFile) setLivePipelineCode(pipeFile.content);
          })
          .catch((err) => {
            if (err instanceof EngineLimitError) {
              setLivePipelineCode(`# 🔒 ${err.message}`);
            }
          });
      }
    }

    // Auto-sync canvas changes to VS Code document in VS Code mode
    const isVSCode = window.location.search.includes("mode=vscode") || window.self !== window.top;
    if (isVSCode) {
      if (vsCodeSyncTimerRef.current) {
        clearTimeout(vsCodeSyncTimerRef.current);
      }
      vsCodeSyncTimerRef.current = setTimeout(() => {
        try {
          const canvasIr = getCanvasIRFromBlocklyWorkspace(catalog);
          const workspaceState = getWorkspaceStateJson();
          if (workspaceState) {
            (canvasIr as any).workspace_state = workspaceState;
          }
          window.parent.postMessage(
            {
              type: "saveCanvas",
              canvasIr: {
                format: "wpipe",
                project: {
                  id: activeProjectId || "pipeline",
                  name: projectName,
                  protocol: "fastapi",
                  docker_image: customDockerImage,
                  canvas_ir: canvasIr,
                  workspace_state: workspaceState,
                  generated_files: generatedFiles,
                },
              },
            },
            "*"
          );
        } catch {}
      }, 400);
    }
  };

  // Save Current Microservice into Local Workspace (Hybrid Engine / Browser)
  const handleSaveProject = async () => {
    if (!engineStatus.connected) {
      showEngineRequired("Saving microservices");
      return;
    }
    setIsSavingProject(true);
    setStatusMessage("Guardando microservicio...");
    const canvasIr = getCanvasIRFromBlocklyWorkspace(catalog);
    const workspaceState = getWorkspaceStateJson();
    if (workspaceState) {
      (canvasIr as any).workspace_state = workspaceState;
    }

    try {
      const res = await saveProjectHybrid(
        {
          id: activeProjectId,
          name: projectName,
          description: `Microservicio ${projectName} guardado desde el lienzo`,
          protocol: "fastapi",
          docker_image: customDockerImage,
          canvas_ir: canvasIr,
          generated_files: generatedFiles,
        },
        engineStatus.connected,
        engineStatus.port
      );
      if (res.project?.id) {
        setActiveProjectId(res.project.id);
      }
      await fetchUserProjects();
      setStatusMessage(`Microservice '${projectName}' saved ✓ (Local PC ~/.wpipe)`);
    } catch (err: any) {
      if (!handleEngineError(err, "Saving microservices")) setStatusMessage(`Error saving: ${err.message}`);
    } finally {
      setIsSavingProject(false);
    }
  };
  handleSaveProjectRef.current = handleSaveProject;

  // Rename Pipeline / Microservice
  const handleRenamePipeline = () => {
    const newName = window.prompt("Introduce el nuevo nombre del pipeline / microservicio:", projectName);
    if (newName && newName.trim()) {
      const sanitized = newName.trim().replace(/[^a-zA-Z0-9_-]/g, "_");
      setProjectName(sanitized);
      setStatusMessage(`Pipeline renombrado a '${sanitized}' ✓`);
    }
  };

  // Create New Microservice from Modal
  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProjectName.trim()) return;
    if (!engineStatus.connected) {
      showEngineRequired("Creating microservices");
      return;
    }
    try {
      const canvasIr = getCanvasIRFromBlocklyWorkspace(catalog);
      const workspaceState = getWorkspaceStateJson();
      if (workspaceState) {
        (canvasIr as any).workspace_state = workspaceState;
      }
      const cleanName = newProjectName.trim().replace(/[^a-zA-Z0-9_-]/g, "_");
      const res = await saveProjectHybrid(
        {
          name: cleanName,
          description: newProjectDesc.trim() || `Microservicio ${cleanName}`,
          docker_image: newProjectDockerImage,
          protocol: "fastapi",
          canvas_ir: canvasIr,
          generated_files: generatedFiles,
        },
        engineStatus.connected,
        engineStatus.port
      );
      const created = res.project;
      setActiveProjectId(created.id);
      setProjectName(created.name);
      setCustomDockerImage(created.docker_image || "python:3.11-slim");
      await fetchUserProjects();
      setIsCreatingProject(false);
      setNewProjectName("");
      setNewProjectDesc("");
      setStatusMessage(`Microservice '${created.name}' created (Local PC ~/.wpipe) ✓`);
      setShowProjectsModal(false);
    } catch (err: any) {
      if (!handleEngineError(err, "Creating microservices")) setStatusMessage(`Error creating: ${err.message}`);
    }
  };

  // Duplicate an Existing Microservice
  const handleDuplicateProject = async (projectId: string) => {
    if (!engineStatus.connected) {
      showEngineRequired("Duplicating microservices");
      return;
    }
    try {
      setStatusMessage("Duplicating microservice...");
      const res = await duplicateProjectHybrid(projectId, engineStatus.connected, engineStatus.port);
      await fetchUserProjects();
      setStatusMessage(`Microservicio duplicado como '${res.project?.name || "copia"}' ✓`);
    } catch (err: any) {
      if (!handleEngineError(err, "Duplicating microservices")) setStatusMessage(`Error duplicating: ${err.message}`);
    }
  };

  // Delete an Existing Microservice
  const handleDeleteProject = async (projectId: string, projName: string) => {
    if (!engineStatus.connected) {
      showEngineRequired("Deleting microservices");
      return;
    }
    if (!window.confirm(`Permanently delete the microservice '${projName}'?`)) return;
    try {
      await deleteProjectHybrid(projectId, engineStatus.connected, engineStatus.port);
      if (activeProjectId === projectId) {
        setActiveProjectId(null);
      }
      await fetchUserProjects();
      setStatusMessage(`Microservicio '${projName}' eliminado`);
    } catch (err: any) {
      setStatusMessage(`Error al eliminar: ${err.message}`);
    }
  };

  // Export current canvas/microservice as .wpipe file
  const handleExportWpipe = () => {
    const canvasIr = getCanvasIRFromBlocklyWorkspace(catalog);
    const workspaceState = getWorkspaceStateJson();
    if (workspaceState) {
      (canvasIr as any).workspace_state = workspaceState;
    }
    const isVSCode = window.location.search.includes("mode=vscode") || window.self !== window.top;
    if (isVSCode) {
      try {
        window.parent.postMessage(
          {
            type: "saveCanvas",
            canvasIr: {
              format: "wpipe",
              project: {
                id: activeProjectId || "pipeline",
                name: projectName,
                protocol: "fastapi",
                docker_image: customDockerImage,
                canvas_ir: canvasIr,
                workspace_state: workspaceState,
                generated_files: generatedFiles,
              },
            },
          },
          "*"
        );
      } catch {}
    }
    exportProjectToWpipeFile({
      id: activeProjectId || `proj_${Date.now()}`,
      name: projectName,
      description: `Microservicio ${projectName}`,
      owner_id: currentUser?.id || "local_dev",
      docker_image: customDockerImage,
      protocol: "fastapi",
      canvas_ir: canvasIr,
      generated_files: generatedFiles,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    setStatusMessage(`Archivo '${projectName}.wpipe' descargado ✓`);
  };

  // Import a .wpipe file into workspace
  const handleImportWpipeFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const text = event.target?.result as string;
        const project = parseWpipeFileContent(text);
        setActiveProjectId(project.id);
        setProjectName(project.name);
        setCustomDockerImage(project.docker_image || "python:3.11-slim");
        const files = (project.generated_files && project.generated_files.length > 0)
          ? project.generated_files
          : (project.files || []);
        void files;
        if (project.canvas_ir && (project.canvas_ir as any).workspace_state) {
          loadWorkspaceStateJson((project.canvas_ir as any).workspace_state);
        }
        // The design is always loaded on the canvas; persisting it needs the engine (limits re-applied there).
        setGeneratedFiles([]);
        setFilesFromEngine(false);
        if (engineStatus.connected) {
          await saveProjectHybrid(project, true, engineStatus.port);
          await fetchUserProjects();
          setStatusMessage(`Design '${file.name}' imported and saved in the local engine ✓`);
        } else {
          setStatusMessage(`Design '${file.name}' loaded on the canvas (connect wpipe-engine to save it as a project) ✓`);
        }
        setShowProjectsModal(false);
      } catch (err: any) {
        if (!handleEngineError(err, "Importing .wpipe projects")) alert(`Error importing .wpipe file: ${err.message}`);
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  // Natural Login with Username and Password
  const handleNaturalLogin = async (
    e?: React.FormEvent,
    overrideUsername?: string,
    overridePassword?: string
  ) => {
    if (e) e.preventDefault();
    const u = (overrideUsername || loginUsername).trim();
    const p = overridePassword || loginPassword;
    if (!u || !p) {
      setAuthError("Por favor ingresa usuario y contraseña.");
      return;
    }

    setAuthLoading(true);
    setAuthError(null);
    try {
      const res = await fetch("/api/v1/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: u, password: p }),
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.detail || "Usuario o contraseña incorrectos.");
      }

      const data = await res.json();
      localStorage.setItem("studio_session_token", data.token);
      localStorage.setItem("studio_user_id", data.user.id);
      setSessionToken(data.token);
      setCurrentUser(data.user);
      setShowAuthModal(false);
      setLoginPassword("");
      setStatusMessage(`Bienvenido de nuevo, ${data.user.name} ✓`);

      // Load user projects and immediately show projects modal to view all microservices
      await fetchUserProjects(data.user.id, data.token);
      setShowProjectsModal(true);
    } catch (err: any) {
      setAuthError(err.message || "Error al iniciar sesión.");
    } finally {
      setAuthLoading(false);
    }
  };

  // Natural Register New User Identity
  const handleNaturalRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    const u = registerUsername.trim().toLowerCase();
    const p = registerPassword;
    const n = registerName.trim();
    const r = registerRole.trim() || "Developer";

    if (!u || !p || !n) {
      setAuthError("Por favor completa nombre, usuario y contraseña.");
      return;
    }
    if (p.length < 4) {
      setAuthError("La contraseña debe tener al menos 4 caracteres.");
      return;
    }

    setAuthLoading(true);
    setAuthError(null);
    try {
      const res = await fetch("/api/v1/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: u, password: p, name: n, role: r }),
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.detail || "Error al registrar la cuenta.");
      }

      const data = await res.json();
      localStorage.setItem("studio_session_token", data.token);
      localStorage.setItem("studio_user_id", data.user.id);
      setSessionToken(data.token);
      setCurrentUser(data.user);
      setShowAuthModal(false);
      setRegisterUsername("");
      setRegisterPassword("");
      setRegisterName("");
      setRegisterRole("");
      setStatusMessage(`Cuenta creada para ${data.user.name} ✓`);

      // Load user projects and immediately show projects modal
      await fetchUserProjects(data.user.id, data.token);
      setShowProjectsModal(true);
    } catch (err: any) {
      setAuthError(err.message || "Error al registrar usuario.");
    } finally {
      setAuthLoading(false);
    }
  };

  // Session Termination / Logout
  const handleLogout = async () => {
    const token = sessionToken || localStorage.getItem("studio_session_token");
    if (token) {
      try {
        await fetch("/api/v1/auth/logout", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "X-Session-Token": token,
          },
        });
      } catch (err) {
        console.warn("Logout request failed:", err);
      }
    }

    localStorage.removeItem("studio_session_token");
    localStorage.removeItem("studio_user_id");
    setSessionToken(null);
    setCurrentUser(null);
    setActiveProjectId(null);
    fetchUserProjects();
    setShowUserMenu(false);
    setShowProjectsModal(false);
    setStatusMessage("Sesión local restaurada ✓");
  };

  // Load Python Preview when switching to python tab
  useEffect(() => {
    if (activeMainTab === "python") {
      handleSyncPythonCode();
    }
  }, [activeMainTab]);

  // Register window event handler for Blockly block config click
  useEffect(() => {
    (window as any).onOpenBlockConfigModal = (block: any) => {
      setConfigModalBlock(block);
      const stepName = (block.getFieldValue("STEP_NAME") || "").toLowerCase();
      const ns = (block.getFieldValue("NAMESPACE") || "").toLowerCase();

      const catalogStep = catalog.find(
        (s) => s.name.toLowerCase() === stepName || s.func_name.toLowerCase() === stepName || s.namespace.toLowerCase() === ns
      );

      if (catalogStep && catalogStep.params && catalogStep.params.length > 0) {
        setDynamicFields(catalogStep.params);
        const initialVals: Record<string, any> = {};
        catalogStep.params.forEach((p) => {
          initialVals[p.name] = p.default ?? "";
        });
        setBlockParamValues(initialVals);
      } else if (stepName.includes("redis") || ns.includes("redis")) {
        setDynamicFields([
          { name: "host", annotation: "str", default: "127.0.0.1" },
          { name: "port", annotation: "int", default: 6379 },
          { name: "db", annotation: "int", default: 0 },
        ]);
        setBlockParamValues({ host: "127.0.0.1", port: "6379", db: "0" });
      } else if (stepName.includes("yolo") || ns.includes("vision") || stepName.includes("ocr")) {
        setDynamicFields([
          { name: "model_path", annotation: "str", default: "/models/yolov8n.pt" },
          { name: "conf_threshold", annotation: "float", default: 0.25 },
          { name: "device", annotation: "str", default: "cuda:0" },
        ]);
        setBlockParamValues({ model_path: "/models/yolov8n.pt", conf_threshold: "0.25", device: "cuda:0" });
      } else {
        setDynamicFields([
          { name: "endpoint_url", annotation: "str", default: "https://api.example.com/v1" },
          { name: "timeout", annotation: "int", default: 30 },
        ]);
        setBlockParamValues({ endpoint_url: "https://api.example.com/v1", timeout: "30" });
      }
    };
    return () => {
      delete (window as any).onOpenBlockConfigModal;
    };
  }, [catalog]);

  // Center and auto-fit Mermaid diagram
  const handleCenterMermaid = () => {
    if (!mermaidContainerRef.current || !mermaidFullRef.current) {
      setMermaidPan({ x: 0, y: 0 });
      return;
    }
    const container = mermaidContainerRef.current.getBoundingClientRect();
    const svg = mermaidFullRef.current.querySelector("svg");
    if (svg && container.width > 0 && container.height > 0) {
      const svgRect = svg.getBoundingClientRect();
      const currentScale = mermaidZoomRef.current || 1.0;
      const naturalWidth = svgRect.width / currentScale;
      const naturalHeight = svgRect.height / currentScale;

      if (naturalWidth > 0 && naturalHeight > 0) {
        const scaleX = (container.width - 80) / naturalWidth;
        const scaleY = (container.height - 80) / naturalHeight;
        const fitScale = Math.min(1.5, Math.max(0.35, Math.min(scaleX, scaleY)));

        setMermaidZoom(+fitScale.toFixed(2));
        const offsetX = (container.width - naturalWidth * fitScale) / 2;
        const offsetY = (container.height - naturalHeight * fitScale) / 2;
        setMermaidPan({ x: Math.round(offsetX), y: Math.round(Math.max(24, offsetY)) });
        setStatusMessage(`Diagrama Mermaid centrado y ajustado (${Math.round(fitScale * 100)}%)`);
      }
    } else {
      setMermaidPan({ x: 0, y: 0 });
      setMermaidZoom(1.0);
    }
  };

  const handleResetMermaid = () => {
    setMermaidZoom(1.0);
    setMermaidPan({ x: 0, y: 0 });
    setStatusMessage("Zoom y posición de Mermaid restablecidos a 100%");
  };

  const handleExportMermaidSvg = () => {
    if (!mermaidFullRef.current) return;
    const svg = mermaidFullRef.current.querySelector("svg");
    if (!svg) {
      setStatusMessage("No hay diagrama SVG disponible para exportar");
      return;
    }
    const svgData = new XMLSerializer().serializeToString(svg);
    const svgBlob = new Blob([svgData], { type: "image/svg+xml;charset=utf-8" });
    const svgUrl = URL.createObjectURL(svgBlob);
    const a = document.createElement("a");
    a.href = svgUrl;
    a.download = `${projectName}_pipeline_diagram.svg`;
    a.click();
    setStatusMessage("Diagrama SVG exportado exitosamente ✓");
  };

  const handleMermaidMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button === 0 || e.button === 1) {
      setMermaidIsDragging(true);
      mermaidDragStart.current = {
        x: e.clientX - mermaidPanRef.current.x,
        y: e.clientY - mermaidPanRef.current.y,
      };
    }
  };

  const handleMermaidMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (mermaidIsDragging) {
      setMermaidPan({
        x: e.clientX - mermaidDragStart.current.x,
        y: e.clientY - mermaidDragStart.current.y,
      });
    }
  };

  const handleMermaidMouseUp = () => {
    setMermaidIsDragging(false);
  };

  const handleMermaidWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (!mermaidContainerRef.current) return;
    const containerRect = mermaidContainerRef.current.getBoundingClientRect();
    const mouseX = e.clientX - containerRect.left;
    const mouseY = e.clientY - containerRect.top;

    const zoomFactor = e.deltaY < 0 ? 1.15 : 0.87;
    const oldZoom = mermaidZoomRef.current;
    const newZoom = Math.min(4.0, Math.max(0.2, +(oldZoom * zoomFactor).toFixed(2)));

    const newPanX = mouseX - ((mouseX - mermaidPanRef.current.x) / oldZoom) * newZoom;
    const newPanY = mouseY - ((mouseY - mermaidPanRef.current.y) / oldZoom) * newZoom;

    setMermaidZoom(newZoom);
    setMermaidPan({ x: Math.round(newPanX), y: Math.round(newPanY) });
  };

  // Mermaid render effect with node interaction and auto-fit
  useEffect(() => {
    if (activeMainTab === "flowchart" && mermaidCode && mermaidFullRef.current) {
      mermaid.initialize({ startOnLoad: false, theme: "dark" });
      mermaidFullRef.current.innerHTML = "";
      const uniqueSvgId = `mermaid_svg_full_${Date.now()}`;
      mermaid
        .render(uniqueSvgId, mermaidCode)
        .then(({ svg }) => {
          if (mermaidFullRef.current) {
            mermaidFullRef.current.innerHTML = svg;
            const svgElement = mermaidFullRef.current.querySelector("svg");
            if (svgElement) {
              svgElement.style.maxWidth = "none";
              svgElement.style.height = "auto";
              svgElement.style.display = "block";
            }
            // Add interactive node click feedback
            const nodes = mermaidFullRef.current.querySelectorAll(".node");
            nodes.forEach((node) => {
              (node as HTMLElement).style.cursor = "pointer";
              node.addEventListener("click", (e) => {
                e.stopPropagation();
                const textEl = node.querySelector(".nodeLabel") || node;
                const label = textEl.textContent || "Paso";
                setStatusMessage(`Nodo seleccionado en DAG: "${label.trim()}"`);
              });
            });

            setTimeout(() => {
              handleCenterMermaid();
            }, 80);
          }
        })
        .catch((err) => {
          console.error("Mermaid render error:", err);
        });
    }
  }, [activeMainTab, mermaidCode]);

  // Render Mermaid diagrams embedded within README and Markdown previews
  useEffect(() => {
    const timer = setTimeout(() => {
      const nodes = document.querySelectorAll(".markdown-body .mermaid:not([data-processed='true'])");
      if (nodes.length > 0) {
        try {
          mermaid.run({
            nodes: Array.from(nodes) as HTMLElement[],
          }).catch((err) => {
            console.warn("Mermaid markdown preview render warning:", err);
          });
        } catch (e) {
          console.warn("Mermaid run error:", e);
        }
      }
    }, 120);
    return () => clearTimeout(timer);
  }, [readmePreviewMode, activeMainTab, githubViewingFile, generatedFiles]);

  // Synchronize Blockly SVG canvas whenever Split View, Bottom Panel (Terminal), or Sidebar toggles
  useEffect(() => {
    const triggerResize = () => {
      window.dispatchEvent(new Event("resize"));
    };
    triggerResize();
    const t1 = setTimeout(triggerResize, 30);
    const t2 = setTimeout(triggerResize, 150);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [isSplitView, bottomPanelOpen, bottomPanelMaximized, showSidebar, activeMainTab]);

  // Switch to Flowchart view
  const handleOpenFlowchart = () => {
    const code = getMermaidFromBlocklyWorkspace();
    setMermaidCode(code);
    setActiveMainTab("flowchart");
    setStatusMessage("Visualizando flujo Mermaid interactivo (Arrastra para mover • Rueda para zoom)");
  };

  // Perform Dry-Run Quality Verification
  const handleDryRun = async () => {
    if (!engineStatus.connected) {
      showEngineRequired("Quality verification (Dry-Run)");
      return;
    }
    setDryRunLoading(true);
    setStatusMessage("Ejecutando compuertas de calidad AST y verificación de contratos...");
    const canvasIr = getCanvasIRFromBlocklyWorkspace(catalog);
    try {
      const url = getEngineApiUrl("/api/v1/pipeline/dry-run", engineStatus.port);
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(canvasIr),
      });
      if (res.ok) {
        const data = await res.json();
        setVerificationModal({
          status: data.status || (data.valid ? "passed" : "failed"),
          gates: data.gates || {
            ast_syntax_check: true,
            input_contract_reads: true,
            output_contract_writes: true,
            flow_connectivity: true,
            wpipe_decorators_valid: true,
          },
        });
        setStatusMessage("Verificación completada: PASS (Todas las compuertas aprobadas) ✓");
        return;
      }
      throw new Error(`HTTP ${res.status}`);
    } catch (err: any) {
      setStatusMessage(`Verification failed in the local engine: ${err.message}`);
    } finally {
      setDryRunLoading(false);
    }
  };

  // Generate and download microservice ZIP (Client-Side JSZip with 0 latency & Offline Support)
  const handleGenerateZip = async () => {
    if (!engineStatus.connected) {
      showEngineRequired("Downloading the microservice ZIP");
      return;
    }
    if (!engineStatus.entitlements.zip_export) {
      setLimitNotice({ title: "PRO Feature Required", message: "ZIP export is not included in your plan." });
      return;
    }
    setZipLoading(true);
    setStatusMessage("Generando paquete ZIP del microservicio...");

    // Also compile directly to VS Code workspace if running inside VS Code
    const isVSCode = window.location.search.includes("mode=vscode") || window.self !== window.top;
    if (isVSCode) {
      try {
        const canvasIr = getCanvasIRFromBlocklyWorkspace(catalog);
        const workspaceState = getWorkspaceStateJson();
        if (workspaceState) {
          (canvasIr as any).workspace_state = workspaceState;
        }
        window.parent.postMessage(
          {
            type: "compile",
            canvasIr: {
              format: "wpipe",
              project: {
                id: activeProjectId || "pipeline",
                name: projectName,
                protocol: "fastapi",
                docker_image: customDockerImage,
                canvas_ir: canvasIr,
                workspace_state: workspaceState,
                generated_files: generatedFiles,
              },
            },
          },
          "*"
        );
      } catch {}
    }

    try {
      // Only files produced by wpipe-engine are packaged (limits enforced by the engine).
      let filesToZip = filesFromEngine ? generatedFiles : [];
      if (!filesToZip || filesToZip.length === 0) {
        const canvasIr = getCanvasIRFromBlocklyWorkspace(catalog);
        filesToZip = await compileOnEngine(canvasIr, projectName, engineStatus.port);
        setGeneratedFiles(filesToZip);
        setFilesFromEngine(filesToZip.length > 0);
      }
      if (filesToZip.length === 0) {
        throw new Error("The engine returned no files");
      }

      const zip = new JSZip();
      for (const f of filesToZip) {
        zip.file(f.path, f.content);
      }

      const blob = await zip.generateAsync({ type: "blob" });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${projectName}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
      setStatusMessage(`Descargado con éxito: ${projectName}.zip (${filesToZip.length} archivos) ✓`);
    } catch (err: any) {
      console.error("ZIP Generation error:", err);
      if (!handleEngineError(err, "Downloading the microservice ZIP")) setStatusMessage(`Error generating ZIP: ${err.message}`);
    } finally {
      setZipLoading(false);
    }
  };

  // Save Pipeline JSON
  const handleSaveJson = () => {
    const canvasIr = getCanvasIRFromBlocklyWorkspace(catalog);
    const jsonStr = JSON.stringify(canvasIr, null, 2);
    const blob = new Blob([jsonStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${projectName}.wpipe.json`;
    a.click();
    setStatusMessage("Pipeline exportado a archivo .wpipe.json ✓");
    setActiveMenu(null);
  };

  // Save to Browser LocalStorage
  const handleSaveToBrowser = () => {
    try {
      const canvasIr = getCanvasIRFromBlocklyWorkspace(catalog);
      localStorage.setItem("wpipe_studio_saved_canvas", JSON.stringify(canvasIr));
      localStorage.setItem("wpipe_studio_saved_project", projectName);
      setStatusMessage("Pipeline guardado en el navegador (localStorage) ✓");
    } catch {
      setStatusMessage("Error al guardar en el almacenamiento local");
    }
    setActiveMenu(null);
  };

  // Restore from Browser LocalStorage
  const handleLoadFromBrowser = () => {
    try {
      const saved = localStorage.getItem("wpipe_studio_saved_canvas");
      if (!saved) {
        setStatusMessage("No hay ningún pipeline guardado en este navegador");
        setActiveMenu(null);
        return;
      }
      const parsed = JSON.parse(saved);
      if (parsed && Array.isArray(parsed.nodes)) {
        clearWorkspace();
        parsed.nodes.forEach((n: any) => {
          if (n.data?.node_type === "trigger") {
            addTriggerBlockToWorkspace(n.data.trigger_type || "api", n.data.trigger_param || "/run");
          } else if (n.data?.node_type === "step") {
            addStepBlockToWorkspace(n.data.label, n.data.namespace || "custom", n.data.origin);
          } else if (n.data?.node_type === "condition") {
            addControlBlockToWorkspace(n.data.has_else ? "wpipe_if_else" : "wpipe_if");
          } else if (n.data?.node_type === "for") {
            addControlBlockToWorkspace("wpipe_for");
          } else if (n.data?.node_type === "while") {
            addControlBlockToWorkspace("wpipe_while");
          } else if (n.data?.node_type === "parallel") {
            addControlBlockToWorkspace("wpipe_parallel");
          } else if (n.data?.node_type === "background") {
            addControlBlockToWorkspace("wpipe_background");
          } else if (n.data?.node_type === "response") {
            addResponseBlockToWorkspace(n.data.response_type || "http_json", n.data.response_param || '{"status": "success", "data": context}');
          }
        });
        const savedProject = localStorage.getItem("wpipe_studio_saved_project");
        if (savedProject) setProjectName(savedProject);
        setStatusMessage("Pipeline restaurado desde el almacenamiento local ✓");
      }
    } catch {
      setStatusMessage("Error al restaurar desde el almacenamiento local");
    }
    setActiveMenu(null);
  };

  // Load Pipeline JSON
  const handleLoadJson = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const file = files[0];
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const parsed = JSON.parse(event.target?.result as string);
        if (parsed && Array.isArray(parsed.nodes)) {
          clearWorkspace();
          parsed.nodes.forEach((n: any) => {
            if (n.data?.node_type === "trigger") {
              addTriggerBlockToWorkspace(n.data.trigger_type || "api", n.data.trigger_param || "/run");
            } else if (n.data?.node_type === "step") {
              addStepBlockToWorkspace(n.data.label, n.data.namespace || "custom", n.data.origin);
            } else if (n.data?.node_type === "condition") {
              addControlBlockToWorkspace(n.data.has_else ? "wpipe_if_else" : "wpipe_if");
            } else if (n.data?.node_type === "for") {
              addControlBlockToWorkspace("wpipe_for");
            } else if (n.data?.node_type === "while") {
              addControlBlockToWorkspace("wpipe_while");
            } else if (n.data?.node_type === "parallel") {
              addControlBlockToWorkspace("wpipe_parallel");
            } else if (n.data?.node_type === "background") {
              addControlBlockToWorkspace("wpipe_background");
            } else if (n.data?.node_type === "response") {
              addResponseBlockToWorkspace(n.data.response_type || "http_json", n.data.response_param || '{"status": "success", "data": context}');
            }
          });
          setStatusMessage(`Cargado pipeline desde '${file.name}' ✓`);
        }
      } catch (err) {
        setStatusMessage("Error al analizar archivo JSON del pipeline");
      }
    };
    reader.readAsText(file);
    setActiveMenu(null);
  };

  // Copy Python Main Code
  const handleCopyPythonCode = async () => {
    if (!engineStatus.connected) {
      showEngineRequired("Copying generated Python code");
      setActiveMenu(null);
      return;
    }
    const canvasIr = getCanvasIRFromBlocklyWorkspace(catalog);
    try {
      const data = { files: await compileOnEngine(canvasIr, projectName, engineStatus.port) };
      const mainFile = data.files?.find((f: any) => f.path === "app/main.py" || f.path.endsWith("main.py"));
      if (mainFile) {
        await navigator.clipboard.writeText(mainFile.content);
        setStatusMessage("Código app/main.py copiado al portapapeles ✓");
      } else if (data.files && data.files[0]) {
        await navigator.clipboard.writeText(data.files[0].content);
        setStatusMessage("Código Python copiado al portapapeles ✓");
      }
    } catch (err: any) {
      if (!handleEngineError(err, "Copying generated Python code")) setStatusMessage(`Error copying code: ${err.message}`);
    }
    setActiveMenu(null);
  };

  // User uploaded .py file handler
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const file = files[0];
    const reader = new FileReader();

    reader.onload = (event) => {
      const content = event.target?.result as string;
      const stateName = file.name.replace(/\.py$/, "");
      const newCustomState: CatalogStep = {
        name: stateName,
        func_name: stateName,
        namespace: `user_states.${stateName}`,
        category: "User Uploaded",
        description: `Custom Python state file: ${file.name}`,
        repo: "User",
        code_snippet: content,
      };

      setUserStates((prev) => [...prev, newCustomState]);
      addStepBlockToWorkspace(stateName, `user_states.${stateName}`, "user_imported");
      setStatusMessage(`Imported and added custom Python state '${stateName}'!`);
    };

    reader.readAsText(file);
  };

  // Create AI Described Step
  const handleCreateAiStep = () => {
    if (!aiStepName.trim() || !aiPrompt.trim()) return;
    addStepBlockToWorkspace(aiStepName, "ai_described", "described");
    setShowAiModal(false);
    setAiStepName("");
    setAiPrompt("");
    setStatusMessage(`Created AI Step '${aiStepName}' and snapped to workspace`);
  };

  // SIMULATION ENGINE: Green Flag 🏁 and Stop 🛑
  // - With wpipe-engine: real simulation executed (and limit-checked) by the engine.
  // - Without engine: FAKE demo animation with synthetic data, explicitly labelled as such.
  const handleStartSimulation = async () => {
    if (isSimulating) return;
    const liveEngine = engineStatus.connected;
    const tag = liveEngine ? "[ENGINE]" : "[FAKE-DEMO]";
    setIsSimulating(true);
    simulationAbortRef.current = false;
    setStatusMessage(
      liveEngine
        ? "🏁 Live simulation started in the local wpipe-engine..."
        : "🏁 FAKE demo simulation started (synthetic data, no Python is executed)..."
    );

    let initialContext: Record<string, any> = {};
    try {
      initialContext = JSON.parse(testPayloadText);
    } catch {
      initialContext = { raw_input: "test_value" };
    }

    setSimContext(initialContext);
    const startLogs = [{ time: new Date().toLocaleTimeString(), level: "INFO", msg: `${tag} 🏁 Pipeline '${projectName}' initialized.` }];
    if (!liveEngine) {
      startLogs.push({
        time: new Date().toLocaleTimeString(),
        level: "WARN",
        msg: `${tag} ⚠️ No local engine detected: this is a FAKE demonstration with synthetic values (max 5 steps). Install and start wpipe-engine for a real simulation.`,
      });
    }
    setSimLogs(startLogs);

    const canvasIr = getCanvasIRFromBlocklyWorkspace(catalog);
    const breakpointList = Array.from(globalBreakpoints);

    // Real run on the engine first (the engine enforces plan limits and may answer 403).
    let engineResult: Awaited<ReturnType<typeof executeEngineSimulation>> | null = null;
    if (liveEngine) {
      try {
        engineResult = await executeEngineSimulation(canvasIr, initialContext, breakpointList, engineStatus.port);
      } catch (err: any) {
        setIsSimulating(false);
        if (!handleEngineError(err, "Running a real simulation")) {
          setStatusMessage(`Engine simulation error: ${err.message}`);
        }
        setSimLogs((prev) => [...prev, { time: new Date().toLocaleTimeString(), level: "ERROR", msg: `${tag} ❌ ${err.message}` }]);
        return;
      }
    }

    let stepsToRun: any[] = (canvasIr.nodes || [])
      .filter((n) => n.data?.node_type !== "trigger" && n.data?.node_type !== ("response" as any))
      .map((n) => ({
        id: n.id,
        name: n.data?.label || "Step",
        reads: n.data?.contract?.reads || [],
        writes: n.data?.contract?.writes || [],
      }));

    const timeline = engineResult?.steps_timeline || [];
    if (!liveEngine && stepsToRun.length > 5) {
      setSimLogs((prev) => [
        ...prev,
        { time: new Date().toLocaleTimeString(), level: "WARN", msg: `${tag} Demo limited to the first 5 steps.` },
      ]);
      stepsToRun = stepsToRun.slice(0, 5);
    }

    if (stepsToRun.length === 0) {
      setIsSimulating(false);
      setStatusMessage("Simulation finished: No steps in pipeline.");
      return;
    }

    const initialSimSteps: SimStepResult[] = stepsToRun.map((st) => ({
      id: st.id,
      name: st.name,
      status: "idle",
      durationMs: 0,
      reads: st.reads || [],
      writes: st.writes || [],
    }));
    setSimSteps(initialSimSteps);

    let currentContext: Record<string, any> = { ...initialContext };
    const stepDelay = turboMode ? 100 : 600;
    const simStartTime = Date.now();

    for (let i = 0; i < stepsToRun.length; i++) {
      if (simulationAbortRef.current) {
        setSimLogs((prev) => [...prev, { time: new Date().toLocaleTimeString(), level: "WARN", msg: `${tag} 🛑 Simulation stopped by user.` }]);
        highlightBlocklyBlock("", "idle");
        break;
      }

      const currentStep = stepsToRun[i];

      const isBp = globalBreakpoints.has(currentStep.name) || globalBreakpoints.has(currentStep.id);
      if (isBp) {
        setIsPausedAtBreakpoint(true);
        setPausedStepName(currentStep.name);
        setDebugContext({ ...currentContext });
        highlightBlocklyBlock(currentStep.name, "paused");
        setBottomPanelOpen(true);
        setBottomPanelTab("debug");
        setSimLogs((prev) => [
          ...prev,
          {
            time: new Date().toLocaleTimeString(),
            level: "WARN",
            msg: `${tag} ⏸ Paused at breakpoint: ${currentStep.name}. Press Continue (F5).`,
          },
        ]);
        await new Promise<void>((resolve) => {
          resumeSimulationResolveRef.current = resolve;
        });
        setIsPausedAtBreakpoint(false);
      }

      highlightBlocklyBlock(currentStep.name, "running");
      setSimSteps((prev) => prev.map((item, idx) => (idx === i ? { ...item, status: "running" } : item)));
      setSimLogs((prev) => [
        ...prev,
        { time: new Date().toLocaleTimeString(), level: "INFO", msg: `${tag} ▶ Executing step: ${currentStep.name}...` },
      ]);

      await new Promise((resolve) => setTimeout(resolve, stepDelay));
      if (simulationAbortRef.current) break;

      let duration: number;
      const stepOutput: Record<string, any> = {};
      if (liveEngine) {
        const real = timeline.find((t) => t.node_id === currentStep.id) || timeline[i];
        duration = Math.round(real?.duration_ms ?? 0);
      } else {
        // Synthetic values: clearly marked as fake demo data.
        duration = Math.floor(40 + Math.random() * 80);
        const keys = currentStep.writes && currentStep.writes.length > 0 ? currentStep.writes : [`${String(currentStep.name).toLowerCase()}_out`];
        keys.forEach((w: string) => {
          stepOutput[w] = `fake_demo_${w}`;
          currentContext[w] = stepOutput[w];
        });
        setSimContext({ ...currentContext });
      }

      highlightBlocklyBlock(currentStep.name, "success");
      setSimSteps((prev) =>
        prev.map((item, idx) => (idx === i ? { ...item, status: "success", durationMs: duration, outputData: stepOutput } : item))
      );
      setSimLogs((prev) => [
        ...prev,
        { time: new Date().toLocaleTimeString(), level: "SUCCESS", msg: `${tag} ✓ Step ${currentStep.name} completed in ${duration}ms.` },
      ]);
    }

    if (liveEngine && engineResult && !simulationAbortRef.current) {
      currentContext = engineResult.output_context || currentContext;
      setSimContext({ ...currentContext });
    }

    setCpuUsage(0);
    setIsSimulating(false);
    setStatusMessage(
      simulationAbortRef.current
        ? "🛑 Simulation aborted"
        : liveEngine
          ? "✓ Live engine simulation finished"
          : "✓ FAKE demo finished — install wpipe-engine for a real simulation"
    );

    // Persist completed live runs in the engine project history (never for fake demos).
    const totalSimDuration = Date.now() - simStartTime;
    if (liveEngine && activeProjectId) {
      const simRecord = {
        status: simulationAbortRef.current ? "aborted" : "success",
        duration_ms: engineResult?.duration_ms ?? totalSimDuration,
        input_payload: initialContext,
        output_context: currentContext,
        steps_timeline: timeline,
      };
      engineJson(
        `/api/v1/projects/${activeProjectId}/simulations`,
        { method: "POST", body: JSON.stringify(simRecord) },
        true,
        engineStatus.port
      )
        .then(() => loadSimulationHistory(activeProjectId))
        .catch(() => {});
    }
  };

  const handleStopSimulation = () => {
    simulationAbortRef.current = true;
    setIsSimulating(false);
    highlightBlocklyBlock("", "idle");
    setSimSteps((prev) =>
      prev.map((item) => (item.status === "running" ? { ...item, status: "idle" } : item))
    );
    setSimLogs((prev) => [
      ...prev,
      {
        time: new Date().toLocaleTimeString(),
        level: "WARN",
        msg: "🛑 Simulation stopped by user.",
      },
    ]);
    setStatusMessage("🛑 Simulation stopped by user");
    setCpuUsage(0);
  };

  // Simulation mode labels: real engine run vs explicitly FAKE browser demo
  const simStartLabel = engineStatus.connected ? "Run Simulation (Live Engine) 🏁" : "Demo Simulation (FAKE) 🏁";
  const fakeSimBanner = !engineStatus.connected ? (
    <div
      data-testid="fake-sim-banner"
      className="p-3 rounded-xl bg-amber-950/70 border border-amber-600/70 text-amber-100 text-[11px] leading-relaxed shadow-md"
    >
      <div className="font-black text-amber-300 text-xs mb-1">⚠️ FAKE / DEMO SIMULATION — NO LOCAL ENGINE DETECTED</div>
      This is a browser demonstration with synthetic values (max 5 steps). No Python code is executed and
      the results are not real. For a real simulation, install and start <span className="font-mono font-bold">wpipe-engine</span> on this machine.
      <button
        onClick={() => setShowEngineModal(true)}
        className="mt-2 block px-2.5 py-1 rounded-lg bg-amber-500 hover:bg-amber-400 text-black font-bold text-[11px] cursor-pointer"
      >
        Install / Connect wpipe-engine
      </button>
    </div>
  ) : null;

  // Group steps for categories
  const officialSteps = catalog.filter((s) => s.repo === "Official");
  const pluginSteps = catalog.filter((s) => s.repo === "Plugin");

  return (
    <div className="flex flex-col h-full w-full min-h-screen bg-[#07090e] text-gray-100 font-sans select-none overflow-hidden aurora-bg">
      {/* 1. FULLSCREEN SPLASH LOADER */}
      {showSplash && (
        <div
          className={`fixed inset-0 z-[99999] bg-[#07090e] flex flex-col items-center justify-center transition-opacity duration-300 pointer-events-auto ${
            splashFadeOut ? "opacity-0 pointer-events-none" : "opacity-100"
          }`}
        >
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-sky-500 via-indigo-600 to-purple-500 flex items-center justify-center font-black text-white text-3xl shadow-2xl logo-pulsing mb-6">
            W
          </div>
          <h2 className="text-2xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-sky-300 via-indigo-200 to-purple-300 font-heading tracking-tight mb-2">
            WPipe Studio
          </h2>
          <p className="text-xs text-gray-400 mb-6 font-mono">Scratux 3.0 Visual Pipeline Environment</p>

          <div className="w-64 h-1.5 bg-gray-900 rounded-full overflow-hidden border border-gray-800 shadow-inner mb-3">
            <div
              className="h-full bg-gradient-to-r from-sky-400 via-indigo-500 to-purple-400 transition-all duration-300"
              style={{ width: `${splashProgress}%` }}
            ></div>
          </div>
          <span className="text-[11px] font-mono text-sky-400 font-bold">{splashProgress}% Complete</span>
        </div>
      )}

      {/* 2. TOP MENU BAR (VS Code style 5-menu title bar) */}
      <header className="h-11 border-b border-gray-800/80 bg-[#0f172a]/95 backdrop-blur-md px-3 flex items-center justify-between relative z-40 shadow-md">
        {/* Left: Sidebar Toggle + Brand + 5 Menus */}
        <div className="flex items-center space-x-1.5">
          {/* Global Primary Sidebar Toggle Button */}
          <button
            onClick={() => setShowSidebar(!showSidebar)}
            title={showSidebar ? "Hide primary sidebar (Ctrl+B)" : "Show primary sidebar (Ctrl+B)"}
            className={`p-1.5 rounded-md transition mr-1 cursor-pointer ${
              showSidebar
                ? "text-sky-400 bg-sky-950/80 border border-sky-800/80 hover:bg-sky-900/80"
                : "text-gray-400 hover:text-white hover:bg-gray-800 border border-transparent"
            }`}
          >
            <PanelLeft size={16} />
          </button>

          {/* Brand Logo */}
          <div className="flex items-center space-x-2 mr-2">
            <div className="w-6 h-6 rounded-md bg-gradient-to-tr from-emerald-500 to-cyan-500 flex items-center justify-center font-black text-gray-950 text-xs shadow-md shadow-emerald-500/20">
              W
            </div>
            <span className="font-extrabold text-sm text-transparent bg-clip-text bg-gradient-to-r from-emerald-300 to-cyan-200 font-heading tracking-tight">
              WPipe Studio
            </span>
            <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-800 font-mono font-bold">
              v2.5.10
            </span>
          </div>

          {/* Universal Suite Switcher (Visible on desktop) */}
          <div className="hidden 2xl:flex items-center gap-1 p-0.5 bg-gray-900/90 border border-gray-800 rounded-full text-[10px] font-semibold mr-2">
            <a
              href="https://wpipe-studio.wisrovi.dev"
              target="_blank"
              rel="noopener"
              className="px-2 py-0.5 rounded-full text-gray-400 hover:text-white transition"
            >
              Docs
            </a>
            <span className="px-2 py-0.5 rounded-full bg-cyan-500/15 text-cyan-400 border border-cyan-500/30 font-bold">
              ⚡ Canvas
            </span>
            <a
              href="https://portal.wisrovi.dev"
              target="_blank"
              rel="noopener"
              className="px-2 py-0.5 rounded-full text-gray-400 hover:text-white transition"
            >
              🔑 Portal
            </a>
            <a
              href="https://wisrovi.lemonsqueezy.com/checkout/buy/b2c96716-71a7-4df5-9d58-1ea58e1a5d96"
              target="_blank"
              rel="noopener"
              className="px-2 py-0.5 rounded-full bg-gradient-to-r from-emerald-500 to-cyan-500 text-gray-950 font-bold hover:brightness-110 transition shadow-sm"
            >
              👑 Pro
            </a>
          </div>

          {/* 1. File Menu Dropdown */}
          <div className="relative menu-dropdown-container">
            <button
              onClick={() => setActiveMenu(activeMenu === "file" ? null : "file")}
              className={`px-2 py-1 text-xs font-semibold rounded-md transition flex items-center gap-1 cursor-pointer ${
                activeMenu === "file" ? "bg-gray-800 text-white" : "text-gray-300 hover:text-white hover:bg-gray-800/60"
              }`}
            >
              <span>File</span>
              <ChevronDown size={12} className="text-gray-400" />
            </button>
            {activeMenu === "file" && (
              <div className="absolute left-0 top-full mt-1 w-64 bg-gray-900 border border-gray-700/80 rounded-xl shadow-2xl py-1.5 z-50 text-xs">
                <button
                  onClick={() => {
                    if (window.confirm("Create a new pipeline and reset the canvas?")) {
                      clearWorkspace();
                      addTriggerBlockToWorkspace("api", "/run");
                      addStepBlockToWorkspace("HttpRequest", "wpipe_steps.connectivity");
                      addResponseBlockToWorkspace("http_json", '{"status": "success", "data": context}');
                      setStatusMessage("New pipeline initialized with REST API Trigger and HTTP Response");
                    }
                    setActiveMenu(null);
                  }}
                  className="w-full text-left px-3 py-2 hover:bg-gray-800 flex items-center gap-2.5 text-gray-200 hover:text-white cursor-pointer"
                >
                  <FileCode size={15} className="text-sky-400" />
                  <div>
                    <div className="font-semibold">New Pipeline</div>
                    <div className="text-[10px] text-gray-400">Reset canvas with default trigger & response</div>
                  </div>
                </button>

                <label className="w-full text-left px-3 py-2 hover:bg-gray-800 flex items-center gap-2.5 text-gray-200 hover:text-white cursor-pointer">
                  <FolderOpen size={15} className="text-amber-400" />
                  <div>
                    <div className="font-semibold">Open Pipeline (.json)...</div>
                    <div className="text-[10px] text-gray-400">Import workflow file from disk</div>
                  </div>
                  <input type="file" accept=".json,.wpipe.json" onChange={handleLoadJson} className="hidden" />
                </label>

                <div className="my-1 border-t border-gray-800" />

                <button
                  onClick={() => {
                    handleSaveProject();
                    setActiveMenu(null);
                  }}
                  className="w-full text-left px-3 py-2 hover:bg-gray-800 flex items-center justify-between text-gray-200 hover:text-white cursor-pointer"
                >
                  <div className="flex items-center gap-2.5">
                    <Save size={15} className="text-emerald-400" />
                    <div>
                      <div className="font-semibold">Save Microservice</div>
                      <div className="text-[10px] text-gray-400">Persist canvas and source files</div>
                    </div>
                  </div>
                  <span className="text-[10px] text-gray-500 font-mono">Ctrl+S</span>
                </button>

                <button
                  onClick={() => {
                    handleRenamePipeline();
                    setActiveMenu(null);
                  }}
                  className="w-full text-left px-3 py-2 hover:bg-gray-800 flex items-center gap-2.5 text-gray-200 hover:text-white cursor-pointer"
                >
                  <Edit3 size={15} className="text-sky-400" />
                  <div>
                    <div className="font-semibold">Rename Pipeline...</div>
                    <div className="text-[10px] text-gray-400">Change service and identifier name</div>
                  </div>
                </button>

                <div className="my-1 border-t border-gray-800" />

                <button
                  onClick={handleSaveToBrowser}
                  className="w-full text-left px-3 py-2 hover:bg-gray-800 flex items-center gap-2.5 text-gray-200 hover:text-white cursor-pointer"
                >
                  <Save size={15} className="text-emerald-400" />
                  <div>
                    <div className="font-semibold">Save to Browser</div>
                    <div className="text-[10px] text-gray-400">Fast local browser storage</div>
                  </div>
                </button>

                <button
                  onClick={handleLoadFromBrowser}
                  className="w-full text-left px-3 py-2 hover:bg-gray-800 flex items-center gap-2.5 text-gray-200 hover:text-white cursor-pointer"
                >
                  <RefreshCw size={15} className="text-teal-400" />
                  <div>
                    <div className="font-semibold">Restore from Browser</div>
                    <div className="text-[10px] text-gray-400">Recover last browser saved state</div>
                  </div>
                </button>

                <div className="my-1 border-t border-gray-800" />

                <button
                  onClick={handleExportWpipe}
                  className="w-full text-left px-3 py-2 hover:bg-gray-800 flex items-center gap-2.5 text-gray-200 hover:text-white cursor-pointer"
                >
                  <Download size={15} className="text-sky-400" />
                  <div>
                    <div className="font-semibold">Export File (.wpipe)</div>
                    <div className="text-[10px] text-gray-400">Compatible with VS Code and Web</div>
                  </div>
                </button>

                <button
                  onClick={handleSaveJson}
                  className="w-full text-left px-3 py-2 hover:bg-gray-800 flex items-center gap-2.5 text-gray-200 hover:text-white cursor-pointer"
                >
                  <Download size={15} className="text-indigo-400" />
                  <div>
                    <div className="font-semibold">Export Canvas (.wpipe.json)</div>
                    <div className="text-[10px] text-gray-400">Download graph schema definition</div>
                  </div>
                </button>

                <button
                  onClick={handleGenerateZip}
                  className="w-full text-left px-3 py-2 hover:bg-gray-800 flex items-center gap-2.5 text-gray-200 hover:text-white cursor-pointer"
                >
                  <Download size={15} className="text-emerald-400" />
                  <div>
                    <div className="font-semibold">Download Microservice (.zip)</div>
                    <div className="text-[10px] text-gray-400">Production Python package ready to run</div>
                  </div>
                </button>

                <button
                  onClick={handleCopyPythonCode}
                  className="w-full text-left px-3 py-2 hover:bg-gray-800 flex items-center gap-2.5 text-gray-200 hover:text-white cursor-pointer"
                >
                  <Copy size={15} className="text-purple-400" />
                  <div>
                    <div className="font-semibold">Copy Python Code</div>
                    <div className="text-[10px] text-gray-400">Copy app/main.py to clipboard</div>
                  </div>
                </button>

                <div className="my-1 border-t border-gray-800" />

                <button
                  onClick={() => {
                    handleRunTests();
                    setActiveMenu(null);
                  }}
                  className="w-full text-left px-3 py-2 hover:bg-purple-950/60 flex items-center gap-2.5 text-purple-300 hover:text-purple-200 cursor-pointer"
                >
                  <FlaskConical size={15} className="text-purple-400" />
                  <div>
                    <div className="font-semibold">Run Unit Tests (pytest)</div>
                    <div className="text-[10px] text-gray-400">Execute regression test suite</div>
                  </div>
                </button>

                <button
                  onClick={() => {
                    setShowProjectsModal(true);
                    setActiveMenu(null);
                  }}
                  className="w-full text-left px-3 py-2 hover:bg-gray-800 flex items-center gap-2.5 text-gray-200 hover:text-white cursor-pointer"
                >
                  <Folder size={15} className="text-amber-400" />
                  <div>
                    <div className="font-semibold">My Microservices...</div>
                    <div className="text-[10px] text-gray-400">Explore saved projects & workspaces</div>
                  </div>
                </button>

                <div className="my-1 border-t border-gray-800" />

                <button
                  onClick={() => {
                    setShowEnvModal(true);
                    setActiveMenu(null);
                  }}
                  className="w-full text-left px-3 py-2 hover:bg-gray-800 flex items-center gap-2.5 text-gray-200 hover:text-white cursor-pointer"
                >
                  <Settings size={15} className="text-emerald-400" />
                  <div>
                    <div className="font-semibold">Environment Variables (.env)</div>
                    <div className="text-[10px] text-gray-400">Configure credentials and secrets</div>
                  </div>
                </button>
              </div>
            )}
          </div>

          {/* 2. Microservices Menu Dropdown */}
          <div className="relative menu-dropdown-container">
            <button
              onClick={() => setActiveMenu(activeMenu === "microservices" ? null : "microservices")}
              className={`px-2 py-1 text-xs font-semibold rounded-md transition flex items-center gap-1 cursor-pointer ${
                activeMenu === "microservices" ? "bg-gray-800 text-white" : "text-gray-300 hover:text-white hover:bg-gray-800/60"
              }`}
            >
              <span>Microservices</span>
              <ChevronDown size={12} className="text-gray-400" />
            </button>
            {activeMenu === "microservices" && (
              <div className="absolute left-0 top-full mt-1 w-72 bg-gray-900 border border-gray-700/80 rounded-xl shadow-2xl py-1.5 z-50 text-xs">
                <button
                  onClick={() => {
                    setShowProjectsModal(true);
                    setIsCreatingProject(false);
                    setActiveMenu(null);
                  }}
                  className="w-full text-left px-3 py-2 hover:bg-gray-800 flex items-center gap-2.5 text-gray-200 hover:text-white cursor-pointer"
                >
                  <Folder size={15} className="text-amber-400" />
                  <div>
                    <div className="font-semibold">Microservice Manager...</div>
                    <div className="text-[10px] text-gray-400">Manage and browse all your projects</div>
                  </div>
                </button>

                <button
                  onClick={() => {
                    setShowProjectsModal(true);
                    setIsCreatingProject(true);
                    setActiveMenu(null);
                  }}
                  className="w-full text-left px-3 py-2 hover:bg-gray-800 flex items-center gap-2.5 text-gray-200 hover:text-white cursor-pointer"
                >
                  <FolderPlus size={15} className="text-emerald-400" />
                  <div>
                    <div className="font-semibold">New Microservice...</div>
                    <div className="text-[10px] text-gray-400">Create a project with an isolated environment</div>
                  </div>
                </button>

                {activeProjectId && (
                  <button
                    onClick={() => {
                      handleDuplicateProject(activeProjectId);
                      setActiveMenu(null);
                    }}
                    className="w-full text-left px-3 py-2 hover:bg-gray-800 flex items-center gap-2.5 text-gray-200 hover:text-white cursor-pointer"
                  >
                    <Copy size={15} className="text-sky-400" />
                    <div>
                      <div className="font-semibold">Duplicate Current Microservice</div>
                      <div className="text-[10px] text-gray-400">Identical copy for experimentation</div>
                    </div>
                  </button>
                )}

                <div className="my-1 border-t border-gray-800" />
                <div className="px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-gray-400">
                  Recent Projects ({userProjects.length})
                </div>

                {userProjects.length === 0 ? (
                  <div className="px-3 py-2 text-[11px] text-gray-500 italic">
                    No saved projects yet
                  </div>
                ) : (
                  <div className="max-h-48 overflow-y-auto space-y-0.5 px-1">
                    {userProjects.slice(0, 6).map((proj) => (
                      <button
                        key={proj.id}
                        onClick={() => {
                          handleOpenProject(proj.id);
                          setActiveMenu(null);
                        }}
                        className={`w-full text-left px-2.5 py-1.5 rounded-lg flex items-center justify-between transition cursor-pointer ${
                          activeProjectId === proj.id
                            ? "bg-sky-950/70 text-sky-200 border border-sky-800/60"
                            : "hover:bg-gray-800/80 text-gray-300 hover:text-white"
                        }`}
                      >
                        <div className="flex items-center gap-2 overflow-hidden">
                          <span className="text-xs">⚡</span>
                          <span className="font-medium truncate max-w-[170px]">{proj.name}</span>
                        </div>
                        {activeProjectId === proj.id && (
                          <span className="text-[9px] font-bold text-sky-400 uppercase">Active</span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 3. Edit Menu Dropdown */}
          <div className="relative menu-dropdown-container">
            <button
              onClick={() => setActiveMenu(activeMenu === "edit" ? null : "edit")}
              className={`px-2 py-1 text-xs font-semibold rounded-md transition flex items-center gap-1 cursor-pointer ${
                activeMenu === "edit" ? "bg-gray-800 text-white" : "text-gray-300 hover:text-white hover:bg-gray-800/60"
              }`}
            >
              <span>Edit</span>
              <ChevronDown size={12} className="text-gray-400" />
            </button>
            {activeMenu === "edit" && (
              <div className="absolute left-0 top-full mt-1 w-60 bg-gray-900 border border-gray-700/80 rounded-xl shadow-2xl py-1.5 z-50 text-xs">
                <button
                  onClick={() => {
                    undoWorkspace(false);
                    setStatusMessage("Undo action");
                    setActiveMenu(null);
                  }}
                  className="w-full text-left px-3 py-2 hover:bg-gray-800 flex items-center justify-between text-gray-200 hover:text-white cursor-pointer"
                >
                  <span className="flex items-center gap-2">
                    <Undo size={14} className="text-sky-400" />
                    <span>Undo</span>
                  </span>
                  <span className="text-[10px] text-gray-500 font-mono">Ctrl+Z</span>
                </button>

                <button
                  onClick={() => {
                    undoWorkspace(true);
                    setStatusMessage("Redo action");
                    setActiveMenu(null);
                  }}
                  className="w-full text-left px-3 py-2 hover:bg-gray-800 flex items-center justify-between text-gray-200 hover:text-white cursor-pointer"
                >
                  <span className="flex items-center gap-2">
                    <Redo size={14} className="text-sky-400" />
                    <span>Redo</span>
                  </span>
                  <span className="text-[10px] text-gray-500 font-mono">Ctrl+Y</span>
                </button>

                <div className="my-1 border-t border-gray-800" />

                <button
                  onClick={() => {
                    collapseAllBlocksInWorkspace();
                    setStatusMessage("All blocks collapsed");
                    setActiveMenu(null);
                  }}
                  className="w-full text-left px-3 py-2 hover:bg-gray-800 flex items-center gap-2 text-gray-200 hover:text-white cursor-pointer"
                >
                  <Minimize2 size={14} className="text-amber-400" />
                  <span>Collapse All Blocks</span>
                </button>

                <button
                  onClick={() => {
                    expandAllBlocksInWorkspace();
                    setStatusMessage("All blocks expanded");
                    setActiveMenu(null);
                  }}
                  className="w-full text-left px-3 py-2 hover:bg-gray-800 flex items-center gap-2 text-gray-200 hover:text-white cursor-pointer"
                >
                  <Maximize2 size={14} className="text-amber-400" />
                  <span>Expand All Blocks</span>
                </button>

                <button
                  onClick={() => {
                    zoomFitWorkspace();
                    setStatusMessage("Canvas centered (Zoom to fit)");
                    setActiveMenu(null);
                  }}
                  className="w-full text-left px-3 py-2 hover:bg-gray-800 flex items-center gap-2 text-gray-200 hover:text-white cursor-pointer"
                >
                  <ZoomIn size={14} className="text-teal-400" />
                  <span>Fit Canvas</span>
                </button>

                <div className="my-1 border-t border-gray-800" />

                <button
                  onClick={() => {
                    if (window.confirm("Are you sure you want to clear the canvas completely?")) {
                      clearWorkspace();
                      setStatusMessage("Canvas cleared completely");
                    }
                    setActiveMenu(null);
                  }}
                  className="w-full text-left px-3 py-2 hover:bg-rose-950/60 text-rose-300 hover:text-rose-200 flex items-center gap-2 cursor-pointer"
                >
                  <Trash2 size={14} />
                  <span>Clear Canvas</span>
                </button>
              </div>
            )}
          </div>

          {/* 4. View Menu Dropdown */}
          <div className="relative menu-dropdown-container">
            <button
              onClick={() => setActiveMenu(activeMenu === "view" ? null : "view")}
              className={`px-2 py-1 text-xs font-semibold rounded-md transition flex items-center gap-1 cursor-pointer ${
                activeMenu === "view" ? "bg-gray-800 text-white" : "text-gray-300 hover:text-white hover:bg-gray-800/60"
              }`}
            >
              <span>View</span>
              <ChevronDown size={12} className="text-gray-400" />
            </button>
            {activeMenu === "view" && (
              <div className="absolute left-0 top-full mt-1 w-64 bg-gray-900 border border-gray-700/80 rounded-xl shadow-2xl py-1.5 z-50 text-xs">
                <button
                  onClick={() => {
                    switchMainTab("code");
                    setActiveMenu(null);
                  }}
                  className="w-full text-left px-3 py-2 hover:bg-gray-800 flex items-center justify-between text-gray-200 hover:text-white cursor-pointer"
                >
                  <span className="flex items-center gap-2">
                    <span>🧩</span>
                    <span className="font-semibold">Blockly Canvas</span>
                  </span>
                  {activeMainTab === "code" && <Check size={13} className="text-sky-400" />}
                </button>

                <button
                  onClick={() => {
                    switchMainTab("python");
                    setActiveMenu(null);
                  }}
                  className="w-full text-left px-3 py-2 hover:bg-gray-800 flex items-center justify-between text-gray-200 hover:text-white cursor-pointer"
                >
                  <span className="flex items-center gap-2">
                    <Code size={14} className="text-purple-400" />
                    <span className="font-semibold">Python Microservice Code</span>
                  </span>
                  {activeMainTab === "python" && <Check size={13} className="text-purple-400" />}
                </button>

                <button
                  onClick={() => {
                    switchMainTab("simulation");
                    setActiveMenu(null);
                  }}
                  className="w-full text-left px-3 py-2 hover:bg-gray-800 flex items-center justify-between text-gray-200 hover:text-white cursor-pointer"
                >
                  <span className="flex items-center gap-2">
                    <span>🎮</span>
                    <span className="font-semibold">Simulation & Debugging</span>
                  </span>
                  {activeMainTab === "simulation" && <Check size={13} className="text-emerald-400" />}
                </button>

                <button
                  onClick={() => {
                    switchMainTab("flowchart");
                    setActiveMenu(null);
                  }}
                  className="w-full text-left px-3 py-2 hover:bg-gray-800 flex items-center justify-between text-gray-200 hover:text-white cursor-pointer"
                >
                  <span className="flex items-center gap-2">
                    <GitMerge size={14} className="text-indigo-400" />
                    <span className="font-semibold">Mermaid Flowchart DAG</span>
                  </span>
                  {activeMainTab === "flowchart" && <Check size={13} className="text-indigo-400" />}
                </button>

                <div className="my-1 border-t border-gray-800" />

                <button
                  onClick={() => {
                    setActiveActivityTab("search");
                    setShowSidebar(true);
                    setActiveMenu(null);
                  }}
                  className="w-full text-left px-3 py-2 hover:bg-gray-800 flex items-center gap-2 text-gray-200 hover:text-white cursor-pointer"
                >
                  <Search size={14} className="text-sky-400" />
                  <span>Search in Files</span>
                </button>

                <button
                  onClick={() => {
                    setActiveActivityTab("git");
                    setShowSidebar(true);
                    setActiveMenu(null);
                  }}
                  className="w-full text-left px-3 py-2 hover:bg-gray-800 flex items-center gap-2 text-gray-200 hover:text-white cursor-pointer"
                >
                  <GitBranch size={14} className="text-amber-400" />
                  <span>Version Control (Git)</span>
                </button>

                <div className="my-1 border-t border-gray-800" />

                <button
                  onClick={() => {
                    setIsSplitView(!isSplitView);
                    setActiveMenu(null);
                  }}
                  className="w-full text-left px-3 py-2 hover:bg-gray-800 flex items-center justify-between text-gray-200 hover:text-white cursor-pointer"
                >
                  <span className="flex items-center gap-2">
                    <Split size={14} className="text-sky-400" />
                    <span>Split View (Canvas + Code)</span>
                  </span>
                  <span className="text-[10px] text-gray-500 font-mono">Ctrl+\</span>
                </button>

                <button
                  onClick={() => {
                    setBottomPanelOpen(!bottomPanelOpen);
                    setActiveMenu(null);
                  }}
                  className="w-full text-left px-3 py-2 hover:bg-gray-800 flex items-center justify-between text-gray-200 hover:text-white cursor-pointer"
                >
                  <span className="flex items-center gap-2">
                    <Terminal size={14} className="text-emerald-400" />
                    <span>Bottom Panel / Terminal</span>
                  </span>
                  <span className="text-[10px] text-gray-500 font-mono">Ctrl+`</span>
                </button>

                <button
                  onClick={() => {
                    setInspectorOpen(!inspectorOpen);
                    setActiveMenu(null);
                  }}
                  className="w-full text-left px-3 py-2 hover:bg-gray-800 flex items-center justify-between text-gray-200 hover:text-white cursor-pointer"
                >
                  <span className="flex items-center gap-2">
                    <Sliders size={14} className="text-purple-400" />
                    <span>Properties Inspector</span>
                  </span>
                  {inspectorOpen && <Check size={13} className="text-purple-400" />}
                </button>

                <div className="my-1 border-t border-gray-800" />

                <button
                  onClick={() => {
                    setShowSidebar(!showSidebar);
                    setActiveMenu(null);
                  }}
                  className="w-full text-left px-3 py-2 hover:bg-gray-800 flex items-center justify-between text-gray-200 hover:text-white cursor-pointer"
                >
                  <span className="flex items-center gap-2">
                    <PanelLeft size={14} className="text-sky-400" />
                    <span>Toggle Primary Sidebar</span>
                  </span>
                  <span className="text-[10px] text-gray-500 font-mono">Ctrl+B</span>
                </button>

                <button
                  onClick={() => {
                    zoomFitWorkspace();
                    setActiveMenu(null);
                  }}
                  className="w-full text-left px-3 py-2 hover:bg-gray-800 flex items-center gap-2 text-gray-200 hover:text-white cursor-pointer"
                >
                  <ZoomIn size={14} className="text-teal-400" />
                  <span>Fit Canvas</span>
                </button>
              </div>
            )}
          </div>

          {/* 5. Run Menu Dropdown */}
          <div className="relative menu-dropdown-container">
            <button
              onClick={() => setActiveMenu(activeMenu === "run" ? null : "run")}
              className={`px-2 py-1 text-xs font-semibold rounded-md transition flex items-center gap-1 cursor-pointer ${
                activeMenu === "run" ? "bg-gray-800 text-white" : "text-gray-300 hover:text-white hover:bg-gray-800/60"
              }`}
            >
              <span>Run</span>
              <ChevronDown size={12} className="text-gray-400" />
            </button>
            {activeMenu === "run" && (
              <div className="absolute left-0 top-full mt-1 w-64 bg-gray-900 border border-gray-700/80 rounded-xl shadow-2xl py-1.5 z-50 text-xs">
                {!isSimulating ? (
                  <button
                    onClick={() => {
                      handleStartSimulation();
                      setActiveMenu(null);
                    }}
                    className="w-full text-left px-3 py-2 hover:bg-emerald-950/60 flex items-center gap-2.5 text-emerald-300 hover:text-emerald-200 cursor-pointer"
                  >
                    <Play size={14} className="fill-current text-emerald-400" />
                    <div>
                      <div className="font-bold">{simStartLabel}</div>
                      <div className="text-[10px] text-gray-400">
                        {engineStatus.connected ? "Executed by the local wpipe-engine" : "Synthetic demo data — install wpipe-engine for real runs"}
                      </div>
                    </div>
                  </button>
                ) : (
                  <button
                    onClick={() => {
                      handleStopSimulation();
                      setActiveMenu(null);
                    }}
                    className="w-full text-left px-3 py-2 hover:bg-rose-950/60 flex items-center gap-2.5 text-rose-300 hover:text-rose-200 cursor-pointer"
                  >
                    <Square size={14} className="fill-current text-rose-400" />
                    <div>
                      <div className="font-bold">Stop Simulation (🛑)</div>
                      <div className="text-[10px] text-gray-400">Interrupt active execution</div>
                    </div>
                  </button>
                )}

                <button
                  onClick={() => {
                    handleStopSimulation();
                    setSimContext({});
                    setSimSteps([]);
                    setSimLogs([]);
                    setStatusMessage("Simulation reset");
                    setActiveMenu(null);
                  }}
                  className="w-full text-left px-3 py-2 hover:bg-gray-800 flex items-center gap-2.5 text-gray-200 hover:text-white cursor-pointer"
                >
                  <RefreshCw size={14} className="text-sky-400" />
                  <div>
                    <div className="font-semibold">Reset Simulation</div>
                    <div className="text-[10px] text-gray-400">Clear state and variables</div>
                  </div>
                </button>

                <div className="my-1 border-t border-gray-800" />

                <button
                  onClick={() => {
                    handleDryRun();
                    setActiveMenu(null);
                  }}
                  disabled={dryRunLoading}
                  className="w-full text-left px-3 py-2 hover:bg-gray-800 flex items-center gap-2.5 text-gray-200 hover:text-white cursor-pointer"
                >
                  <CheckCircle size={14} className="text-sky-400" />
                  <div>
                    <div className="font-semibold">Verify Syntax (Dry-Run AST)</div>
                    <div className="text-[10px] text-gray-400">Validate connectivity and contracts</div>
                  </div>
                </button>

                <div className="my-1 border-t border-gray-800" />

                <button
                  onClick={() => {
                    handleRunTests();
                    setActiveMenu(null);
                  }}
                  className="w-full text-left px-3 py-2 hover:bg-purple-950/60 flex items-center gap-2.5 text-purple-300 hover:text-purple-200 cursor-pointer"
                >
                  <FlaskConical size={15} className="text-purple-400" />
                  <div>
                    <div className="font-semibold">Run Unit Tests (pytest)</div>
                    <div className="text-[10px] text-gray-400">Execute regression test suite</div>
                  </div>
                </button>

                <button
                  onClick={() => {
                    if (activeProjectId) loadSimulationHistory(activeProjectId);
                    setBottomPanelOpen(true);
                    setBottomPanelTab("output");
                    setActiveMenu(null);
                  }}
                  className="w-full text-left px-3 py-2 hover:bg-gray-800 flex items-center gap-2.5 text-gray-200 hover:text-white cursor-pointer"
                >
                  <History size={14} className="text-teal-400" />
                  <div>
                    <div className="font-semibold">Execution History ({simulationHistory.length})</div>
                    <div className="text-[10px] text-gray-400">Records persisted in SQLite / PostgreSQL</div>
                  </div>
                </button>

                <div className="my-1 border-t border-gray-800" />

                <button
                  onClick={() => {
                    setTurboMode(!turboMode);
                    setStatusMessage(`Turbo Mode: ${!turboMode ? "Enabled ⚡" : "Disabled"}`);
                    setActiveMenu(null);
                  }}
                  className="w-full text-left px-3 py-2 hover:bg-gray-800 flex items-center justify-between text-gray-200 hover:text-white cursor-pointer"
                >
                  <span className="flex items-center gap-2">
                    <Sparkles size={14} className="text-yellow-400" />
                    <span className="font-semibold">Turbo Mode</span>
                  </span>
                  {turboMode ? (
                    <span className="text-[10px] text-emerald-400 font-bold font-mono">ACTIVE</span>
                  ) : (
                    <span className="text-[10px] text-gray-500 font-mono">OFF</span>
                  )}
                </button>
              </div>
            )}
          </div>

          {/* 6. Help Menu Dropdown */}
          <div className="relative menu-dropdown-container">
            <button
              onClick={() => setActiveMenu(activeMenu === "help" ? null : "help")}
              className={`px-2 py-1 text-xs font-semibold rounded-md transition flex items-center gap-1 cursor-pointer ${
                activeMenu === "help" ? "bg-gray-800 text-white" : "text-gray-300 hover:text-white hover:bg-gray-800/60"
              }`}
            >
              <span>Help</span>
              <ChevronDown size={12} className="text-gray-400" />
            </button>
            {activeMenu === "help" && (
              <div className="absolute left-0 top-full mt-1 w-64 bg-gray-900 border border-gray-700/80 rounded-xl shadow-2xl py-1.5 z-50 text-xs">
                <button
                  onClick={() => {
                    setCommandPaletteOpen(true);
                    setCommandQuery("");
                    setCommandSelectedIndex(0);
                    setActiveMenu(null);
                  }}
                  className="w-full text-left px-3 py-2 hover:bg-gray-800 flex items-center justify-between text-gray-200 hover:text-white cursor-pointer"
                >
                  <div className="flex items-center gap-2.5">
                    <Search size={14} className="text-sky-400" />
                    <div>
                      <div className="font-semibold">Command Palette...</div>
                      <div className="text-[10px] text-gray-400">Quick action palette and shortcuts</div>
                    </div>
                  </div>
                  <span className="text-[10px] text-gray-500 font-mono">Ctrl+P</span>
                </button>

                <div className="my-1 border-t border-gray-800" />

                <button
                  onClick={() => {
                    setShowFaqModal(true);
                    setActiveMenu(null);
                  }}
                  className="w-full text-left px-3 py-2 hover:bg-gray-800 flex items-center gap-2.5 text-gray-200 hover:text-white cursor-pointer"
                >
                  <BookOpen size={14} className="text-purple-400" />
                  <div>
                    <div className="font-semibold">Tutorials & FAQ Guide</div>
                    <div className="text-[10px] text-gray-400">Frequently asked questions and guides</div>
                  </div>
                </button>

                <button
                  onClick={() => {
                    switchMainTab("code");
                    setActiveActivityTab("blocks");
                    setShowSidebar(true);
                    setActiveMenu(null);
                  }}
                  className="w-full text-left px-3 py-2 hover:bg-gray-800 flex items-center gap-2.5 text-gray-200 hover:text-white cursor-pointer"
                >
                  <Layers size={14} className="text-sky-400" />
                  <div>
                    <div className="font-semibold">WPipe Step Catalog</div>
                    <div className="text-[10px] text-gray-400">196 official steps & plugins</div>
                  </div>
                </button>

                <div className="my-1 border-t border-gray-800" />

                <button
                  onClick={() => {
                    setShowAboutModal(true);
                    setActiveMenu(null);
                  }}
                  className="w-full text-left px-3 py-2 hover:bg-gray-800 flex items-center gap-2.5 text-gray-200 hover:text-white cursor-pointer"
                >
                  <Info size={14} className="text-teal-400" />
                  <div>
                    <div className="font-semibold">About WPipe Studio</div>
                    <div className="text-[10px] text-gray-400">wisrovi SUITE, version and credits</div>
                  </div>
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Center: Sleek Breadcrumb & Microservice Identifier */}
        <div className="hidden xl:flex items-center space-x-1.5 px-3 py-1 bg-gray-900/60 hover:bg-gray-900 border border-gray-800/80 hover:border-gray-700/80 rounded-lg text-xs transition">
          <button
            onClick={() => setShowProjectsModal(true)}
            className="flex items-center space-x-1.5 text-gray-400 hover:text-sky-300 font-medium transition cursor-pointer"
            title="Open Microservice Manager"
          >
            <Folder size={13} className="text-amber-400" />
            <span className="hidden md:inline">microservices</span>
          </button>
          <span className="text-gray-600">/</span>
          <button
            onClick={handleRenamePipeline}
            className="flex items-center space-x-1.5 text-sky-300 hover:text-white font-mono font-bold transition cursor-pointer group"
            title="Click to rename this microservice"
          >
            <span className="max-w-[200px] truncate">{projectName || "my_wpipe_pipeline"}</span>
            <Edit3 size={11} className="text-gray-500 group-hover:text-sky-400 transition" />
          </button>
        </div>

        {/* Far Right: Engine Status + Fully Right-Aligned PRO Badge + User Account Menu */}
        <div className="flex items-center space-x-2.5">
          {/* Quick suite portal link */}
          <a
            href="https://portal.wisrovi.dev"
            target="_blank"
            rel="noopener noreferrer"
            className="hidden lg:flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 hover:text-emerald-300 text-xs font-semibold transition"
            title="Abrir Portal de Gestión de Licencias & Seats"
          >
            <span>🔑</span>
            <span className="hidden xl:inline">Portal Licencias</span>
          </a>

          {/* Local Engine Bridge Status Widget */}
          <EngineStatusWidget
            status={engineStatus}
            onRecheck={checkEngine}
            showProBadge={false}
            onOpenModal={() => setShowEngineModal(true)}
          />

          {/* Fully Right-Aligned PRO Badge (Opens Dedicated PRO License Modal) */}
          <LicenseProBadge
            status={engineStatus}
            onClick={() => setShowProModal(true)}
          />

          <div className="h-5 w-px bg-gray-800" />

          {/* User Account Avatar & Profile Menu */}
          <div className="relative user-menu-container z-[100]">
            <button
              onClick={() => setShowUserMenu(!showUserMenu)}
              className="flex items-center gap-2 px-2.5 py-1 rounded-full bg-gradient-to-r from-gray-900 to-gray-800 hover:from-gray-800 hover:to-gray-700 border border-gray-700/80 text-xs text-gray-200 hover:text-white transition shadow-sm cursor-pointer group"
              data-testid="account-button"
              title={currentUser ? `Account: ${currentUser.name} (@${currentUser.username})` : "Guest — no session and no verified engine license"}
            >
              <div
                className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-black text-white shadow-sm shrink-0"
                style={{ backgroundColor: getUserColor(currentUser) }}
              >
                <User size={12} className="text-white" />
              </div>
              <div className="hidden md:flex flex-col text-left leading-none">
                <span className="font-bold text-[11px] text-gray-100 group-hover:text-sky-300 transition max-w-[110px] truncate">
                  {currentUser ? currentUser.name : "Guest"}
                </span>
                <span className="text-[9px] text-sky-400 font-mono max-w-[110px] truncate">
                  {currentUser ? currentUser.role.toUpperCase() : engineStatus.connected ? "LOCAL ENGINE" : "NO ENGINE"}
                </span>
              </div>
              <ChevronDown size={11} className="text-gray-400 group-hover:text-gray-200" />
            </button>

            {/* Dropdown Menu */}
            {showUserMenu && (
              <div className="absolute right-0 top-full mt-2 w-64 bg-[#0b0f19] border border-sky-800/80 rounded-xl shadow-2xl py-2 z-[100] animate-in fade-in duration-150">
                <div className="px-3.5 py-2.5 border-b border-gray-800/80">
                  <div className="flex items-center gap-2.5">
                    <div
                      className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-black text-white shadow-md"
                      style={{ backgroundColor: getUserColor(currentUser) }}
                    >
                      {(currentUser?.name || "G")[0].toUpperCase()}
                    </div>
                    <div className="overflow-hidden">
                      <div className="font-bold text-xs text-white truncate">{currentUser?.name || "Guest"}</div>
                      <div className="text-[10px] font-mono text-sky-400 truncate">
                        {currentUser ? `@${currentUser.username}` : "Not signed in"}
                      </div>
                      <div className="text-[10px] text-gray-400 truncate">
                        {currentUser ? currentUser.role : engineStatus.connected ? "Local engine (unlicensed)" : "No local engine detected"}
                      </div>
                    </div>
                  </div>
                  <div className="mt-2 text-[10px] font-mono text-gray-400 bg-gray-950 px-2 py-1 rounded border border-gray-800/80 truncate">
                    {engineStatus.connected ? "📁 ~/.wpipe/workspaces/" : "🔒 Projects require wpipe-engine"}
                  </div>
                </div>

                <div className="p-1 space-y-0.5">
                  <button
                    onClick={() => {
                      setShowUserMenu(false);
                      setShowProjectsModal(true);
                    }}
                    className="w-full text-left px-3 py-2 rounded-lg text-xs font-semibold text-gray-200 hover:text-white hover:bg-sky-950/60 flex items-center gap-2 transition cursor-pointer"
                  >
                    <Folder size={14} className="text-amber-400" />
                    <span>My Microservices ({userProjects.length})</span>
                  </button>

                  <button
                    onClick={() => {
                      setShowUserMenu(false);
                      setShowProjectsModal(true);
                      setIsCreatingProject(true);
                    }}
                    className="w-full text-left px-3 py-2 rounded-lg text-xs font-semibold text-gray-200 hover:text-white hover:bg-sky-950/60 flex items-center gap-2 transition cursor-pointer"
                  >
                    <FolderPlus size={14} className="text-sky-400" />
                    <span>New Microservice</span>
                  </button>

                  <div className="h-px bg-gray-800/80 my-1" />

                  {/* Suite Ecosystem Navigation */}
                  <a
                    href="https://portal.wisrovi.dev"
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => setShowUserMenu(false)}
                    className="w-full text-left px-3 py-2 rounded-lg text-xs font-semibold text-emerald-400 hover:text-emerald-300 hover:bg-emerald-950/40 flex items-center gap-2 transition cursor-pointer"
                  >
                    <span>🔑</span>
                    <span>Portal de Licencias & Seats</span>
                  </a>

                  <a
                    href="https://wisrovi.lemonsqueezy.com/checkout/buy/b2c96716-71a7-4df5-9d58-1ea58e1a5d96"
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => setShowUserMenu(false)}
                    className="w-full text-left px-3 py-2 rounded-lg text-xs font-bold text-amber-300 hover:text-amber-200 hover:bg-amber-950/40 flex items-center gap-2 transition cursor-pointer"
                  >
                    <span>👑</span>
                    <span>Comprar / Upgrade a Pro</span>
                  </a>

                  <a
                    href="https://wpipe-studio.wisrovi.dev"
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => setShowUserMenu(false)}
                    className="w-full text-left px-3 py-2 rounded-lg text-xs font-semibold text-gray-300 hover:text-white hover:bg-gray-800/60 flex items-center gap-2 transition cursor-pointer"
                  >
                    <span>🌐</span>
                    <span>Documentación & Web Suite</span>
                  </a>

                  <div className="h-px bg-gray-800/80 my-1" />

                  <button
                    onClick={() => {
                      setShowUserMenu(false);
                      setShowAuthModal(true);
                    }}
                    className="w-full text-left px-3 py-2 rounded-lg text-xs font-semibold text-gray-200 hover:text-white hover:bg-sky-950/60 flex items-center gap-2 transition cursor-pointer"
                  >
                    <User size={14} className="text-sky-400" />
                    <span>Connect Central Server / Login</span>
                  </button>

                  <div className="h-px bg-gray-800/80 my-1" />

                  <button
                    onClick={() => {
                      setShowUserMenu(false);
                      handleLogout();
                    }}
                    className="w-full text-left px-3 py-2 rounded-lg text-xs font-bold text-rose-400 hover:text-rose-200 hover:bg-rose-950/60 flex items-center gap-2 transition cursor-pointer"
                  >
                    <LogOut size={14} />
                    <span>Sign Out</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* 3. MAIN WORKSPACE CONTAINER (Flush with Top Header) */}
      <div className="flex-1 flex flex-col overflow-hidden relative bg-[#07090e]">
        {/* WORKSPACE ROW: GLOBAL ACTIVITY BAR + UNIFIED PRIMARY SIDEBAR + MAIN TABS VIEWPORT */}
        <div className="flex-1 flex overflow-hidden relative bg-[#1e1e1e]">
          {/* 1. GLOBAL ACTIVITY BAR (w-12 bg-[#181818]) */}
          <div className="w-12 bg-[#181818] border-r border-[#2b2b2b] flex flex-col justify-between items-center py-2 shrink-0 z-20 select-none">
            {/* Top Activity Icons */}
            <div className="flex flex-col items-center w-full space-y-2">
              <button
                onClick={() => handleActivityTabClick("blocks")}
                title="Paleta de Bloques WPipe (Canvas)"
                className={`w-full h-11 flex items-center justify-center relative cursor-pointer transition ${
                  activeActivityTab === "blocks" && showSidebar
                    ? "text-white"
                    : "text-[#858585] hover:text-white"
                }`}
              >
                {activeActivityTab === "blocks" && showSidebar && (
                  <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-white" />
                )}
                <Layers size={20} />
              </button>

              <button
                onClick={() => handleActivityTabClick("explorer")}
                title="Explorador de Archivos / Microservicio (Ctrl+Shift+E)"
                className={`w-full h-11 flex items-center justify-center relative cursor-pointer transition ${
                  activeActivityTab === "explorer" && showSidebar
                    ? "text-white"
                    : "text-[#858585] hover:text-white"
                }`}
              >
                {activeActivityTab === "explorer" && showSidebar && (
                  <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-white" />
                )}
                <Folder size={20} />
              </button>

              <button
                onClick={() => handleActivityTabClick("simulation")}
                title="Simulación & Depuración en Vivo"
                className={`w-full h-11 flex items-center justify-center relative cursor-pointer transition ${
                  activeActivityTab === "simulation" && showSidebar
                    ? "text-white"
                    : "text-[#858585] hover:text-white"
                }`}
              >
                {activeActivityTab === "simulation" && showSidebar && (
                  <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-white" />
                )}
                <Play size={20} />
                {isSimulating && (
                  <span className="absolute top-2 right-2 w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
                )}
              </button>

              <button
                onClick={() => handleActivityTabClick("flowchart")}
                title="Flujo Visual (Mermaid DAG)"
                className={`w-full h-11 flex items-center justify-center relative cursor-pointer transition ${
                  activeActivityTab === "flowchart" && showSidebar
                    ? "text-white"
                    : "text-[#858585] hover:text-white"
                }`}
              >
                {activeActivityTab === "flowchart" && showSidebar && (
                  <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-white" />
                )}
                <GitMerge size={20} />
              </button>

              <div className="w-6 h-[1px] bg-[#2b2b2b] my-1" />

              <button
                onClick={() => handleActivityTabClick("search")}
                title="Buscar en Archivos / Bloques (Ctrl+Shift+F)"
                className={`w-full h-11 flex items-center justify-center relative cursor-pointer transition ${
                  activeActivityTab === "search" && showSidebar
                    ? "text-white"
                    : "text-[#858585] hover:text-white"
                }`}
              >
                {activeActivityTab === "search" && showSidebar && (
                  <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-white" />
                )}
                <Search size={20} />
              </button>

              <button
                onClick={() => handleActivityTabClick("git")}
                title="Control de Código Fuente (Git)"
                className={`w-full h-11 flex items-center justify-center relative cursor-pointer transition ${
                  activeActivityTab === "git" && showSidebar
                    ? "text-white"
                    : "text-[#858585] hover:text-white"
                }`}
              >
                {activeActivityTab === "git" && showSidebar && (
                  <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-white" />
                )}
                <GitBranch size={20} />
                {modifiedFiles.size > 0 && (
                  <span className="absolute top-2 right-2 w-4 h-4 bg-[#007acc] text-white rounded-full text-[9px] font-bold flex items-center justify-center">
                    {modifiedFiles.size}
                  </span>
                )}
              </button>
            </div>

            {/* Bottom Activity Icons */}
            <div className="flex flex-col items-center w-full space-y-2">
              <button
                onClick={() => setShowProjectsModal(true)}
                title="Mis Microservicios (Gestionar proyectos, crear, clonar)"
                className="w-full h-10 flex items-center justify-center text-[#858585] hover:text-white cursor-pointer transition"
              >
                <FolderOpen size={18} />
              </button>

              <button
                onClick={() => setShowFaqModal(true)}
                title="Guía de Arquitectura y FAQ"
                className="w-full h-10 flex items-center justify-center text-[#858585] hover:text-white cursor-pointer transition"
              >
                <BookOpen size={18} />
              </button>

              <button
                onClick={() => setShowProjectsModal(true)}
                title={currentUser ? `User: ${currentUser.name} (${currentUser.role})` : "Guest (no session)"}
                className="w-full h-11 flex items-center justify-center text-[#858585] hover:text-white cursor-pointer transition relative"
              >
                {currentUser ? (
                  <div
                    className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white shadow-sm"
                    style={{ backgroundColor: getUserColor(currentUser) }}
                  >
                    {currentUser.name.charAt(0).toUpperCase()}
                  </div>
                ) : (
                  <User size={19} />
                )}
              </button>
            </div>
          </div>

          {/* 2. UNIFIED PRIMARY SIDEBAR (w-72 bg-[#252526]) */}
          {showSidebar && (
            <div className="w-72 bg-[#252526] border-r border-[#2b2b2b] flex flex-col overflow-hidden shrink-0 z-10 select-none">
              {/* 2.1 Blocks Palette View */}
              {activeActivityTab === "blocks" && (
                <div className="flex-1 flex flex-col overflow-hidden">
                  <div className="p-3 border-b border-[#2b2b2b] bg-[#202020] space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="w-5 h-5 rounded-md bg-gradient-to-tr from-sky-500 to-indigo-600 flex items-center justify-center text-xs shadow-sm">
                          🧩
                        </div>
                        <span className="font-bold text-xs text-[#cccccc] uppercase tracking-wider">Paleta de Bloques</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] text-[#858585] font-mono">
                          {categorySearch.trim() ? "Filtrando..." : "11 Bloques"}
                        </span>
                        <button
                          onClick={() => setShowSidebar(false)}
                          title="Ocultar panel lateral (Ctrl+B)"
                          className="p-1 hover:bg-[#3c3c3c] rounded text-[#858585] hover:text-white transition cursor-pointer"
                        >
                          <ChevronLeft size={14} />
                        </button>
                      </div>
                    </div>

                    {/* Search input */}
                    <div className="relative">
                      <Search size={13} className="absolute left-2.5 top-2 text-[#858585]" />
                      <input
                        type="text"
                        value={categorySearch}
                        onChange={(e) => setCategorySearch(e.target.value)}
                        placeholder="Buscar bloques (ej: trigger, if)..."
                        className="w-full bg-[#1e1e1e] border border-[#3c3c3c] focus:border-[#007acc] rounded-lg py-1 pl-8 pr-7 text-xs text-gray-200 focus:outline-none transition placeholder:text-gray-500 font-mono"
                      />
                      {categorySearch && (
                        <button
                          onClick={() => setCategorySearch("")}
                          className="absolute right-2 top-1.5 text-[#858585] hover:text-white text-xs font-bold"
                        >
                          ✕
                        </button>
                      )}
                    </div>

                    {/* Category Filter Pills */}
                    <div className="flex items-center gap-1 overflow-x-auto no-scrollbar pt-1">
                      {[
                        { id: "all", label: "Todos", count: 11, icon: "🌐" },
                        { id: "trigger", label: "Inicio/Fin", count: 2, icon: "🚀" },
                        { id: "steps", label: "Pasos", count: 3, icon: "📦" },
                        { id: "control", label: "Control", count: 2, icon: "🔀" },
                        { id: "loops", label: "Bucles", count: 2, icon: "🔁" },
                        { id: "parallel", label: "Paralelo", count: 2, icon: "⚡" },
                      ].map((cat) => (
                        <button
                          key={cat.id}
                          onClick={() => setSelectedCategory(cat.id)}
                          className={`px-2 py-0.5 rounded-full text-[10px] font-semibold flex items-center gap-1 shrink-0 transition cursor-pointer ${
                            selectedCategory === cat.id
                              ? "bg-sky-600 text-white shadow-sm"
                              : "bg-[#2d2d2d] text-[#969696] hover:bg-[#37373d] hover:text-white"
                          }`}
                        >
                          <span>{cat.icon}</span>
                          <span>{cat.label}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Scrollable List of Blocks with Interlocking Shape & Hover Descriptions */}
                  <div className="flex-1 overflow-y-auto p-2.5 space-y-2.5 custom-modal-scrollbar">
                    {[
                      {
                        id: "trigger",
                        cat: "trigger",
                        name: "Lanzador de Pipeline",
                        icon: "🚀",
                        badge: "Disparador Ingress",
                        isHat: true,
                        gradient: "from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 border-amber-300/80 shadow-amber-950/50",
                        tabColor: "bg-amber-500 border-amber-300/80",
                        description:
                          "Punto de entrada oficial del microservicio WPipe. Define el disparador inicial que recibe la carga de trabajo y activa el pipeline: API REST FastAPI (POST /run), Kafka Topic Consumer, cola Redis Stream, Cron Job periódico o comando CLI.",
                        params: "Tipo (API / Kafka / Redis / Cron / CLI), Parámetro de ruta/tópico/clave",
                        pythonSnippet: '@app.post("/run")\ndef run_pipeline(payload: dict):\n    return pipe.run(payload)',
                        action: () => {
                          addTriggerBlockToWorkspace();
                          setStatusMessage("Añadido 'Lanzador de Pipeline' al canvas ✓");
                        },
                      },
                      {
                        id: "response",
                        cat: "trigger",
                        name: "Cierre de Pipeline",
                        icon: "🏁",
                        badge: "Cierre y Salida Egress",
                        isCap: true,
                        gradient: "from-rose-600 to-rose-700 hover:from-rose-500 hover:to-rose-600 border-rose-400/80 shadow-rose-950/50",
                        tabColor: "bg-rose-600 border-rose-400/80",
                        description:
                          "Bloque terminal Cap de cierre del microservicio WPipe (base plana terminal). Define la salida o respuesta final: Respuesta HTTP 200 JSON, publicación en tópico Kafka, cola Redis, exportación a archivo o retorno directo del contexto.",
                        params: "Tipo (HTTP JSON / Kafka / Redis / Archivo / Terminate), Detalle/Payload",
                        pythonSnippet: 'return JSONResponse(\n    status_code=200,\n    content={"status": "success", "data": context}\n)',
                        action: () => {
                          addResponseBlockToWorkspace();
                          setStatusMessage("Añadido 'Cierre de Pipeline' al canvas ✓");
                        },
                      },
                      {
                        id: "step",
                        cat: "steps",
                        name: "Paso de Catálogo",
                        icon: "📦",
                        badge: "wpipe-steps Oficial & Plugins",
                        isHat: false,
                        gradient: "from-blue-600 to-blue-700 hover:from-blue-500 hover:to-blue-600 border-blue-400/80 shadow-blue-950/50",
                        tabColor: "bg-blue-600 border-blue-400/80",
                        description:
                          "Inserta un paso modular verificado de la suite WPipe (196 pasos oficiales de wpipe-steps y plugins comunitarios como ecam_yolo o rss_parser). Incluye selectores directos de origen (Official/Plugin), categoría y filtro de búsqueda.",
                        params: "Origen (Official/Plugin), Categoría, Filtro de texto, Estado, Namespace",
                        pythonSnippet: 'pipe.set_steps([\n    HttpRequest(url="https://api.site.com/v1"),\n    ImageECamYOLO(conf=0.25)\n])',
                        action: () => {
                          addStepBlockToWorkspace();
                          setStatusMessage("Añadido 'Paso de Catálogo' al canvas ✓");
                        },
                      },
                      {
                        id: "ai_step",
                        cat: "steps",
                        name: "Paso con IA",
                        icon: "✨",
                        badge: "Dialecto A (@step + DTO)",
                        isHat: false,
                        gradient: "from-purple-600 to-purple-700 hover:from-purple-500 hover:to-purple-600 border-purple-400/80 shadow-purple-950/50",
                        tabColor: "bg-purple-600 border-purple-400/80",
                        description:
                          "Genera un estado personalizado para WPipe a partir de una descripción en lenguaje natural. Produce automáticamente código tipado bajo Dialecto A: función @step en app/states/ y contrato Pydantic Context DTO en app/dto/.",
                        params: "Nombre del estado, Prompt descriptivo en lenguaje natural",
                        pythonSnippet: '@step(name="custom_ai")\n@to_obj(CustomContext)\ndef custom_ai_step(context: CustomContext) -> dict:\n    # Auto-generado por IA\n    return {"processed": True}',
                        action: () => {
                          addAiStepBlockToWorkspace();
                          setStatusMessage("Añadido 'Paso con IA' al canvas ✓");
                        },
                      },
                      {
                        id: "custom_file",
                        cat: "steps",
                        name: "Paso Personalizado (.py)",
                        icon: "📄",
                        badge: "Archivo Python Local",
                        isHat: false,
                        gradient: "from-teal-600 to-teal-700 hover:from-teal-500 hover:to-teal-600 border-teal-400/80 shadow-teal-950/50",
                        tabColor: "bg-teal-600 border-teal-400/80",
                        description:
                          "Adjunta un archivo Python propio (.py) con tus funciones de negocio. WPipe Studio lo integra automáticamente en app/states/ al generar el microservicio empaquetado, preservando tu código original.",
                        params: "Archivo Python (.py) adjunto, función exportada",
                        pythonSnippet: 'from app.states.custom_module import my_custom_step\n\npipe.set_steps([my_custom_step])',
                        action: () => {
                          addUserFileStepBlockToWorkspace();
                          setStatusMessage("Añadido 'Paso Personalizado (.py)' al canvas ✓");
                        },
                      },
                      {
                        id: "if",
                        cat: "control",
                        name: "Condición (Si)",
                        icon: "🔀",
                        badge: "Control Condition Simple",
                        isHat: false,
                        gradient: "from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 border-amber-300/80 shadow-amber-950/50",
                        tabColor: "bg-amber-500 border-amber-300/80",
                        description:
                          "Bloque Condition de WPipe. Evalúa una expresión condicional booleana sobre el contexto de datos; si es True, ejecuta la rama contenida. Omite la rama falsa para flujos limpios y directos.",
                        params: "Expresión condicional booleana (ej. status_code == 200)",
                        pythonSnippet: 'Condition(\n    expression="status_code == 200",\n    branch_true=[notify_success_step]\n)',
                        action: () => {
                          addControlBlockToWorkspace("wpipe_if");
                          setStatusMessage("Añadida 'Condición Si' al canvas ✓");
                        },
                      },
                      {
                        id: "if_else",
                        cat: "control",
                        name: "Condición (Si / Sino)",
                        icon: "⚖️",
                        badge: "Control Condition Dual",
                        isHat: false,
                        gradient: "from-amber-600 to-amber-700 hover:from-amber-500 hover:to-amber-600 border-amber-400/80 shadow-amber-950/50",
                        tabColor: "bg-amber-600 border-amber-400/80",
                        description:
                          "Bifurcación completa en WPipe. Ejecuta la rama branch_true si la condición es verdadera (True), o la rama branch_false si es falsa (False), facilitando el manejo de contingencias o errores.",
                        params: "Expresión condicional, rama verdadera y rama falsa",
                        pythonSnippet: 'Condition(\n    expression="status_code == 200",\n    branch_true=[notify_step],\n    branch_false=[error_handler_step]\n)',
                        action: () => {
                          addControlBlockToWorkspace("wpipe_if_else");
                          setStatusMessage("Añadida 'Condición Si / Sino' al canvas ✓");
                        },
                      },
                      {
                        id: "while",
                        cat: "loops",
                        name: "Bucle Mientras (While)",
                        icon: "🔁",
                        badge: "Bucle Condicional While",
                        isHat: false,
                        gradient: "from-orange-600 to-orange-700 hover:from-orange-500 hover:to-orange-600 border-orange-400/80 shadow-orange-950/50",
                        tabColor: "bg-orange-600 border-orange-400/80",
                        description:
                          "Repite los pasos contenidos continuamente mientras la condición sea True. El motor WPipe incorpora control automático de iteraciones y prevención de bloqueos infinitos.",
                        params: "Expresión condicional de continuación (ej. retry_count < 3)",
                        pythonSnippet: 'Condition(\n    expression="retry_count < 3",\n    branch_true=[retry_step]\n)',
                        action: () => {
                          addControlBlockToWorkspace("wpipe_while");
                          setStatusMessage("Añadido 'Bucle Mientras (While)' al canvas ✓");
                        },
                      },
                      {
                        id: "for",
                        cat: "loops",
                        name: "Bucle Repetir (For)",
                        icon: "🔢",
                        badge: "Iterador Fijo For",
                        isHat: false,
                        gradient: "from-orange-500 to-orange-600 hover:from-orange-400 hover:to-orange-500 border-orange-300/80 shadow-orange-950/50",
                        tabColor: "bg-orange-500 border-orange-300/80",
                        description:
                          "Bloque For nativo de WPipe. Ejecuta los pasos contenidos un número exacto de iteraciones de manera secuencial y determinista, pasando el contexto actualizado en cada vuelta.",
                        params: "Número entero de iteraciones (ej. 5), pasos contenidos",
                        pythonSnippet: 'For(\n    iterations=5,\n    steps=[process_batch_step]\n)',
                        action: () => {
                          addControlBlockToWorkspace("wpipe_for");
                          setStatusMessage("Añadido 'Bucle Repetir (For)' al canvas ✓");
                        },
                      },
                      {
                        id: "parallel",
                        cat: "parallel",
                        name: "Ejecución Paralela",
                        icon: "⚡",
                        badge: "Concurrencia Multi-hilo",
                        isHat: false,
                        gradient: "from-emerald-600 to-emerald-700 hover:from-emerald-500 hover:to-emerald-600 border-emerald-400/80 shadow-emerald-950/50",
                        tabColor: "bg-emerald-600 border-emerald-400/80",
                        description:
                          "Bloque Parallel de WPipe. Despacha múltiples ramas de pasos concurrentemente y fusiona los resultados en el contexto común según la política seleccionada (accumulate o last_wins).",
                        params: "Ramas paralelas de pasos, Política de fusión (accumulate / last_wins)",
                        pythonSnippet: 'Parallel(\n    steps=[step_fetch_user, step_fetch_orders],\n    merge_policy="accumulate"\n)',
                        action: () => {
                          addControlBlockToWorkspace("wpipe_parallel");
                          setStatusMessage("Añadida 'Ejecución Paralela' al canvas ✓");
                        },
                      },
                      {
                        id: "background",
                        cat: "parallel",
                        name: "Segundo Plano (Background)",
                        icon: "⏳",
                        badge: "Hilo Asíncrono No Bloqueante",
                        isHat: false,
                        gradient: "from-indigo-600 to-indigo-700 hover:from-indigo-500 hover:to-indigo-600 border-indigo-400/80 shadow-indigo-950/50",
                        tabColor: "bg-indigo-600 border-indigo-400/80",
                        description:
                          "Bloque Background de WPipe. Ejecuta un paso en un hilo en segundo plano sin esperar su finalización ni bloquear el avance del pipeline principal (ideal para telemetría, auditoría o alertas).",
                        params: "Paso asíncrono a lanzar en segundo plano",
                        pythonSnippet: 'Background(\n    step=audit_logging_step\n)',
                        action: () => {
                          addControlBlockToWorkspace("wpipe_background");
                          setStatusMessage("Añadida 'Tarea en Segundo Plano' al canvas ✓");
                        },
                      },
                    ]
                      .filter((b) => {
                        if (selectedCategory !== "all" && b.cat !== selectedCategory) return false;
                        if (!categorySearch.trim()) return true;
                        const q = categorySearch.toLowerCase().trim();
                        return (
                          b.name.toLowerCase().includes(q) ||
                          b.description.toLowerCase().includes(q) ||
                          b.badge.toLowerCase().includes(q)
                        );
                      })
                      .map((b) => {
                        const ent = engineStatus.entitlements;
                        const proLocked =
                          (b.id === "parallel" && !ent.parallel_blocks) ||
                          (b.id === "background" && !ent.background_blocks) ||
                          (b.id === "ai_step" && !ent.ai_steps);
                        return (
                        <div
                          key={b.id}
                          data-testid={`palette-${b.id}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            const before = getWorkspaceBlockCount();
                            b.action();
                            if (getWorkspaceBlockCount() === before && b.cat !== "trigger") {
                              setStatusMessage(`🔒 '${b.name}' was not added: plan limit or PRO feature`);
                            }
                            setCanvasBlockCount(getWorkspaceBlockCount());
                          }}
                          onMouseEnter={(e) => handleBlockMouseEnter(b, e)}
                          onMouseLeave={handleBlockMouseLeave}
                          title={proLocked ? "🔒 PRO feature: requires a verified Pro license in wpipe-engine" : undefined}
                          className={`group relative cursor-pointer select-none transition-transform duration-150 hover:scale-[1.02] active:scale-[0.98] ${proLocked ? "opacity-60" : ""}`}
                        >
                          {b.isHat ? (
                            <div className="w-12 h-2.5 rounded-t-full -mb-1 ml-3 bg-amber-500 border-t border-l border-r border-amber-300/80 shadow-sm" />
                          ) : (
                            <div className={`w-5 h-1.5 rounded-t-sm -mb-0.5 ml-4 ${b.tabColor} shadow-sm`} />
                          )}
                          <div
                            className={`px-3 py-2 rounded-xl bg-gradient-to-r ${b.gradient} border shadow-md flex items-center justify-between text-white`}
                          >
                            <div className="flex items-center gap-2.5 truncate">
                              <span className="text-base shrink-0 p-1 rounded-lg bg-black/20 shadow-inner">
                                {b.icon}
                              </span>
                              <div className="flex flex-col truncate min-w-0">
                                <span className="text-xs font-bold tracking-tight truncate leading-tight">
                                  {b.name}
                                </span>
                                <span className="text-[10px] text-white/75 font-medium truncate leading-tight mt-0.5">
                                  {b.badge}
                                </span>
                              </div>
                            </div>
                            {proLocked ? (
                              <div className="px-1.5 h-6 rounded-lg bg-black/40 flex items-center justify-center text-amber-300 text-[10px] font-black shrink-0 ml-1 shadow-sm border border-amber-400/40">
                                🔒 PRO
                              </div>
                            ) : (
                              <div className="w-6 h-6 rounded-lg bg-black/25 flex items-center justify-center text-white/90 text-xs font-bold group-hover:bg-white/20 transition shrink-0 ml-1 shadow-sm">
                                +
                              </div>
                            )}
                          </div>
                          <div className="w-5 h-1.5 rounded-t-sm -mt-0.5 ml-4 bg-[#252526] border-t border-l border-r border-[#1e1e1e]" />
                        </div>
                        );
                      })}
                  </div>
                </div>
              )}

              {/* 2.2 Explorer View */}
              {activeActivityTab === "explorer" && (
                <div className="flex-1 flex flex-col overflow-hidden">
                  <div className="px-4 py-2 flex items-center justify-between text-[11px] font-bold text-[#bbbbbb] tracking-wider uppercase border-b border-[#2b2b2b] bg-[#202020]">
                    <span>EXPLORADOR</span>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={handleSyncPythonCode}
                        disabled={previewLoading}
                        title="Sincronizar microservicio con los bloques del lienzo"
                        className="p-1 hover:bg-[#3c3c3c] rounded text-[#858585] hover:text-white transition cursor-pointer"
                      >
                        <RefreshCw size={12} className={previewLoading ? "animate-spin" : ""} />
                      </button>
                      <button
                        onClick={handleGenerateZip}
                        disabled={zipLoading}
                        title="Descargar paquete completo (.zip)"
                        className="p-1 hover:bg-[#3c3c3c] rounded text-[#858585] hover:text-white transition cursor-pointer"
                      >
                        <Download size={12} />
                      </button>
                      <button
                        onClick={() => setShowSidebar(false)}
                        title="Ocultar panel lateral (Ctrl+B)"
                        className="p-1 hover:bg-[#3c3c3c] rounded text-[#858585] hover:text-white transition cursor-pointer"
                      >
                        <ChevronLeft size={14} />
                      </button>
                    </div>
                  </div>

                  {/* Quick File Filter */}
                  <div className="px-3 py-2 border-b border-[#2b2b2b]">
                    <div className="relative">
                      <Search size={13} className="absolute left-2.5 top-2 text-[#858585]" />
                      <input
                        type="text"
                        placeholder="Buscar archivo (filtro)..."
                        value={githubFileSearch}
                        onChange={(e) => setGithubFileSearch(e.target.value)}
                        className="w-full bg-[#1e1e1e] border border-[#3c3c3c] focus:border-[#007acc] rounded py-1 pl-8 pr-6 text-xs text-gray-200 focus:outline-none font-mono"
                      />
                      {githubFileSearch && (
                        <button
                          onClick={() => setGithubFileSearch("")}
                          className="absolute right-2 top-1.5 text-xs text-[#858585] hover:text-white cursor-pointer"
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Project Folder Header */}
                  <div
                    onClick={() => {
                      setGithubCurrentDir("");
                      setGithubViewingFile(null);
                    }}
                    className="px-3 py-1.5 bg-[#2d2d2d] hover:bg-[#37373d] flex items-center justify-between text-xs font-bold text-gray-200 cursor-pointer transition border-b border-[#2b2b2b]"
                  >
                    <div className="flex items-center gap-1.5 truncate">
                      <ChevronDown size={14} className="text-[#858585]" />
                      <span className="truncate">{projectName ? projectName.toUpperCase() : "WPIPE_MICROSERVICE"}</span>
                    </div>
                    <span className="text-[10px] text-[#858585] font-mono bg-[#1e1e1e] px-1.5 py-0.2 rounded border border-[#3c3c3c]">
                      {generatedFiles.length}
                    </span>
                  </div>

                  {/* Explorer Tree Body */}
                  <div className="flex-1 overflow-y-auto py-1 px-1 custom-modal-scrollbar">
                    {previewLoading ? (
                      <p className="text-xs text-[#858585] italic p-3">Sincronizando archivos...</p>
                    ) : generatedFiles.length === 0 ? (
                      <p className="text-xs text-[#858585] italic p-3">No hay archivos generados.</p>
                    ) : githubFileSearch.trim() ? (
                      <div className="space-y-0.5">
                        {generatedFiles
                          .filter((f) => f.path.toLowerCase().includes(githubFileSearch.toLowerCase()))
                          .map((f) => (
                            <div
                              key={f.path}
                              onClick={() => {
                                setActiveMainTab("python");
                                openFileInTab(f);
                              }}
                              className={`px-3 py-1 rounded flex items-center justify-between text-xs font-mono cursor-pointer transition ${
                                githubViewingFile?.path === f.path
                                  ? "bg-[#094771] text-white font-bold"
                                  : "text-[#cccccc] hover:bg-[#2a2d2e] hover:text-white"
                              }`}
                            >
                              <div className="flex items-center gap-2 truncate">
                                {getGitHubFileIcon(f.path)}
                                <span className="truncate">{f.path}</span>
                              </div>
                              <span className="text-[10px] text-[#858585] shrink-0 font-mono">
                                {f.content.split("\n").length}L
                              </span>
                            </div>
                          ))}
                      </div>
                    ) : (
                      <FileTreeItem
                        node={buildFileTree(generatedFiles)}
                        selectedPath={githubViewingFile ? githubViewingFile.path : githubCurrentDir}
                        onSelectFile={(file) => {
                          setActiveMainTab("python");
                          openFileInTab(file);
                        }}
                        onSelectFolder={(folderPath) => {
                          setActiveMainTab("python");
                          setGithubCurrentDir(folderPath);
                          setGithubViewingFile(null);
                        }}
                        expandedFolders={expandedFolders}
                        onToggleFolder={toggleFolder}
                        modifiedFiles={modifiedFiles}
                      />
                    )}
                  </div>
                </div>
              )}

              {/* 2.3 Simulation Quick Controls View */}
              {activeActivityTab === "simulation" && (
                <div className="flex-1 flex flex-col overflow-hidden p-3 space-y-3">
                  <div className="flex items-center justify-between pb-2 border-b border-[#2b2b2b]">
                    <div className="flex items-center gap-2">
                      <Play size={14} className="text-emerald-400" />
                      <span className="font-bold text-xs text-[#cccccc] uppercase tracking-wider">Simulation</span>
                    </div>
                    <button
                      onClick={() => setShowSidebar(false)}
                      title="Ocultar panel lateral (Ctrl+B)"
                      className="p-1 hover:bg-[#3c3c3c] rounded text-[#858585] hover:text-white transition cursor-pointer"
                    >
                      <ChevronLeft size={14} />
                    </button>
                  </div>

                  {fakeSimBanner}
                  <div className="space-y-2">
                    {!isSimulating ? (
                      <button
                        onClick={handleStartSimulation}
                        data-testid="sim-start-sidebar"
                        className={`w-full py-2 border text-white rounded-lg text-xs font-bold flex items-center justify-center gap-2 shadow-md transition cursor-pointer ${
                          engineStatus.connected
                            ? "bg-emerald-600 hover:bg-emerald-500 border-emerald-400"
                            : "bg-amber-600 hover:bg-amber-500 border-amber-400"
                        }`}
                      >
                        <Play size={14} className="fill-current" />
                        <span>{simStartLabel}</span>
                      </button>
                    ) : (
                      <button
                        onClick={handleStopSimulation}
                        className="w-full py-2 bg-rose-600 hover:bg-rose-500 border border-rose-400 text-white rounded-lg text-xs font-bold flex items-center justify-center gap-2 shadow-md transition cursor-pointer animate-pulse"
                      >
                        <Square size={13} className="fill-current" />
                        <span>Stop Simulation (🛑)</span>
                      </button>
                    )}

                    <button
                      onClick={() => {
                        handleStopSimulation();
                        setSimContext({});
                        setSimSteps([]);
                        setSimLogs([]);
                        setStatusMessage("Simulation reset");
                      }}
                      className="w-full py-1.5 bg-[#2d2d2d] hover:bg-[#37373d] text-gray-300 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition cursor-pointer border border-[#3c3c3c]"
                    >
                      <RefreshCw size={12} />
                      <span>Reiniciar Contexto</span>
                    </button>
                  </div>

                  <div className="space-y-1.5 pt-2 border-t border-[#2b2b2b]">
                    <span className="text-[10px] text-[#858585] font-mono uppercase font-bold">Presets de Carga (Ingress)</span>
                    <div className="grid grid-cols-2 gap-1.5">
                      <button
                        onClick={() =>
                          setTestPayloadText(
                            JSON.stringify({ request_id: "req_api_101", user_id: 42, url: "https://api.site.com/v1" }, null, 2)
                          )
                        }
                        className="px-2 py-1 rounded bg-[#1e1e1e] hover:bg-[#2d2d2d] text-[10px] font-mono text-sky-400 border border-[#3c3c3c] transition text-center"
                      >
                        🌐 API REST
                      </button>
                      <button
                        onClick={() =>
                          setTestPayloadText(
                            JSON.stringify({ topic: "events.input", partition: 0, key: "usr_99", payload: { type: "ORDER_CREATED" } }, null, 2)
                          )
                        }
                        className="px-2 py-1 rounded bg-[#1e1e1e] hover:bg-[#2d2d2d] text-[10px] font-mono text-purple-400 border border-[#3c3c3c] transition text-center"
                      >
                        📨 Kafka
                      </button>
                      <button
                        onClick={() =>
                          setTestPayloadText(
                            JSON.stringify({ queue: "tasks_high", job_id: "job_88", data: { image_url: "https://site.com/pic.jpg" } }, null, 2)
                          )
                        }
                        className="px-2 py-1 rounded bg-[#1e1e1e] hover:bg-[#2d2d2d] text-[10px] font-mono text-rose-400 border border-[#3c3c3c] transition text-center"
                      >
                        ⚡ Redis
                      </button>
                      <button
                        onClick={() =>
                          setTestPayloadText(
                            JSON.stringify({ schedule: "*/5 * * * *", timestamp: new Date().toISOString() }, null, 2)
                          )
                        }
                        className="px-2 py-1 rounded bg-[#1e1e1e] hover:bg-[#2d2d2d] text-[10px] font-mono text-amber-400 border border-[#3c3c3c] transition text-center"
                      >
                        ⏰ Cron
                      </button>
                    </div>
                  </div>

                  <div className="flex-1 flex flex-col space-y-1 pt-1 min-h-[160px]">
                    <span className="text-[10px] text-[#858585] font-mono uppercase font-bold">Payload de Entrada (JSON)</span>
                    <textarea
                      value={testPayloadText}
                      onChange={(e) => setTestPayloadText(e.target.value)}
                      className="flex-1 w-full bg-[#1e1e1e] border border-[#3c3c3c] rounded-lg p-2 font-mono text-[11px] text-gray-200 focus:outline-none focus:border-[#007acc] resize-none"
                      placeholder='{"key": "value"}'
                    />
                  </div>
                </div>
              )}

              {/* 2.4 Flowchart Quick Actions View */}
              {activeActivityTab === "flowchart" && (
                <div className="flex-1 flex flex-col overflow-hidden p-3 space-y-3">
                  <div className="flex items-center justify-between pb-2 border-b border-[#2b2b2b]">
                    <div className="flex items-center gap-2">
                      <GitMerge size={14} className="text-indigo-400" />
                      <span className="font-bold text-xs text-[#cccccc] uppercase tracking-wider">Flujo (DAG)</span>
                    </div>
                    <button
                      onClick={() => setShowSidebar(false)}
                      title="Ocultar panel lateral (Ctrl+B)"
                      className="p-1 hover:bg-[#3c3c3c] rounded text-[#858585] hover:text-white transition cursor-pointer"
                    >
                      <ChevronLeft size={14} />
                    </button>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between bg-[#1e1e1e] border border-[#3c3c3c] rounded-lg p-1.5">
                      <button
                        onClick={() => setMermaidZoom((s) => Math.max(0.2, +(s - 0.15).toFixed(2)))}
                        title="Reducir zoom (-)"
                        className="p-1.5 hover:bg-[#2d2d2d] rounded text-sky-400 transition"
                      >
                        <ZoomOut size={14} />
                      </button>
                      <span className="text-xs font-mono font-bold text-sky-400 select-none">
                        {Math.round(mermaidZoom * 100)}%
                      </span>
                      <button
                        onClick={() => setMermaidZoom((s) => Math.min(4.0, +(s + 0.15).toFixed(2)))}
                        title="Aumentar zoom (+)"
                        className="p-1.5 hover:bg-[#2d2d2d] rounded text-sky-400 transition"
                      >
                        <ZoomIn size={14} />
                      </button>
                    </div>

                    <button
                      onClick={handleCenterMermaid}
                      className="w-full py-1.5 bg-[#2d2d2d] hover:bg-[#37373d] text-teal-400 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition border border-[#3c3c3c]"
                    >
                      <Maximize2 size={13} />
                      <span>Ajustar y Centrar</span>
                    </button>

                    <button
                      onClick={handleResetMermaid}
                      className="w-full py-1.5 bg-[#2d2d2d] hover:bg-[#37373d] text-gray-300 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition border border-[#3c3c3c]"
                    >
                      <span>Restablecer a 100%</span>
                    </button>
                  </div>

                  <div className="space-y-1.5 pt-3 border-t border-[#2b2b2b]">
                    <span className="text-[10px] text-[#858585] font-mono uppercase font-bold">Exportar & Compartir</span>
                    <button
                      onClick={handleExportMermaidSvg}
                      className="w-full py-1.5 bg-[#0e639c] hover:bg-[#1177bb] text-white rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition shadow"
                    >
                      <Download size={13} />
                      <span>Exportar SVG</span>
                    </button>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(mermaidCode);
                        setStatusMessage("Código Mermaid copiado al portapapeles ✓");
                      }}
                      className="w-full py-1.5 bg-[#2d2d2d] hover:bg-[#37373d] text-gray-300 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition border border-[#3c3c3c]"
                    >
                      <Copy size={13} />
                      <span>Copiar Mermaid</span>
                    </button>
                    <button
                      onClick={() => setShowWorkPlanModal(true)}
                      className="w-full py-1.5 bg-blue-950/80 hover:bg-blue-900 border border-blue-800 text-blue-300 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition"
                    >
                      <FileText size={13} />
                      <span>Ver Plan</span>
                    </button>
                    <button
                      onClick={() => {
                        const mdPlan = getWorkPlanFromBlocklyWorkspace(catalog, projectName || "main_pipeline");
                        const mdBlob = new Blob([mdPlan], { type: "text/markdown;charset=utf-8" });
                        const mdUrl = URL.createObjectURL(mdBlob);
                        const a = document.createElement("a");
                        a.href = mdUrl;
                        a.download = `${projectName}_work_plan.md`;
                        a.click();
                        setStatusMessage("Plan de trabajo (.md) descargado ✓");
                      }}
                      className="w-full py-1.5 bg-emerald-950/80 hover:bg-emerald-900 border border-emerald-800 text-emerald-300 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition"
                    >
                      <Download size={13} />
                      <span>Exportar Plan (.md)</span>
                    </button>
                  </div>
                </div>
              )}

              {/* 2.5 Global Search View */}
              {activeActivityTab === "search" && (
                <div className="flex-1 flex flex-col overflow-hidden p-3 space-y-3">
                  <div className="flex items-center justify-between pb-2 border-b border-[#2b2b2b]">
                    <div className="flex items-center gap-2">
                      <Search size={14} className="text-sky-400" />
                      <span className="font-bold text-xs text-[#cccccc] uppercase tracking-wider">Buscar</span>
                    </div>
                    <button
                      onClick={() => setShowSidebar(false)}
                      title="Ocultar panel lateral (Ctrl+B)"
                      className="p-1 hover:bg-[#3c3c3c] rounded text-[#858585] hover:text-white transition cursor-pointer"
                    >
                      <ChevronLeft size={14} />
                    </button>
                  </div>

                  <div className="relative">
                    <Search size={13} className="absolute left-2.5 top-2 text-[#858585]" />
                    <input
                      type="text"
                      placeholder="Buscar en archivos..."
                      value={githubFileSearch}
                      onChange={(e) => setGithubFileSearch(e.target.value)}
                      className="w-full bg-[#1e1e1e] border border-[#3c3c3c] focus:border-[#007acc] rounded py-1 pl-8 pr-6 text-xs text-gray-200 focus:outline-none font-mono"
                    />
                  </div>

                  <div className="flex-1 overflow-y-auto space-y-1 custom-modal-scrollbar">
                    {generatedFiles
                      .filter(
                        (f) =>
                          !githubFileSearch ||
                          f.path.toLowerCase().includes(githubFileSearch.toLowerCase()) ||
                          f.content.toLowerCase().includes(githubFileSearch.toLowerCase())
                      )
                      .map((f) => (
                        <div
                          key={f.path}
                          onClick={() => {
                            setActiveMainTab("python");
                            openFileInTab(f);
                          }}
                          className="p-2 rounded bg-[#1e1e1e] hover:bg-[#2d2d2d] border border-[#2b2b2b] text-xs cursor-pointer transition"
                        >
                          <div className="flex items-center gap-1.5 font-mono text-sky-400 truncate">
                            {getGitHubFileIcon(f.path)}
                            <span className="truncate">{f.path}</span>
                          </div>
                          <span className="text-[10px] text-gray-500 font-mono mt-1 block">
                            {f.content.split("\n").length} líneas
                          </span>
                        </div>
                      ))}
                  </div>
                </div>
              )}

              {/* 2.6 Source Control (Git) View */}
              {activeActivityTab === "git" && (
                <div className="flex-1 flex flex-col overflow-hidden p-3 space-y-3">
                  <div className="flex items-center justify-between pb-2 border-b border-[#2b2b2b]">
                    <div className="flex items-center gap-2">
                      <GitBranch size={14} className="text-amber-400" />
                      <span className="font-bold text-xs text-[#cccccc] uppercase tracking-wider">Control de Código</span>
                    </div>
                    <button
                      onClick={() => setShowSidebar(false)}
                      title="Ocultar panel lateral (Ctrl+B)"
                      className="p-1 hover:bg-[#3c3c3c] rounded text-[#858585] hover:text-white transition cursor-pointer"
                    >
                      <ChevronLeft size={14} />
                    </button>
                  </div>

                  <div className="flex items-center justify-between p-2 rounded bg-[#1e1e1e] border border-[#2b2b2b] text-xs font-mono">
                    <div className="flex items-center gap-1.5">
                      <GitBranch size={13} className="text-sky-400" />
                      <span>Rama: <strong className="text-white">main</strong></span>
                    </div>
                    <span className="text-[10px] text-gray-400">
                      {modifiedFiles.size} modificados
                    </span>
                  </div>

                  <div className="flex-1 overflow-y-auto space-y-1 custom-modal-scrollbar">
                    <span className="text-[10px] text-[#858585] font-mono uppercase font-bold">Cambios Detectados</span>
                    {modifiedFiles.size === 0 ? (
                      <p className="text-xs text-gray-500 italic p-2">No hay archivos modificados.</p>
                    ) : (
                      Array.from(modifiedFiles).map((path) => {
                        const file = generatedFiles.find((f) => f.path === path);
                        return (
                          <div
                            key={path}
                            onClick={() => {
                              if (file) {
                                setActiveMainTab("python");
                                openFileInTab(file);
                              }
                            }}
                            className="p-2 rounded bg-[#1e1e1e] hover:bg-[#2d2d2d] border border-amber-900/40 text-xs cursor-pointer flex items-center justify-between transition"
                          >
                            <div className="flex items-center gap-1.5 truncate font-mono text-gray-200">
                              {getGitHubFileIcon(path)}
                              <span className="truncate">{path}</span>
                            </div>
                            <span className="text-[10px] font-bold text-amber-400 font-mono bg-amber-950/60 px-1 rounded">
                              M
                            </span>
                          </div>
                        );
                      })
                    )}
                  </div>

                  <div className="pt-2 border-t border-[#2b2b2b]">
                    <button
                      onClick={handleGenerateZip}
                      disabled={zipLoading}
                      className="w-full py-2 bg-[#0e639c] hover:bg-[#1177bb] text-white rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition shadow"
                    >
                      <Download size={13} />
                      <span>Descargar ZIP con Cambios</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* 3. MAIN WORKSPACE VIEWPORT (Expands to 100% when sidebar is collapsed) */}
          <div className="flex-1 flex flex-col overflow-hidden relative bg-[#1e1e1e]">
            {/* Unified Mode Switcher Bar */}
            <div className="h-9 bg-[#181818] border-b border-[#2b2b2b] flex items-center justify-between px-3 shrink-0 select-none z-20">
              <div className="flex items-center gap-1 overflow-x-auto no-scrollbar py-0.5">
                <button
                  onClick={() => switchMainTab("code")}
                  className={`flex items-center gap-1.5 px-3 py-1 rounded text-xs font-semibold transition cursor-pointer ${
                    activeMainTab === "code"
                      ? "bg-[#252526] text-sky-400 border border-sky-600/50 shadow-sm"
                      : "text-gray-400 hover:text-white hover:bg-[#252526]/50"
                  }`}
                >
                  <span>🧩</span>
                  <span>Blockly Canvas</span>
                </button>

                <button
                  onClick={() => {
                    switchMainTab("python");
                    handleSyncPythonCode();
                  }}
                  className={`flex items-center gap-1.5 px-3 py-1 rounded text-xs font-semibold transition cursor-pointer ${
                    activeMainTab === "python"
                      ? "bg-[#252526] text-purple-400 border border-purple-600/50 shadow-sm"
                      : "text-gray-400 hover:text-white hover:bg-[#252526]/50"
                  }`}
                >
                  <Code size={13} className="text-purple-400" />
                  <span>Code & Files</span>
                  <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-[#2b2b2b] text-gray-300 font-mono">
                    {generatedFiles.length > 0 ? generatedFiles.length : 35}
                  </span>
                </button>

                <button
                  onClick={() => switchMainTab("simulation")}
                  className={`flex items-center gap-1.5 px-3 py-1 rounded text-xs font-semibold transition cursor-pointer ${
                    activeMainTab === "simulation"
                      ? "bg-[#252526] text-emerald-400 border border-emerald-600/50 shadow-sm"
                      : "text-gray-400 hover:text-white hover:bg-[#252526]/50"
                  }`}
                >
                  <span>🎮</span>
                  <span>Live Simulation</span>
                  {isSimulating && <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />}
                </button>

                <button
                  onClick={() => {
                    switchMainTab("flowchart");
                    handleOpenFlowchart();
                  }}
                  className={`flex items-center gap-1.5 px-3 py-1 rounded text-xs font-semibold transition cursor-pointer ${
                    activeMainTab === "flowchart"
                      ? "bg-[#252526] text-indigo-400 border border-indigo-600/50 shadow-sm"
                      : "text-gray-400 hover:text-white hover:bg-[#252526]/50"
                  }`}
                >
                  <GitMerge size={13} className="text-indigo-400" />
                  <span>Flow (Mermaid DAG)</span>
                </button>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowSidebar(!showSidebar)}
                  title={showSidebar ? "Hide sidebar (Ctrl+B)" : "Show sidebar (Ctrl+B)"}
                  className="p-1 rounded text-gray-400 hover:text-white hover:bg-[#2a2d2e] transition cursor-pointer"
                >
                  <PanelLeft size={14} />
                </button>
              </div>
            </div>
            {/* TAB 1: CODE / SCRATUX BLOCKS WORKSPACE (Permanently Mounted in DOM to preserve blocks) */}
            <div className={activeMainTab === "code" ? "flex-1 bg-[#07090e] relative overflow-hidden flex flex-col" : "hidden"}>
            {/* Floating Action Toolbar */}
            <div className="absolute top-3 right-4 flex items-center gap-1.5 p-1 bg-gray-950/90 backdrop-blur-md border border-gray-800/90 rounded-xl shadow-2xl z-10 max-w-[calc(100%-2rem)] overflow-x-auto no-scrollbar">
              <div className="flex items-center gap-1.5 px-2 py-1 text-[11px] text-gray-400 font-medium border-r border-gray-800 mr-1 hidden sm:flex select-none">
                <Move size={12} className="text-sky-400" />
                <span>Drag canvas to pan</span>
              </div>

              <button
                onClick={centerWorkspace}
                title="Center canvas on blocks origin"
                className="px-2.5 py-1.5 hover:bg-gray-800 text-sky-400 hover:text-sky-300 rounded-lg flex items-center gap-1 text-xs font-semibold transition cursor-pointer"
              >
                <Maximize2 size={13} />
                <span>Center</span>
              </button>

              <button
                onClick={zoomFitWorkspace}
                title="Zoom to fit blocks"
                className="px-2.5 py-1.5 hover:bg-gray-800 text-teal-400 hover:text-teal-300 rounded-lg flex items-center gap-1 text-xs font-semibold transition cursor-pointer"
              >
                <Search size={13} />
                <span>Fit</span>
              </button>

              <button
                onClick={collapseAllBlocksInWorkspace}
                title="Collapse all blocks on canvas"
                className="px-2.5 py-1.5 hover:bg-gray-800 text-amber-400 hover:text-amber-300 rounded-lg flex items-center gap-1 text-xs font-semibold transition cursor-pointer"
              >
                <Minimize2 size={13} />
                <span>Collapse</span>
              </button>

              <button
                onClick={expandAllBlocksInWorkspace}
                title="Expand all blocks on canvas"
                className="px-2.5 py-1.5 hover:bg-gray-800 text-emerald-400 hover:text-emerald-300 rounded-lg flex items-center gap-1 text-xs font-semibold transition cursor-pointer"
              >
                <ChevronDown size={13} />
                <span>Expand</span>
              </button>

              <div className="w-[1px] h-4 bg-gray-800 mx-0.5" />

              <button
                onClick={() => undoWorkspace(false)}
                title="Undo last action (Ctrl+Z)"
                className="p-1.5 hover:bg-gray-800 text-gray-300 hover:text-white rounded-lg transition cursor-pointer"
              >
                <Undo size={14} />
              </button>

              <button
                onClick={clearWorkspace}
                title="Clear entire canvas"
                className="p-1.5 hover:bg-rose-950 text-rose-400 hover:text-rose-300 rounded-lg transition cursor-pointer"
              >
                <Trash2 size={14} />
              </button>

              <div className="w-[1px] h-4 bg-gray-800 mx-0.5" />

              <button
                onClick={() => setShowFaqModal(true)}
                title="Architecture Guide & FAQ"
                className="px-2.5 py-1.5 hover:bg-purple-950/70 text-purple-400 hover:text-purple-300 rounded-lg flex items-center gap-1 text-xs font-semibold transition cursor-pointer"
              >
                <BookOpen size={13} />
                <span>Guide</span>
              </button>
            </div>

            {/* Blockly Workspace + Live Split View + Inspector Component */}
            <div className="flex-1 w-full h-full flex overflow-hidden relative">
              {/* Workspace Container */}
              <div className={`h-full flex flex-col relative ${isSplitView ? "w-1/2 border-r border-[#2d2d2d]" : "w-full flex-1"}`}>
                <BlocklyComponent
                  onBlockSelected={handleBlockSelected}
                  onWorkspaceChange={handleWorkspaceChanged}
                />
                {/* Plan block counter (display only; the engine enforces the signed limit) */}
                {(() => {
                  const max = engineStatus.entitlements.max_blocks;
                  const atLimit = max !== null && canvasBlockCount >= max;
                  const over = max !== null && canvasBlockCount > max;
                  return (
                    <div
                      data-testid="block-counter"
                      className={`absolute top-3 right-3 z-20 px-2.5 py-1 rounded-full text-[11px] font-mono font-bold border shadow-lg backdrop-blur-sm pointer-events-none ${
                        max === null
                          ? "bg-emerald-950/80 text-emerald-300 border-emerald-700/70"
                          : over
                            ? "bg-red-950/85 text-red-300 border-red-700/70"
                            : atLimit
                              ? "bg-amber-950/85 text-amber-300 border-amber-700/70"
                              : "bg-slate-900/85 text-slate-200 border-slate-700/70"
                      }`}
                      title={
                        max === null
                          ? "Verified PRO license: unlimited blocks"
                          : "Free plan limit. The local engine rejects pipelines above this limit."
                      }
                    >
                      Blocks {canvasBlockCount} / {max === null ? "∞" : max} · {max === null ? "PRO" : engineStatus.connected ? "Free" : "Free · No Engine"}
                    </div>
                  );
                })()}
              </div>

              {/* Live Split View (Canvas + Python Code side-by-side) */}
              {isSplitView && (
                <div className="w-1/2 h-full flex flex-col bg-[#1e1e1e] overflow-hidden">
                  <div className="h-9 px-3 bg-[#252526] border-b border-[#2d2d2d] flex items-center justify-between text-xs text-gray-300 shrink-0">
                    <div className="flex items-center gap-2">
                      <FileCode size={14} className="text-sky-400" />
                      <span className="font-mono font-semibold">pipeline.py (Live AST Compilado)</span>
                      <span className="text-[10px] text-emerald-400 bg-emerald-950/60 px-1.5 py-0.5 rounded border border-emerald-800">
                        En vivo
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(livePipelineCode);
                          setStatusMessage("Código pipeline.py copiado al portapapeles");
                        }}
                        className="p-1 hover:bg-[#333333] text-gray-400 hover:text-white rounded cursor-pointer"
                        title="Copiar código"
                      >
                        <Copy size={13} />
                      </button>
                      <button
                        onClick={() => setIsSplitView(false)}
                        className="p-1 hover:bg-[#333333] text-gray-400 hover:text-white rounded cursor-pointer"
                        title="Cerrar vista dividida"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  </div>
                  <div className="flex-1 p-3 overflow-auto font-mono text-xs bg-[#1e1e1e]">
                    <pre className="text-gray-200 font-mono text-[12px] leading-relaxed select-text">
                      <code>{livePipelineCode || "# Modifica el lienzo para compilar el AST de WPipe en vivo..."}</code>
                    </pre>
                  </div>
                </div>
              )}

              {/* Step Property Inspector Drawer */}
              {inspectorOpen && selectedBlockData && (
                <div className="absolute right-0 top-0 bottom-0 w-80 bg-[#252526] border-l border-[#333333] shadow-2xl flex flex-col z-20 animate-in slide-in-from-right duration-200">
                  <div className="h-10 px-3 bg-[#2d2d2d] border-b border-[#333333] flex items-center justify-between text-xs font-semibold text-gray-200 shrink-0">
                    <div className="flex items-center gap-1.5 truncate">
                      <Sliders size={14} className="text-purple-400 shrink-0" />
                      <span className="truncate">Inspector: {selectedBlockData.stepName || selectedBlockData.type}</span>
                    </div>
                    <button
                      onClick={() => setInspectorOpen(false)}
                      className="p-1 hover:bg-[#3e3e42] text-gray-400 hover:text-white rounded cursor-pointer"
                    >
                      <X size={14} />
                    </button>
                  </div>

                  <div className="flex-1 overflow-y-auto p-3 space-y-4 text-xs">
                    {/* Breakpoint toggle */}
                    <div className="p-2.5 rounded-lg bg-[#1e1e1e] border border-[#3c3c3c] flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div
                          className={`w-3.5 h-3.5 rounded-full border ${
                            breakpoints.has(selectedBlockData.id) || breakpoints.has(selectedBlockData.stepName)
                              ? "bg-rose-500 border-rose-300 shadow-[0_0_8px_rgba(244,63,94,0.8)]"
                              : "bg-gray-800 border-gray-600"
                          }`}
                        />
                        <span className="text-gray-300 font-medium">Punto de Interrupción</span>
                      </div>
                      <button
                        onClick={() => handleToggleBreakpoint(selectedBlockData.id, selectedBlockData.stepName)}
                        className={`px-2.5 py-1 rounded text-[11px] font-bold transition cursor-pointer ${
                          breakpoints.has(selectedBlockData.id) || breakpoints.has(selectedBlockData.stepName)
                            ? "bg-rose-900/60 border border-rose-600 text-rose-300 hover:bg-rose-900"
                            : "bg-[#333333] hover:bg-[#444444] text-gray-300 border border-[#444444]"
                        }`}
                      >
                        {breakpoints.has(selectedBlockData.id) || breakpoints.has(selectedBlockData.stepName) ? "Quitar 🔴" : "Activar ⭕"}
                      </button>
                    </div>

                    {/* Metadata & Description */}
                    <div className="p-2.5 rounded-lg bg-[#1e1e1e] border border-[#3c3c3c] space-y-1.5">
                      <span className="text-[10px] uppercase font-mono text-gray-400 font-bold">Documentación</span>
                      <p className="text-gray-300 text-[11px] leading-relaxed">
                        {catalog.find((s) => s.name === selectedBlockData.stepName)?.description ||
                          selectedBlockData.description ||
                          "Sin descripción disponible en el catálogo de pasos."}
                      </p>
                      {catalog.find((s) => s.name === selectedBlockData.stepName)?.repo && (
                        <div className="text-[10px] text-gray-500 font-mono">
                          Origen: {catalog.find((s) => s.name === selectedBlockData.stepName)?.repo}
                        </div>
                      )}
                    </div>

                    {/* Block Fields Editor */}
                    <div className="space-y-3">
                      <span className="text-[10px] uppercase font-mono text-gray-400 font-bold">Parámetros del Bloque</span>
                      {selectedBlockData.fields &&
                        Object.entries(selectedBlockData.fields).map(([fieldName, val]) => (
                          <div key={fieldName} className="space-y-1">
                            <label className="text-[11px] font-mono text-sky-400 block">{fieldName}</label>
                            <input
                              type="text"
                              value={String(val ?? "")}
                              onChange={(e) => {
                                const newVal = e.target.value;
                                updateBlockFieldValue(selectedBlockData.id, fieldName, newVal);
                                setSelectedBlockData((prev: any) =>
                                  prev
                                    ? {
                                        ...prev,
                                        fields: { ...prev.fields, [fieldName]: newVal },
                                      }
                                    : prev
                                );
                              }}
                              className="w-full px-2 py-1.5 bg-[#1e1e1e] border border-[#3c3c3c] rounded text-gray-200 font-mono text-xs focus:outline-none focus:border-sky-500"
                            />
                          </div>
                        ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

        {/* TAB 2: DEDICATED FULL-SCREEN SIMULATION & DEBUGGING STAGE */}
        {activeMainTab === "simulation" && (
          <div className="flex-1 flex overflow-hidden bg-[#07090e]">
            {/* Left Column: Controls, Ingress Payload, Context State Inspector */}
            <div className="w-[45%] border-r border-gray-800/80 bg-[#0c101c] flex flex-col p-4 space-y-4 overflow-y-auto custom-modal-scrollbar">
              {fakeSimBanner}
              {/* Header Controls */}
              <div className="flex items-center justify-between p-3 rounded-xl bg-gray-950/80 border border-gray-800/80 shadow-md">
                <div className="flex items-center space-x-2">
                  <button
                    onClick={handleStartSimulation}
                    disabled={isSimulating}
                    data-testid="sim-start-stage"
                    className={`px-3.5 py-2 rounded-lg border flex items-center gap-2 text-xs font-bold shadow-md transition cursor-pointer ${
                      isSimulating
                        ? "bg-emerald-950/40 border-emerald-900 text-emerald-600 opacity-60 cursor-not-allowed"
                        : engineStatus.connected
                          ? "bg-emerald-600 hover:bg-emerald-500 border-emerald-400 text-white active:scale-95 shadow-emerald-950/60"
                          : "bg-amber-600 hover:bg-amber-500 border-amber-400 text-white active:scale-95"
                    }`}
                  >
                    <Play size={14} className="fill-current" />
                    <span>{simStartLabel}</span>
                  </button>

                  <button
                    onClick={handleStopSimulation}
                    disabled={!isSimulating}
                    className={`px-3 py-2 rounded-lg border flex items-center gap-1.5 text-xs font-bold transition cursor-pointer ${
                      isSimulating
                        ? "bg-rose-600 hover:bg-rose-500 border-rose-400 text-white active:scale-95 shadow-lg"
                        : "bg-gray-800/50 border-gray-700/60 text-gray-500 cursor-not-allowed"
                    }`}
                  >
                    <Square size={13} className="fill-current" />
                    <span>Stop (🛑)</span>
                  </button>
                </div>

                <button
                  onClick={() => {
                    handleStopSimulation();
                    setSimContext({});
                    setSimSteps([]);
                    setSimLogs([]);
                    setStatusMessage("Simulation reset");
                  }}
                  className="px-2.5 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer"
                >
                  <RefreshCw size={12} />
                  <span>Reiniciar</span>
                </button>
              </div>

              {/* Ingress Payload Editor with Presets */}
              <div className="p-3.5 rounded-xl bg-gray-950/80 border border-gray-800/80 space-y-2.5 shadow-sm">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-gray-200 flex items-center gap-1.5">
                    <Database size={14} className="text-amber-400" />
                    <span>Payload de Entrada (JSON)</span>
                  </span>
                  <span className="text-[10px] text-gray-500 font-mono">Presets Rápidos:</span>
                </div>

                {/* Preset Buttons */}
                <div className="flex items-center gap-1.5 flex-wrap">
                  <button
                    onClick={() =>
                      setTestPayloadText(
                        JSON.stringify({ request_id: "req_api_101", user_id: 42, url: "https://api.site.com/v1" }, null, 2)
                      )
                    }
                    className="px-2 py-1 rounded bg-gray-900 hover:bg-gray-800 text-[10px] font-mono text-sky-400 border border-gray-800 transition cursor-pointer"
                  >
                    🌐 API REST
                  </button>
                  <button
                    onClick={() =>
                      setTestPayloadText(
                        JSON.stringify({ topic: "events.input", partition: 0, key: "usr_99", payload: { type: "ORDER_CREATED" } }, null, 2)
                      )
                    }
                    className="px-2 py-1 rounded bg-gray-900 hover:bg-gray-800 text-[10px] font-mono text-emerald-400 border border-gray-800 transition cursor-pointer"
                  >
                    📨 Kafka Event
                  </button>
                  <button
                    onClick={() =>
                      setTestPayloadText(
                        JSON.stringify({ queue: "wpipe:queue:in", task_id: "job_88", model_path: "/models/yolov8n.pt" }, null, 2)
                      )
                    }
                    className="px-2 py-1 rounded bg-gray-900 hover:bg-gray-800 text-[10px] font-mono text-rose-400 border border-gray-800 transition cursor-pointer"
                  >
                    📦 Redis Queue
                  </button>
                  <button
                    onClick={() =>
                      setTestPayloadText(
                        JSON.stringify({ cron: "*/5 * * * *", timestamp: new Date().toISOString() }, null, 2)
                      )
                    }
                    className="px-2 py-1 rounded bg-gray-900 hover:bg-gray-800 text-[10px] font-mono text-purple-400 border border-gray-800 transition cursor-pointer"
                  >
                    ⏱️ Cron Job
                  </button>
                </div>

                <textarea
                  rows={5}
                  value={testPayloadText}
                  onChange={(e) => setTestPayloadText(e.target.value)}
                  className="w-full bg-gray-900 border border-gray-800 rounded-lg p-2.5 text-xs font-mono text-amber-200 focus:outline-none focus:border-amber-500/80 resize-none leading-relaxed"
                />
              </div>

              {/* Live Context State Mutation Inspector */}
              <div className="flex-1 p-3.5 rounded-xl bg-gray-950/80 border border-gray-800/80 flex flex-col shadow-sm min-h-[220px]">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-bold text-gray-200 flex items-center gap-1.5">
                    <Layers size={14} className="text-sky-400" />
                    <span>Variables del Contexto (data mutation)</span>
                  </span>
                  <span className="text-[10px] font-mono text-gray-500">
                    {Object.keys(simContext).length} variables
                  </span>
                </div>

                <div className="flex-1 overflow-y-auto bg-gray-900/90 border border-gray-800/80 rounded-lg p-3 font-mono text-xs space-y-1.5 custom-modal-scrollbar">
                  {Object.keys(simContext).length === 0 ? (
                    <div className="text-gray-500 italic text-center py-6 text-xs">
                      No hay variables en el contexto. Haz clic en <strong>Iniciar Simulación (🏁)</strong> para observar las mutaciones en vivo paso a paso.
                    </div>
                  ) : (
                    Object.entries(simContext).map(([k, v]) => (
                      <div key={k} className="flex items-start justify-between border-b border-gray-800/60 pb-1.5">
                        <span className="text-sky-400 font-bold shrink-0 mr-3">{k}:</span>
                        <span className="text-gray-300 break-all text-right font-mono">
                          {typeof v === "object" ? JSON.stringify(v) : String(v)}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>

            {/* Right Column: Execution Timeline, Metrics, Real-time Logs */}
            <div className="flex-1 flex flex-col bg-[#07090e] p-4 space-y-4 overflow-y-auto custom-modal-scrollbar">
              {/* Step Sequence Timeline */}
              <div className="p-3.5 rounded-xl bg-gray-950/90 border border-gray-800/80 shadow-md">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-sky-400 to-indigo-300 flex items-center gap-1.5">
                    <Terminal size={14} className="text-sky-400" />
                    <span>Línea Temporal de Ejecución (Pipeline Steps)</span>
                  </span>
                  <span
                    className={`text-[10px] px-2.5 py-0.5 rounded-full font-mono font-bold ${
                      isSimulating
                        ? "bg-amber-950 text-amber-300 border border-amber-800 animate-pulse"
                        : "bg-gray-900 text-gray-400 border border-gray-800"
                    }`}
                  >
                    {isSimulating ? "SIMULANDO EN VIVO ⚡" : "EN ESPERA"}
                  </span>
                </div>

                <div className="space-y-2 max-h-56 overflow-y-auto pr-1 custom-modal-scrollbar">
                  {simSteps.length === 0 ? (
                    <p className="text-xs text-gray-500 italic text-center py-4">
                      Presiona la bandera verde 🏁 para simular el avance del pipeline paso a paso con los bloques actuales del lienzo.
                    </p>
                  ) : (
                    simSteps.map((step, idx) => (
                      <div
                        key={step.id}
                        className={`p-2.5 rounded-xl border text-xs flex items-center justify-between transition ${
                          step.status === "running"
                            ? "bg-amber-950/40 border-amber-500 text-amber-200 shadow-md ring-1 ring-amber-500/50"
                            : step.status === "success"
                            ? "bg-emerald-950/30 border-emerald-700/80 text-emerald-200"
                            : step.status === "error"
                            ? "bg-rose-950/40 border-rose-600 text-rose-200"
                            : "bg-gray-900/60 border-gray-800/80 text-gray-400"
                        }`}
                      >
                        <div className="flex items-center space-x-2.5 truncate">
                          <span className="font-mono text-[10px] opacity-60">#{idx + 1}</span>
                          <span className="font-bold truncate">{step.name}</span>
                        </div>
                        <div className="flex items-center space-x-2">
                          {step.status === "running" && (
                            <RefreshCw size={13} className="animate-spin text-amber-400" />
                          )}
                          {step.status === "success" && (
                            <span className="text-[11px] font-mono text-emerald-400 font-semibold">
                              ✓ {step.durationMs}ms
                            </span>
                          )}
                          {step.status === "error" && (
                            <span className="text-[11px] font-mono text-rose-400 font-bold">
                              ✕ ERROR
                            </span>
                          )}
                          {step.status === "idle" && (
                            <span className="text-[11px] font-mono text-gray-600">esperando</span>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Resource Metrics */}
              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 rounded-xl bg-gray-950/80 border border-gray-800/80 flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs text-gray-400">
                    <Cpu size={16} className="text-sky-400" />
                    <span>Uso de CPU</span>
                  </div>
                  <span className="text-sm font-mono font-bold text-sky-300">{cpuUsage}%</span>
                </div>
                <div className="p-3 rounded-xl bg-gray-950/80 border border-gray-800/80 flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs text-gray-400">
                    <Database size={16} className="text-purple-400" />
                    <span>Memoria RAM</span>
                  </div>
                  <span className="text-sm font-mono font-bold text-purple-300">{ramUsage} MB</span>
                </div>
              </div>

              {/* Real-time Terminal Log Console */}
              <div className="flex-1 p-3.5 rounded-xl bg-black border border-gray-800/90 flex flex-col min-h-[160px] shadow-inner">
                <div className="flex items-center justify-between pb-2 mb-2 border-b border-gray-800/80">
                  <span className="text-xs font-mono text-gray-400 flex items-center gap-1.5">
                    <Terminal size={13} className="text-emerald-400" />
                    <span>Consola de Logs (Sandbox Runtime)</span>
                  </span>
                  <span className="text-[10px] font-mono text-gray-600">stdout/stderr</span>
                </div>
                <div className="flex-1 overflow-y-auto font-mono text-xs space-y-1 custom-modal-scrollbar">
                  {simLogs.length === 0 ? (
                    <p className="text-gray-600 italic">No hay logs generados.</p>
                  ) : (
                    simLogs.map((log, i) => (
                      <div key={i} className="flex items-start gap-2">
                        <span className="text-gray-600 text-[10px] shrink-0">{log.time}</span>
                        <span
                          className={`text-[10px] font-bold shrink-0 ${
                            log.level === "ERROR"
                              ? "text-rose-400"
                              : log.level === "WARN"
                              ? "text-amber-400"
                              : "text-emerald-400"
                          }`}
                        >
                          [{log.level}]
                        </span>
                        <span className="text-gray-300 break-all">{log.msg}</span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 3: MERMAID FLOWCHART VIEW */}
        {activeMainTab === "flowchart" && (
          <div className="flex-1 flex flex-col bg-[#07090e] overflow-hidden">
            {/* Top Toolbar */}
            <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 bg-gray-950/80 border-b border-gray-800/80 text-xs">
              <div className="flex items-center space-x-2">
                <div className="hidden xl:flex items-center gap-1.5 px-2.5 py-1 bg-gray-900 border border-gray-800 rounded-lg text-gray-400 text-[11px] font-medium mr-1 select-none">
                  <Move size={12} className="text-sky-400" />
                  <span>Arrastra fondo para mover • Rueda ratón para zoom</span>
                </div>

                <div className="flex items-center bg-gray-900 border border-gray-800 rounded-lg p-0.5">
                  <button
                    onClick={() => setMermaidZoom((s) => Math.max(0.2, +(s - 0.15).toFixed(2)))}
                    title="Reducir zoom (-)"
                    className="p-1.5 hover:bg-gray-800 rounded text-sky-400 hover:text-sky-300 cursor-pointer transition"
                  >
                    <ZoomOut size={13} />
                  </button>
                  <span className="text-xs font-mono font-bold text-sky-400 w-14 text-center select-none">
                    {Math.round(mermaidZoom * 100)}%
                  </span>
                  <button
                    onClick={() => setMermaidZoom((s) => Math.min(4.0, +(s + 0.15).toFixed(2)))}
                    title="Aumentar zoom (+)"
                    className="p-1.5 hover:bg-gray-800 rounded text-sky-400 hover:text-sky-300 cursor-pointer transition"
                  >
                    <ZoomIn size={13} />
                  </button>
                </div>

                <button
                  onClick={handleResetMermaid}
                  title="Restablecer zoom y posición a 100%"
                  className="px-2.5 py-1.5 bg-gray-900 hover:bg-gray-800 border border-gray-800 rounded-lg text-xs font-semibold text-gray-300 hover:text-white cursor-pointer transition"
                >
                  100%
                </button>

                <button
                  onClick={handleCenterMermaid}
                  title="Centrar y ajustar automáticamente el diagrama al lienzo"
                  className="px-2.5 py-1.5 bg-gray-900 hover:bg-gray-800 border border-gray-800 rounded-lg text-xs font-semibold text-teal-400 hover:text-teal-300 flex items-center gap-1.5 cursor-pointer transition"
                >
                  <Maximize2 size={13} />
                  <span>Ajustar y Centrar</span>
                </button>
              </div>

              <div className="flex items-center space-x-2">
                <button
                  onClick={handleExportMermaidSvg}
                  title="Descargar diagrama vectorial SVG para presentaciones o documentación"
                  className="px-3 py-1.5 bg-sky-950 hover:bg-sky-900 border border-sky-800/80 text-sky-300 rounded-lg text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition shadow-sm"
                >
                  <Download size={13} />
                  <span>Exportar SVG</span>
                </button>

                <button
                  onClick={() => {
                    navigator.clipboard.writeText(mermaidCode);
                    setStatusMessage("Código Mermaid copiado al portapapeles ✓");
                  }}
                  title="Copiar código fuente Mermaid"
                  className="px-3 py-1.5 bg-gray-900 hover:bg-gray-800 border border-gray-800 text-gray-300 hover:text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition"
                >
                  <Copy size={13} />
                  <span>Copiar Mermaid</span>
                </button>

                <button
                  onClick={() => setShowWorkPlanModal(true)}
                  title="Visualizar plan de ejecución y especificación de arquitectura"
                  className="px-3 py-1.5 bg-blue-950 hover:bg-blue-900 border border-blue-800/80 text-blue-300 rounded-lg text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition shadow-sm"
                >
                  <FileText size={13} />
                  <span>Ver Plan</span>
                </button>

                <button
                  onClick={() => {
                    const mdPlan = getWorkPlanFromBlocklyWorkspace(catalog, projectName || "main_pipeline");
                    const mdBlob = new Blob([mdPlan], { type: "text/markdown;charset=utf-8" });
                    const mdUrl = URL.createObjectURL(mdBlob);
                    const a = document.createElement("a");
                    a.href = mdUrl;
                    a.download = `${projectName}_work_plan.md`;
                    a.click();
                    setStatusMessage("Plan de trabajo (.md) descargado ✓");
                  }}
                  title="Exportar plan de trabajo en formato Markdown"
                  className="px-3 py-1.5 bg-emerald-950 hover:bg-emerald-900 border border-emerald-800/80 text-emerald-300 rounded-lg text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition shadow-sm"
                >
                  <Download size={13} />
                  <span>Exportar Plan (.md)</span>
                </button>
              </div>
            </div>

            {/* Interactive Pan-Zoom Canvas */}
            <div
              ref={mermaidContainerRef}
              onMouseDown={handleMermaidMouseDown}
              onMouseMove={handleMermaidMouseMove}
              onMouseUp={handleMermaidMouseUp}
              onMouseLeave={handleMermaidMouseUp}
              onWheel={handleMermaidWheel}
              className={`flex-1 relative overflow-hidden mermaid-viewport ${mermaidIsDragging ? "is-dragging" : ""}`}
            >
              <div
                ref={mermaidFullRef}
                style={{
                  transform: `translate(${mermaidPan.x}px, ${mermaidPan.y}px) scale(${mermaidZoom})`,
                  transition: mermaidIsDragging ? "none" : "transform 0.12s cubic-bezier(0.2, 0, 0, 1)",
                }}
                className="mermaid-svg-stage select-none"
              />
            </div>
          </div>
        )}

        {/* TAB 4: VS CODE STYLE PYTHON MICROSERVICE ENVIRONMENT */}
        {activeMainTab === "python" && (() => {
          const directoryItems = getGitHubDirectoryItems(generatedFiles, githubCurrentDir);
          const currentReadme = generatedFiles.find(
            (f) => f.path.toLowerCase() === (githubCurrentDir ? `${githubCurrentDir}/readme.md` : "readme.md")
          );

          // Build breadcrumb items
          const pathParts = (githubViewingFile
            ? githubViewingFile.path.split("/").slice(0, -1)
            : githubCurrentDir.split("/").filter(Boolean));

          const breadcrumbs = [
            { label: projectName || "wpipe_microservice", path: "", isFolder: true },
            ...pathParts.map((part, idx) => ({
              label: part,
              path: pathParts.slice(0, idx + 1).join("/"),
              isFolder: true,
            })),
            ...(githubViewingFile
              ? [{ label: githubViewingFile.path.split("/").pop() || "", path: githubViewingFile.path, isFolder: false }]
              : []),
          ];

          return (
            <div className="flex-1 flex flex-col bg-[#1e1e1e] overflow-hidden text-[#cccccc] font-sans">
              {/* 3.1 VS Code Tabs Bar */}
                  <div className="bg-[#252526] border-b border-[#1e1e1e] flex items-center justify-between overflow-x-auto select-none no-scrollbar shrink-0 h-9">
                    {/* Tabs List */}
                    <div className="flex items-center h-full overflow-x-auto no-scrollbar">
                      {/* Folder tab if no files open */}
                      {openTabs.length === 0 && (
                        <div
                          onClick={() => setGithubViewingFile(null)}
                          className="h-full px-4 flex items-center gap-2 text-xs font-mono border-r border-[#1e1e1e] bg-[#1e1e1e] text-white border-t-2 border-t-[#007acc] cursor-pointer"
                        >
                          <Folder size={14} className="text-[#dcb67a]" />
                          <span>{githubCurrentDir.split("/").pop() || projectName || "workspace"} (Carpeta)</span>
                        </div>
                      )}

                      {openTabs.map((tab) => {
                        const isActive = githubViewingFile?.path === tab.path;
                        const isModified = modifiedFiles.has(tab.path);
                        return (
                          <div
                            key={tab.path}
                            onClick={() => {
                              setIsEditingFile(false);
                              setReadmePreviewMode(false);
                              setGithubViewingFile(tab);
                              setGithubCurrentDir(tab.path.split("/").slice(0, -1).join("/"));
                            }}
                            className={`h-full px-3 flex items-center gap-2 text-xs font-mono border-r border-[#1e1e1e] cursor-pointer transition shrink-0 group ${
                              isActive
                                ? "bg-[#1e1e1e] text-white border-t-2 border-t-[#007acc]"
                                : "bg-[#2d2d2d] text-[#969696] hover:bg-[#1e1e1e] hover:text-gray-200 border-t-2 border-t-transparent"
                            }`}
                          >
                            {getGitHubFileIcon(tab.path)}
                            <span className="truncate max-w-[130px]">{tab.path.split("/").pop()}</span>
                            {isModified && (
                              <span
                                onClick={(e) => closeTab(tab.path, e)}
                                className="w-2 h-2 rounded-full bg-[#e2c08d] group-hover:hidden"
                                title="Modificado"
                              />
                            )}
                            <button
                              onClick={(e) => closeTab(tab.path, e)}
                              className={`p-0.5 rounded hover:bg-[#3c3c3c] text-gray-400 hover:text-white transition ${
                                isModified ? "hidden group-hover:block" : ""
                              }`}
                              title="Cerrar archivo"
                            >
                              <X size={12} />
                            </button>
                          </div>
                        );
                      })}
                    </div>

                    {/* Tab Bar Action Buttons on the Right */}
                    <div className="flex items-center space-x-1.5 px-3 shrink-0">
                      {githubViewingFile && (githubViewingFile.path === "README.md" || githubViewingFile.path.endsWith("/README.md")) && (
                        <button
                          onClick={() => setReadmePreviewMode(!readmePreviewMode)}
                          className="px-2 py-0.5 bg-[#0e639c] hover:bg-[#1177bb] text-white rounded text-xs font-mono flex items-center gap-1.5 transition cursor-pointer"
                          title={readmePreviewMode ? "Switch to Monaco Code Editor" : "Switch to Rendered Markdown Preview"}
                        >
                          {readmePreviewMode ? <Code size={12} /> : <Eye size={12} />}
                          <span>{readmePreviewMode ? "Code" : "Preview"}</span>
                        </button>
                      )}

                      {githubViewingFile && !isEditingFile && !(githubViewingFile.path === "README.md" || githubViewingFile.path.endsWith("/README.md")) && (
                        <button
                          onClick={handleStartEditingFile}
                          className="px-2.5 py-0.5 bg-[#0e639c] hover:bg-[#1177bb] text-white rounded text-xs font-semibold flex items-center gap-1 transition cursor-pointer"
                          title="Edit this file"
                        >
                          <Edit3 size={12} />
                          <span>Edit</span>
                        </button>
                      )}

                      {isEditingFile && (
                        <>
                          <button
                            onClick={handleSaveFileChanges}
                            className="px-2.5 py-0.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-xs font-bold flex items-center gap-1 transition cursor-pointer"
                            title="Guardar cambios"
                          >
                            <Save size={12} />
                            <span>Guardar</span>
                          </button>
                          <button
                            onClick={handleCancelFileEditing}
                            className="px-2 py-0.5 bg-[#3c3c3c] hover:bg-[#4a4a4a] text-gray-300 rounded text-xs transition cursor-pointer"
                            title="Cancelar edición"
                          >
                            <span>Cancelar</span>
                          </button>
                        </>
                      )}

                      {githubViewingFile && (
                        <>
                          <button
                            onClick={() => {
                              navigator.clipboard.writeText(githubViewingFile.content);
                              setStatusMessage(`Copiado ${githubViewingFile.path} al portapapeles`);
                            }}
                            className="p-1 hover:bg-[#3c3c3c] text-gray-300 hover:text-white rounded transition cursor-pointer"
                            title="Copiar código"
                          >
                            <Copy size={13} />
                          </button>
                          <button
                            onClick={() => {
                              const blob = new Blob([githubViewingFile.content], { type: "text/plain;charset=utf-8" });
                              const url = URL.createObjectURL(blob);
                              const a = document.createElement("a");
                              a.href = url;
                              a.download = githubViewingFile.path.split("/").pop() || "file.txt";
                              a.click();
                              setStatusMessage(`Descargado ${githubViewingFile.path}`);
                            }}
                            className="p-1 hover:bg-[#3c3c3c] text-gray-300 hover:text-white rounded transition cursor-pointer"
                            title="Descargar archivo"
                          >
                            <Download size={13} />
                          </button>
                        </>
                      )}
                    </div>
                  </div>

                  {/* 3.2 VS Code Breadcrumbs Bar */}
                  <div className="bg-[#1e1e1e] border-b border-[#2b2b2b] px-4 py-1 flex items-center gap-1.5 text-xs text-[#969696] font-mono shrink-0 select-none">
                    {breadcrumbs.map((b, i) => (
                      <React.Fragment key={b.path + i}>
                        {i > 0 && <span className="text-[#5a5a5a]">›</span>}
                        {b.isFolder ? (
                          <button
                            onClick={() => {
                              setGithubCurrentDir(b.path);
                              setGithubViewingFile(null);
                            }}
                            className="hover:text-white flex items-center gap-1 cursor-pointer transition"
                          >
                            <Folder size={12} className="text-[#dcb67a]" />
                            <span>{b.label}</span>
                          </button>
                        ) : (
                          <span className="text-white flex items-center gap-1 font-semibold">
                            {getGitHubFileIcon(b.label)}
                            <span>{b.label}</span>
                          </span>
                        )}
                      </React.Fragment>
                    ))}
                  </div>

                  {/* Docker Image Quick Selector Banner if Dockerfile is open */}
                  {githubViewingFile && githubViewingFile.path.endsWith("Dockerfile") && (
                    <div className="bg-[#182332] border-b border-[#2b2b2b] px-4 py-1.5 flex items-center justify-between flex-wrap gap-2 text-xs">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sky-400 font-bold font-mono flex items-center gap-1.5">
                          🐳 Imagen Base:
                        </span>
                        {[
                          { label: "Python 3.11-slim", tag: "python:3.11-slim" },
                          { label: "Python 3.12-slim", tag: "python:3.12-slim" },
                          { label: "Python 3.10-slim", tag: "python:3.10-slim" },
                          { label: "Python 3.11 Full", tag: "python:3.11" },
                          { label: "CUDA 12.1", tag: "nvidia/cuda:12.1.0-runtime-ubuntu22.04" },
                          { label: "FastAPI Prod", tag: "tiangolo/uvicorn-gunicorn-fastapi:python3.11-slim" },
                        ].map((preset) => {
                          const active = (isEditingFile ? editingFileContent : githubViewingFile.content).includes(preset.tag);
                          return (
                            <button
                              key={preset.tag}
                              onClick={() => handleSelectDockerBaseImage(preset.tag)}
                              className={`px-2 py-0.5 rounded text-[11px] font-mono transition cursor-pointer border ${
                                active
                                  ? "bg-sky-500/20 text-sky-300 border-sky-500/60 font-bold"
                                  : "bg-[#252526] text-gray-300 border-[#3c3c3c] hover:bg-[#3c3c3c] hover:text-white"
                              }`}
                            >
                              {preset.label}
                            </button>
                          );
                        })}
                      </div>
                      <div className="flex items-center gap-1">
                        <input
                          type="text"
                          placeholder="Personalizada (ej: repo:tag)..."
                          value={customDockerImage}
                          onChange={(e) => setCustomDockerImage(e.target.value)}
                          className="bg-[#1e1e1e] border border-[#3c3c3c] rounded px-2 py-0.5 text-[11px] font-mono text-gray-200 focus:outline-none focus:border-sky-400 w-44"
                        />
                        <button
                          onClick={() => {
                            if (customDockerImage.trim()) {
                              handleSelectDockerBaseImage(customDockerImage.trim());
                              setCustomDockerImage("");
                            }
                          }}
                          disabled={!customDockerImage.trim()}
                          className="px-2 py-0.5 bg-sky-600 hover:bg-sky-500 disabled:opacity-40 text-white font-bold rounded text-[11px] transition cursor-pointer"
                        >
                          Aplicar
                        </button>
                      </div>
                    </div>
                  )}

                  {/* 3.3 Main Editor Content Viewport */}
                  <div className="flex-1 flex overflow-hidden relative">
                    {githubViewingFile ? (
                      /* --- A: FILE VIEW (De forma natural en editor de código) --- */
                      readmePreviewMode && (githubViewingFile.path === "README.md" || githubViewingFile.path.endsWith("/README.md")) ? (
                        /* Markdown Preview inside file tab */
                        <div className="flex-1 overflow-y-auto p-6 bg-[#1e1e1e] custom-modal-scrollbar">
                          <div className="w-full max-w-7xl mx-auto px-2 sm:px-6">
                            <div className="bg-[#252526] border border-[#3c3c3c] rounded-t-xl px-4 py-2.5 flex items-center justify-between text-xs">
                              <span className="font-bold text-sky-400 flex items-center gap-2">
                                <BookOpen size={14} />
                                <span>Preview of {githubViewingFile.path}</span>
                              </span>
                              <button
                                onClick={() => setReadmePreviewMode(false)}
                                className="text-xs text-sky-400 hover:underline cursor-pointer flex items-center gap-1"
                              >
                                <Code size={12} />
                                <span>Back to code editor</span>
                              </button>
                            </div>
                            <div className="bg-[#1e1e1e] border border-[#3c3c3c] border-t-0 rounded-b-xl p-8 shadow-2xl text-gray-200">
                              <div
                                className="markdown-body"
                                dangerouslySetInnerHTML={{ __html: renderMarkdown(githubViewingFile.content) }}
                              />
                            </div>
                          </div>
                        </div>
                      ) : isEditingFile ? (
                        /* Live Interactive Code Editor with Prism highlighting */
                        <div className="flex-1 flex flex-col bg-[#1e1e1e] overflow-hidden relative">
                          <div className="flex-1 flex overflow-hidden relative">
                            {/* Line numbers gutter */}
                            <div
                              ref={editorLineNumbersRef}
                              className="editor-line-numbers border-r border-[#2b2b2b] py-4 px-3 text-right select-none font-mono text-xs overflow-hidden shrink-0"
                              style={{ backgroundColor: "#1e1e1e", color: "#858585" }}
                            >
                              {editingFileContent.split("\n").map((_, i) => (
                                <div key={i} style={{ height: "20px", lineHeight: "20px" }}>
                                  {i + 1}
                                </div>
                              ))}
                            </div>

                            {/* Live syntax-highlighted editor viewport */}
                            <div className="relative flex-1 h-full overflow-hidden live-editor-viewport">
                              <pre
                                ref={editorPreRef}
                                aria-hidden="true"
                                className="live-code-pre pointer-events-none"
                                dangerouslySetInnerHTML={{
                                  __html: highlightCode(
                                    editingFileContent.endsWith("\n") ? editingFileContent + " " : editingFileContent,
                                    githubViewingFile.path
                                  ),
                                }}
                              />
                              <textarea
                                ref={editorTextareaRef}
                                value={editingFileContent}
                                onChange={(e) => {
                                  setEditingFileContent(e.target.value);
                                  updateCursorPosition(e.target);
                                }}
                                onSelect={(e) => updateCursorPosition(e.currentTarget)}
                                onKeyUp={(e) => updateCursorPosition(e.currentTarget)}
                                onClick={(e) => updateCursorPosition(e.currentTarget)}
                                onKeyDown={handleEditorKeyDown}
                                onScroll={handleEditorScroll}
                                spellCheck={false}
                                autoFocus
                                placeholder="Escribe o edita el código aquí..."
                                className="live-code-textarea"
                              />
                            </div>
                          </div>
                        </div>
                      ) : (
                        /* Natural Code Viewer (Read mode with line numbers gutter) */
                        <div className="flex-1 flex flex-col bg-[#1e1e1e] overflow-hidden">
                          {/* Banner for protected README.md */}
                          {(githubViewingFile.path === "README.md" || githubViewingFile.path.endsWith("/README.md")) && (
                            <div className="bg-[#2a1c0d] border-b border-amber-800/60 px-4 py-2 text-xs flex items-center justify-between text-amber-300">
                              <div className="flex items-center gap-2">
                                <span>🔒</span>
                                <span className="font-semibold">
                                  Archivo protegido: Derechos reservados a favor de wisrovi (wisrovi.dev) y WPipe Studio.
                                </span>
                              </div>
                              <button
                                onClick={() => setReadmePreviewMode(true)}
                                className="px-2.5 py-0.5 bg-amber-600 hover:bg-amber-500 text-black font-bold rounded text-xs transition cursor-pointer flex items-center gap-1"
                              >
                                <Eye size={12} />
                                <span>Ver Renderizado Bonito</span>
                              </button>
                            </div>
                          )}

                          <div
                            onDoubleClick={
                              githubViewingFile.path === "README.md" || githubViewingFile.path.endsWith("/README.md")
                                ? undefined
                                : handleStartEditingFile
                            }
                            title={
                              githubViewingFile.path === "README.md" || githubViewingFile.path.endsWith("/README.md")
                                ? "Archivo protegido (Derechos de autor & Autoría wisrovi)"
                                : "Doble clic para editar este archivo en el editor de código"
                            }
                            className="flex-1 flex overflow-auto font-mono text-xs custom-modal-scrollbar select-text bg-[#1e1e1e]"
                          >
                            {/* Line numbers gutter */}
                            <div className="bg-[#1e1e1e] border-r border-[#2b2b2b] py-4 px-3 text-right text-[#858585] select-none font-mono text-xs shrink-0">
                              {githubViewingFile.content.split("\n").map((_, i) => (
                                <div key={i} style={{ height: "20px", lineHeight: "20px" }}>
                                  {i + 1}
                                </div>
                              ))}
                            </div>
                            {/* Highlighted code */}
                            <pre
                              className="p-4 text-gray-200 whitespace-pre flex-1 overflow-visible font-mono text-xs"
                              style={{
                                fontFamily:
                                  'Consolas, "Fira Code", Menlo, Monaco, "Courier New", monospace',
                                lineHeight: "20px",
                                margin: 0,
                              }}
                              dangerouslySetInnerHTML={{
                                __html: highlightCode(githubViewingFile.content, githubViewingFile.path),
                              }}
                            />
                          </div>
                        </div>
                      )
                    ) : (
                      /* --- B: FOLDER VIEW (Al cargar la carpeta o seleccionarla) --- */
                      currentReadme ? (
                        /* Folder with README.md: RENDERIZA DE FORMA BONITA */
                        <div className="flex-1 overflow-y-auto p-6 bg-[#1e1e1e] custom-modal-scrollbar">
                          <div className="w-full max-w-7xl mx-auto px-2 sm:px-6">
                            {/* Banner header above rendered README */}
                            <div className="bg-[#252526] border border-[#3c3c3c] rounded-t-xl px-4 py-3 flex items-center justify-between flex-wrap gap-2 text-xs">
                              <div className="flex items-center gap-2">
                                <span className="text-sky-400 font-bold flex items-center gap-1.5 font-mono">
                                  <BookOpen size={15} />
                                  <span>README.md</span>
                                </span>
                                <span className="text-gray-400 text-[11px]">
                                  — Vista Previa Renderizada Oficial (Directorio: {githubCurrentDir || "/"})
                                </span>
                              </div>
                              <div className="flex items-center gap-2">
                                <button
                                  onClick={() => openFileInTab(currentReadme)}
                                  className="px-3 py-1 bg-[#0e639c] hover:bg-[#1177bb] text-white rounded text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer shadow"
                                  title="Abrir este README.md en el editor de código tradicional"
                                >
                                  <Edit3 size={13} />
                                  <span>Ver Archivo en Editor</span>
                                </button>
                              </div>
                            </div>

                            {/* Rendered HTML Container via marked and styled GitHub-alert callouts */}
                            <div className="bg-[#1e1e1e] border border-[#3c3c3c] border-t-0 rounded-b-xl p-8 shadow-2xl text-gray-200">
                              <div
                                className="markdown-body"
                                dangerouslySetInnerHTML={{ __html: renderMarkdown(currentReadme.content) }}
                              />
                            </div>

                            {/* Files in this directory */}
                            <div className="mt-8 border border-[#3c3c3c] rounded-xl overflow-hidden bg-[#252526]">
                              <div className="px-4 py-2.5 bg-[#2d2d2d] border-b border-[#3c3c3c] text-xs font-semibold text-gray-300 flex items-center justify-between">
                                <span>Archivos en esta carpeta ({directoryItems.length})</span>
                                <span className="text-[11px] text-gray-400 font-mono">Haz clic para abrir en el editor</span>
                              </div>
                              <div className="divide-y divide-[#3c3c3c]">
                                {directoryItems.map((item) => (
                                  <div
                                    key={item.fullPath}
                                    onClick={() => {
                                      if (item.isFolder) {
                                        setGithubCurrentDir(item.fullPath);
                                        setGithubViewingFile(null);
                                      } else if (item.file) {
                                        openFileInTab(item.file);
                                      }
                                    }}
                                    className="px-4 py-2 hover:bg-[#2a2d2e] flex items-center justify-between text-xs cursor-pointer transition group"
                                  >
                                    <div className="flex items-center gap-2">
                                      {item.isFolder ? <Folder size={15} className="text-[#dcb67a]" /> : getGitHubFileIcon(item.name)}
                                      <span className="font-mono text-gray-200 group-hover:text-sky-400">{item.name}</span>
                                    </div>
                                    <span className="text-gray-500 font-mono text-[11px]">{item.description}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          </div>
                        </div>
                      ) : (
                        /* Folder WITHOUT README.md: Show Directory Table */
                        <div className="flex-1 overflow-y-auto p-6 bg-[#1e1e1e] custom-modal-scrollbar">
                          <div className="w-full max-w-7xl mx-auto px-2 sm:px-6 space-y-4">
                            <div className="bg-[#252526] border border-[#3c3c3c] rounded-t-xl p-4 flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <FolderOpen size={18} className="text-[#dcb67a]" />
                                <span className="font-bold text-gray-100 font-mono text-sm">
                                  {githubCurrentDir || projectName || "workspace"}
                                </span>
                              </div>
                              <span className="text-xs text-gray-400 font-mono">
                                {directoryItems.length} elementos
                              </span>
                            </div>

                            <div className="border border-[#3c3c3c] border-t-0 rounded-b-xl divide-y divide-[#3c3c3c] bg-[#1e1e1e] overflow-hidden">
                              {githubCurrentDir !== "" && (
                                <div
                                  onClick={() => {
                                    const parts = githubCurrentDir.split("/");
                                    parts.pop();
                                    setGithubCurrentDir(parts.join("/"));
                                  }}
                                  className="px-4 py-2 hover:bg-[#2a2d2e] flex items-center gap-2 text-xs font-mono text-sky-400 font-bold cursor-pointer transition select-none"
                                >
                                  <ArrowLeft size={13} />
                                  <span>.. (Volver a la carpeta superior)</span>
                                </div>
                              )}

                              {directoryItems.map((item) => (
                                <div
                                  key={item.fullPath}
                                  onClick={() => {
                                    if (item.isFolder) {
                                      setGithubCurrentDir(item.fullPath);
                                    } else if (item.file) {
                                      openFileInTab(item.file);
                                    }
                                  }}
                                  className="px-4 py-2 hover:bg-[#2a2d2e] flex items-center justify-between text-xs transition cursor-pointer group"
                                >
                                  <div className="flex items-center gap-2 truncate">
                                    {item.isFolder ? <Folder size={15} className="text-[#dcb67a]" /> : getGitHubFileIcon(item.name)}
                                    <span className="font-mono text-gray-200 group-hover:text-sky-300">{item.name}</span>
                                  </div>
                                  <span className="text-gray-500 font-mono text-[11px]">{item.description}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      )
                    )}
                  </div>
            </div>
          );
        })()}

            {/* RETRACTABLE BOTTOM PANEL (Terminal, Output, Problems, Debugger, Tests, History) */}
            {bottomPanelOpen && (
              <div
                className={`w-full bg-[#181818] border-t border-[#2d2d2d] flex flex-col shrink-0 transition-all duration-150 z-20 ${
                  bottomPanelMaximized ? "h-[450px]" : "h-64"
                }`}
              >
                {/* Panel Header */}
                <div className="h-8 bg-[#252526] border-b border-[#2d2d2d] flex items-center justify-between px-3 select-none text-xs shrink-0">
                  <div className="flex items-center gap-4 h-full">
                    <button
                      onClick={() => setBottomPanelTab("terminal")}
                      className={`h-full flex items-center gap-1.5 border-b-2 font-mono text-[11px] font-semibold transition cursor-pointer ${
                        bottomPanelTab === "terminal"
                          ? "border-[#007acc] text-white"
                          : "border-transparent text-gray-400 hover:text-gray-200"
                      }`}
                    >
                      <Terminal size={12} className="text-emerald-400" />
                      <span>TERMINAL</span>
                    </button>

                    <button
                      onClick={() => setBottomPanelTab("output")}
                      className={`h-full flex items-center gap-1.5 border-b-2 font-mono text-[11px] font-semibold transition cursor-pointer ${
                        bottomPanelTab === "output"
                          ? "border-[#007acc] text-white"
                          : "border-transparent text-gray-400 hover:text-gray-200"
                      }`}
                    >
                      <FileText size={12} className="text-sky-400" />
                      <span>OUTPUT</span>
                    </button>

                    <button
                      onClick={() => setBottomPanelTab("problems")}
                      className={`h-full flex items-center gap-1.5 border-b-2 font-mono text-[11px] font-semibold transition cursor-pointer ${
                        bottomPanelTab === "problems"
                          ? "border-[#007acc] text-white"
                          : "border-transparent text-gray-400 hover:text-gray-200"
                      }`}
                    >
                      <AlertTriangle size={12} className="text-amber-400" />
                      <span>PROBLEMS</span>
                      <span className="text-[10px] bg-gray-800 text-gray-300 px-1 rounded">0</span>
                    </button>

                    <button
                      onClick={() => setBottomPanelTab("debug")}
                      className={`h-full flex items-center gap-1.5 border-b-2 font-mono text-[11px] font-semibold transition cursor-pointer ${
                        bottomPanelTab === "debug"
                          ? "border-[#007acc] text-white"
                          : "border-transparent text-gray-400 hover:text-gray-200"
                      }`}
                    >
                      <Bug size={12} className="text-rose-400" />
                      <span>DEBUGGER</span>
                      {breakpoints.size > 0 && (
                        <span className="text-[10px] bg-rose-950 text-rose-300 border border-rose-800 px-1 rounded">
                          {breakpoints.size} 🔴
                        </span>
                      )}
                    </button>

                    <button
                      onClick={() => setBottomPanelTab("tests")}
                      className={`h-full flex items-center gap-1.5 border-b-2 font-mono text-[11px] font-semibold transition cursor-pointer ${
                        bottomPanelTab === "tests"
                          ? "border-[#007acc] text-white"
                          : "border-transparent text-gray-400 hover:text-gray-200"
                      }`}
                    >
                      <FlaskConical size={12} className="text-purple-400" />
                      <span>TESTS</span>
                      {testRunData && (
                        <span
                          className={`text-[10px] px-1 rounded ${
                            testRunData.exit_code === 0
                              ? "bg-emerald-950 text-emerald-300 border border-emerald-800"
                              : "bg-rose-950 text-rose-300 border border-rose-800"
                          }`}
                        >
                          {testRunData.exit_code === 0 ? "PASSED" : "FAILED"}
                        </span>
                      )}
                    </button>

                    <button
                      onClick={() => {
                        setBottomPanelTab("history");
                        if (activeProjectId) loadSimulationHistory(activeProjectId);
                      }}
                      className={`h-full flex items-center gap-1.5 border-b-2 font-mono text-[11px] font-semibold transition cursor-pointer ${
                        bottomPanelTab === "history"
                          ? "border-[#007acc] text-white"
                          : "border-transparent text-gray-400 hover:text-gray-200"
                      }`}
                    >
                      <History size={12} className="text-teal-400" />
                      <span>HISTORY</span>
                      <span className="text-[10px] bg-teal-950/70 text-teal-300 border border-teal-800 px-1 rounded">
                        {simulationHistory.length}
                      </span>
                    </button>
                  </div>

                  {/* Header Actions */}
                  <div className="flex items-center gap-1 text-gray-400">
                    <button
                      onClick={() => setBottomPanelMaximized(!bottomPanelMaximized)}
                      className="p-1 hover:bg-[#333333] hover:text-white rounded cursor-pointer"
                      title={bottomPanelMaximized ? "Restaurar tamaño" : "Maximizar panel"}
                    >
                      {bottomPanelMaximized ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
                    </button>
                    <button
                      onClick={() => setBottomPanelOpen(false)}
                      className="p-1 hover:bg-[#333333] hover:text-white rounded cursor-pointer"
                      title="Cerrar panel (Ctrl+`)"
                    >
                      <X size={14} />
                    </button>
                  </div>
                </div>

                {/* Panel Content */}
                <div className="flex-1 overflow-hidden bg-[#181818] p-2 flex flex-col font-mono text-xs">
                  {/* TAB 1: TERMINAL */}
                  {bottomPanelTab === "terminal" && (
                    <div className="flex-1 flex flex-col overflow-hidden">
                      {/* Presets Bar */}
                      <div className="flex items-center gap-2 pb-2 mb-2 border-b border-[#2b2b2b] shrink-0 text-[11px]">
                        <span className="text-gray-500 font-semibold">Presets:</span>
                        <button
                          onClick={() => {
                            setTerminalInput("ls -la");
                            handleExecuteTerminal("ls -la");
                          }}
                          className="px-2 py-0.5 rounded bg-[#252526] hover:bg-[#333333] text-gray-300 border border-[#333] cursor-pointer"
                        >
                          ls -la
                        </button>
                        <button
                          onClick={() => {
                            setTerminalInput("pytest tests/");
                            handleExecuteTerminal("pytest tests/");
                          }}
                          className="px-2 py-0.5 rounded bg-[#252526] hover:bg-[#333333] text-purple-300 border border-[#333] cursor-pointer"
                        >
                          pytest tests/
                        </button>
                        <button
                          onClick={() => {
                            setTerminalInput("cat .env");
                            handleExecuteTerminal("cat .env");
                          }}
                          className="px-2 py-0.5 rounded bg-[#252526] hover:bg-[#333333] text-emerald-300 border border-[#333] cursor-pointer"
                        >
                          cat .env
                        </button>
                        <button
                          onClick={() => {
                            setTerminalInput("python -V");
                            handleExecuteTerminal("python -V");
                          }}
                          className="px-2 py-0.5 rounded bg-[#252526] hover:bg-[#333333] text-sky-300 border border-[#333] cursor-pointer"
                        >
                          python -V
                        </button>
                        <button
                          onClick={() => setTerminalHistory([])}
                          className="ml-auto text-gray-500 hover:text-gray-300 cursor-pointer"
                          title="Limpiar terminal"
                        >
                          Limpiar
                        </button>
                      </div>

                      {/* Terminal History */}
                      <div className="flex-1 overflow-y-auto space-y-2 pr-1 custom-modal-scrollbar">
                        {terminalHistory.map((item, idx) => (
                          <div key={idx} className="space-y-1">
                            <div className="flex items-center gap-1.5 text-gray-300">
                              <span className="text-emerald-400 font-bold">wpipe@{projectName || "workspace"}</span>
                              <span className="text-gray-500">:</span>
                              <span className="text-sky-400 font-bold">~</span>
                              <span className="text-gray-400">$</span>
                              <span className="text-white font-semibold">{item.command}</span>
                            </div>
                            {item.stdout && (
                              <pre className="text-gray-300 whitespace-pre-wrap pl-3 border-l-2 border-emerald-500/40 text-[11px] leading-relaxed">
                                {item.stdout}
                              </pre>
                            )}
                            {item.stderr && (
                              <pre className="text-rose-400 whitespace-pre-wrap pl-3 border-l-2 border-rose-500/40 text-[11px] leading-relaxed">
                                {item.stderr}
                              </pre>
                            )}
                          </div>
                        ))}
                      </div>

                      {/* Terminal Input Box */}
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          handleExecuteTerminal();
                        }}
                        className="mt-2 pt-2 border-t border-[#2b2b2b] flex items-center gap-1.5 shrink-0"
                      >
                        <span className="text-emerald-400 font-bold">wpipe@{projectName || "workspace"}</span>
                        <span className="text-gray-500">:</span>
                        <span className="text-sky-400 font-bold">~</span>
                        <span className="text-gray-400">$</span>
                        <input
                          type="text"
                          value={terminalInput}
                          onChange={(e) => setTerminalInput(e.target.value)}
                          placeholder={isExecutingTerminal ? "Ejecutando..." : "Escribe un comando bash (ls, pytest, python...)"}
                          disabled={isExecutingTerminal}
                          className="flex-1 bg-transparent text-gray-100 font-mono text-xs focus:outline-none placeholder-gray-600"
                        />
                        {isExecutingTerminal && (
                          <RefreshCw size={13} className="text-sky-400 animate-spin" />
                        )}
                      </form>
                    </div>
                  )}

                  {/* TAB 2: SALIDA / LOGS */}
                  {bottomPanelTab === "output" && (
                    <div className="flex-1 flex flex-col overflow-hidden">
                      <div className="flex items-center justify-between pb-1.5 mb-1.5 border-b border-[#2b2b2b] text-[11px] text-gray-400 shrink-0">
                        <span>Registro de Salida del Motor WPipe ({simLogs.length} entradas)</span>
                        <button
                          onClick={() => setSimLogs([])}
                          className="hover:text-white cursor-pointer"
                        >
                          Limpiar Logs
                        </button>
                      </div>
                      <div className="flex-1 overflow-y-auto space-y-1 custom-modal-scrollbar">
                        {simLogs.length === 0 ? (
                          <div className="text-gray-600 italic">No hay registros de salida recientes. Inicia una simulación para ver logs.</div>
                        ) : (
                          simLogs.map((log, idx) => (
                            <div key={idx} className="flex items-start gap-2 text-[11px]">
                              <span className="text-gray-500 select-none">{log.time}</span>
                              <span
                                className={`px-1 py-0.2 rounded text-[10px] font-bold select-none ${
                                  log.level === "ERROR"
                                    ? "bg-rose-950 text-rose-300"
                                    : log.level === "WARN"
                                    ? "bg-amber-950 text-amber-300"
                                    : "bg-sky-950 text-sky-300"
                                }`}
                              >
                                [{log.level}]
                              </span>
                              <span className="text-gray-300 font-mono flex-1">{log.msg}</span>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  )}

                  {/* TAB 3: PROBLEMAS */}
                  {bottomPanelTab === "problems" && (
                    <div className="flex-1 overflow-y-auto space-y-2 p-2">
                      <div className="flex items-center gap-2 text-emerald-400 font-semibold">
                        <CheckCircle size={15} />
                        <span>No se han detectado problemas en el espacio de trabajo.</span>
                      </div>
                      <p className="text-gray-500 text-xs">
                        El linter de sintaxis AST y los validadores de WPipe confirman que el DAG y los tipos coinciden con las especificaciones.
                      </p>
                    </div>
                  )}

                  {/* TAB 4: DEPURACIÓN / BREAKPOINTS */}
                  {bottomPanelTab === "debug" && (
                    <div className="flex-1 flex overflow-hidden gap-4">
                      {/* Left: Breakpoints List */}
                      <div className="w-1/3 border-r border-[#2b2b2b] pr-3 flex flex-col">
                        <div className="flex items-center justify-between pb-1.5 mb-2 border-b border-[#2b2b2b] font-bold text-gray-300">
                          <span>Puntos de Interrupción ({breakpoints.size})</span>
                          {breakpoints.size > 0 && (
                            <button
                              onClick={() => {
                                globalBreakpoints.clear();
                                setBreakpoints(new Set());
                                updateBreakpointVisuals();
                              }}
                              className="text-gray-500 hover:text-rose-400 text-[10px] cursor-pointer"
                            >
                              Limpiar todos
                            </button>
                          )}
                        </div>
                        <div className="flex-1 overflow-y-auto space-y-1">
                          {breakpoints.size === 0 ? (
                            <div className="text-gray-600 italic text-[11px]">
                              Haz clic en un bloque y activa el punto de interrupción en el Inspector o pulsa F9.
                            </div>
                          ) : (
                            Array.from(breakpoints).map((bp) => (
                              <div
                                key={bp}
                                className="flex items-center justify-between p-1.5 rounded bg-[#252526] hover:bg-[#2d2d2d] text-gray-200 text-[11px]"
                              >
                                <div className="flex items-center gap-1.5 truncate">
                                  <span className="text-rose-500">🔴</span>
                                  <span className="truncate">{bp}</span>
                                </div>
                                <button
                                  onClick={() => handleToggleBreakpoint(bp, bp)}
                                  className="text-gray-500 hover:text-white"
                                >
                                  <X size={12} />
                                </button>
                              </div>
                            ))
                          )}
                        </div>
                      </div>

                      {/* Right: State & Actions */}
                      <div className="flex-1 flex flex-col">
                        <div className="flex items-center justify-between pb-2 mb-2 border-b border-[#2b2b2b]">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-gray-300">Estado:</span>
                            {isPausedAtBreakpoint ? (
                              <span className="px-2 py-0.5 rounded bg-amber-950 text-amber-300 border border-amber-800 text-[11px] font-bold animate-pulse">
                                ⏸️ Pausado en: {pausedStepName}
                              </span>
                            ) : isSimulating ? (
                              <span className="px-2 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-800 text-[11px] font-bold">
                                ▶️ Ejecutando
                              </span>
                            ) : (
                              <span className="text-gray-500 text-[11px]">En espera (Inactivo)</span>
                            )}
                          </div>

                          {/* Debug Toolbar */}
                          <div className="flex items-center gap-1.5">
                            {isPausedAtBreakpoint && (
                              <button
                                onClick={handleResumeSimulation}
                                className="px-2 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-[11px] flex items-center gap-1 cursor-pointer"
                                title="Continuar ejecución (F5)"
                              >
                                <Play size={11} className="fill-current" />
                                <span>Continuar (F5)</span>
                              </button>
                            )}
                            {isSimulating && (
                              <button
                                onClick={handleStopSimulation}
                                className="px-2 py-1 rounded bg-rose-600 hover:bg-rose-500 text-white font-bold text-[11px] flex items-center gap-1 cursor-pointer"
                                title="Detener (🛑)"
                              >
                                <Square size={11} className="fill-current" />
                                <span>Detener</span>
                              </button>
                            )}
                          </div>
                        </div>

                        {/* Local Variables in Context */}
                        <div className="flex-1 overflow-y-auto space-y-1">
                          <span className="text-gray-400 font-bold text-[10px] uppercase">Variables Locales en Contexto</span>
                          <pre className="p-2 bg-[#252526] rounded border border-[#333] text-sky-300 text-[11px] overflow-x-auto whitespace-pre-wrap">
                            {JSON.stringify(debugContext && Object.keys(debugContext).length > 0 ? debugContext : simContext, null, 2)}
                          </pre>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* TAB 5: TESTS (Pytest Runner) */}
                  {bottomPanelTab === "tests" && (
                    <div className="flex-1 flex flex-col overflow-hidden">
                      <div className="flex items-center justify-between pb-2 mb-2 border-b border-[#2b2b2b] shrink-0">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={handleRunTests}
                            disabled={isTestingRunning}
                            className={`px-3 py-1 rounded font-bold text-[11px] flex items-center gap-1.5 transition cursor-pointer ${
                              isTestingRunning
                                ? "bg-gray-800 text-gray-500 cursor-not-allowed"
                                : "bg-purple-600 hover:bg-purple-500 text-white shadow"
                            }`}
                          >
                            <FlaskConical size={13} />
                            <span>{isTestingRunning ? "Ejecutando tests..." : "Ejecutar Tests (pytest tests/)"}</span>
                          </button>

                          {testRunData && (
                            <div className="flex items-center gap-2 text-xs">
                              <span className="text-emerald-400 font-semibold">✓ {testRunData.passed} pasados</span>
                              {testRunData.failed > 0 && (
                                <span className="text-rose-400 font-semibold">❌ {testRunData.failed} fallidos</span>
                              )}
                              <span className="text-gray-500 font-mono">({testRunData.duration_seconds}s)</span>
                            </div>
                          )}
                        </div>

                        {testRunData && (
                          <div className="text-[11px] text-gray-400 font-mono">
                            Código de Salida: {testRunData.exit_code}
                          </div>
                        )}
                      </div>

                      {/* Test Log Terminal */}
                      <div className="flex-1 overflow-y-auto bg-[#1e1e1e] p-2.5 rounded border border-[#2d2d2d] custom-modal-scrollbar">
                        {isTestingRunning ? (
                          <div className="flex items-center gap-2 text-sky-400 py-4 justify-center">
                            <RefreshCw size={15} className="animate-spin" />
                            <span>Ejecutando pytest en el espacio de trabajo del microservicio...</span>
                          </div>
                        ) : testRunData ? (
                          <pre className="text-gray-200 font-mono text-[11px] leading-relaxed whitespace-pre-wrap select-text">
                            {testRunData.output}
                          </pre>
                        ) : (
                          <div className="text-gray-500 italic text-center py-6">
                            Haz clic en "Ejecutar Tests" para validar la suite de pruebas unitarias pytest en tests/.
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* TAB 6: HISTORIAL DE SIMULACIONES */}
                  {bottomPanelTab === "history" && (
                    <div className="flex-1 flex flex-col overflow-hidden">
                      <div className="flex items-center justify-between pb-2 mb-2 border-b border-[#2b2b2b] shrink-0 text-xs">
                        <span className="text-gray-300 font-semibold">
                          Historial Persistido en PostgreSQL ({simulationHistory.length} ejecuciones)
                        </span>
                        <button
                          onClick={() => {
                            if (activeProjectId) loadSimulationHistory(activeProjectId);
                          }}
                          className="px-2 py-0.5 rounded bg-[#252526] hover:bg-[#333333] text-teal-300 border border-[#333] flex items-center gap-1 cursor-pointer"
                        >
                          <RefreshCw size={11} />
                          <span>Actualizar</span>
                        </button>
                      </div>

                      <div className="flex-1 overflow-y-auto space-y-1.5 custom-modal-scrollbar">
                        {simulationHistory.length === 0 ? (
                          <div className="text-gray-500 italic text-center py-6">
                            No hay simulaciones registradas en la base de datos para este microservicio.
                          </div>
                        ) : (
                          simulationHistory.map((run) => (
                            <div
                              key={run.id}
                              className="p-2 rounded bg-[#252526] hover:bg-[#2d2d2d] border border-[#333333] flex items-center justify-between text-xs transition"
                            >
                              <div className="flex items-center gap-3">
                                <span
                                  className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                    run.status === "success"
                                      ? "bg-emerald-950 text-emerald-300 border border-emerald-800"
                                      : "bg-rose-950 text-rose-300 border border-rose-800"
                                  }`}
                                >
                                  {run.status.toUpperCase()}
                                </span>
                                <span className="font-mono text-gray-200">Duración: {run.duration_ms}ms</span>
                                <span className="text-gray-500 text-[11px]">
                                  {new Date(run.created_at).toLocaleTimeString()} ({new Date(run.created_at).toLocaleDateString()})
                                </span>
                              </div>

                              <div className="flex items-center gap-2">
                                <button
                                  onClick={() => {
                                    setSelectedHistoricalRun(run);
                                    setShowDiffModal(true);
                                  }}
                                  className="px-2 py-1 rounded bg-[#333333] hover:bg-[#444444] text-sky-300 text-[11px] font-semibold flex items-center gap-1 cursor-pointer"
                                >
                                  <FileText size={11} />
                                  <span>Ver Detalle / Diff</span>
                                </button>
                                <button
                                  onClick={() => {
                                    if (run.input_payload) {
                                      setTestPayloadText(JSON.stringify(run.input_payload, null, 2));
                                      setStatusMessage("Contexto de entrada cargado desde el historial");
                                    }
                                  }}
                                  className="px-2 py-1 rounded bg-[#333333] hover:bg-[#444444] text-emerald-300 text-[11px] font-semibold cursor-pointer"
                                  title="Cargar payload de entrada al editor"
                                >
                                  Cargar Payload
                                </button>
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            </div>
          </div>

          {/* 4. GLOBAL VS CODE STATUS BAR (Bottom bar) */}
          <div className="h-6 bg-[#007acc] text-white flex items-center justify-between px-3 text-[11px] font-mono select-none shrink-0 z-20">
            <div className="flex items-center gap-3">
              <div
                onClick={() => setShowProjectsModal(true)}
                className="bg-[#005999] px-2 h-full flex items-center gap-1.5 font-bold cursor-pointer hover:bg-[#004d80]"
                title="Entorno Remoto WPipe Studio (Espacio de trabajo)"
              >
                <span>{"><"}</span>
                <span>WPipe Studio</span>
              </div>
              <div
                onClick={() => {
                  setActiveActivityTab("git");
                  setShowSidebar(true);
                }}
                className="flex items-center gap-1 cursor-pointer hover:opacity-80"
                title="Control de Código Fuente (Git)"
              >
                <GitBranch size={12} />
                <span>main{modifiedFiles.size > 0 ? "*" : ""}</span>
              </div>
              <div className="flex items-center gap-1.5 text-[10px] opacity-90">
                <span>0 ⚠️</span>
                <span>0 ❌</span>
              </div>
              {isPausedAtBreakpoint && (
                <div
                  onClick={handleResumeSimulation}
                  className="flex items-center gap-1 bg-amber-400 text-gray-950 px-2 py-0.5 rounded text-[10px] font-bold cursor-pointer hover:bg-amber-300 animate-pulse shadow"
                  title="Pausado en punto de interrupción. Haz clic o pulsa F5 para continuar"
                >
                  <Play size={10} className="fill-current" />
                  <span>PAUSADO: {pausedStepName} (F5)</span>
                </div>
              )}
              {turboMode && (
                <div
                  onClick={() => setTurboMode(false)}
                  className="flex items-center gap-1 bg-yellow-400/25 text-yellow-200 border border-yellow-400/60 px-1.5 py-0.5 rounded text-[10px] font-bold cursor-pointer hover:bg-yellow-400/40"
                  title="Modo Turbo Activo (Haz clic para desactivar)"
                >
                  <Sparkles size={10} className="text-yellow-300" />
                  <span>TURBO</span>
                </div>
              )}
            </div>

            <div className="flex items-center gap-3">
              <button
                onClick={() => setBottomPanelOpen(!bottomPanelOpen)}
                className="flex items-center gap-1 hover:bg-[#005999] px-1.5 py-0.5 rounded cursor-pointer"
                title="Toggle Bottom Panel (Ctrl+`)"
              >
                <Terminal size={12} />
                <span>Terminal</span>
              </button>
              <button
                onClick={() => setIsSplitView(!isSplitView)}
                className="flex items-center gap-1 hover:bg-[#005999] px-1.5 py-0.5 rounded cursor-pointer"
                title="Toggle Split View (Ctrl+\)"
              >
                <Split size={12} />
                <span>Split</span>
              </button>
              <button
                onClick={() => setShowEnvModal(true)}
                className="flex items-center gap-1 hover:bg-[#005999] px-1.5 py-0.5 rounded cursor-pointer"
                title="Environment Variables (.env)"
              >
                <Settings size={12} />
                <span>.env</span>
              </button>

              <div className="h-3 w-px bg-white/30 mx-1" />

              {activeMainTab === "python" && githubViewingFile ? (
                <>
                  <span>Ln {cursorPos.line}, Col {cursorPos.col}</span>
                  <span>Spaces: 4</span>
                  <span>UTF-8</span>
                  <span>LF</span>
                  <span className="font-semibold">{getLanguageFromPath(githubViewingFile.path)}</span>
                </>
              ) : activeMainTab === "python" ? (
                <>
                  <span>{getGitHubDirectoryItems(generatedFiles, githubCurrentDir).length} items</span>
                  <span>Active Workspace</span>
                </>
              ) : activeMainTab === "code" ? (
                <>
                  <span>Blockly Canvas</span>
                  <span>Dialect A</span>
                  <span>WPipe v2.5.13</span>
                </>
              ) : activeMainTab === "simulation" ? (
                <>
                  <span>{isSimulating ? "Simulation Running (⚡)" : "Simulation Idle (🏁)"}</span>
                  <span>{simSteps.length} Steps</span>
                </>
              ) : (
                <>
                  <span>Mermaid DAG Flowchart</span>
                  <span>Zoom: {Math.round(mermaidZoom * 100)}%</span>
                </>
              )}
              <span className="text-[10px] opacity-80 border-l border-white/20 pl-2 truncate max-w-[200px]">
                {statusMessage}
              </span>
            </div>
          </div>
      </div>


      {/* 4. MIS MICROSERVICIOS & PROYECTOS MODAL (Multi-Tenant Workspaces) */}
      {showProjectsModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 z-50 animate-in fade-in duration-200">
          <div className="bg-[#0b0f19] border border-sky-800/70 rounded-2xl max-w-4xl w-full p-6 space-y-4 shadow-2xl glass-panel max-h-[88vh] flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-gray-800/80 pb-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-sky-500 to-indigo-600 flex items-center justify-center text-lg shadow-md shadow-sky-500/20">
                  📁
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-lg font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-sky-400 via-indigo-300 to-purple-300 font-heading">
                      My Microservices & Projects
                    </h3>
                    {storageSource === "engine" ? (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-emerald-950/80 text-emerald-400 border border-emerald-700/60 flex items-center gap-1 shadow-sm">
                        <ShieldCheck size={11} /> 🟢 Local PC (~/.wpipe/workspaces)
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-indigo-950/80 text-indigo-300 border border-indigo-700/60 flex items-center gap-1 shadow-sm">
                        <ShieldCheck size={11} /> 🔒 Local Engine Required
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-400">
                    {storageSource === "engine" ? (
                      <>Your microservices stored on disk (<span className="font-mono text-[11px] text-sky-400/90">~/.wpipe/workspaces/</span>) by the local engine.</>
                    ) : (
                      <>Projects are created, stored and generated by the local wpipe-engine. Start the engine on this machine to manage microservices.</>
                    )}
                  </p>
                </div>
              </div>
              <button
                onClick={() => {
                  setShowProjectsModal(false);
                  setIsCreatingProject(false);
                }}
                className="text-gray-400 hover:text-white font-bold p-1 text-lg rounded-lg hover:bg-gray-800/60 transition cursor-pointer"
              >
                ✕
              </button>
            </div>

            {/* Actions Bar & Search */}
            <div className="flex items-center justify-between gap-3">
              <div className="flex-1 relative">
                <Search size={14} className="absolute left-3 top-3 text-gray-500" />
                <input
                  type="text"
                  placeholder="Buscar microservicio por nombre o descripción..."
                  value={projectSearch}
                  onChange={(e) => setProjectSearch(e.target.value)}
                  className="w-full bg-gray-950 border border-gray-800 rounded-xl py-2 pl-9 pr-3 text-xs text-gray-200 focus:outline-none focus:border-sky-500 transition"
                />
              </div>

              <div className="flex items-center gap-2">
                {/* Import .wpipe button */}
                <label className="px-3 py-2 bg-gray-900 hover:bg-gray-800 border border-gray-700/80 rounded-xl text-xs font-semibold text-gray-200 hover:text-white transition flex items-center gap-1.5 cursor-pointer shadow-sm">
                  <FolderOpen size={14} className="text-amber-400" />
                  <span>Importar .wpipe</span>
                  <input type="file" accept=".wpipe,.wpipe.json,.json" onChange={handleImportWpipeFile} className="hidden" />
                </label>

                {/* Export .wpipe button */}
                <button
                  onClick={handleExportWpipe}
                  className="px-3 py-2 bg-gray-900 hover:bg-gray-800 border border-gray-700/80 rounded-xl text-xs font-semibold text-gray-200 hover:text-white transition flex items-center gap-1.5 cursor-pointer shadow-sm"
                  title="Descargar este microservicio como archivo .wpipe"
                >
                  <Download size={14} className="text-sky-400" />
                  <span>Exportar .wpipe</span>
                </button>

                <button
                  onClick={() => setIsCreatingProject(!isCreatingProject)}
                  className={`px-3.5 py-2 rounded-xl text-xs font-bold transition flex items-center gap-1.5 shadow cursor-pointer ${
                    isCreatingProject
                      ? "bg-gray-800 hover:bg-gray-700 text-gray-200"
                      : "bg-gradient-to-r from-sky-600 to-indigo-600 hover:from-sky-500 hover:to-indigo-500 text-white shadow-sky-600/30"
                  }`}
                >
                  <FolderPlus size={14} />
                  <span>{isCreatingProject ? "Cancelar" : "Nuevo Microservicio"}</span>
                </button>
              </div>
            </div>

            {/* Inline New Project Form */}
            {isCreatingProject && (
              <form
                onSubmit={handleCreateProject}
                className="p-4 bg-gray-950/90 border border-sky-600/40 rounded-xl space-y-3 shadow-inner"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-extrabold text-sky-300 flex items-center gap-1.5">
                    <Plus size={13} /> Crear Nuevo Microservicio Aislado
                  </span>
                  <span className="text-[10px] text-gray-400">Se creará su propio directorio en tu workspace</span>
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="text-[10px] font-bold text-gray-400 block mb-1">Nombre del Microservicio *</label>
                    <input
                      type="text"
                      required
                      placeholder="ej: image_yolo_service"
                      value={newProjectName}
                      onChange={(e) => setNewProjectName(e.target.value.replace(/[^a-zA-Z0-9_-]/g, "_"))}
                      className="w-full bg-gray-900 border border-gray-700 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-sky-500 font-mono"
                    />
                  </div>

                  <div>
                    <label className="text-[10px] font-bold text-gray-400 block mb-1">Descripción</label>
                    <input
                      type="text"
                      placeholder="Detección de objetos con pipeline modular"
                      value={newProjectDesc}
                      onChange={(e) => setNewProjectDesc(e.target.value)}
                      className="w-full bg-gray-900 border border-gray-700 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-sky-500"
                    />
                  </div>

                  <div>
                    <label className="text-[10px] font-bold text-gray-400 block mb-1">Imagen Docker Base</label>
                    <input
                      type="text"
                      placeholder="python:3.11-slim"
                      value={newProjectDockerImage}
                      onChange={(e) => setNewProjectDockerImage(e.target.value)}
                      className="w-full bg-gray-900 border border-gray-700 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-sky-500 font-mono"
                    />
                  </div>
                </div>

                <div className="flex justify-end gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => setIsCreatingProject(false)}
                    className="px-3 py-1 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg text-xs font-semibold"
                  >
                    Descartar
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-1 bg-sky-600 hover:bg-sky-500 text-white rounded-lg text-xs font-bold shadow-md shadow-sky-600/30 cursor-pointer"
                  >
                    Crear y Cargar en Lienzo
                  </button>
                </div>
              </form>
            )}

            {/* Microservices Grid */}
            <div className="flex-1 overflow-y-auto pr-1 space-y-2.5 max-h-[50vh]">
              {userProjects.filter((p) => {
                if (!projectSearch.trim()) return true;
                const q = projectSearch.toLowerCase();
                return p.name.toLowerCase().includes(q) || (p.description || "").toLowerCase().includes(q);
              }).length === 0 ? (
                <div className="py-12 text-center text-gray-500 space-y-2">
                  <FolderOpen size={36} className="mx-auto opacity-40 text-sky-400" />
                  <p className="text-xs font-semibold text-gray-400">
                    {projectSearch.trim() ? "No se encontraron microservicios con ese filtro." : "Aún no tienes microservicios guardados en tu espacio."}
                  </p>
                  <p className="text-[11px] text-gray-500">
                    Haz clic en "Nuevo Microservicio" o guarda el pipeline actual usando el botón Guardar del encabezado.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  {userProjects
                    .filter((p) => {
                      if (!projectSearch.trim()) return true;
                      const q = projectSearch.toLowerCase();
                      return p.name.toLowerCase().includes(q) || (p.description || "").toLowerCase().includes(q);
                    })
                    .map((project) => {
                      const isActive = activeProjectId === project.id;
                      return (
                        <div
                          key={project.id}
                          className={`p-4 rounded-xl border transition flex flex-col justify-between group ${
                            isActive
                              ? "bg-gradient-to-br from-sky-950/70 via-gray-900/90 to-indigo-950/60 border-sky-500/80 shadow-lg shadow-sky-950/40"
                              : "bg-gray-950/70 border-gray-800/80 hover:border-gray-700"
                          }`}
                        >
                          <div>
                            <div className="flex items-center justify-between mb-1.5">
                              <span className="text-xs font-bold text-gray-100 flex items-center gap-1.5 truncate">
                                <span>⚙️</span>
                                <span className="font-mono">{project.name}</span>
                              </span>
                              {isActive && (
                                <span className="text-[9px] px-2 py-0.5 rounded font-mono font-bold bg-sky-500/20 text-sky-300 border border-sky-500/40 animate-pulse">
                                  ACTIVO EN LIENZO
                                </span>
                              )}
                            </div>
                            <p className="text-[11px] text-gray-400 line-clamp-2 mb-2">
                              {project.description || "Microservicio modular generado con WPipe Studio."}
                            </p>
                            <div className="flex items-center gap-2 text-[10px] text-gray-400 font-mono">
                              <span className="bg-gray-900 px-2 py-0.5 rounded border border-gray-800 text-sky-400">
                                🐳 {project.docker_image || "python:3.11-slim"}
                              </span>
                              <span className="bg-gray-900 px-2 py-0.5 rounded border border-gray-800 text-purple-400">
                                🧩 {project.node_count || 0} bloques
                              </span>
                            </div>
                          </div>

                          <div className="mt-3 pt-2.5 border-t border-gray-800/70 flex items-center justify-between gap-1">
                            <span className="text-[9px] text-gray-500 font-mono flex items-center gap-1">
                              <Clock size={10} /> {new Date(project.updated_at).toLocaleDateString()}
                            </span>

                            <div className="flex items-center gap-1">
                              <button
                                onClick={() => handleOpenProject(project.id)}
                                className={`px-2.5 py-1 rounded text-[11px] font-bold transition flex items-center gap-1 cursor-pointer ${
                                  isActive
                                    ? "bg-sky-500/20 text-sky-300 border border-sky-500/40 hover:bg-sky-500/30"
                                    : "bg-sky-600 hover:bg-sky-500 text-white shadow-sm"
                                }`}
                                title="Cargar este microservicio en el lienzo y visor de código"
                              >
                                <Play size={11} />
                                <span>{isActive ? "Recargar" : "Abrir"}</span>
                              </button>

                              <button
                                onClick={() => handleDuplicateProject(project.id)}
                                className="px-2 py-1 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded text-[11px] font-medium transition cursor-pointer"
                                title="Clonar este microservicio en uno nuevo"
                              >
                                <Copy size={11} />
                              </button>

                              <button
                                onClick={() => handleDeleteProject(project.id, project.name)}
                                className="px-2 py-1 bg-gray-800 hover:bg-rose-950 text-gray-400 hover:text-rose-300 rounded text-[11px] font-medium transition cursor-pointer"
                                title="Eliminar permanentemente este microservicio"
                              >
                                <Trash2 size={11} />
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                </div>
              )}
            </div>

            {/* Footer Isolation Explainer */}
            <div className="pt-2 border-t border-gray-800/80 text-[11px] text-gray-400 flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <ShieldCheck size={14} className="text-emerald-400" />
                <span>Cada proyecto reside en su directorio físico aislado. Ningún archivo se cruza con otros microservicios.</span>
              </span>
              <span className="text-[10px] text-gray-500 font-mono">
                {userProjects.length} microservicio{userProjects.length === 1 ? "" : "s"} registrado{userProjects.length === 1 ? "" : "s"}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* 5. NATURAL LOGIN / REGISTRATION MODAL */}
      {showAuthModal && (
        <div className="fixed inset-0 z-[9999] bg-black/80 backdrop-blur-md flex flex-col items-center justify-center p-4 select-none animate-in fade-in duration-200 overflow-y-auto">
          {/* Subtle glowing backdrops */}
          <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[550px] h-[550px] bg-sky-500/10 rounded-full blur-3xl pointer-events-none" />
          <div className="absolute bottom-1/4 right-1/4 w-[450px] h-[450px] bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />

          <div className="w-full max-w-md bg-[#0b0f19]/95 border border-sky-800/70 rounded-2xl p-7 shadow-2xl backdrop-blur-xl relative z-10 flex flex-col space-y-4 my-auto">
            {/* Close Button */}
            <button
              type="button"
              onClick={() => {
                setShowAuthModal(false);
                setAuthError(null);
              }}
              className="absolute top-4 right-4 text-gray-400 hover:text-white font-bold p-1.5 text-sm rounded-lg hover:bg-gray-800/80 transition cursor-pointer"
              title="Cerrar modal"
            >
              ✕
            </button>

            {/* Brand Header */}
            <div className="text-center space-y-1.5">
              <div className="w-14 h-14 mx-auto rounded-2xl bg-gradient-to-tr from-sky-500 via-indigo-600 to-purple-600 flex items-center justify-center font-black text-white text-2xl shadow-xl shadow-sky-500/25 mb-2">
                W
              </div>
              <h2 className="text-2xl font-black text-transparent bg-clip-text bg-gradient-to-r from-sky-300 via-indigo-200 to-purple-300 font-heading tracking-tight">
                WPipe Studio
              </h2>
              <p className="text-xs text-gray-400">
                Orquestación Visual de Microservicios Python
              </p>
            </div>

            {/* Auth Mode Tabs */}
            <div className="grid grid-cols-2 p-1 bg-gray-950 rounded-xl border border-gray-800 text-xs font-bold">
              <button
                type="button"
                onClick={() => {
                  setAuthMode("login");
                  setAuthError(null);
                }}
                className={`py-2 rounded-lg transition cursor-pointer ${
                  authMode === "login"
                    ? "bg-sky-600 text-white shadow-md shadow-sky-600/30"
                    : "text-gray-400 hover:text-gray-200"
                }`}
              >
                Iniciar Sesión
              </button>
              <button
                type="button"
                onClick={() => {
                  setAuthMode("register");
                  setAuthError(null);
                }}
                className={`py-2 rounded-lg transition cursor-pointer ${
                  authMode === "register"
                    ? "bg-sky-600 text-white shadow-md shadow-sky-600/30"
                    : "text-gray-400 hover:text-gray-200"
                }`}
              >
                Crear Cuenta
              </button>
            </div>

            {/* Error Banner */}
            {authError && (
              <div className="p-3 rounded-xl bg-rose-950/70 border border-rose-600/60 text-rose-300 text-xs flex items-center gap-2 animate-in fade-in">
                <AlertTriangle size={15} className="shrink-0 text-rose-400" />
                <span className="flex-1">{authError}</span>
              </div>
            )}

            {/* Iniciar Sesión Form */}
            {authMode === "login" && (
              <form onSubmit={(e) => handleNaturalLogin(e)} className="space-y-3">
                <div>
                  <label className="text-[11px] font-bold text-gray-300 block mb-1">
                    Usuario
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="ej: william.rodriguez"
                    value={loginUsername}
                    onChange={(e) => setLoginUsername(e.target.value)}
                    className="w-full bg-gray-950 border border-gray-800 focus:border-sky-500 rounded-xl px-3 py-2 text-xs text-white focus:outline-none transition font-mono"
                  />
                </div>

                <div>
                  <label className="text-[11px] font-bold text-gray-300 block mb-1">
                    Contraseña
                  </label>
                  <input
                    type="password"
                    required
                    placeholder="••••••••"
                    value={loginPassword}
                    onChange={(e) => setLoginPassword(e.target.value)}
                    className="w-full bg-gray-950 border border-gray-800 focus:border-sky-500 rounded-xl px-3 py-2 text-xs text-white focus:outline-none transition"
                  />
                </div>

                <button
                  type="submit"
                  disabled={authLoading}
                  className="w-full py-2.5 bg-gradient-to-r from-sky-600 to-indigo-600 hover:from-sky-500 hover:to-indigo-500 text-white rounded-xl text-xs font-bold transition shadow-lg shadow-sky-600/30 flex items-center justify-center gap-2 cursor-pointer mt-1 disabled:opacity-50"
                >
                  {authLoading ? (
                    <RefreshCw size={14} className="animate-spin" />
                  ) : (
                    <User size={14} />
                  )}
                  <span>{authLoading ? "Autenticando..." : "Iniciar Sesión"}</span>
                </button>


              </form>
            )}

            {/* Crear Cuenta Form */}
            {authMode === "register" && (
              <form onSubmit={handleNaturalRegister} className="space-y-2.5">
                <div>
                  <label className="text-[11px] font-bold text-gray-300 block mb-1">
                    Nombre Completo *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="ej: Elena Vance"
                    value={registerName}
                    onChange={(e) => setRegisterName(e.target.value)}
                    className="w-full bg-gray-950 border border-gray-800 focus:border-sky-500 rounded-xl px-3 py-2 text-xs text-white focus:outline-none transition"
                  />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[11px] font-bold text-gray-300 block mb-1">
                      Usuario *
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="elena.vance"
                      value={registerUsername}
                      onChange={(e) => setRegisterUsername(e.target.value)}
                      className="w-full bg-gray-950 border border-gray-800 focus:border-sky-500 rounded-xl px-3 py-2 text-xs text-white focus:outline-none transition font-mono"
                    />
                  </div>

                  <div>
                    <label className="text-[11px] font-bold text-gray-300 block mb-1">
                      Contraseña *
                    </label>
                    <input
                      type="password"
                      required
                      placeholder="••••••••"
                      value={registerPassword}
                      onChange={(e) => setRegisterPassword(e.target.value)}
                      className="w-full bg-gray-950 border border-gray-800 focus:border-sky-500 rounded-xl px-3 py-2 text-xs text-white focus:outline-none transition"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-[11px] font-bold text-gray-300 block mb-1">
                    Rol o Cargo
                  </label>
                  <input
                    type="text"
                    placeholder="ML Ops Engineer"
                    value={registerRole}
                    onChange={(e) => setRegisterRole(e.target.value)}
                    className="w-full bg-gray-950 border border-gray-800 focus:border-sky-500 rounded-xl px-3 py-2 text-xs text-white focus:outline-none transition"
                  />
                </div>

                <button
                  type="submit"
                  disabled={authLoading}
                  className="w-full py-2.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white rounded-xl text-xs font-bold transition shadow-lg shadow-emerald-600/30 flex items-center justify-center gap-2 cursor-pointer mt-1 disabled:opacity-50"
                >
                  {authLoading ? (
                    <RefreshCw size={14} className="animate-spin" />
                  ) : (
                    <Plus size={14} />
                  )}
                  <span>{authLoading ? "Creando cuenta..." : "Crear Cuenta y Entrar"}</span>
                </button>
              </form>
            )}

            {/* Persistence Footer */}
            <div className="text-[10px] text-gray-500 font-mono text-center pt-2 border-t border-gray-800/80">
              🔒 Workspace Aislado: ./media/workspaces/{currentUser ? (currentUser as any).id : "usuario"} • Docker Compose
            </div>
          </div>
        </div>
      )}

      {/* 4.5 WORK PLAN & ARCHITECTURE SPECIFICATION MODAL */}
      {showWorkPlanModal && (
        <div className="fixed inset-0 bg-black/85 backdrop-blur-md flex items-center justify-center p-4 z-50">
          <div className="bg-[#0b0f19] border border-blue-800/80 rounded-2xl max-w-4xl w-full p-6 space-y-4 shadow-2xl glass-panel max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between border-b border-gray-800 pb-3">
              <div className="flex items-center gap-2.5">
                <FileText size={20} className="text-blue-400" />
                <div>
                  <h3 className="text-base font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-indigo-300 font-heading">
                    Plan de Ejecución y Arquitectura — {projectName}
                  </h3>
                  <p className="text-xs text-gray-400">
                    Especificación jerárquica de la máquina de estados según el diseño del lienzo visual.
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    const mdPlan = getWorkPlanFromBlocklyWorkspace(catalog, projectName || "main_pipeline");
                    navigator.clipboard.writeText(mdPlan);
                    setStatusMessage("Plan de trabajo copiado al portapapeles ✓");
                  }}
                  className="px-3 py-1 bg-gray-900 hover:bg-gray-800 border border-gray-700 text-gray-300 hover:text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer"
                >
                  <Copy size={12} />
                  <span>Copiar Markdown</span>
                </button>
                <button
                  onClick={() => {
                    const mdPlan = getWorkPlanFromBlocklyWorkspace(catalog, projectName || "main_pipeline");
                    const mdBlob = new Blob([mdPlan], { type: "text/markdown;charset=utf-8" });
                    const mdUrl = URL.createObjectURL(mdBlob);
                    const a = document.createElement("a");
                    a.href = mdUrl;
                    a.download = `${projectName}_work_plan.md`;
                    a.click();
                    setStatusMessage("Plan de trabajo (.md) descargado ✓");
                  }}
                  className="px-3 py-1 bg-emerald-950 hover:bg-emerald-900 border border-emerald-800 text-emerald-300 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer"
                >
                  <Download size={12} />
                  <span>Descargar .md</span>
                </button>
                <button
                  onClick={() => setShowWorkPlanModal(false)}
                  className="text-gray-400 hover:text-white font-bold p-1 text-lg ml-2 cursor-pointer"
                >
                  ✕
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto pr-2 space-y-4 text-xs text-gray-200">
              <div
                className="prose prose-invert max-w-none space-y-3 leading-relaxed"
                dangerouslySetInnerHTML={{
                  __html: renderMarkdown(
                    getWorkPlanFromBlocklyWorkspace(catalog, projectName || "main_pipeline")
                  ),
                }}
              />
            </div>
          </div>
        </div>
      )}

      {/* 5. FAQ / ARCHITECTURE GUIDE MODAL */}
      {showFaqModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 z-50">
          <div className="bg-[#0f172a] border border-purple-800/80 rounded-2xl max-w-2xl w-full p-6 space-y-4 shadow-2xl glass-panel max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between border-b border-gray-800 pb-3">
              <div>
                <h3 className="text-lg font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-indigo-300 font-heading">
                  ❓ Guía de Arquitectura & FAQ
                </h3>
                <p className="text-xs text-gray-400">Detalles sobre Scratux, Intermediate Representation y Sandbox de WPipe Studio.</p>
              </div>
              <button onClick={() => setShowFaqModal(false)} className="text-gray-400 hover:text-white font-bold p-1 text-lg">
                ✕
              </button>
            </div>

            <input
              type="text"
              placeholder="Buscar respuestas..."
              value={faqSearch}
              onChange={(e) => setFaqSearch(e.target.value)}
              className="w-full bg-gray-950 border border-gray-800 rounded-xl p-2.5 text-xs text-gray-200 focus:outline-none"
            />

            <div className="flex-1 overflow-y-auto space-y-2.5 pr-1">
              {faqList
                .filter((f) => !faqSearch || f.question.toLowerCase().includes(faqSearch.toLowerCase()) || f.answer.toLowerCase().includes(faqSearch.toLowerCase()))
                .map((faq) => {
                  const isOpen = openFaqId === faq.id;
                  return (
                    <div key={faq.id} className="border border-gray-800 rounded-xl bg-gray-950/60 overflow-hidden">
                      <button
                        onClick={() => setOpenFaqId(isOpen ? null : faq.id)}
                        className="w-full p-3.5 text-left bg-gray-900/80 hover:bg-gray-800/80 flex items-center justify-between"
                      >
                        <span className="text-xs font-bold text-gray-200 flex items-center gap-2">
                          <span className="text-[10px] px-2 py-0.5 rounded bg-purple-950 text-purple-300 border border-purple-800 font-mono">
                            {faq.category}
                          </span>
                          <span>{faq.question}</span>
                        </span>
                        <span className="text-xs text-gray-400">{isOpen ? "▲" : "▼"}</span>
                      </button>
                      {isOpen && (
                        <div className="p-3.5 text-xs text-gray-300 bg-gray-950/90 border-t border-gray-800 leading-relaxed">
                          {faq.answer}
                        </div>
                      )}
                    </div>
                  );
                })}
            </div>
          </div>
        </div>
      )}

      {/* 6. AI STEP CREATOR MODAL */}
      {showAiModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-[#0f172a] border border-purple-800 rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl">
            <h3 className="text-base font-bold text-purple-300 flex items-center gap-2 font-heading">
              <Sparkles size={16} />
              <span>Crear Paso con IA (Dialecto A)</span>
            </h3>
            <p className="text-xs text-gray-400">
              Describe lo que debe hacer tu paso. El backend generará automáticamente su código y su DTO Pydantic tipado.
            </p>

            <div className="space-y-3">
              <div>
                <label className="block text-xs text-gray-300 mb-1">Nombre del Paso</label>
                <input
                  type="text"
                  placeholder="ej. ExtractMetadataStep"
                  className="w-full bg-gray-900 border border-gray-700 rounded-lg p-2 text-xs text-gray-100"
                  value={aiStepName}
                  onChange={(e) => setAiStepName(e.target.value)}
                />
              </div>

              <div>
                <label className="block text-xs text-gray-300 mb-1">Prompt / Descripción</label>
                <textarea
                  rows={4}
                  placeholder="Describe la lógica, entradas requeridas y salidas que debe generar este paso..."
                  className="w-full bg-gray-900 border border-gray-700 rounded-lg p-2 text-xs text-gray-100 resize-none"
                  value={aiPrompt}
                  onChange={(e) => setAiPrompt(e.target.value)}
                ></textarea>
              </div>
            </div>

            <div className="flex justify-end space-x-2 pt-2">
              <button
                onClick={() => setShowAiModal(false)}
                className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg text-xs"
              >
                Cancelar
              </button>
              <button
                onClick={handleCreateAiStep}
                className="px-4 py-1.5 bg-purple-600 hover:bg-purple-500 text-white rounded-lg text-xs font-bold shadow"
              >
                Crear Paso
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 7. VERIFICATION RESULTS MODAL */}
      {verificationModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-[#0f172a] border border-gray-800 rounded-2xl max-w-lg w-full p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-gray-800 pb-3">
              <h3 className="text-base font-bold text-gray-100 flex items-center gap-2 font-heading">
                <CheckCircle size={18} className="text-emerald-400" />
                <span>Resultados de Verificación de Calidad</span>
              </h3>
              <button onClick={() => setVerificationModal(null)} className="text-gray-400 hover:text-white font-bold p-1">
                ✕
              </button>
            </div>

            <div className="space-y-3 text-sm">
              <div className="flex items-center justify-between bg-gray-950 p-3 rounded-lg border border-gray-800">
                <span className="font-semibold text-gray-300">Estado General</span>
                <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-950 text-emerald-400 border border-emerald-800">
                  {verificationModal.status}
                </span>
              </div>

              <div className="space-y-1.5 pt-1">
                {Object.entries(verificationModal.gates || {}).map(([gate, pass]) => (
                  <div key={gate} className="flex items-center justify-between text-xs py-1 border-b border-gray-800/50">
                    <span className="font-mono text-gray-400">{gate}</span>
                    <span className="text-emerald-400 font-semibold font-mono">PASS ✓</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="pt-2 flex justify-end">
              <button
                onClick={() => setVerificationModal(null)}
                className="px-4 py-2 bg-sky-600 hover:bg-sky-500 text-white rounded-lg text-xs font-bold transition shadow"
              >
                Cerrar Resultados
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 8. STEP CONFIGURATION MODAL */}
      {configModalBlock && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 z-50">
          <div className="bg-[#0f172a] border border-amber-500/80 rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl glass-panel">
            <div className="flex items-center justify-between border-b border-gray-800 pb-3">
              <div>
                <h3 className="text-base font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-amber-300 to-amber-100 font-heading">
                  ⚙️ Configurar Parámetros del Paso
                </h3>
                <p className="text-xs text-amber-400 font-mono">
                  {configModalBlock.getFieldValue("STEP_NAME")} ({configModalBlock.getFieldValue("NAMESPACE")})
                </p>
              </div>
              <button onClick={() => setConfigModalBlock(null)} className="text-gray-400 hover:text-white font-bold p-1 text-lg">
                ✕
              </button>
            </div>

            <div className="space-y-3 text-xs">
              {dynamicFields.map((field) => (
                <div key={field.name}>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-gray-300 font-semibold font-mono">{field.name}</label>
                    <span className="text-[10px] text-sky-400 font-mono">({field.annotation || "str"})</span>
                  </div>
                  <input
                    type="text"
                    className="w-full bg-gray-900 border border-gray-700 rounded-lg p-2 text-gray-100 font-mono focus:border-amber-500 focus:outline-none"
                    placeholder={`Por defecto: ${field.default ?? ""}`}
                    value={blockParamValues[field.name] ?? ""}
                    onChange={(e) =>
                      setBlockParamValues({
                        ...blockParamValues,
                        [field.name]: e.target.value,
                      })
                    }
                  />
                </div>
              ))}
            </div>

            <div className="flex justify-between items-center pt-3 border-t border-gray-800">
              <button
                onClick={() => {
                  const autoVals: Record<string, any> = {};
                  dynamicFields.forEach((f) => {
                    autoVals[f.name] = f.default ?? "auto_val";
                  });
                  setBlockParamValues(autoVals);
                  setStatusMessage("Valores auto-completados por el agente IA");
                }}
                className="px-3 py-1.5 bg-purple-950 hover:bg-purple-900 text-purple-300 rounded-lg text-xs font-semibold border border-purple-700"
              >
                🤖 Auto-Fill con IA
              </button>

              <div className="flex space-x-2">
                <button
                  onClick={() => setConfigModalBlock(null)}
                  className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg text-xs font-semibold"
                >
                  Cancelar
                </button>
                <button
                  onClick={() => {
                    if (configModalBlock && configModalBlock.getField("CONFIG_ICON")) {
                      configModalBlock.setFieldValue(
                        "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='%2310b981'><path d='M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z'/></svg>",
                        "CONFIG_ICON"
                      );
                    }
                    setConfigModalBlock(null);
                    setStatusMessage(`Guardados parámetros para ${configModalBlock.getFieldValue("STEP_NAME")}`);
                  }}
                  className="px-4 py-1.5 bg-amber-600 hover:bg-amber-500 text-white rounded-lg text-xs font-bold shadow"
                >
                  Guardar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 9. HIDDEN USER FILE INPUT FOR PYTHON UPLOAD */}
      <input
        type="file"
        ref={userFileInputRef}
        accept=".py"
        className="hidden"
        onChange={handleUserFileSelected}
      />

      {/* 10. AI STEP CONFIGURATION MODAL */}
      {showAiConfigModal && targetAiBlock && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 z-50">
          <div className="bg-[#0f172a] border border-purple-500/80 rounded-2xl max-w-lg w-full p-6 space-y-4 shadow-2xl glass-panel">
            <div className="flex items-center justify-between border-b border-gray-800 pb-3">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-purple-600 flex items-center justify-center text-white text-base shadow">
                  ✨
                </div>
                <div>
                  <h3 className="text-base font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-purple-300 to-indigo-200 font-heading">
                    Configurar Paso con IA
                  </h3>
                  <p className="text-[11px] text-purple-400 font-mono">
                    Dialecto A: Generará @step, función y Context DTO tipado
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowAiConfigModal(false)}
                className="text-gray-400 hover:text-white font-bold p-1 text-lg"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="text-gray-300 font-semibold font-mono block mb-1">
                  Nombre del Estado / Función Python:
                </label>
                <input
                  type="text"
                  className="w-full bg-gray-900 border border-gray-700 rounded-lg p-2.5 text-gray-100 font-mono focus:border-purple-500 focus:outline-none"
                  placeholder="ej: analyze_sales_summary"
                  value={aiStepNameInput}
                  onChange={(e) => setAiStepNameInput(e.target.value.replace(/[^a-zA-Z0-9_]/g, "_"))}
                />
              </div>

              <div>
                <label className="text-gray-300 font-semibold font-mono block mb-1">
                  Descripción del comportamiento (Prompt para la IA):
                </label>
                <textarea
                  rows={4}
                  className="w-full bg-gray-900 border border-gray-700 rounded-lg p-2.5 text-gray-100 focus:border-purple-500 focus:outline-none resize-none leading-relaxed"
                  placeholder="Describe en lenguaje natural qué debe hacer este paso, qué variables lee y qué variables escribe en el pipeline..."
                  value={aiPromptInput}
                  onChange={(e) => setAiPromptInput(e.target.value)}
                />
              </div>
            </div>

            <div className="flex justify-end space-x-2 pt-3 border-t border-gray-800">
              <button
                onClick={() => setShowAiConfigModal(false)}
                className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg text-xs font-semibold"
              >
                Cancelar
              </button>
              <button
                onClick={() => {
                  if (targetAiBlock) {
                    targetAiBlock.setFieldValue(aiStepNameInput || "custom_ai_state", "STEP_NAME");
                    targetAiBlock.setFieldValue(aiPromptInput || "Paso generado con IA", "AI_PROMPT");
                    setStatusMessage(`Paso IA configurado: ${aiStepNameInput}`);
                  }
                  setShowAiConfigModal(false);
                }}
                className="px-5 py-2 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white rounded-lg text-xs font-bold shadow"
              >
                Guardar y Aplicar al Bloque
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ABOUT MODAL */}
      {showAboutModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-[10000] p-4 animate-in fade-in duration-150">
          <div className="bg-[#0f172a] border border-sky-500/50 rounded-2xl p-6 max-w-md w-full shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-gray-800">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-sky-500 to-indigo-600 flex items-center justify-center font-black text-white text-lg shadow-lg">
                  W
                </div>
                <div>
                  <h3 className="text-base font-extrabold text-white">WPipe Studio</h3>
                  <p className="text-[11px] text-sky-400 font-mono">wisrovi SUITE · v2.5.10</p>
                </div>
              </div>
              <button
                onClick={() => setShowAboutModal(false)}
                className="text-gray-400 hover:text-white p-1 rounded-lg hover:bg-gray-800 cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            <p className="text-xs text-gray-300 leading-relaxed">
              Plataforma visual de ingeniería de microservicios y orquestación modular de pipelines Python de alto rendimiento bajo contratos Dialecto A.
            </p>

            <div className="bg-gray-950/90 rounded-xl p-3 border border-gray-800 space-y-2 text-xs font-mono">
              <div className="flex items-center justify-between">
                <span className="text-gray-400">Autor Principal:</span>
                <span className="text-sky-300 font-semibold">William Rodriguez (wisrovi)</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-400">Sitio Web:</span>
                <a
                  href="https://wisrovi.dev"
                  target="_blank"
                  rel="noreferrer"
                  className="text-teal-400 hover:underline"
                >
                  wisrovi.dev
                </a>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-400">Motor Core:</span>
                <span className="text-emerald-400">WPipe v2.5.13</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-400">Catálogo de Pasos:</span>
                <span className="text-purple-400">196 Oficiales + Plugins</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-400">Persistencia:</span>
                <span className="text-amber-400">PostgreSQL 15 (wpostgresql)</span>
              </div>
            </div>

            <div className="pt-2 flex justify-end">
              <button
                onClick={() => setShowAboutModal(false)}
                className="px-4 py-1.5 bg-sky-600 hover:bg-sky-500 text-white rounded-lg text-xs font-bold transition cursor-pointer shadow"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 11. PALETTE HOVER TOOLTIP POPOVER */}
      {hoveredPaletteBlock && paletteTooltipPos && (
        <div
          style={{ top: paletteTooltipPos.top, left: paletteTooltipPos.left }}
          className="fixed z-50 w-96 p-4 rounded-2xl bg-gray-950/98 border border-sky-500/70 shadow-2xl backdrop-blur-xl pointer-events-none ring-1 ring-sky-500/30 text-gray-100 animate-in fade-in zoom-in-95 duration-150"
        >
          <div className="flex items-center justify-between mb-2.5 pb-2.5 border-b border-gray-800">
            <div className="flex items-center gap-2">
              <span className="text-xl drop-shadow">{hoveredPaletteBlock.icon}</span>
              <span className="font-extrabold text-sm text-white tracking-wide">
                {hoveredPaletteBlock.name}
              </span>
            </div>
            <span className="text-[10px] px-2.5 py-0.5 rounded-full font-bold uppercase tracking-wider bg-sky-950/80 text-sky-300 border border-sky-700/60">
              {hoveredPaletteBlock.badge}
            </span>
          </div>

          <p className="text-xs text-slate-200 leading-relaxed mb-3">
            {hoveredPaletteBlock.description}
          </p>

          <div className="space-y-2.5">
            <div>
              <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1 flex items-center gap-1">
                <span>⚙️</span> Parámetros / Propiedades:
              </div>
              <div className="text-xs text-amber-200 font-mono bg-gray-900/90 px-3 py-1.5 rounded-lg border border-gray-800 leading-snug">
                {hoveredPaletteBlock.params}
              </div>
            </div>

            <div>
              <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1 flex items-center gap-1">
                <span>🐍</span> Equivalente WPipe Python:
              </div>
              <pre className="text-xs text-emerald-300 font-mono bg-black/85 p-3 rounded-lg border border-gray-800 overflow-x-auto whitespace-pre-wrap leading-relaxed">
                {hoveredPaletteBlock.pythonSnippet}
              </pre>
            </div>
          </div>

          <div className="mt-3 pt-2 border-t border-gray-800/80 flex items-center justify-between text-xs text-sky-400 font-semibold">
            <span>👆 Haz clic para añadir al lienzo</span>
            <span className="text-gray-500 font-mono text-[11px]">WPipe OS</span>
          </div>
        </div>
      )}
      {/* 12. GLOBAL COMMAND PALETTE (Ctrl+Shift+P / Ctrl+P / F1) */}
      {commandPaletteOpen && (
        <div
          onClick={() => setCommandPaletteOpen(false)}
          className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-start justify-center pt-16 p-4 z-50 animate-in fade-in duration-100"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-xl bg-[#252526] border border-[#454545] rounded-xl shadow-2xl overflow-hidden flex flex-col font-sans"
          >
            {/* Input Header */}
            <div className="p-2 border-b border-[#3c3c3c] flex items-center gap-2 bg-[#1e1e1e]">
              <Search size={16} className="text-[#007acc] shrink-0" />
              <input
                autoFocus
                type="text"
                value={commandQuery}
                onChange={(e) => {
                  setCommandQuery(e.target.value);
                  setCommandSelectedIndex(0);
                }}
                onKeyDown={(e) => {
                  const filtered = [
                    { id: "run-sim", title: "Simulation: Start (🏁 F5)", category: "Pipeline", action: () => handleStartSimulation() },
                    { id: "stop-sim", title: "Simulación: Detener Ejecución (🛑)", category: "Pipeline", action: () => handleStopSimulation() },
                    { id: "toggle-split", title: "Ver: Alternar Vista Dividida Lienzo + Código (Ctrl+\\)", category: "View", action: () => setIsSplitView((prev) => !prev) },
                    { id: "toggle-terminal", title: "Terminal: Alternar Panel Inferior / Terminal (Ctrl+`)", category: "Terminal", action: () => setBottomPanelOpen((prev) => !prev) },
                    { id: "run-tests", title: "Tests: Ejecutar Suite Pytest (pytest tests/)", category: "Testing", action: () => { setBottomPanelOpen(true); setBottomPanelTab("tests"); handleRunTests(); } },
                    { id: "open-env", title: "Configuración: Variables de Entorno (.env)", category: "Config", action: () => setShowEnvModal(true) },
                    { id: "open-inspector", title: "Inspector: Alternar Inspector de Propiedades", category: "View", action: () => setInspectorOpen((prev) => !prev) },
                    { id: "open-history", title: "Historial: Ver Registro de Simulaciones (PostgreSQL)", category: "Database", action: () => { setBottomPanelOpen(true); setBottomPanelTab("history"); if (activeProjectId) loadSimulationHistory(activeProjectId); } },
                    { id: "sync-python", title: "Microservicio: Sincronizar Código Python desde Lienzo", category: "Codegen", action: () => handleSyncPythonCode() },
                    { id: "save-project", title: "Proyecto: Guardar Microservicio en Workspace", category: "File", action: () => handleSaveProject() },
                    { id: "export-zip", title: "Exportar: Descargar Paquete Microservicio ZIP", category: "Export", action: () => handleGenerateZip() },
                    { id: "open-flowchart", title: "Diagrama: Ver Flujo Mermaid Interactivo", category: "View", action: () => handleOpenFlowchart() },
                  ].filter(
                    (c) =>
                      c.title.toLowerCase().includes(commandQuery.toLowerCase()) ||
                      c.category.toLowerCase().includes(commandQuery.toLowerCase())
                  );

                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setCommandSelectedIndex((prev) => (prev + 1) % Math.max(1, filtered.length));
                  } else if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setCommandSelectedIndex((prev) => (prev - 1 + filtered.length) % Math.max(1, filtered.length));
                  } else if (e.key === "Enter") {
                    e.preventDefault();
                    if (filtered[commandSelectedIndex]) {
                      filtered[commandSelectedIndex].action();
                      setCommandPaletteOpen(false);
                    }
                  } else if (e.key === "Escape") {
                    setCommandPaletteOpen(false);
                  }
                }}
                placeholder="Escribe un comando para ejecutar (ej: simulación, terminal, tests, split, .env...)"
                className="flex-1 bg-transparent text-gray-100 text-xs font-mono focus:outline-none placeholder-gray-500"
              />
              <span className="text-[10px] text-gray-500 font-mono">ESC para salir</span>
            </div>

            {/* Commands List */}
            <div className="max-h-80 overflow-y-auto p-1 divide-y divide-[#2a2a2a] custom-modal-scrollbar">
              {(() => {
                const commands = [
                  { id: "run-sim", title: "Simulation: Start (🏁 F5)", category: "Pipeline", icon: <Play size={13} className="text-emerald-400" />, action: () => handleStartSimulation() },
                  { id: "stop-sim", title: "Simulación: Detener Ejecución (🛑)", category: "Pipeline", icon: <Square size={13} className="text-rose-400" />, action: () => handleStopSimulation() },
                  { id: "toggle-split", title: "Ver: Alternar Vista Dividida Lienzo + Código (Ctrl+\\)", category: "View", icon: <Split size={13} className="text-sky-400" />, action: () => setIsSplitView((prev) => !prev) },
                  { id: "toggle-terminal", title: "Terminal: Alternar Panel Inferior / Terminal (Ctrl+`)", category: "Terminal", icon: <Terminal size={13} className="text-emerald-400" />, action: () => setBottomPanelOpen((prev) => !prev) },
                  { id: "run-tests", title: "Tests: Ejecutar Suite Pytest (pytest tests/)", category: "Testing", icon: <FlaskConical size={13} className="text-purple-400" />, action: () => { setBottomPanelOpen(true); setBottomPanelTab("tests"); handleRunTests(); } },
                  { id: "open-env", title: "Configuración: Variables de Entorno (.env)", category: "Config", icon: <Settings size={13} className="text-emerald-400" />, action: () => setShowEnvModal(true) },
                  { id: "open-inspector", title: "Inspector: Alternar Inspector de Propiedades", category: "View", icon: <Sliders size={13} className="text-purple-400" />, action: () => setInspectorOpen((prev) => !prev) },
                  { id: "open-history", title: "Historial: Ver Registro de Simulaciones (PostgreSQL)", category: "Database", icon: <History size={13} className="text-teal-400" />, action: () => { setBottomPanelOpen(true); setBottomPanelTab("history"); if (activeProjectId) loadSimulationHistory(activeProjectId); } },
                  { id: "sync-python", title: "Microservicio: Sincronizar Código Python desde Lienzo", category: "Codegen", icon: <FileCode size={13} className="text-sky-400" />, action: () => handleSyncPythonCode() },
                  { id: "save-project", title: "Proyecto: Guardar Microservicio en Workspace", category: "File", icon: <Save size={13} className="text-emerald-400" />, action: () => handleSaveProject() },
                  { id: "export-zip", title: "Exportar: Descargar Paquete Microservicio ZIP", category: "Export", icon: <Download size={13} className="text-sky-400" />, action: () => handleGenerateZip() },
                  { id: "open-flowchart", title: "Diagrama: Ver Flujo Mermaid Interactivo", category: "View", icon: <GitMerge size={13} className="text-indigo-400" />, action: () => handleOpenFlowchart() },
                ].filter(
                  (c) =>
                    c.title.toLowerCase().includes(commandQuery.toLowerCase()) ||
                    c.category.toLowerCase().includes(commandQuery.toLowerCase())
                );

                if (commands.length === 0) {
                  return (
                    <div className="py-6 text-center text-xs text-gray-500 italic">
                      No se encontraron comandos coincidentes.
                    </div>
                  );
                }

                return commands.map((cmd, idx) => (
                  <div
                    key={cmd.id}
                    onClick={() => {
                      cmd.action();
                      setCommandPaletteOpen(false);
                    }}
                    onMouseEnter={() => setCommandSelectedIndex(idx)}
                    className={`px-3 py-2 flex items-center justify-between text-xs cursor-pointer rounded transition ${
                      commandSelectedIndex === idx
                        ? "bg-[#04395e] text-white"
                        : "text-gray-300 hover:bg-[#2a2d2e]"
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      {cmd.icon}
                      <span className="font-medium">{cmd.title}</span>
                    </div>
                    <span className="text-[10px] font-mono text-gray-400 bg-[#1e1e1e] px-1.5 py-0.5 rounded border border-[#333]">
                      {cmd.category}
                    </span>
                  </div>
                ));
              })()}
            </div>
          </div>
        </div>
      )}

      {/* 13. VISUAL ENVIRONMENT VARIABLES MANAGER MODAL (.env) */}
      {showEnvModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 z-50 animate-in fade-in duration-150">
          <div className="bg-[#1e1e1e] border border-[#007acc]/70 rounded-2xl max-w-2xl w-full p-5 space-y-4 shadow-2xl flex flex-col font-sans max-h-[85vh]">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-[#333333] pb-3 shrink-0">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-emerald-600/30 border border-emerald-500/50 flex items-center justify-center text-emerald-400">
                  <Settings size={18} />
                </div>
                <div>
                  <h3 className="text-base font-extrabold text-white">Variables de Entorno (.env)</h3>
                  <p className="text-[11px] text-gray-400">
                    Configura credenciales y parámetros de ejecución del microservicio activo ({projectName || "default"})
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowEnvModal(false)}
                className="p-1 hover:bg-[#333333] text-gray-400 hover:text-white rounded cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>

            {/* Presets Bar */}
            <div className="flex items-center gap-2 p-2 bg-[#252526] rounded-lg border border-[#333333] shrink-0 text-xs">
              <span className="text-gray-400 font-semibold text-[11px]">Presets Rápidos:</span>
              <button
                onClick={() => {
                  setEnvVars((prev) => [
                    ...prev,
                    { key: "POSTGRES_HOST", value: "postgres" },
                    { key: "POSTGRES_PORT", value: "5432" },
                    { key: "POSTGRES_USER", value: "wpipe_user" },
                    { key: "POSTGRES_PASSWORD", value: "wpipe_secret_2026", showSecret: false },
                    { key: "POSTGRES_DB", value: "wpipe_studio_db" },
                  ]);
                }}
                className="px-2 py-1 rounded bg-[#1e1e1e] hover:bg-[#333333] text-sky-400 border border-[#3c3c3c] text-[11px] cursor-pointer"
              >
                + PostgreSQL
              </button>
              <button
                onClick={() => {
                  setEnvVars((prev) => [
                    ...prev,
                    { key: "REDIS_HOST", value: "redis" },
                    { key: "REDIS_PORT", value: "6379" },
                  ]);
                }}
                className="px-2 py-1 rounded bg-[#1e1e1e] hover:bg-[#333333] text-rose-400 border border-[#3c3c3c] text-[11px] cursor-pointer"
              >
                + Redis
              </button>
              <button
                onClick={() => {
                  setEnvVars((prev) => [
                    ...prev,
                    { key: "KAFKA_BOOTSTRAP_SERVERS", value: "kafka:9092" },
                    { key: "KAFKA_GROUP_ID", value: "wpipe_consumers" },
                  ]);
                }}
                className="px-2 py-1 rounded bg-[#1e1e1e] hover:bg-[#333333] text-purple-400 border border-[#3c3c3c] text-[11px] cursor-pointer"
              >
                + Kafka
              </button>
            </div>

            {/* Variables Table */}
            <div className="flex-1 overflow-y-auto space-y-2 pr-1 custom-modal-scrollbar">
              {envVars.length === 0 ? (
                <div className="text-center py-8 text-gray-500 text-xs italic">
                  No hay variables de entorno configuradas aún. Añade una o usa un preset rápido.
                </div>
              ) : (
                envVars.map((item, idx) => (
                  <div key={idx} className="flex items-center gap-2 p-2 rounded bg-[#252526] border border-[#333333]">
                    <input
                      type="text"
                      value={item.key}
                      onChange={(e) => {
                        const newKey = e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, "_");
                        setEnvVars((prev) => prev.map((v, i) => (i === idx ? { ...v, key: newKey } : v)));
                      }}
                      placeholder="KEY_NAME"
                      className="w-1/3 px-2 py-1 bg-[#1e1e1e] border border-[#3c3c3c] rounded text-emerald-400 font-mono text-xs focus:outline-none focus:border-emerald-500"
                    />
                    <div className="flex-1 relative flex items-center">
                      <input
                        type={item.showSecret ? "text" : "password"}
                        value={item.value}
                        onChange={(e) => {
                          const val = e.target.value;
                          setEnvVars((prev) => prev.map((v, i) => (i === idx ? { ...v, value: val } : v)));
                        }}
                        placeholder="Valor secreto o configuración"
                        className="w-full px-2 py-1 bg-[#1e1e1e] border border-[#3c3c3c] rounded text-gray-200 font-mono text-xs focus:outline-none focus:border-sky-500 pr-7"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          setEnvVars((prev) =>
                            prev.map((v, i) => (i === idx ? { ...v, showSecret: !v.showSecret } : v))
                          );
                        }}
                        className="absolute right-1.5 text-gray-400 hover:text-white"
                        title={item.showSecret ? "Ocultar secreto" : "Mostrar secreto"}
                      >
                        {item.showSecret ? <EyeOff size={13} /> : <Eye size={13} />}
                      </button>
                    </div>
                    <button
                      onClick={() => setEnvVars((prev) => prev.filter((_, i) => i !== idx))}
                      className="p-1 hover:bg-[#333333] text-rose-400 hover:text-rose-300 rounded cursor-pointer"
                      title="Eliminar variable"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))
              )}
            </div>

            {/* Bottom Actions */}
            <div className="flex items-center justify-between border-t border-[#333333] pt-3 shrink-0">
              <button
                onClick={() => setEnvVars((prev) => [...prev, { key: "NEW_ENV_VAR", value: "", showSecret: true }])}
                className="px-3 py-1.5 rounded bg-[#252526] hover:bg-[#333333] text-gray-200 border border-[#3c3c3c] text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
              >
                <Plus size={13} className="text-emerald-400" />
                <span>Añadir Variable</span>
              </button>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowEnvModal(false)}
                  className="px-3 py-1.5 bg-[#252526] hover:bg-[#333333] text-gray-300 rounded text-xs font-semibold cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleSaveEnv}
                  disabled={isSavingEnv}
                  className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-xs font-bold shadow transition cursor-pointer flex items-center gap-1.5"
                >
                  {isSavingEnv ? <RefreshCw size={12} className="animate-spin" /> : <Save size={12} />}
                  <span>{isSavingEnv ? "Guardando..." : "Guardar .env"}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 14. SIMULATION CONTEXT DIFF MODAL */}
      {showDiffModal && selectedHistoricalRun && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 z-50 animate-in fade-in duration-150">
          <div className="bg-[#1e1e1e] border border-teal-500/70 rounded-2xl max-w-4xl w-full p-5 space-y-4 shadow-2xl flex flex-col font-sans max-h-[88vh]">
            <div className="flex items-center justify-between border-b border-[#333333] pb-3 shrink-0">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-teal-600/30 border border-teal-500/50 flex items-center justify-center text-teal-400">
                  <History size={18} />
                </div>
                <div>
                  <h3 className="text-base font-extrabold text-white">Detalle de Ejecución Histórica</h3>
                  <div className="flex items-center gap-2 text-[11px] text-gray-400 font-mono mt-0.5">
                    <span>ID: {selectedHistoricalRun.id?.slice(0, 8)}...</span>
                    <span>•</span>
                    <span className={selectedHistoricalRun.status === "success" ? "text-emerald-400 font-bold" : "text-rose-400 font-bold"}>
                      {selectedHistoricalRun.status?.toUpperCase()}
                    </span>
                    <span>•</span>
                    <span>{selectedHistoricalRun.duration_ms}ms</span>
                    <span>•</span>
                    <span>{new Date(selectedHistoricalRun.created_at).toLocaleString()}</span>
                  </div>
                </div>
              </div>
              <button
                onClick={() => setShowDiffModal(false)}
                className="p-1 hover:bg-[#333333] text-gray-400 hover:text-white rounded cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto space-y-4 pr-1 custom-modal-scrollbar text-xs">
              {/* Context Diff side-by-side */}
              <div>
                <span className="font-bold text-gray-300 uppercase tracking-wider text-[10px] block mb-1">
                  Comparación de Contexto: Payload Entrada vs Contexto Salida
                </span>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <span className="text-sky-400 font-mono text-[11px] font-semibold">📥 Entrada (Ingress Payload)</span>
                    <pre className="p-3 bg-[#252526] rounded-lg border border-[#333] text-sky-200 font-mono text-[11px] max-h-56 overflow-auto whitespace-pre-wrap leading-relaxed">
                      {JSON.stringify(selectedHistoricalRun.input_payload || {}, null, 2)}
                    </pre>
                  </div>
                  <div className="space-y-1">
                    <span className="text-emerald-400 font-mono text-[11px] font-semibold">📤 Salida (Egress Context)</span>
                    <pre className="p-3 bg-[#252526] rounded-lg border border-[#333] text-emerald-200 font-mono text-[11px] max-h-56 overflow-auto whitespace-pre-wrap leading-relaxed">
                      {JSON.stringify(selectedHistoricalRun.output_context || {}, null, 2)}
                    </pre>
                  </div>
                </div>
              </div>

              {/* Logs */}
              {selectedHistoricalRun.logs && (
                <div className="space-y-1">
                  <span className="font-bold text-gray-300 uppercase tracking-wider text-[10px] block">
                    Registro de Consola (Stdout Logs)
                  </span>
                  <pre className="p-3 bg-[#181818] rounded-lg border border-[#333] text-gray-300 font-mono text-[11px] max-h-48 overflow-auto whitespace-pre-wrap leading-relaxed">
                    {selectedHistoricalRun.logs}
                  </pre>
                </div>
              )}
            </div>

            <div className="flex justify-end pt-3 border-t border-[#333333] shrink-0">
              <button
                onClick={() => setShowDiffModal(false)}
                className="px-4 py-1.5 bg-[#252526] hover:bg-[#333333] text-gray-200 rounded text-xs font-semibold cursor-pointer"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 15. LOCAL ENGINE STATUS MODAL */}
      <ConnectEngineModal
        isOpen={showEngineModal}
        onClose={() => setShowEngineModal(false)}
        status={engineStatus}
        onRecheck={checkEngine}
      />

      {/* 16. DEDICATED PRO LICENSE & CAPABILITIES MODAL */}
      <ProLicenseModal
        isOpen={showProModal}
        onClose={() => setShowProModal(false)}
        status={engineStatus}
      />

      {/* 17. PLAN LIMIT / ENGINE REQUIRED NOTICE (display only; the engine is the enforcer) */}
      {limitNotice && (
        <div
          data-testid="limit-notice"
          className="fixed inset-0 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 z-[200]"
          onClick={() => setLimitNotice(null)}
        >
          <div
            className="bg-[#0b0f19] border border-amber-600/70 rounded-2xl max-w-md w-full p-5 space-y-3 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2">
              <span className="text-2xl">🔒</span>
              <h3 className="text-base font-extrabold text-amber-300">{limitNotice.title}</h3>
            </div>
            <p className="text-xs text-gray-300 leading-relaxed">{limitNotice.message}</p>
            <div className="flex flex-wrap gap-2 pt-1">
              {(limitNotice.needsEngine || !engineStatus.connected) && (
                <button
                  onClick={() => {
                    setLimitNotice(null);
                    setShowEngineModal(true);
                  }}
                  className="px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold cursor-pointer"
                >
                  Install / Connect wpipe-engine
                </button>
              )}
              <a
                href="https://wisrovi.lemonsqueezy.com/checkout/buy/b2c96716-71a7-4df5-9d58-1ea58e1a5d96"
                target="_blank"
                rel="noopener noreferrer"
                className="px-3 py-1.5 rounded-lg bg-gradient-to-r from-emerald-500 to-cyan-500 hover:from-emerald-400 hover:to-cyan-400 text-gray-950 text-xs font-bold transition shadow-sm flex items-center gap-1.5 cursor-pointer"
              >
                <span>👑</span>
                <span>Comprar Licencia Pro</span>
              </a>
              <a
                href="https://portal.wisrovi.dev"
                target="_blank"
                rel="noopener noreferrer"
                className="px-3 py-1.5 rounded-lg bg-[#1e293b] hover:bg-[#334155] border border-cyan-500/30 text-cyan-300 text-xs font-semibold transition flex items-center gap-1.5 cursor-pointer"
              >
                <span>🔑</span>
                <span>¿Ya compraste? Ir al Portal</span>
              </a>
              <button
                onClick={() => setLimitNotice(null)}
                className="px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-200 text-xs font-semibold cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
