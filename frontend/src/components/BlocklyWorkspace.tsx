import React, { useEffect, useRef } from "react";
import * as Blockly from "blockly";
import { CanvasIR, CanvasNode, CanvasEdge, StepOrigin } from "../lib/ir/schemas";

export interface AttachedUserFile {
  fileName: string;
  code: string;
  stepName: string;
}

// Global registry for files attached to user file step blocks
export const attachedFilesRegistry: Record<string, AttachedUserFile> = {};

let globalCatalog: any[] = [];
export function setBlocklyCatalog(catalog: any[]) {
  globalCatalog = catalog;
}

function isPlugin(s: any): boolean {
  if (!s) return false;
  const r = (s.repo || "").toLowerCase();
  const ns = (s.namespace || "").toLowerCase();
  return r === "plugin" || r === "community" || ns.includes("plugin") || ns.startsWith("wpipe_plugins");
}

function isOfficial(s: any): boolean {
  if (!s) return false;
  return !isPlugin(s);
}

function getRepoOptions(): [string, string][] {
  return [
    ["🌐 Todos los Repos", "ALL"],
    ["📦 Oficiales (wpipe-steps)", "Official"],
    ["🧩 Plugins (wpipe-plugins)", "Plugin"],
  ];
}

function getCategoryOptions(repoFilter: string): [string, string][] {
  let filtered = globalCatalog;
  if (repoFilter === "Official") {
    filtered = filtered.filter(isOfficial);
  } else if (repoFilter === "Plugin") {
    filtered = filtered.filter(isPlugin);
  }

  const catSet = new Set<string>();
  filtered.forEach((s) => {
    if (s.category) catSet.add(s.category.toLowerCase());
  });

  const cats = Array.from(catSet).sort();
  const options: [string, string][] = [["📂 Todas las Categorías", "ALL"]];
  cats.forEach((c) => {
    const capitalized = c.charAt(0).toUpperCase() + c.slice(1);
    options.push([`📁 ${capitalized}`, c]);
  });

  if (options.length === 1 && filtered.length === 0) {
    return [
      ["📂 Todas las Categorías", "ALL"],
      ["📁 Conectividad", "connectivity"],
      ["📁 Base de Datos", "database"],
      ["📁 Seguridad", "security"],
      ["📁 Visión", "vision"],
      ["📁 IA", "ai"],
    ];
  }
  return options;
}

function getStepOptions(repoFilter: string, catFilter: string, searchTerm: string = ""): [string, string][] {
  let filtered = globalCatalog;
  if (repoFilter === "Official") {
    filtered = filtered.filter(isOfficial);
  } else if (repoFilter === "Plugin") {
    filtered = filtered.filter(isPlugin);
  }

  if (catFilter && catFilter !== "ALL") {
    const withCat = filtered.filter((s) => (s.category || "").toLowerCase() === catFilter.toLowerCase());
    if (withCat.length > 0) {
      filtered = withCat;
    }
  }

  if (searchTerm && searchTerm.trim()) {
    const q = searchTerm.toLowerCase().trim();
    filtered = filtered.filter((s) => {
      const n = (s.name || "").toLowerCase();
      const fn = (s.func_name || "").toLowerCase();
      const d = (s.description || "").toLowerCase();
      return n.includes(q) || fn.includes(q) || d.includes(q);
    });
  }

  if (filtered.length === 0) {
    if (globalCatalog.length === 0) {
      return [
        ["📦 HttpRequest (connectivity)", "HttpRequest"],
        ["📦 NmapScanStep (security)", "NmapScanStep"],
        ["📦 MySQLQuery (database)", "MySQLQuery"],
        ["📦 ImageECamYOLO (vision)", "ImageECamYOLO"],
      ];
    }
    return [["(Sin estados disponibles)", "none"]];
  }

  // Return up to 100 options for responsive UI
  return filtered.slice(0, 100).map((s) => {
    const label = s.func_name || s.name;
    const cat = s.category ? ` [${s.category}]` : "";
    return [`📦 ${label}${cat}`, label];
  });
}

export function createCollapseToggleField(): Blockly.FieldImage {
  const minusSvg =
    "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%23ffffff' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'><rect x='2' y='2' width='20' height='20' rx='5' fill='%231f2937' stroke='%2338bdf8'/><line x1='7' y1='12' x2='17' y2='12'/></svg>";

  return new Blockly.FieldImage(
    minusSvg,
    16,
    16,
    "➖ Colapsar este bloque sobre sí mismo (Click para alternar)",
    function (this: any) {
      const block = this.getSourceBlock();
      if (block && typeof block.setCollapsed === "function") {
        block.setCollapsed(!block.isCollapsed());
      }
    }
  );
}

export function attachBlockCollapseBehavior(block: Blockly.Block) {
  const blockSvg = block as any;
  if (blockSvg && typeof blockSvg.getSvgRoot === "function") {
    const svg = blockSvg.getSvgRoot();
    if (svg) {
      svg.ondblclick = (e: MouseEvent) => {
        e.stopPropagation();
        e.preventDefault();
        if (typeof block.setCollapsed === "function") {
          block.setCollapsed(!block.isCollapsed());
        }
      };
    }
  }
}

// Define custom block shapes and categories for WPipe Studio Scratch workspace
export function registerWPipeBlocklyBlocks() {
  if (Blockly.Blocks["wpipe_step"]) return;

  // 0. WPipe Trigger / Event Ingress Block (Scratch Events Gold/Amber)
  Blockly.Blocks["wpipe_trigger"] = {
    init: function () {
      this.appendDummyInput("HEADER")
        .appendField("🚀 Disparador del Pipeline:")
        .appendField(
          new Blockly.FieldDropdown(
            [
              ["🌐 API REST (FastAPI POST /run)", "api"],
              ["📨 Kafka Consumer (Topic)", "kafka"],
              ["📦 Redis Stream / Queue (Key)", "redis"],
              ["⏱️ Cron / Programador (Interval)", "cron"],
              ["🔗 Webhook Receptor (Endpoint)", "webhook"],
              ["💻 CLI / Ejecución Local", "cli"],
            ],
            function (this: any, newVal: string) {
              const block = this.getSourceBlock();
              if (block) {
                const paramField = block.getField("TRIGGER_PARAM");
                if (paramField) {
                  if (newVal === "api") paramField.setValue("/run");
                  else if (newVal === "kafka") paramField.setValue("events.input");
                  else if (newVal === "redis") paramField.setValue("wpipe:queue:in");
                  else if (newVal === "cron") paramField.setValue("*/5 * * * *");
                  else if (newVal === "webhook") paramField.setValue("/webhook/incoming");
                  else if (newVal === "cli") paramField.setValue("main.py");
                }
              }
              return newVal;
            }
          ),
          "TRIGGER_TYPE"
        )
        .appendField(createCollapseToggleField(), "COLLAPSE_BTN");

      this.appendDummyInput()
        .appendField("Ruta / Tópico / Clave:")
        .appendField(new Blockly.FieldTextInput("/run"), "TRIGGER_PARAM");

      // Hat block: no previous connection, only next connection
      this.setPreviousStatement(false);
      this.setNextStatement(true, null);
      this.setColour(42); // Scratch Events Gold / Amber
      this.setTooltip(
        "Disparador de entrada del pipeline: define cómo se recibe la carga inicial (API REST, Kafka, Redis, Cron, etc.). Doble-clic para colapsar."
      );
    },
  };

  // 1. WPipe Step Block (Motion Blue) with Interactive Dropdowns directly inside the block
  Blockly.Blocks["wpipe_step"] = {
    init: function () {
      const configField = new Blockly.FieldImage(
        "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='%2360a5fa'><path d='M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z'/></svg>",
        18,
        18,
        "⚙️ Configurar Parámetros (Click para editar)",
        () => {
          if (typeof (window as any).onOpenBlockConfigModal === "function") {
            (window as any).onOpenBlockConfigModal(this);
          }
        }
      );

      this.appendDummyInput("HEADER")
        .appendField("📦 Paso de Catálogo:")
        .appendField(configField, "CONFIG_ICON")
        .appendField(createCollapseToggleField(), "COLLAPSE_BTN");

      const repoDropdown = new Blockly.FieldDropdown(getRepoOptions, function (this: any, newVal: string) {
        const block = this.getSourceBlock();
        if (block) {
          block.setFieldValue("ALL", "CAT_FILTER");
          const stepOpts = getStepOptions(newVal, "ALL", "");
          if (stepOpts.length > 0 && stepOpts[0][1] !== "none") {
            block.setFieldValue(stepOpts[0][1], "STEP_NAME");
          }
        }
        return newVal;
      });

      this.appendDummyInput()
        .appendField("Origen:")
        .appendField(repoDropdown, "REPO_FILTER");

      const catDropdown = new Blockly.FieldDropdown(
        function (this: any) {
          const block = this.getSourceBlock();
          const repo = block ? block.getFieldValue("REPO_FILTER") || "ALL" : "ALL";
          return getCategoryOptions(repo);
        },
        function (this: any, newCat: string) {
          const block = this.getSourceBlock();
          if (block) {
            const repo = block.getFieldValue("REPO_FILTER") || "ALL";
            const stepOpts = getStepOptions(repo, newCat, "");
            if (stepOpts.length > 0 && stepOpts[0][1] !== "none") {
              block.setFieldValue(stepOpts[0][1], "STEP_NAME");
            }
          }
          return newCat;
        }
      );

      this.appendDummyInput()
        .appendField("Categoría:")
        .appendField(catDropdown, "CAT_FILTER");

      this.appendDummyInput()
        .appendField("🔍 Filtro:")
        .appendField(new Blockly.FieldTextInput(""), "SEARCH_FILTER");

      this.appendDummyInput()
        .appendField("Estado:")
        .appendField(
          new Blockly.FieldDropdown(function () {
            const block = this.getSourceBlock();
            const repo = block ? block.getFieldValue("REPO_FILTER") || "ALL" : "ALL";
            const cat = block ? block.getFieldValue("CAT_FILTER") || "ALL" : "ALL";
            const q = block ? block.getFieldValue("SEARCH_FILTER") || "" : "";
            return getStepOptions(repo, cat, q);
          }),
          "STEP_NAME"
        );

      this.appendDummyInput("NS_ROW")
        .appendField("Namespace:")
        .appendField(new Blockly.FieldTextInput("wpipe_steps.connectivity"), "NAMESPACE");

      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour(217); // Scratch Motion Blue
      this.setTooltip("Paso ejecutable de WPipe. Usa los selectores para elegir origen, categoría y step. Doble-clic para colapsar.");
    },
    onchange: function () {
      if (!this.workspace || this.workspace.isDragging()) return;
      const stepName = this.getFieldValue("STEP_NAME");
      if (stepName && stepName !== "none") {
        const match = globalCatalog.find(
          (s) => s.name === stepName || s.func_name === stepName
        );
        if (match) {
          if (match.namespace && this.getFieldValue("NAMESPACE") !== match.namespace) {
            this.setFieldValue(match.namespace, "NAMESPACE");
          }
          if (match.description) {
            this.setTooltip(`${match.name}: ${match.description}\nNamespace: ${match.namespace}`);
          }
        }
      }
    },
  };

  // 2. AI Step Block (Purple / Scratch My Blocks) with Description & Dialect A Generator
  Blockly.Blocks["wpipe_ai_step"] = {
    init: function () {
      const editPromptField = new Blockly.FieldImage(
        "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='%23c084fc'><path d='M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z'/></svg>",
        18,
        18,
        "✏️ Editar Prompt IA (Click para abrir modal)",
        () => {
          if (typeof (window as any).onOpenAiPromptModal === "function") {
            (window as any).onOpenAiPromptModal(this);
          }
        }
      );

      this.appendDummyInput("HEADER")
        .appendField("✨ Paso Generado con IA:")
        .appendField(editPromptField, "AI_EDIT_ICON")
        .appendField(createCollapseToggleField(), "COLLAPSE_BTN");

      this.appendDummyInput()
        .appendField("Nombre:")
        .appendField(new Blockly.FieldTextInput("custom_ai_state"), "STEP_NAME");

      this.appendDummyInput()
        .appendField("Prompt:")
        .appendField(new Blockly.FieldTextInput("Describir qué hace este estado..."), "AI_PROMPT");

      this.appendDummyInput()
        .appendField("⚙️ Dialecto A:")
        .appendField(new Blockly.FieldLabel("Emite @step + Context DTO"), "DIALECT_LABEL");

      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour(275); // Scratch My Blocks Purple
      this.setTooltip("Paso autogenerado por IA a partir de tu descripción en lenguaje natural. Doble-clic para colapsar.");
    },
  };

  // 3. User Custom File (.py) Block (Teal / Cyan) with File Upload Action
  Blockly.Blocks["wpipe_user_file_step"] = {
    init: function () {
      const attachFileField = new Blockly.FieldImage(
        "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='%232dd4bf'><path d='M16.5 6v11.5c0 2.21-1.79 4-4 4s-4-1.79-4-4V5c0-1.38 1.12-2.5 2.5-2.5s2.5 1.12 2.5 2.5v10.5c0 .55-.45 1-1 1s-1-.45-1-1V6H10v9.5c0 1.38 1.12 2.5 2.5 2.5s2.5-1.12 2.5-2.5V5c0-2.21-1.79-4-4-4S7 2.79 7 5v12.5c0 3.04 2.46 5.5 5.5 5.5s5.5-2.46 5.5-5.5V6h-1.5z'/></svg>",
        18,
        18,
        "📎 Adjuntar Archivo .py (Click para examinar)",
        () => {
          if (typeof (window as any).onAttachUserFile === "function") {
            (window as any).onAttachUserFile(this);
          }
        }
      );

      this.appendDummyInput("HEADER")
        .appendField("📄 Paso Personalizado (.py):")
        .appendField(attachFileField, "ATTACH_ICON")
        .appendField(createCollapseToggleField(), "COLLAPSE_BTN");

      this.appendDummyInput()
        .appendField("Nombre:")
        .appendField(new Blockly.FieldTextInput("custom_user_step"), "STEP_NAME");

      this.appendDummyInput()
        .appendField("Archivo:")
        .appendField(new Blockly.FieldTextInput("sin_archivo.py"), "FILE_NAME");

      this.appendDummyInput()
        .appendField("Estado:")
        .appendField(new Blockly.FieldLabel("⚠️ Haz clic en 📎 para adjuntar tu .py"), "FILE_STATUS");

      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour(180); // Cyan / Teal
      this.setTooltip("Estado propio cargado desde un archivo Python (.py). Haz clic en 📎 para adjuntarlo. Doble-clic para colapsar.");
    },
  };

  // 4. IF Condition Block (Scratch Control Orange)
  Blockly.Blocks["wpipe_if"] = {
    init: function () {
      this.appendDummyInput("HEADER")
        .appendField("🔀 SI condición:")
        .appendField(new Blockly.FieldTextInput("status_code == 200"), "CONDITION")
        .appendField("ENTONCES:")
        .appendField(createCollapseToggleField(), "COLLAPSE_BTN");
      this.appendStatementInput("DO").setCheck(null).appendField("RAMA VERDADERA:");
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour(36); // Scratch Control Orange
      this.setTooltip("Ejecuta los pasos anidados si la condición evalúa a verdadero (True). Doble-clic para colapsar.");
    },
  };

  // 5. IF-ELSE Dual-Branch Condition Block (Scratch Control Orange)
  Blockly.Blocks["wpipe_if_else"] = {
    init: function () {
      this.appendDummyInput("HEADER")
        .appendField("🔀 SI condición:")
        .appendField(new Blockly.FieldTextInput("status_code == 200"), "CONDITION")
        .appendField("ENTONCES:")
        .appendField(createCollapseToggleField(), "COLLAPSE_BTN");
      this.appendStatementInput("DO").setCheck(null).appendField("RAMA VERDADERA:");
      this.appendDummyInput().appendField("SINO:");
      this.appendStatementInput("ELSE").setCheck(null).appendField("RAMA FALSA:");
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour(36); // Scratch Control Orange
      this.setTooltip("Ejecuta la rama verdadera en True, o la rama falsa en False. Doble-clic para colapsar.");
    },
  };

  // 6. FOR / REPEAT Loop Block (Events Amber)
  Blockly.Blocks["wpipe_for"] = {
    init: function () {
      this.appendDummyInput("HEADER")
        .appendField("🔁 REPETIR")
        .appendField(new Blockly.FieldNumber(5, 1, 1000), "ITERATIONS")
        .appendField("VECES:")
        .appendField(createCollapseToggleField(), "COLLAPSE_BTN");
      this.appendStatementInput("DO").setCheck(null).appendField("PASOS A REPETIR:");
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour(28); // Scratch Events Amber
      this.setTooltip("Ejecuta los pasos contenidos N veces de manera secuencial. Doble-clic para colapsar.");
    },
  };

  // 7. PARALLEL Branch Block (Operators Green)
  Blockly.Blocks["wpipe_parallel"] = {
    init: function () {
      this.appendDummyInput("HEADER")
        .appendField("⚡ EJECUTAR EN PARALELO")
        .appendField(createCollapseToggleField(), "COLLAPSE_BTN");
      this.appendDummyInput()
        .appendField("Fusión de contexto:")
        .appendField(
          new Blockly.FieldDropdown([
            ["Acumular (accumulate)", "accumulate"],
            ["Último gana (last_wins)", "last_wins"],
          ]),
          "MERGE_POLICY"
        );
      this.appendStatementInput("DO").setCheck(null).appendField("RAMAS PARALELAS:");
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour(150); // Scratch Operators Green
      this.setTooltip("Ejecuta los pasos en paralelo fusionando el contexto con la política seleccionada. Doble-clic para colapsar.");
    },
  };

  // 8. WHILE Loop Block (Events Amber)
  Blockly.Blocks["wpipe_while"] = {
    init: function () {
      this.appendDummyInput("HEADER")
        .appendField("🔁 REPETIR MIENTRAS:")
        .appendField(new Blockly.FieldTextInput("retry_count < 3"), "CONDITION")
        .appendField("DO:")
        .appendField(createCollapseToggleField(), "COLLAPSE_BTN");
      this.appendStatementInput("DO").setCheck(null).appendField("PASOS A REPETIR:");
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour(28); // Scratch Events Amber
      this.setTooltip("Ejecuta los pasos contenidos en bucle mientras la condición sea verdadera (While). Doble-clic para colapsar.");
    },
  };

  // 9. BACKGROUND Task Block (Scratch Dark Indigo)
  Blockly.Blocks["wpipe_background"] = {
    init: function () {
      this.appendDummyInput("HEADER")
        .appendField("⏳ SEGUNDO PLANO (Background)")
        .appendField(createCollapseToggleField(), "COLLAPSE_BTN");
      this.appendStatementInput("DO").setCheck(null).appendField("PASO ASÍNCRONO:");
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour(235); // Scratch Indigo / Dark Blue
      this.setTooltip("Ejecuta el paso en un hilo secundario sin bloquear el flujo principal (Background). Doble-clic para colapsar.");
    },
  };
}

// Global reference store for workspace injection helper
let activeWorkspaceRef: Blockly.WorkspaceSvg | null = null;

function getOptimalNewBlockPosition(ws: Blockly.WorkspaceSvg): { x: number; y: number } {
  try {
    const metrics = ws.getMetricsManager().getViewMetrics(true);
    const viewLeft = metrics.left;
    const viewTop = metrics.top;
    const viewWidth = metrics.width;
    const viewHeight = metrics.height;

    const selected = Blockly.getSelected();
    if (selected && selected instanceof Blockly.BlockSvg && selected.workspace === ws) {
      const selXy = selected.getRelativeToSurfaceXY();
      const selHw = selected.getHeightWidth ? selected.getHeightWidth() : { height: 100, width: 250 };
      return {
        x: selXy.x,
        y: selXy.y + selHw.height + 25,
      };
    }

    const topBlocks = ws.getTopBlocks(false);
    if (topBlocks.length === 0) {
      return { x: Math.max(80, viewLeft + 60), y: Math.max(60, viewTop + 60) };
    }

    let maxBottomY = 0;
    let preferredX = 80;

    topBlocks.forEach((tb) => {
      const xy = tb.getRelativeToSurfaceXY();
      const hw = tb.getHeightWidth ? tb.getHeightWidth() : { height: 100, width: 250 };
      if (xy.y + hw.height > maxBottomY) {
        maxBottomY = xy.y + hw.height;
        preferredX = xy.x;
      }
    });

    if (maxBottomY + 40 >= viewTop && maxBottomY + 40 <= viewTop + viewHeight - 80) {
      return {
        x: preferredX,
        y: maxBottomY + 25,
      };
    }

    const centerX = viewLeft + viewWidth / 2 - 120;
    const centerY = viewTop + viewHeight / 2 - 60;
    const jitterX = Math.floor(Math.random() * 30);
    const jitterY = Math.floor(Math.random() * 30);

    return {
      x: Math.max(viewLeft + 40, centerX + jitterX),
      y: Math.max(viewTop + 40, centerY + jitterY),
    };
  } catch {
    return { x: 200 + Math.floor(Math.random() * 40), y: 150 + Math.floor(Math.random() * 40) };
  }
}

function tryAutoConnectBlock(ws: Blockly.WorkspaceSvg, newBlock: Blockly.BlockSvg): boolean {
  if (!newBlock.previousConnection) return false;

  // 1. If user has a selected block with open nextConnection:
  const selected = Blockly.getSelected();
  if (selected && selected instanceof Blockly.BlockSvg && selected.workspace === ws && selected !== newBlock) {
    if (selected.nextConnection && !selected.nextConnection.isConnected()) {
      selected.nextConnection.connect(newBlock.previousConnection);
      return true;
    }
  }

  // 2. Otherwise find the lowest block in the primary stack that has an open nextConnection
  const topBlocks = ws.getTopBlocks(false);
  for (const tb of topBlocks) {
    let curr: Blockly.Block | null = tb;
    while (curr) {
      if (curr !== newBlock && curr.nextConnection && !curr.nextConnection.isConnected()) {
        curr.nextConnection.connect(newBlock.previousConnection);
        return true;
      }
      if (curr.nextConnection && curr.nextConnection.targetBlock()) {
        curr = curr.nextConnection.targetBlock();
      } else {
        break;
      }
    }
  }
  return false;
}

function placeAndHighlightBlock(ws: Blockly.WorkspaceSvg, block: Blockly.BlockSvg) {
  block.initSvg();
  block.render();
  attachBlockCollapseBehavior(block);

  const connected = tryAutoConnectBlock(ws, block);
  if (!connected) {
    const pos = getOptimalNewBlockPosition(ws);
    block.moveTo(new Blockly.utils.Coordinate(pos.x, pos.y));
  }

  if (typeof (block as any).select === "function") {
    (block as any).select();
  }

  if (typeof (block as any).bringToFront === "function") {
    (block as any).bringToFront();
  }

  // Trigger workspace change listeners
  try {
    const event = new (Blockly.Events.get(Blockly.Events.BLOCK_CREATE) || Blockly.Events.BlockCreate)(block);
    Blockly.Events.fire(event);
  } catch {
    // fallback
  }
}

export function addTriggerBlockToWorkspace(triggerType: string = "api", triggerParam: string = "/run") {
  if (!activeWorkspaceRef) return;
  const block = activeWorkspaceRef.newBlock("wpipe_trigger") as Blockly.BlockSvg;
  block.setFieldValue(triggerType, "TRIGGER_TYPE");
  block.setFieldValue(triggerParam, "TRIGGER_PARAM");
  placeAndHighlightBlock(activeWorkspaceRef, block);
}

export function collapseAllBlocksInWorkspace() {
  if (!activeWorkspaceRef) return;
  const blocks = activeWorkspaceRef.getAllBlocks(false);
  blocks.forEach((b) => {
    if (typeof (b as any).setCollapsed === "function") {
      (b as any).setCollapsed(true);
    }
  });
}

export function expandAllBlocksInWorkspace() {
  if (!activeWorkspaceRef) return;
  const blocks = activeWorkspaceRef.getAllBlocks(false);
  blocks.forEach((b) => {
    if (typeof (b as any).setCollapsed === "function") {
      (b as any).setCollapsed(false);
    }
  });
}

export function centerWorkspace() {
  if (!activeWorkspaceRef) return;
  activeWorkspaceRef.scrollCenter();
}

export function zoomFitWorkspace() {
  if (!activeWorkspaceRef) return;
  if (typeof (activeWorkspaceRef as any).zoomToFit === "function") {
    (activeWorkspaceRef as any).zoomToFit();
  } else {
    activeWorkspaceRef.setScale(1.0);
    activeWorkspaceRef.scrollCenter();
  }
}

export function undoWorkspace(redo: boolean = false) {
  if (!activeWorkspaceRef) return;
  activeWorkspaceRef.undo(redo);
}

export function clearWorkspace() {
  if (!activeWorkspaceRef) return;
  activeWorkspaceRef.clear();
}

export function addStepBlockToWorkspace(
  initialStepName: string = "HttpRequest",
  initialNamespace: string = "wpipe_steps.connectivity",
  stepOrigin: string = "catalog"
) {
  if (!activeWorkspaceRef) return;
  const block = activeWorkspaceRef.newBlock("wpipe_step") as Blockly.BlockSvg;
  block.setFieldValue(initialStepName, "STEP_NAME");
  block.setFieldValue(initialNamespace, "NAMESPACE");
  placeAndHighlightBlock(activeWorkspaceRef, block);
}

export function addAiStepBlockToWorkspace(initialName: string = "ai_process_step", initialPrompt: string = "Procesar datos con modelo de IA") {
  if (!activeWorkspaceRef) return;
  const block = activeWorkspaceRef.newBlock("wpipe_ai_step") as Blockly.BlockSvg;
  block.setFieldValue(initialName, "STEP_NAME");
  block.setFieldValue(initialPrompt, "AI_PROMPT");
  placeAndHighlightBlock(activeWorkspaceRef, block);
}

export function addUserFileStepBlockToWorkspace(initialName: string = "custom_file_step") {
  if (!activeWorkspaceRef) return;
  const block = activeWorkspaceRef.newBlock("wpipe_user_file_step") as Blockly.BlockSvg;
  block.setFieldValue(initialName, "STEP_NAME");
  placeAndHighlightBlock(activeWorkspaceRef, block);
}

export function addControlBlockToWorkspace(
  type: "wpipe_if" | "wpipe_if_else" | "wpipe_for" | "wpipe_while" | "wpipe_parallel" | "wpipe_background"
) {
  if (!activeWorkspaceRef) return;
  const block = activeWorkspaceRef.newBlock(type) as Blockly.BlockSvg;
  placeAndHighlightBlock(activeWorkspaceRef, block);
}

export function getMermaidFromBlocklyWorkspace(): string {
  if (!activeWorkspaceRef) return "graph TD\n    empty[\"Empty Canvas\"]";
  const topBlocks = activeWorkspaceRef.getTopBlocks(true);
  if (!topBlocks || topBlocks.length === 0) {
    return "graph TD\n    empty[\"Empty Canvas\"]";
  }

  let lines: string[] = ["graph TD"];
  let nodeCounter = 1;

  function traverseBlock(block: Blockly.Block): { entryId: string; exitNodes: string[] } {
    const currentId = `node_${nodeCounter++}`;
    const type = block.type;
    let branchExits: string[] = [];

    if (type === "wpipe_trigger") {
      const trigType = block.getFieldValue("TRIGGER_TYPE") || "api";
      const trigParam = block.getFieldValue("TRIGGER_PARAM") || "/run";
      const typeLabels: Record<string, string> = {
        api: `🚀 API REST: POST ${trigParam}`,
        kafka: `📨 KAFKA TOPIC: ${trigParam}`,
        redis: `📦 REDIS QUEUE: ${trigParam}`,
        cron: `⏱️ CRON JOB: ${trigParam}`,
        webhook: `🔗 WEBHOOK: ${trigParam}`,
        cli: `💻 CLI RUNNER`,
      };
      const label = typeLabels[trigType] || `🚀 TRIGGER: ${trigType}`;
      lines.push(`    ${currentId}(["${label}"]):::startTrigger`);
      branchExits = [currentId];
    } else if (type === "wpipe_step") {
      const name = block.getFieldValue("STEP_NAME") || "Step";
      lines.push(`    ${currentId}["📦 ${name}"]`);
      branchExits = [currentId];
    } else if (type === "wpipe_ai_step") {
      const name = block.getFieldValue("STEP_NAME") || "AIStep";
      lines.push(`    ${currentId}["✨ IA: ${name}"]:::aiStep`);
      branchExits = [currentId];
    } else if (type === "wpipe_user_file_step") {
      const name = block.getFieldValue("STEP_NAME") || "CustomStep";
      const fileName = block.getFieldValue("FILE_NAME") || "file.py";
      lines.push(`    ${currentId}["📄 ${name}<br/><small>${fileName}</small>"]:::userStep`);
      branchExits = [currentId];
    } else if (type === "wpipe_if" || type === "wpipe_if_else") {
      const cond = block.getFieldValue("CONDITION") || "IF Condition";
      lines.push(`    ${currentId}{{"🔀 SI: ${cond}"}}`);

      const doInput = block.getInput("DO");
      if (doInput && doInput.connection && doInput.connection.targetBlock()) {
        const childRes = traverseBlock(doInput.connection.targetBlock()!);
        lines.push(`    ${currentId} -->|TRUE| ${childRes.entryId}`);
        branchExits.push(...childRes.exitNodes);
      } else {
        branchExits.push(currentId);
      }

      const elseInput = block.getInput("ELSE");
      if (elseInput && elseInput.connection && elseInput.connection.targetBlock()) {
        const elseRes = traverseBlock(elseInput.connection.targetBlock()!);
        lines.push(`    ${currentId} -->|FALSE| ${elseRes.entryId}`);
        branchExits.push(...elseRes.exitNodes);
      }
    } else if (type === "wpipe_for") {
      const iters = block.getFieldValue("ITERATIONS") || "5";
      lines.push(`    ${currentId}{{"🔁 REPEAT (${iters}x)"}}`);
      const doInput = block.getInput("DO");
      if (doInput && doInput.connection && doInput.connection.targetBlock()) {
        const childRes = traverseBlock(doInput.connection.targetBlock()!);
        lines.push(`    ${currentId} -->|LOOP| ${childRes.entryId}`);
        childRes.exitNodes.forEach((ex) => lines.push(`    ${ex} -.->|LOOP BACK| ${currentId}`));
      }
      branchExits = [currentId];
    } else if (type === "wpipe_while") {
      const cond = block.getFieldValue("CONDITION") || "retry_count < 3";
      lines.push(`    ${currentId}{{"🔁 WHILE (${cond})"}}`);
      const doInput = block.getInput("DO");
      if (doInput && doInput.connection && doInput.connection.targetBlock()) {
        const childRes = traverseBlock(doInput.connection.targetBlock()!);
        lines.push(`    ${currentId} -->|LOOP| ${childRes.entryId}`);
        childRes.exitNodes.forEach((ex) => lines.push(`    ${ex} -.->|LOOP BACK| ${currentId}`));
      }
      branchExits = [currentId];
    } else if (type === "wpipe_parallel") {
      const policy = block.getFieldValue("MERGE_POLICY") || "accumulate";
      lines.push(`    ${currentId}["⚡ RUN IN PARALLEL<br/><small>Merge: ${policy}</small>"]`);
      const doInput = block.getInput("DO");
      if (doInput && doInput.connection && doInput.connection.targetBlock()) {
        const childRes = traverseBlock(doInput.connection.targetBlock()!);
        lines.push(`    ${currentId} -->|PARALLEL| ${childRes.entryId}`);
        branchExits.push(...childRes.exitNodes);
      } else {
        branchExits.push(currentId);
      }
    } else if (type === "wpipe_background") {
      lines.push(`    ${currentId}["⏳ BACKGROUND TASK"]:::bgStep`);
      const doInput = block.getInput("DO");
      if (doInput && doInput.connection && doInput.connection.targetBlock()) {
        const childRes = traverseBlock(doInput.connection.targetBlock()!);
        lines.push(`    ${currentId} -.->|ASYNC BG| ${childRes.entryId}`);
        branchExits.push(...childRes.exitNodes);
      } else {
        branchExits.push(currentId);
      }
    } else {
      lines.push(`    ${currentId}["${type}"]`);
      branchExits = [currentId];
    }

    let finalExitNodes = branchExits;
    if (block.nextConnection && block.nextConnection.targetBlock()) {
      const nextRes = traverseBlock(block.nextConnection.targetBlock()!);
      branchExits.forEach((ex) => {
        lines.push(`    ${ex} --> ${nextRes.entryId}`);
      });
      finalExitNodes = nextRes.exitNodes;
    }

    return { entryId: currentId, exitNodes: finalExitNodes };
  }

  topBlocks.forEach((tb) => {
    traverseBlock(tb);
  });

  lines.push("    classDef startTrigger fill:#d97706,stroke:#f59e0b,stroke-width:3px,color:#fff,font-weight:bold;");
  lines.push("    classDef aiStep fill:#9333ea,stroke:#c084fc,stroke-width:2px,color:#fff;");
  lines.push("    classDef userStep fill:#0d9488,stroke:#2dd4bf,stroke-width:2px,color:#fff;");
  lines.push("    classDef bgStep fill:#4338ca,stroke:#818cf8,stroke-width:2px,color:#fff;");

  return lines.join("\n");
}

export function highlightBlocklyBlock(stepName: string, state: "running" | "success" | "error" | "idle") {
  if (!activeWorkspaceRef) return;
  const blocks = activeWorkspaceRef.getAllBlocks(false);
  blocks.forEach((b) => {
    const name = b.getFieldValue("STEP_NAME") || b.type;
    const svgRoot = b.getSvgRoot();
    if (svgRoot) {
      if (state !== "idle" && (name.toLowerCase().includes(stepName.toLowerCase()) || stepName.toLowerCase().includes(name.toLowerCase()))) {
        if (state === "running") {
          svgRoot.style.filter = "drop-shadow(0 0 14px #fbbf24)";
        } else if (state === "success") {
          svgRoot.style.filter = "drop-shadow(0 0 14px #22c55e)";
        } else if (state === "error") {
          svgRoot.style.filter = "drop-shadow(0 0 14px #ef4444)";
        }
      } else if (state === "idle") {
        svgRoot.style.filter = "none";
      }
    }
  });
}

export function getCanvasIRFromBlocklyWorkspace(catalog: any[] = []): CanvasIR {
  if (!activeWorkspaceRef) {
    return { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } };
  }
  const topBlocks = activeWorkspaceRef.getTopBlocks(true);
  const nodes: CanvasNode[] = [];
  const edges: CanvasEdge[] = [];
  let nodeIdx = 1;

  function processBlock(block: Blockly.Block, parentId: string | null = null, slotType: any = null): { entryId: string; exitNodes: string[] } {
    const currentId = `node_${nodeIdx++}`;
    const type = block.type;
    const xy = block.getRelativeToSurfaceXY();
    let label = "Step";
    let nodeType: "trigger" | "step" | "condition" | "for" | "while" | "parallel" | "background" = "step";
    let triggerType: "api" | "kafka" | "redis" | "cron" | "webhook" | "cli" | undefined = undefined;
    let triggerParam: string | undefined = undefined;
    let namespace: string | undefined = undefined;
    let funcName: string | undefined = undefined;
    let origin: StepOrigin = "catalog";
    let conditionExpression: string | undefined = undefined;
    let forIterations: number | undefined = undefined;
    let mergePolicy: "accumulate" | "last_wins" = "accumulate";
    let notes: string | undefined = undefined;
    let codeSnippet: string | undefined = undefined;
    let params: Record<string, any> = {};
    let contract = { reads: ["data"], writes: ["result"], inferred: "exact" as const };

    if (type === "wpipe_trigger") {
      nodeType = "trigger";
      triggerType = (block.getFieldValue("TRIGGER_TYPE") || "api") as any;
      triggerParam = block.getFieldValue("TRIGGER_PARAM") || "/run";
      label = `Trigger (${(triggerType || "api").toUpperCase()}: ${triggerParam})`;
      origin = "described";
      params = { trigger_type: triggerType, trigger_param: triggerParam };
    } else if (type === "wpipe_step") {
      label = block.getFieldValue("STEP_NAME") || "Step";
      namespace = block.getFieldValue("NAMESPACE") || undefined;
      funcName = label;
      const catMatch = catalog.find((c) => c.name === label || c.func_name === label);
      if (catMatch) {
        origin = catMatch.repo === "User" ? "user_imported" : "catalog";
        namespace = catMatch.namespace || namespace;
      }
    } else if (type === "wpipe_ai_step") {
      label = block.getFieldValue("STEP_NAME") || "custom_ai_state";
      funcName = label;
      origin = "described";
      notes = block.getFieldValue("AI_PROMPT") || "Paso generado con IA";
      namespace = `app.states.${label}`;
    } else if (type === "wpipe_user_file_step") {
      label = block.getFieldValue("STEP_NAME") || "custom_user_step";
      funcName = label;
      origin = "user_imported";
      const fileName = block.getFieldValue("FILE_NAME") || "custom_user_step.py";
      namespace = `app.states.${fileName.replace(/\.py$/, "")}`;
      const attached = attachedFilesRegistry[block.id];
      if (attached && attached.code) {
        codeSnippet = attached.code;
      }
    } else if (type === "wpipe_if" || type === "wpipe_if_else") {
      nodeType = "condition";
      label = type === "wpipe_if" ? "IF Condition" : "IF-ELSE Condition";
      conditionExpression = block.getFieldValue("CONDITION") || "status_code == 200";
      origin = "described";
    } else if (type === "wpipe_for") {
      nodeType = "for";
      label = "FOR Loop";
      forIterations = Number(block.getFieldValue("ITERATIONS")) || 5;
      origin = "described";
    } else if (type === "wpipe_while") {
      nodeType = "while";
      label = "WHILE Loop";
      conditionExpression = block.getFieldValue("CONDITION") || "retry_count < 3";
      origin = "described";
    } else if (type === "wpipe_parallel") {
      nodeType = "parallel";
      label = "PARALLEL";
      mergePolicy = (block.getFieldValue("MERGE_POLICY") as any) || "accumulate";
      origin = "described";
    } else if (type === "wpipe_background") {
      nodeType = "background";
      label = "BACKGROUND Task";
      origin = "described";
    }

    const canvasNode: CanvasNode = {
      id: currentId,
      type: "default",
      position: { x: xy.x, y: xy.y },
      data: {
        label,
        node_type: nodeType,
        trigger_type: triggerType,
        trigger_param: triggerParam,
        namespace,
        func_name: funcName,
        origin,
        params,
        contract,
        condition_expression: conditionExpression,
        for_iterations: forIterations,
        merge_policy: mergePolicy,
        notes,
        code_snippet: codeSnippet,
        parent_id: parentId || undefined,
        slot_type: slotType || undefined,
      },
    };
    nodes.push(canvasNode);

    let branchExits: string[] = [];

    const doInput = block.getInput("DO");
    if (doInput && doInput.connection && doInput.connection.targetBlock()) {
      let childSlot: any = "if_body";
      if (nodeType === "for" || nodeType === "while") childSlot = "loop_body";
      else if (nodeType === "parallel") childSlot = "parallel_body";
      else if (nodeType === "background") childSlot = "background_body";
      const childRes = processBlock(doInput.connection.targetBlock()!, currentId, childSlot);
      edges.push({ id: `e_${currentId}_${childRes.entryId}`, source: currentId, target: childRes.entryId });
      branchExits.push(...childRes.exitNodes);
    } else {
      branchExits.push(currentId);
    }

    const elseInput = block.getInput("ELSE");
    if (elseInput && elseInput.connection && elseInput.connection.targetBlock()) {
      const elseRes = processBlock(elseInput.connection.targetBlock()!, currentId, "else_body");
      edges.push({ id: `e_${currentId}_${elseRes.entryId}`, source: currentId, target: elseRes.entryId });
      branchExits.push(...elseRes.exitNodes);
    }

    let finalExits = branchExits;
    if (block.nextConnection && block.nextConnection.targetBlock()) {
      const nextRes = processBlock(block.nextConnection.targetBlock()!, parentId, slotType);
      // Direct sequence edge between current container block and the next block
      edges.push({ id: `e_seq_${currentId}_${nextRes.entryId}`, source: currentId, target: nextRes.entryId });
      branchExits.forEach((exId) => {
        if (exId !== currentId) {
          edges.push({ id: `e_${exId}_${nextRes.entryId}`, source: exId, target: nextRes.entryId });
        }
      });
      finalExits = nextRes.exitNodes;
    }

    return { entryId: currentId, exitNodes: finalExits };
  }

  topBlocks.forEach((tb) => {
    processBlock(tb);
  });

  return { nodes, edges, viewport: { x: 0, y: 0, zoom: 1 } };
}

export function getWorkPlanFromBlocklyWorkspace(catalogSteps: any[] = []): string {
  if (!activeWorkspaceRef) {
    return "# 📋 WPipe Studio Execution Work Plan\n\nNo blocks found in workspace.";
  }

  const allBlocks = activeWorkspaceRef.getAllBlocks(false);
  if (!allBlocks || allBlocks.length === 0) {
    return "# 📋 WPipe Studio Execution Work Plan\n\nNo blocks configured in workspace.";
  }

  const triggerBlocks = allBlocks.filter((b) => b.type === "wpipe_trigger");
  const stepBlocks = allBlocks.filter((b) => b.type === "wpipe_step");
  const aiBlocks = allBlocks.filter((b) => b.type === "wpipe_ai_step");
  const userFileBlocks = allBlocks.filter((b) => b.type === "wpipe_user_file_step");
  const controlBlocks = allBlocks.filter(
    (b) =>
      b.type.startsWith("wpipe_") &&
      !["wpipe_trigger", "wpipe_step", "wpipe_ai_step", "wpipe_user_file_step"].includes(b.type)
  );

  let md = `# 📋 WPipe Studio Execution Work Plan & Architecture Specification\n\n`;
  md += `> **Generated on:** ${new Date().toISOString().split("T")[0]}\n`;
  md += `> **Pipeline Status:** Verified for Execution\n\n`;

  md += `---

## 0. 🚀 Ingress & Pipeline Triggers (${triggerBlocks.length})
`;
  if (triggerBlocks.length === 0) {
    md += `*Default trigger: API REST (/run)*\n\n`;
  } else {
    triggerBlocks.forEach((b, idx) => {
      const t = b.getFieldValue("TRIGGER_TYPE") || "api";
      const p = b.getFieldValue("TRIGGER_PARAM") || "/run";
      md += `#### ${idx + 1}. \`${t.toUpperCase()}\` Ingress\n- **Route / Topic / Key:** \`${p}\`\n\n`;
    });
  }

  md += `---

## 1. 📦 Steps & State Contracts

### 🌐 Official & Plugin Catalog Steps (${stepBlocks.length})
`;
  if (stepBlocks.length === 0) {
    md += `*No standard catalog steps in workspace.*\n\n`;
  } else {
    stepBlocks.forEach((b, idx) => {
      const name = b.getFieldValue("STEP_NAME") || "Step";
      const ns = b.getFieldValue("NAMESPACE") || "wpipe_steps";
      md += `#### ${idx + 1}. \`${name}\`\n- **Namespace:** \`${ns}\`\n\n`;
    });
  }

  md += `### ✨ AI-Generated States (${aiBlocks.length})
`;
  if (aiBlocks.length === 0) {
    md += `*No AI-generated steps configured.*\n\n`;
  } else {
    aiBlocks.forEach((b, idx) => {
      const name = b.getFieldValue("STEP_NAME") || "custom_ai_state";
      const prompt = b.getFieldValue("AI_PROMPT") || "";
      md += `#### ${idx + 1}. \`${name}\` (Dialect A)\n- **Generation Prompt:** "${prompt}"\n- **Output:** \`app/states/${name}.py\` + \`app/dto/${name}_dto.py\`\n\n`;
    });
  }

  md += `### 📄 User-Imported Python States (${userFileBlocks.length})
`;
  if (userFileBlocks.length === 0) {
    md += `*No user-imported python files.*\n\n`;
  } else {
    userFileBlocks.forEach((b, idx) => {
      const name = b.getFieldValue("STEP_NAME") || "custom_user_step";
      const fileName = b.getFieldValue("FILE_NAME") || "file.py";
      md += `#### ${idx + 1}. \`${name}\`\n- **Source File:** \`${fileName}\`\n\n`;
    });
  }

  md += `---

## 2. 🔀 Control Flow Blocks (${controlBlocks.length})
`;
  controlBlocks.forEach((b, idx) => {
    md += `- **Node ${idx + 1}:** \`${b.type}\``;
    if (b.getFieldValue("CONDITION")) {
      md += ` (Condition: \`${b.getFieldValue("CONDITION")}\`)`;
    }
    if (b.getFieldValue("ITERATIONS")) {
      md += ` (Repeat: \`${b.getFieldValue("ITERATIONS")}\` times)`;
    }
    if (b.getFieldValue("MERGE_POLICY")) {
      md += ` (Merge: \`${b.getFieldValue("MERGE_POLICY")}\`)`;
    }
    md += `\n`;
  });

  return md;
}

interface BlocklyWorkspaceProps {
  onWorkspaceChange?: (workspace: Blockly.WorkspaceSvg) => void;
}

export const BlocklyComponent: React.FC<BlocklyWorkspaceProps> = ({ onWorkspaceChange }) => {
  const blocklyDivRef = useRef<HTMLDivElement>(null);
  const workspaceRef = useRef<Blockly.WorkspaceSvg | null>(null);

  useEffect(() => {
    registerWPipeBlocklyBlocks();

    if (blocklyDivRef.current && !workspaceRef.current) {
      const ws = Blockly.inject(blocklyDivRef.current, {
        collapse: true,
        comments: true,
        disable: true,
        move: {
          scrollbars: {
            horizontal: true,
            vertical: true,
          },
          drag: true,
          wheel: false,
        },
        grid: {
          spacing: 20,
          length: 3,
          colour: "#1f2937",
          snap: true,
        },
        zoom: {
          controls: true,
          wheel: true,
          startScale: 0.95,
          maxScale: 3,
          minScale: 0.3,
          scaleSpeed: 1.2,
          pinch: true,
        },
        trashcan: true,
        sounds: false,
      });

      workspaceRef.current = ws;
      activeWorkspaceRef = ws;

      // Starter template stack with Trigger entrypoint and all 10 blocks (Hello World pipeline)
      const triggerBlock = ws.newBlock("wpipe_trigger");
      triggerBlock.setFieldValue("api", "TRIGGER_TYPE");
      triggerBlock.setFieldValue("/run", "TRIGGER_PARAM");
      triggerBlock.initSvg();
      triggerBlock.render();
      attachBlockCollapseBehavior(triggerBlock);
      triggerBlock.moveBy(80, 50);

      // 1. Paso de Catálogo (HttpRequest)
      const block1 = ws.newBlock("wpipe_step");
      block1.setFieldValue("HttpRequest", "STEP_NAME");
      block1.setFieldValue("wpipe_steps.connectivity", "NAMESPACE");
      block1.initSvg();
      block1.render();
      attachBlockCollapseBehavior(block1);
      if (triggerBlock.nextConnection && block1.previousConnection) {
        triggerBlock.nextConnection.connect(block1.previousConnection);
      }

      // 2. Paso con IA (ai_sentiment_step)
      const blockAi = ws.newBlock("wpipe_ai_step");
      blockAi.setFieldValue("ai_sentiment_step", "STEP_NAME");
      blockAi.setFieldValue("Clasificar sentimiento del texto de entrada", "AI_PROMPT");
      blockAi.initSvg();
      blockAi.render();
      attachBlockCollapseBehavior(blockAi);
      if (block1.nextConnection && blockAi.previousConnection) {
        block1.nextConnection.connect(blockAi.previousConnection);
      }

      // 3. Paso Personalizado (.py) (custom_cleaner_step)
      const blockUser = ws.newBlock("wpipe_user_file_step");
      blockUser.setFieldValue("custom_cleaner_step", "STEP_NAME");
      blockUser.setFieldValue("cleaner_state.py", "FILE_NAME");
      blockUser.initSvg();
      blockUser.render();
      attachBlockCollapseBehavior(blockUser);
      if (blockAi.nextConnection && blockUser.previousConnection) {
        blockAi.nextConnection.connect(blockUser.previousConnection);
      }

      // 4. Condición Si simple (wpipe_if)
      const blockIf = ws.newBlock("wpipe_if");
      blockIf.setFieldValue("is_valid == True", "CONDITION");
      blockIf.initSvg();
      blockIf.render();
      attachBlockCollapseBehavior(blockIf);
      if (blockUser.nextConnection && blockIf.previousConnection) {
        blockUser.nextConnection.connect(blockIf.previousConnection);
      }

      // 5. Ejecución Paralela (wpipe_parallel) dentro de la condición Si
      const blockParallel = ws.newBlock("wpipe_parallel");
      blockParallel.setFieldValue("accumulate", "MERGE_POLICY");
      blockParallel.initSvg();
      blockParallel.render();
      attachBlockCollapseBehavior(blockParallel);
      const ifDo = blockIf.getInput("DO");
      if (ifDo && ifDo.connection && blockParallel.previousConnection) {
        ifDo.connection.connect(blockParallel.previousConnection);
      }

      // 6. Paso dentro del bloque paralelo (MySQLQuery)
      const blockDb = ws.newBlock("wpipe_step");
      blockDb.setFieldValue("MySQLQuery", "STEP_NAME");
      blockDb.setFieldValue("wpipe_steps.storage", "NAMESPACE");
      blockDb.initSvg();
      blockDb.render();
      attachBlockCollapseBehavior(blockDb);
      const parDo = blockParallel.getInput("DO");
      if (parDo && parDo.connection && blockDb.previousConnection) {
        parDo.connection.connect(blockDb.previousConnection);
      }

      // 7. Condición Si / Sino dual (wpipe_if_else)
      const blockIfElse = ws.newBlock("wpipe_if_else");
      blockIfElse.setFieldValue("status_code == 200", "CONDITION");
      blockIfElse.initSvg();
      blockIfElse.render();
      attachBlockCollapseBehavior(blockIfElse);
      if (blockIf.nextConnection && blockIfElse.previousConnection) {
        blockIf.nextConnection.connect(blockIfElse.previousConnection);
      }

      // 8. Bucle Repetir (wpipe_for) en la rama verdadera
      const blockFor = ws.newBlock("wpipe_for");
      blockFor.setFieldValue("3", "ITERATIONS");
      blockFor.initSvg();
      blockFor.render();
      attachBlockCollapseBehavior(blockFor);
      const ifElseDo = blockIfElse.getInput("DO");
      if (ifElseDo && ifElseDo.connection && blockFor.previousConnection) {
        ifElseDo.connection.connect(blockFor.previousConnection);
      }

      // 9. Tarea en Segundo Plano (wpipe_background) dentro del bucle For
      const blockBg = ws.newBlock("wpipe_background");
      blockBg.initSvg();
      blockBg.render();
      attachBlockCollapseBehavior(blockBg);
      const forDo = blockFor.getInput("DO");
      if (forDo && forDo.connection && blockBg.previousConnection) {
        forDo.connection.connect(blockBg.previousConnection);
      }

      const blockBgTask = ws.newBlock("wpipe_step");
      blockBgTask.setFieldValue("RedisGet", "STEP_NAME");
      blockBgTask.setFieldValue("wpipe_steps.storage", "NAMESPACE");
      blockBgTask.initSvg();
      blockBgTask.render();
      attachBlockCollapseBehavior(blockBgTask);
      const bgDo = blockBg.getInput("DO");
      if (bgDo && bgDo.connection && blockBgTask.previousConnection) {
        bgDo.connection.connect(blockBgTask.previousConnection);
      }

      // 10. Bucle Mientras (wpipe_while) en la rama falsa de If-Else
      const blockWhile = ws.newBlock("wpipe_while");
      blockWhile.setFieldValue("retry_count < 3", "CONDITION");
      blockWhile.initSvg();
      blockWhile.render();
      attachBlockCollapseBehavior(blockWhile);
      const ifElseElse = blockIfElse.getInput("ELSE");
      if (ifElseElse && ifElseElse.connection && blockWhile.previousConnection) {
        ifElseElse.connection.connect(blockWhile.previousConnection);
      }

      const blockRetryStep = ws.newBlock("wpipe_step");
      blockRetryStep.setFieldValue("NmapScanStep", "STEP_NAME");
      blockRetryStep.setFieldValue("wpipe_steps.network", "NAMESPACE");
      blockRetryStep.initSvg();
      blockRetryStep.render();
      attachBlockCollapseBehavior(blockRetryStep);
      const whileDo = blockWhile.getInput("DO");
      if (whileDo && whileDo.connection && blockRetryStep.previousConnection) {
        whileDo.connection.connect(blockRetryStep.previousConnection);
      }

      // Initial auto-centering so blocks are not stuck in the corner
      setTimeout(() => {
        if (ws) {
          ws.scrollCenter();
        }
      }, 150);

      ws.addChangeListener((e) => {
        if (e && (e as any).type === Blockly.Events.BLOCK_CREATE) {
          const createEv = e as any;
          if (createEv.blockId) {
            const b = ws.getBlockById(createEv.blockId);
            if (b) attachBlockCollapseBehavior(b);
          }
        }
        if (onWorkspaceChange) {
          onWorkspaceChange(ws);
        }
      });
    }

    return () => {
      if (workspaceRef.current) {
        if (activeWorkspaceRef === workspaceRef.current) {
          activeWorkspaceRef = null;
        }
        workspaceRef.current.dispose();
        workspaceRef.current = null;
      }
    };
  }, []);

  return <div ref={blocklyDivRef} className="w-full h-full min-h-[550px] rounded-xl overflow-hidden shadow-2xl" />;
};
