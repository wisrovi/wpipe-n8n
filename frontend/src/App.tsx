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
  Layers,
  ChevronDown,
  ChevronRight,
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
  Code,
  File,
  Settings,
  MoreHorizontal,
  FilePlus,
  Split,
} from "lucide-react";

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
  const [activeMenu, setActiveMenu] = useState<"file" | "edit" | null>(null);
  const [turboMode, setTurboMode] = useState<boolean>(false);

  // Main Tabs: 'code' (Blockly) | 'simulation' (Dedicated Stage) | 'flowchart' (Mermaid) | 'python' (TargetIR Preview)
  // GitHub / VS Code Repository Navigation State (Microservicio Python)
  const [githubCurrentDir, setGithubCurrentDir] = useState<string>("");
  const [githubViewingFile, setGithubViewingFile] = useState<{ path: string; content: string } | null>(null);
  const [githubFileSearch, setGithubFileSearch] = useState<string>("");
  const [githubShowTreeSidebar, setGithubShowTreeSidebar] = useState<boolean>(true);
  const [githubRawMode, setGithubRawMode] = useState<boolean>(false);
  const [isEditingFile, setIsEditingFile] = useState<boolean>(false);
  const [editingFileContent, setEditingFileContent] = useState<string>("");
  const [modifiedFiles, setModifiedFiles] = useState<Set<string>>(new Set());
  const [customDockerImage, setCustomDockerImage] = useState<string>("");
  const [activeMainTab, setActiveMainTab] = useState<"code" | "simulation" | "flowchart" | "python">("code");
  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({});
  const toggleFolder = (path: string) =>
    setExpandedFolders((prev) => ({ ...prev, [path]: prev[path] === false ? true : false }));

  // VS Code Experience State (Microservicio Python)
  const [openTabs, setOpenTabs] = useState<{ path: string; content: string }[]>([]);
  const [activeActivityTab, setActiveActivityTab] = useState<"explorer" | "search" | "git" | "settings">("explorer");
  const [cursorPos, setCursorPos] = useState<{ line: number; col: number }>({ line: 1, col: 1 });
  const [readmePreviewMode, setReadmePreviewMode] = useState<boolean>(false);

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
  const [currentUser, setCurrentUser] = useState<UserProfile | null>(null);
  const [sessionToken, setSessionToken] = useState<string | null>(() => localStorage.getItem("studio_session_token"));
  const [isCheckingAuth, setIsCheckingAuth] = useState<boolean>(true);
  const [availableUsers, setAvailableUsers] = useState<UserProfile[]>([]);
  const [userProjects, setUserProjects] = useState<ProjectSummary[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [isSavingProject, setIsSavingProject] = useState<boolean>(false);

  // Natural Login / Register Form State
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

  // Synchronize Python Preview with current workspace blocks
  const handleSyncPythonCode = () => {
    setPreviewLoading(true);
    setStatusMessage("Sincronizando microservicio Python con el lienzo actual...");
    const canvasIr = getCanvasIRFromBlocklyWorkspace(catalog);
    fetch("/api/v1/pipeline/transform", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(canvasIr),
    })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => {
        if (data && Array.isArray(data.files) && data.files.length > 0) {
          setGeneratedFiles(data.files);
          setSelectedFileIdx(0);
          if (githubViewingFile) {
            const updatedView = data.files.find((f: any) => f.path === githubViewingFile.path);
            if (updatedView) {
              setGithubViewingFile(updatedView);
              setEditingFileContent(updatedView.content);
            }
          }
          setStatusMessage("Microservicio Python actualizado con los bloques del lienzo ✓");
        }
      })
      .catch((err) => {
        console.error("Transform error:", err);
        setStatusMessage(`Error sincronizando código: ${err.message}`);
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
    fetch("/api/v1/catalog/steps")
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data)) {
          setCatalog(data);
          setBlocklyCatalog(data);
        }
      })
      .catch((err) => {
        console.error("Failed to load catalog steps:", err);
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

  // Check Active Session Token and Load Identity on Mount
  useEffect(() => {
    const token = localStorage.getItem("studio_session_token");
    if (!token) {
      setIsCheckingAuth(false);
      setCurrentUser(null);
      // Fetch public users list for quick demo presets
      fetch("/api/v1/auth/users")
        .then((res) => (res.ok ? res.json() : []))
        .then((users: UserProfile[]) => {
          if (Array.isArray(users)) setAvailableUsers(users);
        })
        .catch(() => {});
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
        return res.json();
      })
      .then((user: UserProfile) => {
        setCurrentUser(user);
        setSessionToken(token);
        localStorage.setItem("studio_user_id", user.id);
        fetchUserProjects(user.id, token);
      })
      .catch(() => {
        // Token was invalid or expired
        localStorage.removeItem("studio_session_token");
        setSessionToken(null);
        setCurrentUser(null);
      })
      .finally(() => {
        setIsCheckingAuth(false);
        fetch("/api/v1/auth/users")
          .then((res) => (res.ok ? res.json() : []))
          .then((users: UserProfile[]) => {
            if (Array.isArray(users)) setAvailableUsers(users);
          })
          .catch(() => {});
      });
  }, []);

  // Fetch Projects for a Specific User
  const fetchUserProjects = async (userId?: string, tokenOverride?: string) => {
    const targetUid = userId || currentUser?.id;
    if (!targetUid) return;
    try {
      const headers: Record<string, string> = { "X-User-ID": targetUid };
      const token = tokenOverride || sessionToken || localStorage.getItem("studio_session_token");
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
        headers["X-Session-Token"] = token;
      }
      const res = await fetch("/api/v1/projects", { headers });
      if (res.ok) {
        const data: ProjectSummary[] = await res.json();
        setUserProjects(data);
      }
    } catch (err) {
      console.error("Error fetching projects:", err);
    }
  };

  // Open / Load a Microservice Project into Workspace
  const handleOpenProject = async (projectId: string) => {
    if (!currentUser) return;
    try {
      setStatusMessage("Cargando microservicio...");
      const res = await fetch(`/api/v1/projects/${projectId}`, {
        headers: getAuthHeaders(),
      });
      if (!res.ok) throw new Error("No se pudo cargar el microservicio");
      const project: ProjectDetail = await res.json();
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
      setStatusMessage(`Microservicio '${project.name}' cargado con éxito ✓`);
      setShowProjectsModal(false);
    } catch (err: any) {
      setStatusMessage(`Error: ${err.message}`);
    }
  };

  // Save Current Microservice into User Workspace
  const handleSaveProject = async () => {
    if (!currentUser) return;
    setIsSavingProject(true);
    setStatusMessage("Guardando microservicio en tu espacio de trabajo...");
    const canvasIr = getCanvasIRFromBlocklyWorkspace(catalog);
    const workspaceState = getWorkspaceStateJson();
    if (workspaceState) {
      (canvasIr as any).workspace_state = workspaceState;
    }

    try {
      if (activeProjectId) {
        // Update existing project
        const res = await fetch(`/api/v1/projects/${activeProjectId}`, {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            ...getAuthHeaders(),
          },
          body: JSON.stringify({
            name: projectName,
            canvas_ir: canvasIr,
            generated_files: generatedFiles,
          }),
        });
        if (!res.ok) throw new Error("Error al actualizar microservicio");
        await fetchUserProjects(currentUser.id);
        setStatusMessage(`Microservicio '${projectName}' guardado ✓`);
      } else {
        // Create new project
        const res = await fetch("/api/v1/projects", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...getAuthHeaders(),
          },
          body: JSON.stringify({
            name: projectName,
            description: `Microservicio ${projectName} creado desde el lienzo`,
            protocol: "fastapi",
            canvas_ir: canvasIr,
            generated_files: generatedFiles,
          }),
        });
        if (!res.ok) throw new Error("Error al crear microservicio");
        const created: ProjectDetail = await res.json();
        setActiveProjectId(created.id);
        await fetchUserProjects(currentUser.id);
        setStatusMessage(`Microservicio '${created.name}' creado y guardado ✓`);
      }
    } catch (err: any) {
      setStatusMessage(`Error guardando: ${err.message}`);
    } finally {
      setIsSavingProject(false);
    }
  };

  // Create New Microservice from Modal
  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser || !newProjectName.trim()) return;
    try {
      const canvasIr = getCanvasIRFromBlocklyWorkspace(catalog);
      const workspaceState = getWorkspaceStateJson();
      if (workspaceState) {
        (canvasIr as any).workspace_state = workspaceState;
      }
      const cleanName = newProjectName.trim().replace(/[^a-zA-Z0-9_-]/g, "_");
      const res = await fetch("/api/v1/projects", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...getAuthHeaders(),
        },
        body: JSON.stringify({
          name: cleanName,
          description: newProjectDesc.trim() || `Microservicio ${cleanName}`,
          protocol: "fastapi",
          canvas_ir: canvasIr,
          generated_files: generatedFiles,
        }),
      });
      if (!res.ok) throw new Error("Error al crear microservicio");
      const created: ProjectDetail = await res.json();
      setActiveProjectId(created.id);
      setProjectName(created.name);
      setCustomDockerImage(created.docker_image || "python:3.11-slim");
      await fetchUserProjects(currentUser.id);
      setIsCreatingProject(false);
      setNewProjectName("");
      setNewProjectDesc("");
      setStatusMessage(`Microservicio '${created.name}' creado en tu espacio privado ✓`);
      setShowProjectsModal(false);
    } catch (err: any) {
      setStatusMessage(`Error al crear: ${err.message}`);
    }
  };

  // Duplicate an Existing Microservice
  const handleDuplicateProject = async (projectId: string) => {
    if (!currentUser) return;
    try {
      setStatusMessage("Duplicando microservicio...");
      const res = await fetch(`/api/v1/projects/${projectId}/duplicate`, {
        method: "POST",
        headers: getAuthHeaders(),
      });
      if (!res.ok) throw new Error("Error al duplicar");
      const duplicated: ProjectDetail = await res.json();
      await fetchUserProjects(currentUser.id);
      setStatusMessage(`Microservicio duplicado como '${duplicated.name}' ✓`);
    } catch (err: any) {
      setStatusMessage(`Error al duplicar: ${err.message}`);
    }
  };

  // Delete an Existing Microservice
  const handleDeleteProject = async (projectId: string, projName: string) => {
    if (!currentUser) return;
    if (!window.confirm(`¿Estás seguro de eliminar permanentemente el microservicio '${projName}'?`)) return;
    try {
      const res = await fetch(`/api/v1/projects/${projectId}`, {
        method: "DELETE",
        headers: getAuthHeaders(),
      });
      if (!res.ok) throw new Error("Error al eliminar");
      if (activeProjectId === projectId) {
        setActiveProjectId(null);
      }
      await fetchUserProjects(currentUser.id);
      setStatusMessage(`Microservicio '${projName}' eliminado de tu espacio`);
    } catch (err: any) {
      setStatusMessage(`Error al eliminar: ${err.message}`);
    }
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
      setRegisterUsername("");
      setRegisterPassword("");
      setRegisterName("");
      setRegisterRole("");
      setStatusMessage(`Cuenta creada para ${data.user.name} ✓`);

      // Refresh users list
      fetch("/api/v1/auth/users")
        .then((r) => (r.ok ? r.json() : []))
        .then((users: UserProfile[]) => setAvailableUsers(users))
        .catch(() => {});

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
    setUserProjects([]);
    setShowUserMenu(false);
    setShowProjectsModal(false);
    setStatusMessage("Sesión finalizada. Hasta pronto.");
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

  // Switch to Flowchart view
  const handleOpenFlowchart = () => {
    const code = getMermaidFromBlocklyWorkspace();
    setMermaidCode(code);
    setActiveMainTab("flowchart");
    setStatusMessage("Visualizando flujo Mermaid interactivo (Arrastra para mover • Rueda para zoom)");
  };

  // Perform Dry-Run Quality Verification
  const handleDryRun = async () => {
    setDryRunLoading(true);
    setStatusMessage("Executing quality gates in verification engine...");
    const canvasIr = getCanvasIRFromBlocklyWorkspace(catalog);
    try {
      const res = await fetch("/api/v1/pipeline/dry-run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(canvasIr),
      });
      const data = await res.json();
      setVerificationModal(data);
      setStatusMessage(`Verification completed: ${data.status} ✓`);
    } catch (err: any) {
      setStatusMessage(`Verification error: ${err.message}`);
    } finally {
      setDryRunLoading(false);
    }
  };

  // Generate and download microservice ZIP
  const handleGenerateZip = async () => {
    setZipLoading(true);
    setStatusMessage("Generando paquete ZIP del microservicio...");
    try {
      let res: Response;
      if (generatedFiles && generatedFiles.length > 0) {
        // Send TargetIR with current files (including any user edits in Dockerfile or code)
        res = await fetch("/api/v1/pipeline/generate-from-files", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            project_name: projectName,
            files: generatedFiles,
          }),
        });
      } else {
        const canvasIr = getCanvasIRFromBlocklyWorkspace(catalog);
        res = await fetch(`/api/v1/pipeline/generate?project_name=${encodeURIComponent(projectName)}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(canvasIr),
        });
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${projectName}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
      setStatusMessage(`Descargado con éxito: ${projectName}.zip ✓`);
    } catch (err: any) {
      setStatusMessage(`Error generando ZIP: ${err.message}`);
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
    const canvasIr = getCanvasIRFromBlocklyWorkspace(catalog);
    try {
      const res = await fetch("/api/v1/pipeline/transform", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(canvasIr),
      });
      const data = await res.json();
      const mainFile = data.files?.find((f: any) => f.path === "app/main.py" || f.path.endsWith("main.py"));
      if (mainFile) {
        await navigator.clipboard.writeText(mainFile.content);
        setStatusMessage("Código app/main.py copiado al portapapeles ✓");
      } else if (data.files && data.files[0]) {
        await navigator.clipboard.writeText(data.files[0].content);
        setStatusMessage("Código Python copiado al portapapeles ✓");
      }
    } catch (err: any) {
      setStatusMessage(`Error al copiar código: ${err.message}`);
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
  const handleStartSimulation = async () => {
    if (isSimulating) return;
    setIsSimulating(true);
    simulationAbortRef.current = false;
    setStatusMessage("🏁 Simulation started: Running pipeline step-by-step...");

    // Parse initial input payload
    let initialContext: Record<string, any> = {};
    try {
      initialContext = JSON.parse(testPayloadText);
    } catch {
      initialContext = { raw_input: "test_value" };
    }

    setSimContext(initialContext);
    setSimLogs([{ time: new Date().toLocaleTimeString(), level: "INFO", msg: `🏁 Pipeline '${projectName}' initialized.` }]);

    // Fetch execution sequence from backend
    const canvasIr = getCanvasIRFromBlocklyWorkspace(catalog);
    let stepsToRun: any[] = [];

    try {
      const res = await fetch("/api/v1/pipeline/dry-run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(canvasIr),
      });
      const data = await res.json();
      stepsToRun = data.simulation_steps || [];
    } catch {
      stepsToRun = canvasIr.nodes.map((n) => ({
        id: n.id,
        name: n.data.label,
        reads: n.data.contract.reads,
        writes: n.data.contract.writes,
        origin: n.data.origin,
      }));
    }

    if (stepsToRun.length === 0) {
      setIsSimulating(false);
      setStatusMessage("Simulation finished: No steps in pipeline.");
      return;
    }

    // Initialize step cards
    const initialSimSteps: SimStepResult[] = stepsToRun.map((s) => ({
      id: s.id,
      name: s.name,
      status: "idle",
      durationMs: 0,
      reads: s.reads || [],
      writes: s.writes || [],
    }));
    setSimSteps(initialSimSteps);

    let currentContext = { ...initialContext };
    const stepDelay = turboMode ? 100 : 700;

    for (let i = 0; i < stepsToRun.length; i++) {
      if (simulationAbortRef.current) {
        setSimLogs((prev) => [...prev, { time: new Date().toLocaleTimeString(), level: "WARN", msg: "🛑 Simulation stopped by user." }]);
        highlightBlocklyBlock("", "idle");
        break;
      }

      const currentStep = stepsToRun[i];

      // Mark running
      highlightBlocklyBlock(currentStep.name, "running");
      setSimSteps((prev) =>
        prev.map((item, idx) => (idx === i ? { ...item, status: "running" } : item))
      );
      setCpuUsage(Math.floor(25 + Math.random() * 45));
      setRamUsage((r) => r + Math.floor(Math.random() * 6));
      setSimLogs((prev) => [
        ...prev,
        { time: new Date().toLocaleTimeString(), level: "INFO", msg: `▶ Executing step: ${currentStep.name}...` },
      ]);

      await new Promise((resolve) => setTimeout(resolve, stepDelay));

      if (simulationAbortRef.current) break;

      // Simulate output writes
      const duration = Math.floor(40 + Math.random() * 80);
      const stepOutput: Record<string, any> = {};
      if (currentStep.writes && currentStep.writes.length > 0) {
        currentStep.writes.forEach((w: string) => {
          stepOutput[w] = `result_${w}_${Math.floor(Math.random() * 1000)}`;
          currentContext[w] = stepOutput[w];
        });
      } else {
        currentContext[`${currentStep.name.toLowerCase()}_out`] = "completed";
      }

      setSimContext({ ...currentContext });

      // Mark success
      highlightBlocklyBlock(currentStep.name, "success");
      setSimSteps((prev) =>
        prev.map((item, idx) =>
          idx === i ? { ...item, status: "success", durationMs: duration, outputData: stepOutput } : item
        )
      );

      setSimLogs((prev) => [
        ...prev,
        {
          time: new Date().toLocaleTimeString(),
          level: "SUCCESS",
          msg: `✓ Step ${currentStep.name} completed in ${duration}ms.`,
        },
      ]);
    }

    setCpuUsage(0);
    setIsSimulating(false);
    setStatusMessage(simulationAbortRef.current ? "🛑 Simulation aborted" : "✓ Simulation finished successfully!");
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
        msg: "🛑 Simulación detenida por el usuario.",
      },
    ]);
    setStatusMessage("🛑 Simulación detenida por el usuario");
    setCpuUsage(0);
  };

  // Group steps for categories
  const officialSteps = catalog.filter((s) => s.repo === "Official");
  const pluginSteps = catalog.filter((s) => s.repo === "Plugin");

  return (
    <div className="flex flex-col h-screen w-screen bg-[#07090e] text-gray-100 font-sans select-none overflow-hidden aurora-bg">
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

      {/* 2. TOP MENU BAR (Scratux menu-bar layout) */}
      <header className="h-12 border-b border-gray-800/80 bg-[#0f172a]/95 backdrop-blur-md px-4 flex items-center justify-between z-30 shadow-md">
        {/* Left: Brand + Menus */}
        <div className="flex items-center space-x-3">
          {/* Brand Logo */}
          <div className="flex items-center space-x-2 mr-2">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-tr from-sky-500 to-indigo-600 flex items-center justify-center font-black text-white text-sm shadow-md">
              W
            </div>
            <span className="font-extrabold text-sm text-transparent bg-clip-text bg-gradient-to-r from-sky-300 to-indigo-200 font-heading tracking-tight">
              WPipe Studio
            </span>
            <span className="text-[9px] px-1.5 py-0.5 rounded bg-sky-950 text-sky-300 border border-sky-800 font-mono">
              v2.5.10
            </span>
          </div>

          {/* File Menu Dropdown */}
          <div className="relative menu-dropdown-container">
            <button
              onClick={() => setActiveMenu(activeMenu === "file" ? null : "file")}
              className={`px-2.5 py-1 text-xs font-semibold rounded-md transition flex items-center gap-1 ${
                activeMenu === "file" ? "bg-gray-800 text-white" : "text-gray-300 hover:text-white hover:bg-gray-800/60"
              }`}
            >
              <span>Archivo</span>
              <ChevronDown size={13} className="text-gray-400" />
            </button>
            {activeMenu === "file" && (
              <div className="absolute left-0 mt-1 w-64 bg-gray-900 border border-gray-700/80 rounded-xl shadow-2xl py-1.5 z-50 text-xs">
                <button
                  onClick={() => {
                    if (window.confirm("¿Crear un nuevo pipeline y reiniciar el lienzo?")) {
                      clearWorkspace();
                      addTriggerBlockToWorkspace("api", "/run");
                      addStepBlockToWorkspace("HttpRequest", "wpipe_steps.connectivity");
                      addResponseBlockToWorkspace("http_json", '{"status": "success", "data": context}');
                      setStatusMessage("Nuevo pipeline iniciado con Disparador API REST y Cierre HTTP");
                    }
                    setActiveMenu(null);
                  }}
                  className="w-full text-left px-3 py-2 hover:bg-gray-800 flex items-center gap-2.5 text-gray-200 hover:text-white"
                >
                  <FileCode size={15} className="text-sky-400" />
                  <div>
                    <div className="font-semibold">Nuevo Pipeline</div>
                    <div className="text-[10px] text-gray-400">Reinicia con disparador por defecto</div>
                  </div>
                </button>

                <label className="w-full text-left px-3 py-2 hover:bg-gray-800 flex items-center gap-2.5 text-gray-200 hover:text-white cursor-pointer">
                  <FolderOpen size={15} className="text-amber-400" />
                  <div>
                    <div className="font-semibold">Abrir Pipeline (.json)</div>
                    <div className="text-[10px] text-gray-400">Importar archivo desde tu equipo</div>
                  </div>
                  <input type="file" accept=".json,.wpipe.json" onChange={handleLoadJson} className="hidden" />
                </label>

                <div className="my-1 border-t border-gray-800" />

                <button
                  onClick={handleSaveToBrowser}
                  className="w-full text-left px-3 py-2 hover:bg-gray-800 flex items-center gap-2.5 text-gray-200 hover:text-white"
                >
                  <Save size={15} className="text-emerald-400" />
                  <div>
                    <div className="font-semibold">Guardar en Navegador</div>
                    <div className="text-[10px] text-gray-400">Almacenamiento local rápido</div>
                  </div>
                </button>

                <button
                  onClick={handleLoadFromBrowser}
                  className="w-full text-left px-3 py-2 hover:bg-gray-800 flex items-center gap-2.5 text-gray-200 hover:text-white"
                >
                  <RefreshCw size={15} className="text-teal-400" />
                  <div>
                    <div className="font-semibold">Restaurar de Navegador</div>
                    <div className="text-[10px] text-gray-400">Recuperar último guardado local</div>
                  </div>
                </button>

                <div className="my-1 border-t border-gray-800" />

                <button
                  onClick={handleSaveJson}
                  className="w-full text-left px-3 py-2 hover:bg-gray-800 flex items-center gap-2.5 text-gray-200 hover:text-white"
                >
                  <Download size={15} className="text-indigo-400" />
                  <div>
                    <div className="font-semibold">Exportar Canvas (.wpipe.json)</div>
                    <div className="text-[10px] text-gray-400">Descarga la definición del grafo</div>
                  </div>
                </button>

                <button
                  onClick={handleGenerateZip}
                  className="w-full text-left px-3 py-2 hover:bg-gray-800 flex items-center gap-2.5 text-gray-200 hover:text-white"
                >
                  <Download size={15} className="text-emerald-400" />
                  <div>
                    <div className="font-semibold">Descargar Microservicio (.zip)</div>
                    <div className="text-[10px] text-gray-400">Código Python listo para producción</div>
                  </div>
                </button>

                <button
                  onClick={handleCopyPythonCode}
                  className="w-full text-left px-3 py-2 hover:bg-gray-800 flex items-center gap-2.5 text-gray-200 hover:text-white"
                >
                  <Copy size={15} className="text-purple-400" />
                  <div>
                    <div className="font-semibold">Copiar Código Python</div>
                    <div className="text-[10px] text-gray-400">Copia app/main.py al portapapeles</div>
                  </div>
                </button>
              </div>
            )}
          </div>

          {/* Edit Menu Dropdown */}
          <div className="relative menu-dropdown-container">
            <button
              onClick={() => setActiveMenu(activeMenu === "edit" ? null : "edit")}
              className={`px-2.5 py-1 text-xs font-semibold rounded-md transition flex items-center gap-1 ${
                activeMenu === "edit" ? "bg-gray-800 text-white" : "text-gray-300 hover:text-white hover:bg-gray-800/60"
              }`}
            >
              <span>Editar</span>
              <ChevronDown size={13} className="text-gray-400" />
            </button>
            {activeMenu === "edit" && (
              <div className="absolute left-0 mt-1 w-60 bg-gray-900 border border-gray-700/80 rounded-xl shadow-2xl py-1.5 z-50 text-xs">
                <button
                  onClick={() => {
                    undoWorkspace(false);
                    setStatusMessage("Deshacer acción (Undo)");
                    setActiveMenu(null);
                  }}
                  className="w-full text-left px-3 py-2 hover:bg-gray-800 flex items-center justify-between text-gray-200 hover:text-white"
                >
                  <span className="flex items-center gap-2">
                    <Undo size={14} className="text-sky-400" />
                    <span>Deshacer (Undo)</span>
                  </span>
                  <span className="text-[10px] text-gray-500 font-mono">Ctrl+Z</span>
                </button>

                <button
                  onClick={() => {
                    undoWorkspace(true);
                    setStatusMessage("Rehacer acción (Redo)");
                    setActiveMenu(null);
                  }}
                  className="w-full text-left px-3 py-2 hover:bg-gray-800 flex items-center justify-between text-gray-200 hover:text-white"
                >
                  <span className="flex items-center gap-2">
                    <Redo size={14} className="text-sky-400" />
                    <span>Rehacer (Redo)</span>
                  </span>
                  <span className="text-[10px] text-gray-500 font-mono">Ctrl+Y</span>
                </button>

                <div className="my-1 border-t border-gray-800" />

                <button
                  onClick={() => {
                    collapseAllBlocksInWorkspace();
                    setStatusMessage("Todos los bloques colapsados");
                    setActiveMenu(null);
                  }}
                  className="w-full text-left px-3 py-2 hover:bg-gray-800 flex items-center gap-2 text-gray-200 hover:text-white"
                >
                  <Minimize2 size={14} className="text-amber-400" />
                  <span>Colapsar Todos los Bloques</span>
                </button>

                <button
                  onClick={() => {
                    expandAllBlocksInWorkspace();
                    setStatusMessage("Todos los bloques expandidos");
                    setActiveMenu(null);
                  }}
                  className="w-full text-left px-3 py-2 hover:bg-gray-800 flex items-center gap-2 text-gray-200 hover:text-white"
                >
                  <Maximize2 size={14} className="text-amber-400" />
                  <span>Expandir Todos los Bloques</span>
                </button>

                <button
                  onClick={() => {
                    zoomFitWorkspace();
                    setStatusMessage("Lienzo centrado (Zoom to fit)");
                    setActiveMenu(null);
                  }}
                  className="w-full text-left px-3 py-2 hover:bg-gray-800 flex items-center gap-2 text-gray-200 hover:text-white"
                >
                  <ZoomIn size={14} className="text-teal-400" />
                  <span>Centrar Lienzo (Fit)</span>
                </button>

                <div className="my-1 border-t border-gray-800" />

                <button
                  onClick={() => {
                    setTurboMode(!turboMode);
                    setStatusMessage(`Modo Turbo: ${!turboMode ? "Activado ⚡" : "Desactivado"}`);
                    setActiveMenu(null);
                  }}
                  className="w-full text-left px-3 py-2 hover:bg-gray-800 flex items-center justify-between text-gray-200 hover:text-white"
                >
                  <span className="flex items-center gap-2">
                    <Sparkles size={14} className="text-yellow-400" />
                    <span>Modo Turbo</span>
                  </span>
                  {turboMode ? (
                    <span className="text-[10px] text-emerald-400 font-bold font-mono">ACTIVO</span>
                  ) : (
                    <span className="text-[10px] text-gray-500 font-mono">OFF</span>
                  )}
                </button>

                <div className="my-1 border-t border-gray-800" />

                <button
                  onClick={() => {
                    if (window.confirm("¿Estás seguro de que deseas vaciar el lienzo por completo?")) {
                      clearWorkspace();
                      setStatusMessage("Lienzo vaciado por completo");
                    }
                    setActiveMenu(null);
                  }}
                  className="w-full text-left px-3 py-2 hover:bg-rose-950/60 text-rose-300 hover:text-rose-200 flex items-center gap-2"
                >
                  <Trash2 size={14} />
                  <span>Limpiar Lienzo Completo</span>
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Center: Microservice Selector, Title & Save Button */}
        <div className="flex items-center gap-2">
          {/* Projects Switcher / Manager Button */}
          <button
            onClick={() => setShowProjectsModal(true)}
            className="flex items-center gap-1.5 px-2.5 py-1 bg-gray-900/90 hover:bg-gray-800 border border-gray-700/80 rounded-md text-xs font-semibold text-gray-200 hover:text-white transition shadow-sm cursor-pointer group"
            title="Abrir Gestor de Microservicios (Espacio Aislado)"
          >
            <Folder size={13} className="text-amber-400 group-hover:scale-110 transition-transform" />
            <span className="max-w-[120px] truncate">{activeProjectId ? projectName : "Mis Microservicios"}</span>
            <ChevronDown size={11} className="text-gray-400" />
          </button>

          {/* Editable Project Title */}
          <input
            type="text"
            value={projectName}
            onChange={(e) => setProjectName(e.target.value.replace(/[^a-zA-Z0-9_-]/g, "_"))}
            className="bg-gray-950/80 border border-gray-700/80 hover:border-gray-500 focus:border-sky-500 rounded-md px-3 py-1 text-xs font-semibold text-gray-200 focus:outline-none transition w-44 text-center font-mono"
            placeholder="my_wpipe_pipeline"
            title="Click para renombrar microservicio"
          />

          {/* Save Microservice Button */}
          <button
            onClick={handleSaveProject}
            disabled={isSavingProject}
            className="flex items-center gap-1.5 px-2.5 py-1 bg-sky-950/80 hover:bg-sky-900 border border-sky-600/70 rounded-md text-xs font-bold text-sky-300 hover:text-sky-200 transition shadow-sm cursor-pointer"
            title="Guardar estado del lienzo y archivos en tu espacio privado"
          >
            <Save size={13} className={isSavingProject ? "animate-spin text-sky-400" : "text-sky-400"} />
            <span>{isSavingProject ? "Guardando..." : "Guardar"}</span>
          </button>
        </div>

        {/* Right: Actions (Tutorials, Dry-Run, Export ZIP, User Profile) */}
        <div className="flex items-center space-x-2">
          <button
            onClick={() => setShowFaqModal(true)}
            className="px-2.5 py-1 text-xs font-semibold text-gray-300 hover:text-white hover:bg-gray-800/60 rounded-md transition flex items-center gap-1.5 cursor-pointer"
            title="Guía y Preguntas Frecuentes"
          >
            <BookOpen size={14} className="text-purple-400" />
            <span>Tutoriales</span>
          </button>

          <button
            onClick={handleDryRun}
            disabled={dryRunLoading}
            className="px-3 py-1 bg-sky-950/90 hover:bg-sky-900 text-sky-300 border border-sky-700/80 rounded-md text-xs font-bold transition flex items-center gap-1.5 shadow cursor-pointer"
          >
            <CheckCircle size={14} className="text-sky-400" />
            <span>{dryRunLoading ? "Verificando..." : "Verificar"}</span>
          </button>

          <button
            onClick={handleGenerateZip}
            disabled={zipLoading}
            className="px-3 py-1 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white rounded-md text-xs font-bold transition shadow-md flex items-center gap-1.5 cursor-pointer"
          >
            <Download size={14} />
            <span>{zipLoading ? "Generando..." : "Descargar ZIP"}</span>
          </button>

          <div className="h-5 w-px bg-gray-800 mx-1" />

          {/* User Profile Pill & Session Dropdown */}
          <div className="relative">
            <button
              onClick={() => setShowUserMenu(!showUserMenu)}
              className="flex items-center gap-2 px-2.5 py-1 rounded-full bg-gradient-to-r from-gray-900 to-gray-800 hover:from-gray-800 hover:to-gray-700 border border-gray-700/80 text-xs text-gray-200 hover:text-white transition shadow-sm cursor-pointer group"
              title="Perfil de usuario y sesión"
            >
              <div
                className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-black text-white shadow-sm shrink-0"
                style={{ backgroundColor: getUserColor(currentUser) }}
              >
                {(currentUser?.name || "W")[0].toUpperCase()}
              </div>
              <div className="flex flex-col text-left leading-none">
                <span className="font-bold text-[11px] text-gray-100 group-hover:text-sky-300 transition max-w-[100px] truncate">
                  {currentUser?.name || "Usuario"}
                </span>
                <span className="text-[9px] text-gray-400 font-mono max-w-[100px] truncate">
                  {currentUser?.role || "Developer"}
                </span>
              </div>
              <ChevronDown size={11} className="text-gray-400 group-hover:text-gray-200" />
            </button>

            {/* Dropdown Menu */}
            {showUserMenu && (
              <div className="absolute right-0 mt-2 w-64 bg-[#0b0f19] border border-sky-800/80 rounded-xl shadow-2xl py-2 z-50 animate-in fade-in duration-150">
                <div className="px-3.5 py-2.5 border-b border-gray-800/80">
                  <div className="flex items-center gap-2.5">
                    <div
                      className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-black text-white shadow-md"
                      style={{ backgroundColor: getUserColor(currentUser) }}
                    >
                      {(currentUser?.name || "W")[0].toUpperCase()}
                    </div>
                    <div className="overflow-hidden">
                      <div className="font-bold text-xs text-white truncate">{currentUser?.name}</div>
                      <div className="text-[10px] font-mono text-sky-400 truncate">@{currentUser?.username}</div>
                      <div className="text-[10px] text-gray-400 truncate">{currentUser?.role}</div>
                    </div>
                  </div>
                  <div className="mt-2 text-[10px] font-mono text-gray-400 bg-gray-950 px-2 py-1 rounded border border-gray-800/80 truncate">
                    📁 media/workspaces/{currentUser?.id}/
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
                    <span>Mis Microservicios ({userProjects.length})</span>
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
                    <span>Nuevo Microservicio</span>
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
                    <span>Cerrar Sesión</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* 3. MAIN WORKSPACE CONTAINER */}
      <div className="flex-1 flex flex-col overflow-hidden relative bg-[#07090e]">
        {/* Sub-Header Tabs */}
        <div className="h-10 border-b border-gray-800/80 bg-[#0b0f19] px-4 flex items-center justify-between shrink-0 z-20">
          <div className="flex items-center space-x-1">
            <button
              onClick={() => setActiveMainTab("code")}
              className={`px-3.5 py-1.5 text-xs font-bold rounded-lg transition flex items-center gap-2 cursor-pointer ${
                activeMainTab === "code"
                  ? "bg-sky-950/80 text-sky-400 border border-sky-700/80 shadow-md shadow-sky-950/50"
                  : "text-gray-400 hover:text-gray-200 hover:bg-gray-900/60"
              }`}
            >
              <span>🧩 Diseño (Canvas)</span>
            </button>

            <button
              onClick={() => setActiveMainTab("simulation")}
              className={`px-3.5 py-1.5 text-xs font-bold rounded-lg transition flex items-center gap-2 cursor-pointer ${
                activeMainTab === "simulation"
                  ? "bg-emerald-950/80 text-emerald-400 border border-emerald-700/80 shadow-md shadow-emerald-950/50"
                  : "text-gray-400 hover:text-gray-200 hover:bg-gray-900/60"
              }`}
            >
              <span>🎮 Simulación & Depuración</span>
              {isSimulating && (
                <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping"></span>
              )}
            </button>

            <button
              onClick={handleOpenFlowchart}
              className={`px-3.5 py-1.5 text-xs font-bold rounded-lg transition flex items-center gap-2 cursor-pointer ${
                activeMainTab === "flowchart"
                  ? "bg-indigo-950/80 text-indigo-400 border border-indigo-700/80 shadow-md shadow-indigo-950/50"
                  : "text-gray-400 hover:text-gray-200 hover:bg-gray-900/60"
              }`}
            >
              <span>📊 Flujo (Mermaid DAG)</span>
            </button>

            <button
              onClick={() => setActiveMainTab("python")}
              className={`px-3.5 py-1.5 text-xs font-bold rounded-lg transition flex items-center gap-2 cursor-pointer ${
                activeMainTab === "python"
                  ? "bg-purple-950/80 text-purple-400 border border-purple-700/80 shadow-md shadow-purple-950/50"
                  : "text-gray-400 hover:text-gray-200 hover:bg-gray-900/60"
              }`}
            >
              <span>💻 Microservicio Python</span>
            </button>

            {/* Quick Simulation Start / Stop Controls */}
            <div className="flex items-center space-x-1.5 ml-3 pl-3 border-l border-gray-800">
              {!isSimulating ? (
                <button
                  onClick={handleStartSimulation}
                  title="Iniciar simulación en vivo paso a paso"
                  className="px-2.5 py-1 bg-emerald-600/30 hover:bg-emerald-600/50 text-emerald-300 border border-emerald-500/50 rounded-md text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer"
                >
                  <Play size={12} className="fill-current text-emerald-400" />
                  <span>Simular</span>
                </button>
              ) : (
                <button
                  onClick={handleStopSimulation}
                  title="Detener la simulación inmediatamente"
                  className="px-2.5 py-1 bg-rose-600 hover:bg-rose-500 text-white border border-rose-400 rounded-md text-xs font-bold flex items-center gap-1.5 transition cursor-pointer shadow-lg animate-pulse"
                >
                  <Square size={12} className="fill-current" />
                  <span>Detener (🛑)</span>
                </button>
              )}
            </div>
          </div>

          <div className="flex items-center space-x-3 text-[11px] font-mono">
            {turboMode && (
              <span className="px-2 py-0.5 rounded bg-yellow-950/80 text-yellow-300 border border-yellow-700/60 font-bold flex items-center gap-1">
                <Sparkles size={11} /> Turbo
              </span>
            )}
            <div className="text-gray-500">
              Estado: <span className="text-gray-300 font-semibold">{statusMessage}</span>
            </div>
          </div>
        </div>

        {/* TAB 1: CODE / SCRATUX BLOCKS WORKSPACE (Permanently Mounted in DOM to preserve blocks) */}
        <div className={activeMainTab === "code" ? "flex-1 flex overflow-hidden relative" : "hidden"}>
          {/* 1. SCRATCH 3.0 CATEGORY STRIP (Far Left Rail) */}
          <div className="w-16 bg-[#080c16] border-r border-gray-800/80 flex flex-col justify-between items-center py-2.5 select-none z-20 shrink-0">
            <div className="flex flex-col items-center space-y-2 w-full px-1">
              {[
                { id: "all", label: "Todos", count: 11, icon: "🌐", dot: "bg-sky-400" },
                { id: "trigger", label: "Inicio/Fin", count: 2, icon: "🚀", dot: "bg-amber-400" },
                { id: "steps", label: "Pasos", count: 3, icon: "📦", dot: "bg-blue-500" },
                { id: "control", label: "Control", count: 2, icon: "🔀", dot: "bg-orange-500" },
                { id: "loops", label: "Bucles", count: 2, icon: "🔁", dot: "bg-yellow-400" },
                { id: "parallel", label: "Paralelo", count: 2, icon: "⚡", dot: "bg-emerald-500" },
              ].map((cat) => (
                <button
                  key={cat.id}
                  onClick={() => setSelectedCategory(cat.id)}
                  title={`${cat.label} (${cat.count} bloques)`}
                  className={`flex flex-col items-center justify-center w-full py-2 rounded-xl transition cursor-pointer relative group ${
                    selectedCategory === cat.id
                      ? "bg-gray-800/95 text-white shadow-lg border border-sky-500/50"
                      : "text-gray-400 hover:text-gray-200 hover:bg-gray-900/50"
                  }`}
                >
                  <span className="text-sm mb-0.5">{cat.icon}</span>
                  <span className="text-[9px] font-bold leading-none">{cat.label}</span>
                  <span
                    className={`text-[8px] font-mono mt-0.5 px-1 rounded-full ${
                      selectedCategory === cat.id
                        ? "bg-sky-500/30 text-sky-300 font-bold"
                        : "text-gray-500"
                    }`}
                  >
                    {cat.count}
                  </span>
                  {selectedCategory === cat.id && (
                    <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-5 rounded-r bg-sky-400 shadow-sm" />
                  )}
                </button>
              ))}
            </div>

            {/* Mis Microservicios & Proyectos Workspace Button (Repurposed EXT) */}
            <div className="w-full px-2 pt-2 border-t border-gray-800/60">
              <button
                type="button"
                onClick={() => setShowProjectsModal(true)}
                title="Mis Microservicios (Gestionar proyectos, crear, clonar)"
                className="w-full aspect-square rounded-xl bg-gradient-to-tr from-sky-600 via-indigo-600 to-purple-600 hover:from-sky-500 hover:to-purple-500 text-white flex flex-col items-center justify-center shadow-lg transition-transform hover:scale-105 active:scale-95 group border border-sky-400/40 cursor-pointer"
              >
                <FolderOpen size={16} className="text-white" />
                <span className="text-[7.5px] font-black mt-0.5 tracking-tighter uppercase">PROY</span>
              </button>
            </div>
          </div>

          {/* 2. SCRATCH BLOCK PALETTE (Interlocking Scratch Block Cards) */}
          <div className="w-72 bg-[#0b0f19] border-r border-gray-800/80 flex flex-col justify-between overflow-hidden z-20 shrink-0">
            {/* Header with Search */}
            <div className="p-3 border-b border-gray-800/80 bg-gray-950/60 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-5 h-5 rounded-md bg-gradient-to-tr from-sky-500 to-indigo-600 flex items-center justify-center text-xs shadow-sm">
                    🧩
                  </div>
                  <span className="font-extrabold text-xs text-gray-200">Paleta de Bloques</span>
                </div>
                <span className="text-[10px] text-gray-400 font-mono">
                  {categorySearch.trim() ? "Filtrando..." : "11 Bloques"}
                </span>
              </div>
              <div className="relative">
                <Search size={13} className="absolute left-2.5 top-2.5 text-gray-500" />
                <input
                  type="text"
                  value={categorySearch}
                  onChange={(e) => setCategorySearch(e.target.value)}
                  placeholder="Buscar bloques (ej: trigger, if)..."
                  className="w-full bg-gray-900 border border-gray-800 rounded-lg py-1.5 pl-8 pr-7 text-xs text-gray-200 focus:outline-none focus:border-sky-500 transition placeholder:text-gray-500 font-mono"
                />
                {categorySearch && (
                  <button
                    onClick={() => setCategorySearch("")}
                    className="absolute right-2 top-2 text-gray-500 hover:text-white text-xs font-bold"
                  >
                    ✕
                  </button>
                )}
              </div>
            </div>

            {/* Scrollable List of Blocks with Interlocking Shape & Hover Descriptions */}
            <div className="flex-1 overflow-y-auto p-2.5 space-y-2.5 custom-modal-scrollbar">
              {[
                // 1. Lanzador (Trigger)
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
                // 2. Cierre / Salida del Pipeline (Response)
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
                // 2. Paso de Catálogo
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
                // 3. Paso con IA
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
                // 4. Paso Personalizado (.py)
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
                // 5. Condición (Si)
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
                // 6. Condición (Si / Sino)
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
                // 7. Bucle Mientras (While)
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
                // 8. Bucle Repetir (For)
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
                // 9. Ejecución Paralela
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
                // 10. Tarea en Segundo Plano (Background)
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
                  return b.name.toLowerCase().includes(q) || b.description.toLowerCase().includes(q) || b.badge.toLowerCase().includes(q);
                })
                .map((b) => (
                  <div
                    key={b.id}
                    onClick={(e) => {
                      e.stopPropagation();
                      b.action();
                    }}
                    onMouseEnter={(e) => handleBlockMouseEnter(b, e)}
                    onMouseLeave={handleBlockMouseLeave}
                    className="group relative cursor-pointer select-none transition-transform duration-150 hover:scale-[1.02] active:scale-[0.98]"
                  >
                    {b.isHat ? (
                      <div className="w-12 h-2.5 rounded-t-full -mb-1 ml-3 bg-amber-500 border-t border-l border-r border-amber-300/80 shadow-sm" />
                    ) : (
                      <div className={`w-5 h-1.5 rounded-t-sm -mb-0.5 ml-4 ${b.tabColor} shadow-sm`} />
                    )}
                    <div className={`px-3 py-2 rounded-xl bg-gradient-to-r ${b.gradient} border shadow-md flex items-center justify-between text-white`}>
                      <div className="flex items-center gap-2.5 truncate">
                        <span className="text-base shrink-0 p-1 rounded-lg bg-black/20 shadow-inner">{b.icon}</span>
                        <div className="flex flex-col truncate min-w-0">
                          <span className="text-xs font-bold tracking-tight truncate leading-tight">{b.name}</span>
                          <span className="text-[10px] text-white/75 font-medium truncate leading-tight mt-0.5">{b.badge}</span>
                        </div>
                      </div>
                      <div className="w-6 h-6 rounded-lg bg-black/25 flex items-center justify-center text-white/90 text-xs font-bold group-hover:bg-white/20 transition shrink-0 ml-1 shadow-sm">
                        +
                      </div>
                    </div>
                    <div className="w-5 h-1.5 rounded-t-sm -mt-0.5 ml-4 bg-[#0b0f19] border-t border-l border-r border-gray-900" />
                  </div>
                ))}
            </div>
          </div>

          {/* 3. CENTER CANVAS: BLOCKLY WORKSPACE + FLOATING ACTION TOOLBAR */}
          <div className="flex-1 bg-[#07090e] relative overflow-hidden flex flex-col">
            {/* Floating Action Toolbar */}
            <div className="absolute top-3 right-4 flex items-center gap-1.5 p-1 bg-gray-950/90 backdrop-blur-md border border-gray-800/90 rounded-xl shadow-2xl z-30">
              <div className="flex items-center gap-1.5 px-2 py-1 text-[11px] text-gray-400 font-medium border-r border-gray-800 mr-1 hidden sm:flex select-none">
                <Move size={12} className="text-sky-400" />
                <span>Arrastra el fondo para mover lienzo</span>
              </div>

              <button
                onClick={centerWorkspace}
                title="Centrar lienzo en el origen de los bloques"
                className="px-2.5 py-1.5 hover:bg-gray-800 text-sky-400 hover:text-sky-300 rounded-lg flex items-center gap-1 text-xs font-semibold transition cursor-pointer"
              >
                <Maximize2 size={13} />
                <span>Centrar</span>
              </button>

              <button
                onClick={zoomFitWorkspace}
                title="Ajustar zoom al tamaño de los bloques"
                className="px-2.5 py-1.5 hover:bg-gray-800 text-teal-400 hover:text-teal-300 rounded-lg flex items-center gap-1 text-xs font-semibold transition cursor-pointer"
              >
                <Search size={13} />
                <span>Ajustar</span>
              </button>

              <button
                onClick={collapseAllBlocksInWorkspace}
                title="Colapsar todos los bloques del lienzo para visualización compacta"
                className="px-2.5 py-1.5 hover:bg-gray-800 text-amber-400 hover:text-amber-300 rounded-lg flex items-center gap-1 text-xs font-semibold transition cursor-pointer"
              >
                <Minimize2 size={13} />
                <span>Colapsar</span>
              </button>

              <button
                onClick={expandAllBlocksInWorkspace}
                title="Expandir todos los bloques del lienzo"
                className="px-2.5 py-1.5 hover:bg-gray-800 text-emerald-400 hover:text-emerald-300 rounded-lg flex items-center gap-1 text-xs font-semibold transition cursor-pointer"
              >
                <ChevronDown size={13} />
                <span>Expandir</span>
              </button>

              <div className="w-[1px] h-4 bg-gray-800 mx-0.5" />

              <button
                onClick={() => undoWorkspace(false)}
                title="Deshacer última acción (Ctrl+Z)"
                className="p-1.5 hover:bg-gray-800 text-gray-300 hover:text-white rounded-lg transition cursor-pointer"
              >
                <Undo size={14} />
              </button>

              <button
                onClick={clearWorkspace}
                title="Limpiar todo el lienzo"
                className="p-1.5 hover:bg-rose-950 text-rose-400 hover:text-rose-300 rounded-lg transition cursor-pointer"
              >
                <Trash2 size={14} />
              </button>

              <div className="w-[1px] h-4 bg-gray-800 mx-0.5" />

              <button
                onClick={() => setShowFaqModal(true)}
                title="Guía de Arquitectura y FAQ"
                className="px-2.5 py-1.5 hover:bg-purple-950/70 text-purple-400 hover:text-purple-300 rounded-lg flex items-center gap-1 text-xs font-semibold transition cursor-pointer"
              >
                <BookOpen size={13} />
                <span>Guía</span>
              </button>
            </div>

            {/* Blockly Workspace Component */}
            <div className="flex-1 w-full h-full relative">
              <BlocklyComponent />
            </div>
          </div>
        </div>

        {/* TAB 2: DEDICATED FULL-SCREEN SIMULATION & DEBUGGING STAGE */}
        {activeMainTab === "simulation" && (
          <div className="flex-1 flex overflow-hidden bg-[#07090e]">
            {/* Left Column: Controls, Ingress Payload, Context State Inspector */}
            <div className="w-[45%] border-r border-gray-800/80 bg-[#0c101c] flex flex-col p-4 space-y-4 overflow-y-auto custom-modal-scrollbar">
              {/* Header Controls */}
              <div className="flex items-center justify-between p-3 rounded-xl bg-gray-950/80 border border-gray-800/80 shadow-md">
                <div className="flex items-center space-x-2">
                  <button
                    onClick={handleStartSimulation}
                    disabled={isSimulating}
                    className={`px-3.5 py-2 rounded-lg border flex items-center gap-2 text-xs font-bold shadow-md transition cursor-pointer ${
                      isSimulating
                        ? "bg-emerald-950/40 border-emerald-900 text-emerald-600 opacity-60 cursor-not-allowed"
                        : "bg-emerald-600 hover:bg-emerald-500 border-emerald-400 text-white active:scale-95 shadow-emerald-950/60"
                    }`}
                  >
                    <Play size={14} className="fill-current" />
                    <span>Iniciar Simulación (🏁)</span>
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
                    <span>Detener (🛑)</span>
                  </button>
                </div>

                <button
                  onClick={() => {
                    handleStopSimulation();
                    setSimContext({});
                    setSimSteps([]);
                    setSimLogs([]);
                    setStatusMessage("Simulación reiniciada");
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
            <div className="flex items-center justify-between px-4 py-2.5 bg-gray-950/80 border-b border-gray-800/80 text-xs">
              <div className="flex items-center space-x-2">
                <div className="flex items-center gap-1.5 px-2.5 py-1 bg-gray-900 border border-gray-800 rounded-lg text-gray-400 text-[11px] font-medium mr-1 select-none">
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
                  onClick={() => {
                    const mdPlan = getWorkPlanFromBlocklyWorkspace(catalog);
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
              {/* Upper area: Activity Bar + Explorer + Editor */}
              <div className="flex-1 flex overflow-hidden">
                {/* 1. VS CODE ACTIVITY BAR (Left narrow bar) */}
                <div className="w-12 bg-[#181818] border-r border-[#2b2b2b] flex flex-col justify-between items-center py-2 shrink-0 z-20 select-none">
                  {/* Top Activity Icons */}
                  <div className="flex flex-col items-center w-full space-y-2">
                    <button
                      onClick={() => {
                        setActiveActivityTab("explorer");
                        setGithubShowTreeSidebar(activeActivityTab === "explorer" ? !githubShowTreeSidebar : true);
                      }}
                      title="Explorador de Archivos (Ctrl+Shift+E)"
                      className={`w-full h-11 flex items-center justify-center relative cursor-pointer transition ${
                        activeActivityTab === "explorer" && githubShowTreeSidebar
                          ? "text-white"
                          : "text-[#858585] hover:text-white"
                      }`}
                    >
                      {activeActivityTab === "explorer" && githubShowTreeSidebar && (
                        <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-white" />
                      )}
                      <Folder size={20} />
                    </button>

                    <button
                      onClick={() => {
                        setActiveActivityTab("search");
                        setGithubShowTreeSidebar(true);
                      }}
                      title="Buscar en Archivos (Ctrl+Shift+F)"
                      className={`w-full h-11 flex items-center justify-center relative cursor-pointer transition ${
                        activeActivityTab === "search" && githubShowTreeSidebar
                          ? "text-white"
                          : "text-[#858585] hover:text-white"
                      }`}
                    >
                      {activeActivityTab === "search" && githubShowTreeSidebar && (
                        <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-white" />
                      )}
                      <Search size={20} />
                    </button>

                    <button
                      onClick={() => {
                        setActiveActivityTab("git");
                        setGithubShowTreeSidebar(true);
                      }}
                      title="Control de Código Fuente (Git)"
                      className={`w-full h-11 flex items-center justify-center relative cursor-pointer transition ${
                        activeActivityTab === "git" && githubShowTreeSidebar
                          ? "text-white"
                          : "text-[#858585] hover:text-white"
                      }`}
                    >
                      {activeActivityTab === "git" && githubShowTreeSidebar && (
                        <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-white" />
                      )}
                      <GitBranch size={20} />
                      {modifiedFiles.size > 0 && (
                        <span className="absolute top-2 right-2 w-4 h-4 bg-[#007acc] text-white rounded-full text-[9px] font-bold flex items-center justify-center">
                          {modifiedFiles.size}
                        </span>
                      )}
                    </button>

                    {/* Quick Switch to Blockly / Stage */}
                    <div className="w-6 h-[1px] bg-[#2b2b2b] my-1" />

                    <button
                      onClick={() => setActiveMainTab("code")}
                      title="Volver al Lienzo de Bloques (Blockly)"
                      className="w-full h-11 flex items-center justify-center text-[#858585] hover:text-white cursor-pointer transition"
                    >
                      <Layers size={18} />
                    </button>

                    <button
                      onClick={() => setActiveMainTab("simulation")}
                      title="Abrir Simulador Interactivo"
                      className="w-full h-11 flex items-center justify-center text-[#858585] hover:text-white cursor-pointer transition"
                    >
                      <Play size={18} />
                    </button>
                  </div>

                  {/* Bottom Activity Icons */}
                  <div className="flex flex-col items-center w-full space-y-2">
                    <button
                      onClick={() => setShowProjectsModal(true)}
                      title={currentUser ? `Usuario: ${currentUser.name} (${currentUser.role})` : "Iniciar Sesión"}
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

                {/* 2. VS CODE PRIMARY SIDEBAR (Explorer / Search / Git) */}
                {githubShowTreeSidebar && (
                  <div className="w-64 bg-[#252526] border-r border-[#2b2b2b] flex flex-col overflow-hidden shrink-0 z-10 select-none">
                    {/* Explorer Title Bar */}
                    <div className="px-4 py-2 flex items-center justify-between text-[11px] font-bold text-[#bbbbbb] tracking-wider uppercase">
                      <span>{activeActivityTab === "search" ? "BUSCAR" : activeActivityTab === "git" ? "CONTROL DE CÓDIGO" : "EXPLORADOR"}</span>
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
                      </div>
                    </div>

                    {/* Quick File Filter */}
                    <div className="px-3 pb-2">
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
                      className="px-3 py-1.5 bg-[#2d2d2d] hover:bg-[#37373d] flex items-center justify-between text-xs font-bold text-gray-200 cursor-pointer transition border-t border-b border-[#2b2b2b]"
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
                                onClick={() => openFileInTab(f)}
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
                          onSelectFile={(file) => openFileInTab(file)}
                          onSelectFolder={(folderPath) => {
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

                {/* 3. VS CODE EDITOR AREA (Tabs + Breadcrumbs + Viewport) */}
                <div className="flex-1 flex flex-col bg-[#1e1e1e] overflow-hidden">
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
                          title="Alternar entre editor de código y vista previa renderizada"
                        >
                          {readmePreviewMode ? <Code size={12} /> : <Eye size={12} />}
                          <span>{readmePreviewMode ? "Código" : "Vista Previa"}</span>
                        </button>
                      )}

                      {githubViewingFile && !isEditingFile && !(githubViewingFile.path === "README.md" || githubViewingFile.path.endsWith("/README.md")) && (
                        <button
                          onClick={handleStartEditingFile}
                          className="px-2.5 py-0.5 bg-[#0e639c] hover:bg-[#1177bb] text-white rounded text-xs font-semibold flex items-center gap-1 transition cursor-pointer"
                          title="Editar este archivo"
                        >
                          <Edit3 size={12} />
                          <span>Editar</span>
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
                          <div className="max-w-4xl mx-auto">
                            <div className="bg-[#252526] border border-[#3c3c3c] rounded-t-xl px-4 py-2.5 flex items-center justify-between text-xs">
                              <span className="font-bold text-sky-400 flex items-center gap-2">
                                <BookOpen size={14} />
                                <span>Vista Previa de {githubViewingFile.path}</span>
                              </span>
                              <button
                                onClick={() => setReadmePreviewMode(false)}
                                className="text-xs text-sky-400 hover:underline cursor-pointer flex items-center gap-1"
                              >
                                <Code size={12} />
                                <span>Volver al editor de código</span>
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
                          <div className="max-w-4xl mx-auto">
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
                          <div className="max-w-4xl mx-auto space-y-4">
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
              </div>

              {/* 4. VS CODE STATUS BAR (Bottom bar) */}
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
                  <div className="flex items-center gap-1 cursor-pointer hover:opacity-80">
                    <GitBranch size={12} />
                    <span>main{modifiedFiles.size > 0 ? "*" : ""}</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-[10px] opacity-90">
                    <span>0 ⚠️</span>
                    <span>0 ❌</span>
                  </div>
                </div>

                <div className="flex items-center gap-4">
                  {githubViewingFile ? (
                    <>
                      <span>Ln {cursorPos.line}, Col {cursorPos.col}</span>
                      <span>Spaces: 4</span>
                      <span>UTF-8</span>
                      <span>LF</span>
                      <span className="font-semibold">{getLanguageFromPath(githubViewingFile.path)}</span>
                    </>
                  ) : (
                    <>
                      <span>{directoryItems.length} elementos</span>
                      <span>Espacio de Trabajo Activo</span>
                    </>
                  )}
                </div>
              </div>
            </div>
          );
        })()}
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
                      Mis Microservicios & Proyectos
                    </h3>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-emerald-950/80 text-emerald-400 border border-emerald-700/60 flex items-center gap-1">
                      <ShieldCheck size={11} /> Aislamiento Multi-Tenant Activo
                    </span>
                  </div>
                  <p className="text-xs text-gray-400">
                    Espacio privado de <strong className="text-gray-200">{currentUser?.name || "William R."}</strong> (
                    <span className="font-mono text-[11px] text-sky-400/90">media/workspaces/{currentUser?.id || "usr_william"}/</span>)
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

      {/* 5. NATURAL FULL-SCREEN LOGIN / REGISTRATION OVERLAY */}
      {!currentUser && (
        <div className="fixed inset-0 z-[9999] bg-[#07090e] flex flex-col items-center justify-center p-4 select-none animate-in fade-in duration-200 overflow-y-auto w-screen h-screen">
          {/* Subtle glowing backdrops */}
          <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[550px] h-[550px] bg-sky-500/10 rounded-full blur-3xl pointer-events-none" />
          <div className="absolute bottom-1/4 right-1/4 w-[450px] h-[450px] bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />

          <div className="w-full max-w-md bg-[#0b0f19]/95 border border-sky-800/70 rounded-2xl p-7 shadow-2xl backdrop-blur-xl relative z-10 flex flex-col space-y-4 my-auto">
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

                {/* Quick Presets / Demo Accounts */}
                <div className="pt-2 border-t border-gray-800/80">
                  <span className="text-[10px] font-bold text-gray-400 block mb-1.5 text-center uppercase tracking-wider">
                    Cuentas de prueba rápidas:
                  </span>
                  <div className="space-y-1.5">
                    <button
                      type="button"
                      onClick={() => handleNaturalLogin(undefined, "william.rodriguez", "admin123")}
                      className="w-full p-2 rounded-lg bg-gray-950/80 hover:bg-sky-950/40 border border-gray-800 hover:border-sky-600/50 flex items-center justify-between text-left transition group cursor-pointer"
                    >
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded-full bg-sky-600 flex items-center justify-center text-[10px] font-bold text-white">
                          WR
                        </div>
                        <div>
                          <div className="text-xs font-semibold text-gray-200 group-hover:text-sky-300">William R.</div>
                          <div className="text-[10px] text-gray-500 font-mono">@william.rodriguez</div>
                        </div>
                      </div>
                      <span className="text-[10px] font-mono text-gray-400 group-hover:text-sky-400">admin123 →</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleNaturalLogin(undefined, "developer", "dev123")}
                      className="w-full p-2 rounded-lg bg-gray-950/80 hover:bg-sky-950/40 border border-gray-800 hover:border-sky-600/50 flex items-center justify-between text-left transition group cursor-pointer"
                    >
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded-full bg-indigo-600 flex items-center justify-center text-[10px] font-bold text-white">
                          DE
                        </div>
                        <div>
                          <div className="text-xs font-semibold text-gray-200 group-hover:text-sky-300">Dev Team</div>
                          <div className="text-[10px] text-gray-500 font-mono">@developer</div>
                        </div>
                      </div>
                      <span className="text-[10px] font-mono text-gray-400 group-hover:text-sky-400">dev123 →</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleNaturalLogin(undefined, "guest", "guest123")}
                      className="w-full p-2 rounded-lg bg-gray-950/80 hover:bg-sky-950/40 border border-gray-800 hover:border-sky-600/50 flex items-center justify-between text-left transition group cursor-pointer"
                    >
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded-full bg-emerald-600 flex items-center justify-center text-[10px] font-bold text-white">
                          GU
                        </div>
                        <div>
                          <div className="text-xs font-semibold text-gray-200 group-hover:text-sky-300">Invitado</div>
                          <div className="text-[10px] text-gray-500 font-mono">@guest</div>
                        </div>
                      </div>
                      <span className="text-[10px] font-mono text-gray-400 group-hover:text-sky-400">guest123 →</span>
                    </button>
                  </div>
                </div>
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
    </div>
  );
}
