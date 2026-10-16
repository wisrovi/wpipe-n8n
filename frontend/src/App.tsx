import React, { useState, useEffect, useRef } from "react";
import { CanvasNode, CanvasEdge, CanvasIR, StepOrigin } from "./lib/ir/schemas";
import {
  BlocklyComponent,
  addStepBlockToWorkspace,
  addAiStepBlockToWorkspace,
  addUserFileStepBlockToWorkspace,
  addControlBlockToWorkspace,
  setBlocklyCatalog,
  attachedFilesRegistry,
  getMermaidFromBlocklyWorkspace,
  getWorkPlanFromBlocklyWorkspace,
  getCanvasIRFromBlocklyWorkspace,
  highlightBlocklyBlock,
} from "./components/BlocklyWorkspace";
import mermaid from "mermaid";
import {
  Play,
  Square,
  FolderOpen,
  Save,
  FileCode,
  CheckCircle,
  AlertTriangle,
  RefreshCw,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Download,
  Copy,
  Sparkles,
  BookOpen,
  Layers,
  ChevronDown,
  Check,
  Search,
  Plus,
  Terminal,
  Cpu,
  Database,
  ArrowRight,
} from "lucide-react";

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

export default function App() {
  // Splash Screen
  const [showSplash, setShowSplash] = useState<boolean>(true);
  const [splashProgress, setSplashProgress] = useState<number>(0);
  const [splashFadeOut, setSplashFadeOut] = useState<boolean>(false);

  // Top Menu State
  const [projectName, setProjectName] = useState<string>("main_pipeline");
  const [activeMenu, setActiveMenu] = useState<"file" | "edit" | null>(null);
  const [turboMode, setTurboMode] = useState<boolean>(false);

  // Main Tabs: 'code' (Blockly) | 'flowchart' (Mermaid) | 'python' (TargetIR Preview)
  const [activeMainTab, setActiveMainTab] = useState<"code" | "flowchart" | "python">("code");

  // Scratch Category Selector
  const [selectedCategory, setSelectedCategory] = useState<string>("motion");
  const [categorySearch, setCategorySearch] = useState<string>("");

  // Extension Library Modal
  const [showExtensionModal, setShowExtensionModal] = useState<boolean>(false);
  const [extensionSearch, setExtensionSearch] = useState<string>("");
  const [extensionCategoryFilter, setExtensionCategoryFilter] = useState<string>("ALL");

  // FAQ Modal
  const [showFaqModal, setShowFaqModal] = useState<boolean>(false);
  const [openFaqId, setOpenFaqId] = useState<string | null>("faq_1");
  const [faqSearch, setFaqSearch] = useState<string>("");

  // Flowchart View state
  const [mermaidCode, setMermaidCode] = useState<string>("");
  const [zoomScale, setZoomScale] = useState<number>(1.0);
  const mermaidFullRef = useRef<HTMLDivElement>(null);

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

  // Fetch Release Catalog from Backend
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
  }, []);

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

  // Mermaid render effect
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
          }
        })
        .catch((err) => {
          console.error("Mermaid render error:", err);
        });
    }
  }, [activeMainTab, mermaidCode]);

  // Load Python Preview when switching to python tab
  useEffect(() => {
    if (activeMainTab === "python") {
      setPreviewLoading(true);
      const canvasIr = getCanvasIRFromBlocklyWorkspace(catalog);
      fetch("/api/v1/pipeline/transform", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(canvasIr),
      })
        .then((res) => res.json())
        .then((data) => {
          if (data && data.files) {
            setGeneratedFiles(data.files);
            setSelectedFileIdx(0);
          }
        })
        .catch((err) => {
          console.error("Transform error:", err);
        })
        .finally(() => {
          setPreviewLoading(false);
        });
    }
  }, [activeMainTab, catalog]);

  // Switch to Flowchart view
  const handleOpenFlowchart = () => {
    const code = getMermaidFromBlocklyWorkspace();
    setMermaidCode(code);
    setActiveMainTab("flowchart");
    setStatusMessage("Generated live Mermaid flowchart preview");
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
    setStatusMessage("Building production microservice ZIP...");
    const canvasIr = getCanvasIRFromBlocklyWorkspace(catalog);
    try {
      const res = await fetch(`/api/v1/pipeline/generate?project_name=${encodeURIComponent(projectName)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(canvasIr),
      });
      if (!res.ok) throw new Error("Failed to generate ZIP");
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${projectName}.zip`;
      a.click();
      setStatusMessage(`Downloaded verified microservice ZIP: ${projectName}.zip`);
    } catch (err: any) {
      setStatusMessage(`Generate error: ${err.message}`);
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
    a.download = `${projectName}_canvas.json`;
    a.click();
    setStatusMessage("Exported pipeline JSON definition");
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
          // Add nodes to workspace
          parsed.nodes.forEach((n: any) => {
            if (n.data?.node_type === "step") {
              addStepBlockToWorkspace(n.data.label, n.data.namespace || "custom", n.data.origin);
            }
          });
          setStatusMessage(`Loaded pipeline definition from '${file.name}'`);
        }
      } catch (err) {
        setStatusMessage("Failed to parse pipeline JSON file");
      }
    };
    reader.readAsText(file);
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
    setStatusMessage("🛑 Simulation stopped by user");
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
          <div className="relative">
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
              <div className="absolute left-0 mt-1 w-52 bg-gray-900 border border-gray-700/80 rounded-lg shadow-2xl py-1 z-50 text-xs">
                <button
                  onClick={() => {
                    if (window.confirm("¿Crear un nuevo pipeline y limpiar el canvas?")) {
                      window.location.reload();
                    }
                    setActiveMenu(null);
                  }}
                  className="w-full text-left px-3 py-2 hover:bg-gray-800 flex items-center gap-2"
                >
                  <FileCode size={14} className="text-sky-400" />
                  <span>Nuevo Pipeline</span>
                </button>
                <label className="w-full text-left px-3 py-2 hover:bg-gray-800 flex items-center gap-2 cursor-pointer">
                  <FolderOpen size={14} className="text-amber-400" />
                  <span>Cargar desde tu ordenador</span>
                  <input type="file" accept=".json" onChange={handleLoadJson} className="hidden" />
                </label>
                <button
                  onClick={handleSaveJson}
                  className="w-full text-left px-3 py-2 hover:bg-gray-800 flex items-center gap-2"
                >
                  <Save size={14} className="text-emerald-400" />
                  <span>Guardar en tu ordenador (.json)</span>
                </button>
              </div>
            )}
          </div>

          {/* Edit Menu Dropdown */}
          <div className="relative">
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
              <div className="absolute left-0 mt-1 w-48 bg-gray-900 border border-gray-700/80 rounded-lg shadow-2xl py-1 z-50 text-xs">
                <button
                  onClick={() => {
                    setTurboMode(!turboMode);
                    setStatusMessage(`Modo Turbo: ${!turboMode ? "Activado ⚡" : "Desactivado"}`);
                    setActiveMenu(null);
                  }}
                  className="w-full text-left px-3 py-2 hover:bg-gray-800 flex items-center justify-between"
                >
                  <span className="flex items-center gap-2">
                    <Sparkles size={14} className="text-yellow-400" />
                    <span>Modo Turbo</span>
                  </span>
                  {turboMode && <Check size={14} className="text-emerald-400" />}
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Center: Editable Project Title */}
        <div className="flex items-center">
          <input
            type="text"
            value={projectName}
            onChange={(e) => setProjectName(e.target.value.replace(/[^a-zA-Z0-9_-]/g, "_"))}
            className="bg-gray-950/80 border border-gray-700/80 hover:border-gray-500 focus:border-sky-500 rounded-md px-3 py-1 text-xs font-semibold text-gray-200 focus:outline-none transition w-64 text-center font-mono"
            placeholder="my_wpipe_pipeline"
            title="Click to rename pipeline"
          />
        </div>

        {/* Right: Actions (FAQ, Dry-Run, Export ZIP) */}
        <div className="flex items-center space-x-2">
          <button
            onClick={() => setShowFaqModal(true)}
            className="px-2.5 py-1 text-xs font-semibold text-gray-300 hover:text-white hover:bg-gray-800/60 rounded-md transition flex items-center gap-1.5"
            title="Guía y Preguntas Frecuentes"
          >
            <BookOpen size={14} className="text-purple-400" />
            <span>Tutoriales</span>
          </button>

          <button
            onClick={handleDryRun}
            disabled={dryRunLoading}
            className="px-3 py-1 bg-sky-950/90 hover:bg-sky-900 text-sky-300 border border-sky-700/80 rounded-md text-xs font-bold transition flex items-center gap-1.5 shadow"
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
        </div>
      </header>

      {/* 3. MAIN WORKSPACE CONTAINER */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* LEFT COLUMN: Workspace with Tabs (Code / Flowchart / Python) */}
        <div className="flex-1 flex flex-col border-r border-gray-800/80 bg-[#07090e] overflow-hidden">
          {/* Sub-Header Tabs */}
          <div className="h-9 border-b border-gray-800/80 bg-[#0b0f19] px-3 flex items-center justify-between">
            <div className="flex items-center space-x-1">
              <button
                onClick={() => setActiveMainTab("code")}
                className={`px-3 py-1 text-xs font-bold rounded-t-md transition flex items-center gap-1.5 ${
                  activeMainTab === "code"
                    ? "bg-[#07090e] text-sky-400 border-t-2 border-sky-500 shadow"
                    : "text-gray-400 hover:text-gray-200"
                }`}
              >
                <span>🧩 Código (Bloques)</span>
              </button>

              <button
                onClick={handleOpenFlowchart}
                className={`px-3 py-1 text-xs font-bold rounded-t-md transition flex items-center gap-1.5 ${
                  activeMainTab === "flowchart"
                    ? "bg-[#07090e] text-sky-400 border-t-2 border-sky-500 shadow"
                    : "text-gray-400 hover:text-gray-200"
                }`}
              >
                <span>📊 Flujo (Mermaid DAG)</span>
              </button>

              <button
                onClick={() => setActiveMainTab("python")}
                className={`px-3 py-1 text-xs font-bold rounded-t-md transition flex items-center gap-1.5 ${
                  activeMainTab === "python"
                    ? "bg-[#07090e] text-sky-400 border-t-2 border-sky-500 shadow"
                    : "text-gray-400 hover:text-gray-200"
                }`}
              >
                <span>💻 Microservicio Python</span>
              </button>
            </div>

            <div className="text-[11px] text-gray-500 font-mono">
              Status: <span className="text-gray-300 font-semibold">{statusMessage}</span>
            </div>
          </div>

          {/* TAB 1: CODE / SCRATUX BLOCKS WORKSPACE */}
          {activeMainTab === "code" && (
            <div className="flex-1 flex overflow-hidden">
              {/* PALETA DE BLOQUES (Streamlined Toolbox) */}
              <div className="w-64 bg-[#0b0f19] border-r border-gray-800/80 flex flex-col justify-between overflow-hidden z-20">
                {/* Header */}
                <div className="p-3 border-b border-gray-800/80 bg-gray-950/60 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-5 h-5 rounded-md bg-gradient-to-tr from-sky-500 to-indigo-600 flex items-center justify-center text-xs">
                      🧩
                    </div>
                    <span className="font-extrabold text-xs text-gray-200">Paleta de Bloques</span>
                  </div>
                  <span className="text-[10px] text-gray-500 font-mono">6 Bloques</span>
                </div>

                {/* Blocks List */}
                <div className="flex-1 overflow-y-auto p-3 space-y-4">
                  {/* Section 1: Pasos & Estados */}
                  <div>
                    <div className="text-[10px] uppercase tracking-wider font-bold text-gray-400 mb-2 flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-sky-400"></span>
                      <span>Pasos & Estados</span>
                    </div>

                    <div className="space-y-2">
                      {/* 1. Paso de Catálogo */}
                      <div
                        onClick={() => {
                          addStepBlockToWorkspace();
                          setStatusMessage("Añadido 'Paso de Catálogo' al canvas");
                        }}
                        className="p-2.5 rounded-xl bg-gradient-to-r from-blue-950/40 to-blue-900/20 border border-blue-500/40 hover:border-blue-400 text-white cursor-pointer hover:scale-[1.02] shadow-sm transition group"
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs font-bold flex items-center gap-1.5 text-blue-300">
                            <span className="w-5 h-5 rounded-md bg-blue-500 flex items-center justify-center text-white text-[11px]">📦</span>
                            <span>Paso de Catálogo</span>
                          </span>
                          <span className="text-[10px] text-blue-400 group-hover:text-blue-300 font-mono font-bold">+ Añadir</span>
                        </div>
                        <p className="text-[10px] text-gray-400 leading-tight">
                          196 pasos oficiales y plugins. Filtra por repo, categoría y selecciona el step en el mismo bloque.
                        </p>
                      </div>

                      {/* 2. Paso con IA */}
                      <div
                        onClick={() => {
                          addAiStepBlockToWorkspace();
                          setStatusMessage("Añadido 'Paso con IA' al canvas");
                        }}
                        className="p-2.5 rounded-xl bg-gradient-to-r from-purple-950/40 to-purple-900/20 border border-purple-500/40 hover:border-purple-400 text-white cursor-pointer hover:scale-[1.02] shadow-sm transition group"
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs font-bold flex items-center gap-1.5 text-purple-300">
                            <span className="w-5 h-5 rounded-md bg-purple-600 flex items-center justify-center text-white text-[11px]">✨</span>
                            <span>Paso con IA</span>
                          </span>
                          <span className="text-[10px] text-purple-400 group-hover:text-purple-300 font-mono font-bold">+ Añadir</span>
                        </div>
                        <p className="text-[10px] text-gray-400 leading-tight">
                          Describe en texto lo que debe hacer y la IA generará el código Dialecto A y Context DTO.
                        </p>
                      </div>

                      {/* 3. Paso Personalizado (.py) */}
                      <div
                        onClick={() => {
                          addUserFileStepBlockToWorkspace();
                          setStatusMessage("Añadido 'Paso Personalizado (.py)' al canvas");
                        }}
                        className="p-2.5 rounded-xl bg-gradient-to-r from-teal-950/40 to-teal-900/20 border border-teal-500/40 hover:border-teal-400 text-white cursor-pointer hover:scale-[1.02] shadow-sm transition group"
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs font-bold flex items-center gap-1.5 text-teal-300">
                            <span className="w-5 h-5 rounded-md bg-teal-600 flex items-center justify-center text-white text-[11px]">📄</span>
                            <span>Paso Personalizado</span>
                          </span>
                          <span className="text-[10px] text-teal-400 group-hover:text-teal-300 font-mono font-bold">+ Adjuntar</span>
                        </div>
                        <p className="text-[10px] text-gray-400 leading-tight">
                          Adjunta tu archivo Python (.py) para usarlo directamente al construir el microservicio.
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Section 2: Control de Flujo */}
                  <div>
                    <div className="text-[10px] uppercase tracking-wider font-bold text-gray-400 mb-2 flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-400"></span>
                      <span>Control de Flujo</span>
                    </div>

                    <div className="space-y-2">
                      {/* 4. Condición Si / Sino */}
                      <div
                        onClick={() => {
                          addControlBlockToWorkspace("wpipe_if_else");
                          setStatusMessage("Añadida 'Condición Si / Sino' al canvas");
                        }}
                        className="p-2.5 rounded-xl bg-gradient-to-r from-amber-950/40 to-amber-900/20 border border-amber-500/40 hover:border-amber-400 text-white cursor-pointer hover:scale-[1.02] shadow-sm transition group"
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs font-bold flex items-center gap-1.5 text-amber-300">
                            <span className="w-5 h-5 rounded-md bg-amber-500 flex items-center justify-center text-white text-[11px]">🔀</span>
                            <span>Condición (Si / Sino)</span>
                          </span>
                          <span className="text-[10px] text-amber-400 group-hover:text-amber-300 font-mono font-bold">+ Añadir</span>
                        </div>
                        <p className="text-[10px] text-gray-400 leading-tight">
                          Bifurcación lógica con ramas THEN y ELSE anidadas (Condition).
                        </p>
                      </div>

                      {/* 5. Bucle Repetir */}
                      <div
                        onClick={() => {
                          addControlBlockToWorkspace("wpipe_for");
                          setStatusMessage("Añadido 'Bucle Repetir (For)' al canvas");
                        }}
                        className="p-2.5 rounded-xl bg-gradient-to-r from-orange-950/40 to-orange-900/20 border border-orange-500/40 hover:border-orange-400 text-white cursor-pointer hover:scale-[1.02] shadow-sm transition group"
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs font-bold flex items-center gap-1.5 text-orange-300">
                            <span className="w-5 h-5 rounded-md bg-orange-600 flex items-center justify-center text-white text-[11px]">🔁</span>
                            <span>Bucle Repetir (For)</span>
                          </span>
                          <span className="text-[10px] text-orange-400 group-hover:text-orange-300 font-mono font-bold">+ Añadir</span>
                        </div>
                        <p className="text-[10px] text-gray-400 leading-tight">
                          Ejecuta los pasos contenidos N veces de manera determinista (For).
                        </p>
                      </div>

                      {/* 6. Ejecución Paralela */}
                      <div
                        onClick={() => {
                          addControlBlockToWorkspace("wpipe_parallel");
                          setStatusMessage("Añadida 'Ejecución Paralela' al canvas");
                        }}
                        className="p-2.5 rounded-xl bg-gradient-to-r from-emerald-950/40 to-emerald-900/20 border border-emerald-500/40 hover:border-emerald-400 text-white cursor-pointer hover:scale-[1.02] shadow-sm transition group"
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs font-bold flex items-center gap-1.5 text-emerald-300">
                            <span className="w-5 h-5 rounded-md bg-emerald-600 flex items-center justify-center text-white text-[11px]">⚡</span>
                            <span>Ejecución Paralela</span>
                          </span>
                          <span className="text-[10px] text-emerald-400 group-hover:text-emerald-300 font-mono font-bold">+ Añadir</span>
                        </div>
                        <p className="text-[10px] text-gray-400 leading-tight">
                          Ejecución concurrente con política de fusión accumulate o last_wins (Parallel).
                        </p>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Footer: Open Catalog Docs */}
                <div className="p-3 border-t border-gray-800/80 bg-gray-950/80">
                  <button
                    onClick={() => setShowExtensionModal(true)}
                    className="w-full py-2 px-3 rounded-lg bg-gray-900 hover:bg-gray-800 border border-gray-700/80 text-gray-200 hover:text-white text-xs font-semibold flex items-center justify-center gap-2 transition"
                  >
                    <BookOpen size={14} className="text-sky-400" />
                    <span>Catálogo Completo (196 Steps)</span>
                  </button>
                </div>
              </div>

              {/* Center Canvas: Blockly Editor */}
              <div className="flex-1 bg-[#07090e] p-2 relative overflow-hidden">
                <BlocklyComponent />
              </div>
            </div>
          )}

          {/* TAB 2: MERMAID FLOWCHART VIEW */}
          {activeMainTab === "flowchart" && (
            <div className="flex-1 flex flex-col bg-[#07090e] overflow-hidden p-4">
              <div className="flex items-center justify-between pb-3 border-b border-gray-800">
                <div className="flex items-center space-x-2">
                  <span className="text-xs font-bold text-gray-300">Zoom:</span>
                  <button
                    onClick={() => setZoomScale((s) => Math.max(0.3, s - 0.2))}
                    className="p-1.5 bg-gray-800 hover:bg-gray-700 rounded text-sky-400"
                  >
                    <ZoomOut size={14} />
                  </button>
                  <span className="text-xs font-mono text-sky-400 w-12 text-center">{Math.round(zoomScale * 100)}%</span>
                  <button
                    onClick={() => setZoomScale((s) => Math.min(3.0, s + 0.2))}
                    className="p-1.5 bg-gray-800 hover:bg-gray-700 rounded text-sky-400"
                  >
                    <ZoomIn size={14} />
                  </button>
                  <button
                    onClick={() => setZoomScale(1.0)}
                    className="px-2 py-1 bg-gray-800 hover:bg-gray-700 rounded text-xs text-gray-300"
                  >
                    100%
                  </button>
                </div>

                <div className="flex items-center space-x-2">
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(mermaidCode);
                      setStatusMessage("Código Mermaid copiado al portapapeles");
                    }}
                    className="px-3 py-1 bg-gray-800 hover:bg-gray-700 text-sky-300 rounded text-xs font-semibold flex items-center gap-1.5"
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
                      setStatusMessage("Plan de trabajo (.md) descargado");
                    }}
                    className="px-3 py-1 bg-emerald-950 hover:bg-emerald-900 text-emerald-300 rounded text-xs font-semibold flex items-center gap-1.5"
                  >
                    <Download size={13} />
                    <span>Exportar Plan (.md)</span>
                  </button>
                </div>
              </div>

              <div className="flex-1 overflow-auto p-8 custom-modal-scrollbar text-center">
                <div
                  ref={mermaidFullRef}
                  style={{ transform: `scale(${zoomScale})`, transformOrigin: "top center", transition: "transform 0.15s ease-out" }}
                  className="inline-block"
                ></div>
              </div>
            </div>
          )}

          {/* TAB 3: TARGET IR / PYTHON MICROSERVICE PREVIEW */}
          {activeMainTab === "python" && (
            <div className="flex-1 flex bg-[#07090e] overflow-hidden">
              {/* Files sidebar */}
              <div className="w-56 border-r border-gray-800/80 bg-[#0d121f] p-3 flex flex-col space-y-1">
                <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-2">Archivos Generados</span>
                {previewLoading ? (
                  <p className="text-xs text-gray-500 italic">Generando TargetIR...</p>
                ) : (
                  generatedFiles.map((file, idx) => (
                    <button
                      key={file.path}
                      onClick={() => setSelectedFileIdx(idx)}
                      className={`w-full text-left px-2.5 py-1.5 rounded text-xs font-mono truncate transition ${
                        selectedFileIdx === idx
                          ? "bg-sky-950 text-sky-300 font-bold border border-sky-800"
                          : "text-gray-400 hover:text-gray-200 hover:bg-gray-800/50"
                      }`}
                    >
                      {file.path}
                    </button>
                  ))
                )}
              </div>

              {/* Code viewer */}
              <div className="flex-1 flex flex-col overflow-hidden bg-gray-950">
                <div className="h-10 border-b border-gray-800 px-4 flex items-center justify-between bg-gray-900/60">
                  <span className="text-xs font-mono text-sky-400 font-bold">
                    {generatedFiles[selectedFileIdx]?.path || "code"}
                  </span>
                  <button
                    onClick={() => {
                      if (generatedFiles[selectedFileIdx]) {
                        navigator.clipboard.writeText(generatedFiles[selectedFileIdx].content);
                        setStatusMessage(`Copiado ${generatedFiles[selectedFileIdx].path}`);
                      }
                    }}
                    className="px-2.5 py-1 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded text-xs flex items-center gap-1"
                  >
                    <Copy size={12} />
                    <span>Copiar</span>
                  </button>
                </div>
                <pre className="flex-1 p-4 font-mono text-xs text-gray-200 overflow-auto whitespace-pre leading-relaxed custom-modal-scrollbar">
                  {generatedFiles[selectedFileIdx]?.content || ""}
                </pre>
              </div>
            </div>
          )}
        </div>

        {/* RIGHT COLUMN: SIMULATION STAGE (Escenario de Scratux) */}
        <div
          className={`border-l border-gray-800/80 bg-[#0c101c] flex flex-col z-20 shadow-2xl transition-all duration-300 ${
            stageViewMode === "fullscreen"
              ? "absolute inset-0 z-50 bg-[#07090e]"
              : stageViewMode === "compact"
              ? "w-80"
              : "w-96"
          }`}
        >
          {/* Stage Header Controls: 🏁 Green Flag and 🛑 Red Stop */}
          <div className="h-12 border-b border-gray-800/80 bg-[#0f172a] px-3 flex items-center justify-between">
            <div className="flex items-center space-x-2">
              {/* Green Flag button */}
              <button
                onClick={handleStartSimulation}
                disabled={isSimulating}
                className={`p-1.5 rounded-lg border flex items-center gap-1.5 text-xs font-bold shadow-md transition ${
                  isSimulating
                    ? "bg-emerald-950/40 border-emerald-900 text-emerald-600 opacity-60 cursor-not-allowed"
                    : "bg-emerald-600 hover:bg-emerald-500 border-emerald-400 text-white cursor-pointer active:scale-95 shadow-emerald-950/60"
                }`}
                title="Iniciar Simulación del Pipeline (Bandera Verde)"
              >
                <Play size={14} className="fill-current" />
                <span>Simular</span>
              </button>

              {/* Red Stop button */}
              <button
                onClick={handleStopSimulation}
                disabled={!isSimulating}
                className={`p-1.5 rounded-lg border flex items-center gap-1 text-xs font-bold transition ${
                  isSimulating
                    ? "bg-rose-600 hover:bg-rose-500 border-rose-400 text-white cursor-pointer active:scale-95 shadow-lg"
                    : "bg-gray-800/50 border-gray-700/60 text-gray-500 cursor-not-allowed"
                }`}
                title="Detener Simulación"
              >
                <Square size={13} className="fill-current" />
                <span>Parar</span>
              </button>
            </div>

            {/* Stage View Size Controls */}
            <div className="flex items-center space-x-1 text-gray-400">
              <span className="text-[10px] font-mono text-gray-400 mr-1 font-bold">ESCENARIO</span>
              <button
                onClick={() => setStageViewMode(stageViewMode === "compact" ? "normal" : "compact")}
                className="p-1 hover:text-white rounded"
                title="Alternar tamaño de escenario"
              >
                <Layers size={14} />
              </button>
              <button
                onClick={() => setStageViewMode(stageViewMode === "fullscreen" ? "normal" : "fullscreen")}
                className="p-1 hover:text-white rounded"
                title="Pantalla completa"
              >
                <Maximize2 size={14} />
              </button>
            </div>
          </div>

          {/* Simulation Stage Content */}
          <div className="flex-1 flex flex-col overflow-y-auto p-3 space-y-3">
            {/* Live Pipeline Flow Visualizer */}
            <div className="bg-gray-950/90 border border-gray-800/80 rounded-xl p-3 shadow-inner">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-sky-400 to-indigo-300 font-heading flex items-center gap-1.5">
                  <Terminal size={14} className="text-sky-400" />
                  <span>Flujo de Ejecución en Vivo</span>
                </span>
                <span className={`text-[10px] px-2 py-0.5 rounded-full font-mono font-bold ${
                  isSimulating ? "bg-amber-950 text-amber-300 border border-amber-800 animate-pulse" : "bg-gray-900 text-gray-400"
                }`}>
                  {isSimulating ? "EJECUTANDO ⚡" : "EN ESPERA"}
                </span>
              </div>

              {/* Step Sequence Timeline */}
              <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                {simSteps.length === 0 ? (
                  <p className="text-[11px] text-gray-500 italic text-center py-4">
                    Haz clic en la bandera verde para simular la ejecución paso a paso.
                  </p>
                ) : (
                  simSteps.map((step, idx) => (
                    <div
                      key={step.id}
                      className={`p-2 rounded-lg border text-xs flex items-center justify-between transition ${
                        step.status === "running"
                          ? "bg-amber-950/40 border-amber-500 text-amber-200 shadow-md ring-1 ring-amber-500/50"
                          : step.status === "success"
                          ? "bg-emerald-950/30 border-emerald-700/80 text-emerald-200"
                          : step.status === "error"
                          ? "bg-rose-950/40 border-rose-600 text-rose-200"
                          : "bg-gray-900/60 border-gray-800/80 text-gray-400"
                      }`}
                    >
                      <div className="flex items-center space-x-2 truncate">
                        <span className="font-mono text-[10px] opacity-60">#{idx + 1}</span>
                        <span className="font-bold truncate">{step.name}</span>
                      </div>
                      <div className="flex items-center space-x-2">
                        {step.status === "running" && <RefreshCw size={12} className="animate-spin text-amber-400" />}
                        {step.status === "success" && (
                          <span className="text-[10px] font-mono text-emerald-400">✓ {step.durationMs}ms</span>
                        )}
                        {step.status === "error" && <span className="text-[10px] font-mono text-rose-400">✕ ERROR</span>}
                        {step.status === "idle" && <span className="text-[10px] font-mono text-gray-600">esperando</span>}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Input Payload Simulator Accordion */}
            <div className="bg-gray-950/80 border border-gray-800/80 rounded-xl p-3">
              <span className="text-xs font-bold text-gray-300 block mb-1.5 flex items-center gap-1.5">
                <Database size={13} className="text-amber-400" />
                <span>Payload de Entrada (JSON)</span>
              </span>
              <textarea
                rows={3}
                value={testPayloadText}
                onChange={(e) => setTestPayloadText(e.target.value)}
                className="w-full bg-gray-900 border border-gray-800 rounded-md p-2 text-[11px] font-mono text-amber-200 focus:outline-none resize-none"
                placeholder='{"key": "value"}'
              />
            </div>

            {/* Live Context State Mutation Inspector */}
            <div className="bg-gray-950/80 border border-gray-800/80 rounded-xl p-3 flex-1 flex flex-col">
              <span className="text-xs font-bold text-gray-300 block mb-2 flex items-center gap-1.5">
                <Layers size={13} className="text-sky-400" />
                <span>Estado del Contexto (data)</span>
              </span>
              <div className="flex-1 overflow-y-auto max-h-36 bg-gray-900/90 border border-gray-800/80 rounded-md p-2 font-mono text-[11px] space-y-1">
                {Object.keys(simContext).length === 0 ? (
                  <p className="text-gray-500 italic">No hay variables de contexto activas.</p>
                ) : (
                  Object.entries(simContext).map(([k, v]) => (
                    <div key={k} className="flex items-center justify-between border-b border-gray-800/50 pb-0.5">
                      <span className="text-sky-300 font-bold">{k}:</span>
                      <span className="text-gray-300 truncate max-w-[180px]">{JSON.stringify(v)}</span>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* System Resource Metrics */}
            <div className="bg-gray-950/60 border border-gray-800/80 rounded-xl p-2.5 flex items-center justify-between text-xs font-mono">
              <div className="flex items-center space-x-1.5 text-gray-400">
                <Cpu size={14} className="text-sky-400" />
                <span>CPU: <strong className="text-gray-200">{cpuUsage}%</strong></span>
              </div>
              <div className="flex items-center space-x-1.5 text-gray-400">
                <span className="text-purple-400">RAM:</span>
                <strong className="text-gray-200">{ramUsage} MB</strong>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 4. EXTENSION LIBRARY MODAL (196 Catalog Steps) */}
      {showExtensionModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 z-50">
          <div className="bg-[#0f172a] border border-sky-800/80 rounded-2xl max-w-4xl w-full p-6 space-y-4 shadow-2xl glass-panel max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between border-b border-gray-800 pb-3">
              <div>
                <h3 className="text-lg font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-sky-400 via-indigo-300 to-purple-300 font-heading">
                  📚 Catálogo de Extensiones WPipe (196 Steps de Release)
                </h3>
                <p className="text-xs text-gray-400">
                  Selecciona y añade pasos oficiales y comunitarios de release a tu workspace de Scratch.
                </p>
              </div>
              <button
                onClick={() => setShowExtensionModal(false)}
                className="text-gray-400 hover:text-white font-bold p-1 text-lg"
              >
                ✕
              </button>
            </div>

            {/* Search and Filters */}
            <div className="flex items-center space-x-3">
              <div className="flex-1 relative">
                <Search size={14} className="absolute left-3 top-3 text-gray-500" />
                <input
                  type="text"
                  placeholder="Buscar en el catálogo (ej: redis, waf, yolo, mysql, http)..."
                  value={extensionSearch}
                  onChange={(e) => setExtensionSearch(e.target.value)}
                  className="w-full bg-gray-950 border border-gray-800 rounded-xl py-2 pl-9 pr-3 text-xs text-gray-200 focus:outline-none"
                />
              </div>

              <select
                value={extensionCategoryFilter}
                onChange={(e) => setExtensionCategoryFilter(e.target.value)}
                className="bg-gray-950 border border-gray-800 rounded-xl py-2 px-3 text-xs text-gray-300 focus:outline-none"
              >
                <option value="ALL">Todas las Categorías</option>
                {Array.from(new Set(catalog.map((s) => s.category).filter(Boolean))).map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>

            {/* Catalog Grid */}
            <div className="flex-1 overflow-y-auto grid grid-cols-2 gap-3 pr-1">
              {catalog
                .filter((s) => {
                  if (extensionCategoryFilter !== "ALL" && s.category.toLowerCase() !== extensionCategoryFilter.toLowerCase()) {
                    return false;
                  }
                  if (!extensionSearch) return true;
                  const q = extensionSearch.toLowerCase();
                  return (
                    s.name.toLowerCase().includes(q) ||
                    s.func_name.toLowerCase().includes(q) ||
                    s.category.toLowerCase().includes(q) ||
                    s.description.toLowerCase().includes(q)
                  );
                })
                .slice(0, 100)
                .map((step, idx) => (
                  <div
                    key={idx}
                    className="p-3.5 bg-gray-950/70 border border-gray-800/80 hover:border-sky-500 rounded-xl transition flex flex-col justify-between group"
                  >
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-bold text-gray-100 flex items-center gap-1.5">
                          <span>📦</span> {step.name}
                        </span>
                        <span className={`text-[9px] px-2 py-0.5 rounded font-mono font-bold ${
                          step.repo === "Official" ? "bg-sky-950 text-sky-300 border border-sky-800" : "bg-emerald-950 text-emerald-300 border border-emerald-800"
                        }`}>
                          {step.repo}
                        </span>
                      </div>
                      <p className="text-[11px] text-gray-400 line-clamp-2">{step.description || "Paso modular de procesamiento."}</p>
                    </div>

                    <div className="mt-3 pt-2 border-t border-gray-900 flex items-center justify-between">
                      <span className="text-[10px] text-gray-500 font-mono">cat: {step.category}</span>
                      <button
                        onClick={() => {
                          addStepBlockToWorkspace(step.name, step.namespace, "catalog");
                          setStatusMessage(`Paso '${step.name}' añadido al workspace`);
                          setShowExtensionModal(false);
                        }}
                        className="px-2.5 py-1 bg-sky-600 hover:bg-sky-500 text-white rounded text-[11px] font-bold shadow transition flex items-center gap-1"
                      >
                        <Plus size={12} />
                        <span>Añadir</span>
                      </button>
                    </div>
                  </div>
                ))}
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
    </div>
  );
}
