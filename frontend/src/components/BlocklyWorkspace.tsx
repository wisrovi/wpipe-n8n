import React, { useEffect, useRef } from "react";
import * as Blockly from "blockly";
import { CanvasIR, CanvasNode, CanvasEdge, StepOrigin } from "../lib/ir/schemas";
import { isVSCodeEnvironment } from "../lib/engineBridge";

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

function getStepOptions(repoFilter: string, catFilter: string, searchTerm: string = "", currentVal?: string): [string, string][] {
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

  const options: [string, string][] = filtered.slice(0, 100).map((s) => {
    const label = s.func_name || s.name;
    const cat = s.category ? ` [${s.category}]` : "";
    return [`📦 ${label}${cat}`, label];
  });

  // If currentVal is provided and not already in options, prepend it (supports custom workspace steps like Queso)
  if (currentVal && currentVal !== "none" && !options.some((opt) => opt[1] === currentVal)) {
    options.unshift([`🛠️ ${currentVal} (Workspace / Custom)`, currentVal]);
  }

  if (options.length === 0) {
    return [["(Sin estados disponibles)", "none"]];
  }

  return options;
}

export class DynamicStepDropdown extends Blockly.FieldDropdown {
  protected doClassValidation_(newValue?: string): string | null {
    if (typeof newValue !== "string") return null;
    return newValue;
  }

  public getText(): string {
    const val = this.getValue();
    const options = this.getOptions(false);
    for (const opt of options) {
      if (opt[1] === val) return String(opt[0]);
    }
    return val ? `🛠️ ${val} (Workspace / Custom)` : super.getText();
  }
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

  // 0b. WPipe Response / Egress Terminator Block (Scratch Cap Block)
  Blockly.Blocks["wpipe_response"] = {
    init: function () {
      this.appendDummyInput("HEADER")
        .appendField("🏁 Cierre del Pipeline:")
        .appendField(
          new Blockly.FieldDropdown(
            [
              ["🌐 Respuesta HTTP (200 JSON OK)", "http_json"],
              ["📨 Kafka Producer (Publicar Tópico)", "kafka_publish"],
              ["📦 Redis Producer (Publicar Cola)", "redis_publish"],
              ["💾 Guardar Contexto en Archivo", "file_export"],
              ["🛑 Fin Silencioso (Return Context)", "terminate"],
            ],
            function (this: any, newVal: string) {
              const block = this.getSourceBlock();
              if (block) {
                const paramField = block.getField("RESPONSE_PARAM");
                if (paramField) {
                  if (newVal === "http_json") paramField.setValue('{"status": "success", "data": context}');
                  else if (newVal === "kafka_publish") paramField.setValue("events.output");
                  else if (newVal === "redis_publish") paramField.setValue("wpipe:queue:out");
                  else if (newVal === "file_export") paramField.setValue("output_result.json");
                  else if (newVal === "terminate") paramField.setValue("return context");
                }
              }
              return newVal;
            }
          ),
          "RESPONSE_TYPE"
        )
        .appendField(createCollapseToggleField(), "COLLAPSE_BTN");

      this.appendDummyInput()
        .appendField("Detalle / Destino / Payload:")
        .appendField(new Blockly.FieldTextInput('{"status": "success", "data": context}'), "RESPONSE_PARAM");

      // Cap block: has previous connection, NO next connection
      this.setPreviousStatement(true, null);
      this.setNextStatement(false);
      this.setColour(345); // Rose / Crimson terminator
      this.setTooltip(
        "Cierre y salida del pipeline: define cómo finaliza el flujo y qué respuesta devuelve el microservicio (Respuesta HTTP JSON, publicación en Kafka/Redis, guardado en archivo o retorno directo). Doble-clic para colapsar."
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
          new DynamicStepDropdown(function () {
            const block = this.getSourceBlock();
            const repo = block ? block.getFieldValue("REPO_FILTER") || "ALL" : "ALL";
            const cat = block ? block.getFieldValue("CAT_FILTER") || "ALL" : "ALL";
            const q = block ? block.getFieldValue("SEARCH_FILTER") || "" : "";
            const curVal = block ? block.getFieldValue("STEP_NAME") : undefined;
            return getStepOptions(repo, cat, q, curVal);
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

// ---------------------------------------------------------------------------
// Canvas plan limits (UX only).
// The authoritative enforcement lives in wpipe-engine, which rejects any compile,
// simulation or project save that exceeds the signed plan entitlements. These guards only
// keep the canvas honest for the user; bypassing them in DevTools yields nothing usable.
// ---------------------------------------------------------------------------
export interface CanvasLimits {
  max_blocks: number | null;
  parallel_blocks: boolean;
  background_blocks: boolean;
  ai_steps: boolean;
}

export interface CanvasLimitViolation {
  code: "LIMIT_BLOCK_COUNT_EXCEEDED" | "PRO_FEATURE_REQUIRED";
  blockType?: string;
  current?: number;
  max?: number | null;
}

let canvasLimits: CanvasLimits = { max_blocks: 5, parallel_blocks: false, background_blocks: false, ai_steps: false };
let limitViolationHandler: ((v: CanvasLimitViolation) => void) | null = null;
let suppressLimitEnforcement = false;

const PRO_BLOCK_ENTITLEMENT: Record<string, keyof CanvasLimits> = {
  wpipe_parallel: "parallel_blocks",
  wpipe_background: "background_blocks",
  wpipe_ai_step: "ai_steps",
};

export function setCanvasLimits(limits: CanvasLimits) {
  canvasLimits = { ...limits };
}

export function setCanvasLimitViolationHandler(handler: ((v: CanvasLimitViolation) => void) | null) {
  limitViolationHandler = handler;
}

export function getWorkspaceBlockCount(): number {
  return activeWorkspaceRef ? activeWorkspaceRef.getAllBlocks(false).length : 0;
}

export function isProBlockType(type: string): boolean {
  return type in PRO_BLOCK_ENTITLEMENT;
}

/** Check whether a block of ``type`` (with ``extra`` blocks in total) may be added. */
export function checkCanAddBlock(type: string, extra: number = 1): CanvasLimitViolation | null {
  const entKey = PRO_BLOCK_ENTITLEMENT[type];
  if (entKey && !canvasLimits[entKey]) {
    return { code: "PRO_FEATURE_REQUIRED", blockType: type };
  }
  const max = canvasLimits.max_blocks;
  const current = getWorkspaceBlockCount();
  if (max !== null && current + extra > max) {
    return { code: "LIMIT_BLOCK_COUNT_EXCEEDED", current, max };
  }
  return null;
}

function reportViolation(v: CanvasLimitViolation) {
  if (limitViolationHandler) limitViolationHandler(v);
}

/** Pre-check used by palette insert helpers. Returns false (and reports) when blocked. */
function guardInsert(type: string): boolean {
  const violation = checkCanAddBlock(type);
  if (violation) {
    reportViolation(violation);
    return false;
  }
  return true;
}

/**
 * Enforce limits for blocks created by drag, paste or duplicate (Blockly BLOCK_CREATE).
 * Newly created blocks that exceed the plan are removed immediately.
 */
function enforceLimitsOnCreate(ws: Blockly.WorkspaceSvg, createEv: any) {
  if (suppressLimitEnforcement) return;
  const ids: string[] = Array.isArray(createEv.ids) && createEv.ids.length > 0 ? createEv.ids : [createEv.blockId];
  const created = ids.map((id) => ws.getBlockById(id)).filter(Boolean) as Blockly.Block[];
  if (created.length === 0) return;

  const proBlock = created.find((b) => {
    const entKey = PRO_BLOCK_ENTITLEMENT[b.type];
    return entKey && !canvasLimits[entKey];
  });
  const max = canvasLimits.max_blocks;
  const total = ws.getAllBlocks(false).length;
  const overLimit = max !== null && total > max;
  if (!proBlock && !overLimit) return;

  const root = created.find((b) => !b.getParent() || !ids.includes(b.getParent()!.id)) || created[0];
  setTimeout(() => {
    if (!root.isDisposed()) root.dispose(true);
  }, 0);
  reportViolation(
    proBlock
      ? { code: "PRO_FEATURE_REQUIRED", blockType: proBlock.type }
      : { code: "LIMIT_BLOCK_COUNT_EXCEEDED", current: total - created.length, max }
  );
}

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
  if (!activeWorkspaceRef || !guardInsert("wpipe_trigger")) return;
  const block = activeWorkspaceRef.newBlock("wpipe_trigger") as Blockly.BlockSvg;
  block.setFieldValue(triggerType, "TRIGGER_TYPE");
  block.setFieldValue(triggerParam, "TRIGGER_PARAM");
  placeAndHighlightBlock(activeWorkspaceRef, block);
}

export function addResponseBlockToWorkspace(
  responseType: string = "http_json",
  responseParam: string = '{"status": "success", "data": context}'
) {
  if (!activeWorkspaceRef || !guardInsert("wpipe_response")) return;
  const block = activeWorkspaceRef.newBlock("wpipe_response") as Blockly.BlockSvg;
  block.setFieldValue(responseType, "RESPONSE_TYPE");
  block.setFieldValue(responseParam, "RESPONSE_PARAM");
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

export function getWorkspaceStateJson(): any {
  if (!activeWorkspaceRef) return null;
  try {
    return Blockly.serialization.workspaces.save(activeWorkspaceRef);
  } catch (err) {
    console.error("Failed to save workspace state:", err);
    return null;
  }
}

let isLoadingWorkspaceState = false;

export function loadWorkspaceStateJson(state: any): boolean {
  if (!activeWorkspaceRef || !state) return false;
  // Loading saved designs never deletes user blocks; the engine still enforces limits on use.
  suppressLimitEnforcement = true;
  isLoadingWorkspaceState = true;
  try {
    activeWorkspaceRef.clear();
    Blockly.serialization.workspaces.load(state, activeWorkspaceRef);
    setTimeout(() => {
      if (activeWorkspaceRef) {
        activeWorkspaceRef.scrollCenter();
      }
    }, 100);
    return true;
  } catch (err) {
    console.error("Failed to load workspace state:", err);
    return false;
  } finally {
    setTimeout(() => {
      suppressLimitEnforcement = false;
      isLoadingWorkspaceState = false;
    }, 600);
  }
}

export function addStepBlockToWorkspace(
  initialStepName: string = "HttpRequestContext",
  initialNamespace: string = "wpipe_steps.connectivity.http",
  stepOrigin: string = "catalog"
) {
  if (!activeWorkspaceRef || !guardInsert("wpipe_step")) return;
  const block = activeWorkspaceRef.newBlock("wpipe_step") as Blockly.BlockSvg;
  block.setFieldValue(initialStepName, "STEP_NAME");
  block.setFieldValue(initialNamespace, "NAMESPACE");
  placeAndHighlightBlock(activeWorkspaceRef, block);
}

export function addAiStepBlockToWorkspace(initialName: string = "ai_process_step", initialPrompt: string = "Process data with an AI model") {
  if (!activeWorkspaceRef || !guardInsert("wpipe_ai_step")) return;
  const block = activeWorkspaceRef.newBlock("wpipe_ai_step") as Blockly.BlockSvg;
  block.setFieldValue(initialName, "STEP_NAME");
  block.setFieldValue(initialPrompt, "AI_PROMPT");
  placeAndHighlightBlock(activeWorkspaceRef, block);
}

export function addUserFileStepBlockToWorkspace(initialName: string = "custom_file_step") {
  if (!activeWorkspaceRef || !guardInsert("wpipe_user_file_step")) return;
  const block = activeWorkspaceRef.newBlock("wpipe_user_file_step") as Blockly.BlockSvg;
  block.setFieldValue(initialName, "STEP_NAME");
  placeAndHighlightBlock(activeWorkspaceRef, block);
}

export function addControlBlockToWorkspace(
  type: "wpipe_if" | "wpipe_if_else" | "wpipe_for" | "wpipe_while" | "wpipe_parallel" | "wpipe_background"
) {
  if (!activeWorkspaceRef || !guardInsert(type)) return;
  const block = activeWorkspaceRef.newBlock(type) as Blockly.BlockSvg;
  placeAndHighlightBlock(activeWorkspaceRef, block);
}

export function getMermaidFromBlocklyWorkspace(): string {
  if (!activeWorkspaceRef) return "flowchart TD\n    empty[\"Empty Canvas\"]";
  const topBlocks = activeWorkspaceRef.getTopBlocks(true);
  if (!topBlocks || topBlocks.length === 0) {
    return "flowchart TD\n    empty[\"Empty Canvas\"]";
  }

  let lines: string[] = ["flowchart TD"];
  let nodeCounter = 1;

  interface ExitPath {
    nodeId: string;
    label?: string;
  }

  interface TraverseResult {
    entryId: string;
    exits: ExitPath[];
  }

  function traverseBlock(block: Blockly.Block, stopAtNext: boolean = false): TraverseResult {
    const currentId = `node_${nodeCounter++}`;
    const type = block.type;
    let nodeExits: ExitPath[] = [];

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
      nodeExits = [{ nodeId: currentId }];
    } else if (type === "wpipe_response") {
      const respType = block.getFieldValue("RESPONSE_TYPE") || "http_json";
      const respParam = block.getFieldValue("RESPONSE_PARAM") || '{"status": "success"}';
      const typeLabels: Record<string, string> = {
        http_json: `🏁 HTTP 200: JSON Response`,
        kafka_publish: `🏁 KAFKA PUBLISH: ${respParam}`,
        redis_publish: `🏁 REDIS PUBLISH: ${respParam}`,
        file_export: `💾 EXPORT: ${respParam}`,
        terminate: `🛑 TERMINATE`,
      };
      const label = typeLabels[respType] || `🏁 RESPONSE: ${respType}`;
      lines.push(`    ${currentId}(["${label}"]):::endResponse`);
      nodeExits = [{ nodeId: currentId }];
    } else if (type === "wpipe_step") {
      const name = block.getFieldValue("STEP_NAME") || "Step";
      lines.push(`    ${currentId}["📦 ${name}"]:::catalogStep`);
      nodeExits = [{ nodeId: currentId }];
    } else if (type === "wpipe_ai_step") {
      const name = block.getFieldValue("STEP_NAME") || "AIStep";
      lines.push(`    ${currentId}["✨ IA: ${name}"]:::aiStep`);
      nodeExits = [{ nodeId: currentId }];
    } else if (type === "wpipe_user_file_step") {
      const name = block.getFieldValue("STEP_NAME") || "CustomStep";
      const fileName = block.getFieldValue("FILE_NAME") || "file.py";
      lines.push(`    ${currentId}["📄 ${name}<br/><small>${fileName}</small>"]:::userStep`);
      nodeExits = [{ nodeId: currentId }];
    } else if (type === "wpipe_if") {
      const cond = (block.getFieldValue("CONDITION") || "is_valid == True").replace(/"/g, "'");
      lines.push(`    ${currentId}{"🔀 Condición: ${cond}"}:::condStep`);

      const doInput = block.getInput("DO");
      if (doInput && doInput.connection && doInput.connection.targetBlock()) {
        const childRes = traverseBlock(doInput.connection.targetBlock()!);
        lines.push(`    ${currentId} -->|"SÍ (True)"| ${childRes.entryId}`);
        nodeExits.push(...childRes.exits);
        nodeExits.push({ nodeId: currentId, label: "NO (False)" });
      } else {
        nodeExits = [{ nodeId: currentId }];
      }
    } else if (type === "wpipe_if_else") {
      const cond = (block.getFieldValue("CONDITION") || "status_code == 200").replace(/"/g, "'");
      lines.push(`    ${currentId}{"🔀 Condición: ${cond}"}:::condStep`);

      const doInput = block.getInput("DO");
      if (doInput && doInput.connection && doInput.connection.targetBlock()) {
        const childRes = traverseBlock(doInput.connection.targetBlock()!);
        lines.push(`    ${currentId} -->|"SÍ (True)"| ${childRes.entryId}`);
        nodeExits.push(...childRes.exits);
      } else {
        nodeExits.push({ nodeId: currentId, label: "SÍ (True)" });
      }

      const elseInput = block.getInput("ELSE");
      if (elseInput && elseInput.connection && elseInput.connection.targetBlock()) {
        const elseRes = traverseBlock(elseInput.connection.targetBlock()!);
        lines.push(`    ${currentId} -->|"NO (False)"| ${elseRes.entryId}`);
        nodeExits.push(...elseRes.exits);
      } else {
        nodeExits.push({ nodeId: currentId, label: "NO (False)" });
      }
    } else if (type === "wpipe_for") {
      const iters = block.getFieldValue("ITERATIONS") || "3";
      lines.push(`    ${currentId}{{"🔁 Bucle For (${iters}x)"}}:::loopStep`);
      const doInput = block.getInput("DO");
      if (doInput && doInput.connection && doInput.connection.targetBlock()) {
        const childRes = traverseBlock(doInput.connection.targetBlock()!);
        lines.push(`    ${currentId} -->|"Iterar (1..${iters})"| ${childRes.entryId}`);
        childRes.exits.forEach((ex) => {
          lines.push(`    ${ex.nodeId} -.->|"Siguiente Iteración"| ${currentId}`);
        });
      }
      nodeExits = [{ nodeId: currentId, label: "Fin Bucle (Completado)" }];
    } else if (type === "wpipe_while") {
      const cond = (block.getFieldValue("CONDITION") || "retry_count < 3").replace(/"/g, "'");
      lines.push(`    ${currentId}{{"🔁 Bucle While (${cond})"}}:::loopStep`);
      const doInput = block.getInput("DO");
      if (doInput && doInput.connection && doInput.connection.targetBlock()) {
        const childRes = traverseBlock(doInput.connection.targetBlock()!);
        lines.push(`    ${currentId} -->|"Iterar (True)"| ${childRes.entryId}`);
        childRes.exits.forEach((ex) => {
          lines.push(`    ${ex.nodeId} -.->|"Re-evaluar Condición"| ${currentId}`);
        });
      }
      nodeExits = [{ nodeId: currentId, label: "Condition False (End)" }];
    } else if (type === "wpipe_parallel") {
      const policy = block.getFieldValue("MERGE_POLICY") || "accumulate";
      lines.push(`    ${currentId}["⚡ Inicio Paralelo (Fork)<br/><small>Merge: ${policy}</small>"]:::parallelStep`);
      const joinId = `join_${nodeCounter++}`;
      lines.push(`    ${joinId}["🔗 Context Join Barrier<br/><small>Merge: ${policy}</small>"]:::parallelStep`);

      const doInput = block.getInput("DO");
      if (doInput && doInput.connection && doInput.connection.targetBlock()) {
        let curParallelBlock: Blockly.Block | null = doInput.connection.targetBlock();
        let branchNum = 1;
        while (curParallelBlock) {
          const pChildRes = traverseBlock(curParallelBlock, true);
          lines.push(`    ${currentId} ==>|"Hebra ${branchNum++}"| ${pChildRes.entryId}`);
          pChildRes.exits.forEach((ex) => {
            lines.push(`    ${ex.nodeId} ==> ${joinId}`);
          });
          curParallelBlock = curParallelBlock.nextConnection?.targetBlock() || null;
        }
      } else {
        lines.push(`    ${currentId} ==> ${joinId}`);
      }
      nodeExits = [{ nodeId: joinId }];
    } else if (type === "wpipe_background") {
      lines.push(`    ${currentId}["⏳ Tarea Segundo Plano (Background)"]:::bgStep`);
      const doInput = block.getInput("DO");
      if (doInput && doInput.connection && doInput.connection.targetBlock()) {
        const childRes = traverseBlock(doInput.connection.targetBlock()!);
        lines.push(`    ${currentId} -.->|"Launch Background Thread"| ${childRes.entryId}`);
        const bgEndId = `bg_done_${nodeCounter++}`;
        lines.push(`    ${bgEndId}(["🏁 Background Thread End"]):::bgStep`);
        childRes.exits.forEach((ex) => {
          lines.push(`    ${ex.nodeId} -.-> ${bgEndId}`);
        });
      }
      nodeExits = [{ nodeId: currentId, label: "Flujo Principal" }];
    } else {
      lines.push(`    ${currentId}["${type}"]`);
      nodeExits = [{ nodeId: currentId }];
    }

    let finalExits = nodeExits;
    if (!stopAtNext && block.nextConnection && block.nextConnection.targetBlock()) {
      const nextRes = traverseBlock(block.nextConnection.targetBlock()!);
      nodeExits.forEach((ex) => {
        if (ex.label) {
          const cleanLabel = ex.label.replace(/^"|"$/g, "");
          lines.push(`    ${ex.nodeId} -->|"${cleanLabel}"| ${nextRes.entryId}`);
        } else {
          lines.push(`    ${ex.nodeId} --> ${nextRes.entryId}`);
        }
      });
      finalExits = nextRes.exits;
    }

    return { entryId: currentId, exits: finalExits };
  }

  // Prioritize root trigger block first
  const sortedTopBlocks = [...topBlocks].sort((a, b) => {
    if (a.type === "wpipe_trigger") return -1;
    if (b.type === "wpipe_trigger") return 1;
    return 0;
  });

  sortedTopBlocks.forEach((tb) => {
    traverseBlock(tb);
  });

  lines.push("    classDef startTrigger fill:#d97706,stroke:#f59e0b,stroke-width:2px,color:#fff,font-weight:bold;");
  lines.push("    classDef endResponse fill:#9f1239,stroke:#f43f5e,stroke-width:2px,color:#fff,font-weight:bold;");
  lines.push("    classDef catalogStep fill:#1e3a8a,stroke:#3b82f6,stroke-width:2px,color:#fff;");
  lines.push("    classDef aiStep fill:#581c87,stroke:#a855f7,stroke-width:2px,color:#fff;");
  lines.push("    classDef userStep fill:#115e59,stroke:#14b8a6,stroke-width:2px,color:#fff;");
  lines.push("    classDef condStep fill:#7c2d12,stroke:#f97316,stroke-width:2px,color:#fff;");
  lines.push("    classDef loopStep fill:#713f12,stroke:#eab308,stroke-width:2px,color:#fff;");
  lines.push("    classDef parallelStep fill:#064e3b,stroke:#10b981,stroke-width:2px,color:#fff;");
  lines.push("    classDef bgStep fill:#312e81,stroke:#6366f1,stroke-width:2px,color:#fff;");

  return lines.join("\n");
}

export const globalBreakpoints = new Set<string>();

export function toggleBlockBreakpoint(stepOrBlockId: string): boolean {
  if (globalBreakpoints.has(stepOrBlockId)) {
    globalBreakpoints.delete(stepOrBlockId);
    updateBreakpointVisuals();
    return false;
  } else {
    globalBreakpoints.add(stepOrBlockId);
    updateBreakpointVisuals();
    return true;
  }
}

export function updateBreakpointVisuals() {
  if (!activeWorkspaceRef) return;
  const blocks = activeWorkspaceRef.getAllBlocks(false);
  blocks.forEach((b) => {
    const name = b.getFieldValue("STEP_NAME") || b.type;
    const isBp = globalBreakpoints.has(b.id) || globalBreakpoints.has(name);
    const svgRoot = b.getSvgRoot();
    if (svgRoot) {
      if (isBp) {
        svgRoot.style.filter = "drop-shadow(0 0 12px #ef4444)";
      } else {
        svgRoot.style.filter = "none";
      }
    }
  });
}

export function updateBlockFieldValue(blockId: string, fieldName: string, value: any) {
  if (!activeWorkspaceRef) return;
  const b = activeWorkspaceRef.getBlockById(blockId);
  if (b) {
    b.setFieldValue(value, fieldName);
  }
}

export function getBlockData(block: Blockly.Block): any {
  const fields: Record<string, any> = {};
  block.inputList.forEach((input) => {
    input.fieldRow.forEach((f) => {
      if (f.name) {
        fields[f.name] = f.getValue();
      }
    });
  });

  const stepName = block.getFieldValue("STEP_NAME") || block.getFieldValue("LABEL") || block.type;
  const isBp = globalBreakpoints.has(block.id) || globalBreakpoints.has(stepName);

  const catalogEntry = globalCatalog.find(
    (c) => c.name === stepName || c.func_name === stepName
  );

  return {
    id: block.id,
    type: block.type,
    stepName,
    namespace: block.getFieldValue("NAMESPACE") || (catalogEntry ? catalogEntry.namespace : ""),
    category: block.getFieldValue("CATEGORY") || (catalogEntry ? catalogEntry.category : "general"),
    fields,
    isBreakpoint: isBp,
    docstring: catalogEntry?.description || catalogEntry?.docstring || "WPipe Studio logic block.",
    params: catalogEntry?.params || {},
    origin: catalogEntry?.repo || "official",
  };
}

export function highlightBlocklyBlock(stepName: string, state: "running" | "success" | "error" | "paused" | "idle") {
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
        } else if (state === "paused") {
          svgRoot.style.filter = "drop-shadow(0 0 16px #f59e0b) drop-shadow(0 0 8px #ef4444)";
        }
      } else if (state === "idle") {
        const isBp = globalBreakpoints.has(b.id) || globalBreakpoints.has(name);
        svgRoot.style.filter = isBp ? "drop-shadow(0 0 12px #ef4444)" : "none";
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
    let fileName: string | undefined = undefined;
    let origin: StepOrigin = "catalog";
    let conditionExpression: string | undefined = undefined;
    let forIterations: number | undefined = undefined;
    let mergePolicy: "accumulate" | "last_wins" = "accumulate";
    let notes: string | undefined = undefined;
    let codeSnippet: string | undefined = undefined;
    let params: Record<string, any> = {};
    let contract = { reads: ["data"], writes: ["result"], inferred: "exact" as const };

    let responseType: any = undefined;
    let responseParam: string | undefined = undefined;

    if (type === "wpipe_trigger") {
      nodeType = "trigger";
      triggerType = (block.getFieldValue("TRIGGER_TYPE") || "api") as any;
      triggerParam = block.getFieldValue("TRIGGER_PARAM") || "/run";
      label = `Trigger (${(triggerType || "api").toUpperCase()}: ${triggerParam})`;
      origin = "described";
      params = { trigger_type: triggerType, trigger_param: triggerParam };
    } else if (type === "wpipe_response") {
      nodeType = "response" as any;
      responseType = (block.getFieldValue("RESPONSE_TYPE") || "http_json") as any;
      responseParam = block.getFieldValue("RESPONSE_PARAM") || '{"status": "success"}';
      label = `Response (${(responseType || "http").toUpperCase()}: ${responseParam})`;
      origin = "described";
      params = { response_type: responseType, response_param: responseParam };
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
      const curFileName = block.getFieldValue("FILE_NAME") || "custom_user_step.py";
      fileName = curFileName;
      namespace = `app.states.${curFileName.replace(/\.py$/, "")}`;
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
        response_type: responseType,
        response_param: responseParam,
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
        file_name: fileName,
        parent_id: parentId || undefined,
        slot_type: slotType || undefined,
        block_type: type,
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

export function getWorkPlanFromBlocklyWorkspace(
  catalogSteps: any[] = [],
  projectName: string = "main_pipeline"
): string {
  if (!activeWorkspaceRef) {
    return "# 📋 WPipe Studio Execution Work Plan\n\nNo blocks found in workspace.";
  }

  const topBlocks = activeWorkspaceRef.getTopBlocks(true);
  if (!topBlocks || topBlocks.length === 0) {
    return "# 📋 WPipe Studio Execution Work Plan\n\nNo blocks configured in workspace.";
  }

  // Sort top blocks so root triggers/initial blocks come first
  const sortedTopBlocks = [...topBlocks].sort((a, b) => {
    if (a.type === "wpipe_trigger") return -1;
    if (b.type === "wpipe_trigger") return 1;
    return 0;
  });

  const catalog = catalogSteps.length > 0 ? catalogSteps : globalCatalog;

  let stepCounter = 1;

  function renderPlanBlock(
    block: Blockly.Block,
    depth: number = 0,
    isParallelBranch: boolean = false
  ): string[] {
    const pad = "  ".repeat(depth);
    const type = block.type;
    const lines: string[] = [];

    if (type === "wpipe_trigger") {
      const trigType = (block.getFieldValue("TRIGGER_TYPE") || "api").toLowerCase();
      const trigParam = block.getFieldValue("TRIGGER_PARAM") || "/run";
      lines.push(`${pad}- **Step ${stepCounter++}: 🚀 Ingress / Main Activation Trigger**`);
      lines.push(`${pad}  - **Tipo de Ingesta:** \`${trigType.toUpperCase()}\``);
      lines.push(`${pad}  - **Ruta / Topic / Canal:** \`${trigParam}\``);
      lines.push(`${pad}  - **Contrato de Entrada:** Recibe payload sin procesar, realiza validación Pydantic e inicializa el contexto de ejecución (\`PipelineContextDTO\`).`);
    } else if (type === "wpipe_response") {
      const respType = (block.getFieldValue("RESPONSE_TYPE") || "http_json").toLowerCase();
      const respParam = block.getFieldValue("RESPONSE_PARAM") || '{"status": "success", "data": context}';
      lines.push(`${pad}- **Paso ${stepCounter++}: 🏁 Egress / Salida y Respuesta del Pipeline**`);
      lines.push(`${pad}  - **Protocolo de Salida:** \`${respType.toUpperCase()}\``);
      lines.push(`${pad}  - **Payload / Parameter:** \`${respParam}\``);
      lines.push(`${pad}  - **Behavior:** Serializes enriched final state and consolidates latency metrics.`);
    } else if (type === "wpipe_step") {
      const name = block.getFieldValue("STEP_NAME") || "Step";
      const ns = block.getFieldValue("NAMESPACE") || "wpipe_steps";
      const catEntry = catalog.find((c) => c.name === name || c.func_name === name);
      const doc = catEntry?.description || catEntry?.docstring || "Paso modular ejecutable perteneciente al ecosistema WPipe.";
      lines.push(`${pad}- **Paso ${stepCounter++}: 📦 Paso de Catálogo: \`${name}\`**`);
      lines.push(`${pad}  - **Namespace / Pack:** \`${ns}\``);
      lines.push(`${pad}  - **Technical Specification:** ${doc}`);
      lines.push(`${pad}  - **Context Mutation:** Processes inputs and commits state transformations into context dictionary.`);
    } else if (type === "wpipe_ai_step") {
      const name = block.getFieldValue("STEP_NAME") || "AISentimentStep";
      const prompt = block.getFieldValue("AI_PROMPT") || "Clasificar sentimiento del texto (threshold=0.5)";
      lines.push(`${pad}- **Paso ${stepCounter++}: ✨ Paso Inteligente IA: \`${name}\`**`);
      lines.push(`${pad}  - **Directiva de Inferencia:** "${prompt}"`);
      lines.push(`${pad}  - **Contract:** Executes inference / NLP logic on payload and injects predictive scores into context.`);
    } else if (type === "wpipe_user_file_step") {
      const name = block.getFieldValue("STEP_NAME") || "CleanDataStep";
      const fileName = block.getFieldValue("FILE_NAME") || "clean_data.py";
      lines.push(`${pad}- **Paso ${stepCounter++}: 📄 Paso de Usuario / Script: \`${name}\`**`);
      lines.push(`${pad}  - **Archivo Fuente:** \`${fileName}\``);
      lines.push(`${pad}  - **Function:** Sanitization, key cleansing and in-memory type normalization.`);
    } else if (type === "wpipe_if") {
      const cond = block.getFieldValue("CONDITION") || "is_valid == True";
      lines.push(`${pad}- **Paso ${stepCounter++}: 🔀 Bifurcación Condicional Simple: \`Condition(expression="${cond}")\`**`);
      lines.push(`${pad}  - **Evaluated Expression:** \`${cond}\``);

      const doInput = block.getInput("DO");
      if (doInput && doInput.connection && doInput.connection.targetBlock()) {
        lines.push(`${pad}  - **True Branch:**`);
        const childBlock = doInput.connection.targetBlock()!;
        lines.push(...renderPlanBlock(childBlock, depth + 2));
      } else {
        lines.push(`${pad}  - **True Branch:** *(Empty - no-op step)*`);
      }
      lines.push(`${pad}  - **Rama NO (False / Bypass):**`);
      lines.push(`${pad}    - When expression evaluates to False, execution skips this block and continues to next step without mutating context.`);
    } else if (type === "wpipe_if_else") {
      const cond = block.getFieldValue("CONDITION") || "status_code == 200";
      lines.push(`${pad}- **Paso ${stepCounter++}: 🔀 Bifurcación Condicional Dual: \`Condition(expression="${cond}")\`**`);
      lines.push(`${pad}  - **Evaluated Expression:** \`${cond}\``);

      const doInput = block.getInput("DO");
      if (doInput && doInput.connection && doInput.connection.targetBlock()) {
        lines.push(`${pad}  - **True Branch:**`);
        const childBlock = doInput.connection.targetBlock()!;
        lines.push(...renderPlanBlock(childBlock, depth + 2));
      } else {
        lines.push(`${pad}  - **True Branch:** *(Empty)*`);
      }

      const elseInput = block.getInput("ELSE");
      if (elseInput && elseInput.connection && elseInput.connection.targetBlock()) {
        lines.push(`${pad}  - **Rama NO (False):**`);
        const elseBlock = elseInput.connection.targetBlock()!;
        lines.push(...renderPlanBlock(elseBlock, depth + 2));
      } else {
        lines.push(`${pad}  - **Rama NO (False):** *(Bypass / Fallback)*`);
      }
      lines.push(`${pad}  - **Punto de Convergencia:** Ambas ramas concluyen y sincronizan su flujo hacia el siguiente nodo.`);
    } else if (type === "wpipe_for") {
      const iters = block.getFieldValue("ITERATIONS") || "3";
      lines.push(`${pad}- **Paso ${stepCounter++}: 🔁 Bucle de Repetición: \`For(iterations=${iters})\`**`);
      lines.push(`${pad}  - **Iterations:** ${iters} continuous cycles`);

      const doInput = block.getInput("DO");
      if (doInput && doInput.connection && doInput.connection.targetBlock()) {
        lines.push(`${pad}  - **Cuerpo del Bucle (Body):**`);
        const childBlock = doInput.connection.targetBlock()!;
        lines.push(...renderPlanBlock(childBlock, depth + 2));
      }
      lines.push(`${pad}  - **Exit Condition:** After completing ${iters} iterations, execution advances to the next step.`);
    } else if (type === "wpipe_while") {
      const cond = block.getFieldValue("CONDITION") || "retry_count < 3";
      lines.push(`${pad}- **Paso ${stepCounter++}: 🔁 Bucle Condicional Mientras: \`For(validation_expression="${cond}")\`**`);
      lines.push(`${pad}  - **Continuity Expression:** \`${cond}\``);

      const doInput = block.getInput("DO");
      if (doInput && doInput.connection && doInput.connection.targetBlock()) {
        lines.push(`${pad}  - **Cuerpo del Bucle (Body):**`);
        const childBlock = doInput.connection.targetBlock()!;
        lines.push(...renderPlanBlock(childBlock, depth + 2));
      }
      lines.push(`${pad}  - **Break Condition:** When expression evaluates to False, loop terminates and sequence continues.`);
    } else if (type === "wpipe_parallel") {
      const merge = block.getFieldValue("MERGE_POLICY") || "accumulate";
      lines.push(`${pad}- **Paso ${stepCounter++}: ⚡ Concurrencia en Paralelo: \`Parallel(merge_policy="${merge}")\`**`);
      lines.push(`${pad}  - **Política de Fusión (Merge Policy):** \`${merge}\` (fusión determinista sin sobreescrituras destructivas).`);

      const doInput = block.getInput("DO");
      if (doInput && doInput.connection && doInput.connection.targetBlock()) {
        lines.push(`${pad}  - **Hebras Concurrentes Snapped (Workers):**`);
        let curParallel: Blockly.Block | null = doInput.connection.targetBlock();
        let branchNum = 1;
        while (curParallel) {
          lines.push(`${pad}    - **Hebra ${branchNum++} Concurrente:**`);
          lines.push(...renderPlanBlock(curParallel, depth + 3, true));
          curParallel = curParallel.nextConnection?.targetBlock() || null;
        }
      }
      lines.push(`${pad}  - **Barrera de Fusión (Join Barrier):** Todos los hilos finalizan concurrentemente y su resultado se integra en el contexto global bajo la política \`${merge}\`.`);
    } else if (type === "wpipe_background") {
      lines.push(`${pad}- **Paso ${stepCounter++}: ⏳ Tarea Asíncrona Desacoplada: \`Background\`**`);
      lines.push(`${pad}  - **Execution Model:** Fire-and-forget task in secondary thread without blocking main thread.`);

      const doInput = block.getInput("DO");
      if (doInput && doInput.connection && doInput.connection.targetBlock()) {
        lines.push(`${pad}  - **Delegated Async Step:**`);
        const childBlock = doInput.connection.targetBlock()!;
        lines.push(...renderPlanBlock(childBlock, depth + 2));
      }
      lines.push(`${pad}  - **Non-Blocking Behavior:** Main pipeline resumes immediately without waiting for background thread completion.`);
    } else {
      lines.push(`${pad}- **Paso ${stepCounter++}: \`${type}\`**`);
    }

    if (!isParallelBranch && block.nextConnection && block.nextConnection.targetBlock()) {
      lines.push(...renderPlanBlock(block.nextConnection.targetBlock()!, depth));
    }

    return lines;
  }

  const executionSteps: string[] = [];
  sortedTopBlocks.forEach((tb) => {
    executionSteps.push(...renderPlanBlock(tb, 0));
  });

  const mermaidDag = getMermaidFromBlocklyWorkspace();

  let md = `# 📋 Execution Plan & Architecture Specification — ${projectName}\n\n`;
  md += `> **Pipeline:** \`${projectName}\` | **Motor:** WPipe Core v2.5.13 Enterprise\n`;
  md += `> **Generated:** ${new Date().toISOString().replace("T", " ").slice(0, 19)} UTC | **Status:** Verified for Execution\n`;
  md += `> **Architecture:** Modular Asynchronous Microservice compliant with WPipe Architect Manual\n\n`;

  md += `---

## 1. 🎯 Executive Summary

The **${projectName}** pipeline implements a deterministic, high-throughput finite state machine utilizing **WPipe OS**. Features full lifecycle management: ingress, state orchestration, branched control flow, parallel concurrency, background threads and unified egress.

- **Total Orchestrated Nodes:** ${stepCounter - 1} steps
- **Ingress Point:** FastAPI REST Ingress / Worker Ingress
- **Control Flow:** Conditional branching, bounded loops and parallel fan-out with cumulative merge policy.

---

## 2. 🔀 Hierarchical Pipeline Execution Sequence

${executionSteps.join("\n")}

---

## 3. 📊 Official Flow Diagram (Mermaid DAG)

\`\`\`mermaid
${mermaidDag}
\`\`\`

---

## 4. 🛡️ WPipe Architecture, Concurrency & Quality Standards

1. **Inmutabilidad y Merge Determinista:** Los resultados de ramas concurrentes y bloques paralelos se fusionan siguiendo estrictamente la política declarada (\`merge_policy="accumulate"\`), garantizando consistencia transaccional y evitando colisiones de claves en memoria.
2. **Desacoplamiento de Tareas Asíncronas:** Las tareas encapsuladas en \`Background\` se delegan al pool de hilos de WPipe sin retener el ciclo de vida del hilo principal de ejecución ni incrementar la latencia de respuesta hacia el cliente.
3. **Manejo de Errores y Timeouts:** Cada paso encapsula su contrato de datos con validación Pydantic y decoradores \`@to_obj\`, \`@timeout_sync\` y control de excepciones (\`TaskError\`).
4. **Observability & Traceability:** All state transitions are logged to SQLite WAL with Prometheus metrics, per-node latency tracking and CPU/RAM profiling.
`;

  return md;
}

interface BlocklyWorkspaceProps {
  onWorkspaceChange?: (workspace: Blockly.WorkspaceSvg, isUserEvent?: boolean) => void;
  onBlockSelected?: (blockData: any) => void;
}

export const BlocklyComponent: React.FC<BlocklyWorkspaceProps> = ({ onWorkspaceChange, onBlockSelected }) => {
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
          wheel: true, // Enables two-finger touchpad panning
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
          scaleSpeed: 1.15,
          pinch: true,
        },
        trashcan: true,
        sounds: false,
      });

      // Laptop Touchpad Smart Zoom & Pan handler (Pinch-to-zoom & Ctrl+Wheel)
      const containerEl = blocklyDivRef.current;
      const onTouchpadWheel = (e: WheelEvent) => {
        if (!workspaceRef.current) return;
        // When user pinches on a trackpad or holds Ctrl while scrolling, browser fires wheel with ctrlKey: true
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          const currentScale = workspaceRef.current.getScale();
          const delta = -e.deltaY;
          const factor = delta > 0 ? 1.05 : 0.95;
          const newScale = Math.min(3, Math.max(0.3, currentScale * factor));
          const clientX = e.clientX;
          const clientY = e.clientY;
          workspaceRef.current.zoom(clientX, clientY, factor > 1 ? 1 : -1);
        }
      };
      containerEl.addEventListener("wheel", onTouchpadWheel, { passive: false });

      workspaceRef.current = ws;
      activeWorkspaceRef = ws;

      const isVSCodeEnv = isVSCodeEnvironment();

      // Starter template: 4 blocks (Trigger -> HttpRequest -> Condition -> Response).
      // Only created in standalone browser mode; in VS Code we wait for document/pipeline init state
      if (!isVSCodeEnv) {
        const triggerBlock = ws.newBlock("wpipe_trigger");
        triggerBlock.setFieldValue("api", "TRIGGER_TYPE");
        triggerBlock.setFieldValue("/run", "TRIGGER_PARAM");
        triggerBlock.initSvg();
        triggerBlock.render();
        attachBlockCollapseBehavior(triggerBlock);
        triggerBlock.moveBy(80, 50);

        // 1. Catalog step (HttpRequestContext)
        const block1 = ws.newBlock("wpipe_step");
        block1.setFieldValue("HttpRequestContext", "STEP_NAME");
        block1.setFieldValue("wpipe_steps.connectivity.http", "NAMESPACE");
        block1.initSvg();
        block1.render();
        attachBlockCollapseBehavior(block1);
        if (triggerBlock.nextConnection && block1.previousConnection) {
          triggerBlock.nextConnection.connect(block1.previousConnection);
        }

        // 2. Simple IF condition (wpipe_if)
        const blockIf = ws.newBlock("wpipe_if");
        blockIf.setFieldValue("status_code == 200", "CONDITION");
        blockIf.initSvg();
        blockIf.render();
        attachBlockCollapseBehavior(blockIf);
        if (block1.nextConnection && blockIf.previousConnection) {
          block1.nextConnection.connect(blockIf.previousConnection);
        }

        // 3. Pipeline egress (wpipe_response)
        const blockResponse = ws.newBlock("wpipe_response");
        blockResponse.setFieldValue("http_json", "RESPONSE_TYPE");
        blockResponse.setFieldValue('{"status": "success", "data": context}', "RESPONSE_PARAM");
        blockResponse.initSvg();
        blockResponse.render();
        attachBlockCollapseBehavior(blockResponse);
        if (blockIf.nextConnection && blockResponse.previousConnection) {
          blockIf.nextConnection.connect(blockResponse.previousConnection);
        }
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
          enforceLimitsOnCreate(ws, createEv);
        }
        if (e && (e as any).type === Blockly.Events.SELECTED) {
          const selEv = e as any;
          if (selEv.newElementId) {
            const b = ws.getBlockById(selEv.newElementId);
            if (b && onBlockSelected) {
              onBlockSelected(getBlockData(b));
            }
          } else if (onBlockSelected) {
            onBlockSelected(null);
          }
        }
        if (onWorkspaceChange && !isLoadingWorkspaceState) {
          const isUser = !!e && !(e as any).isUiEvent && ((e as any).recordUndo !== false);
          onWorkspaceChange(ws, isUser);
        }
      });
    }

    // Attach ResizeObserver to keep Blockly SVG responsive to all screen sizes & sidebar toggles
    let resizeObserver: ResizeObserver | null = null;
    const handleResize = () => {
      if (workspaceRef.current) {
        requestAnimationFrame(() => {
          if (workspaceRef.current) {
            Blockly.svgResize(workspaceRef.current);
          }
        });
      }
    };

    if (blocklyDivRef.current) {
      resizeObserver = new ResizeObserver(() => {
        handleResize();
      });
      resizeObserver.observe(blocklyDivRef.current);
    }
    window.addEventListener("resize", handleResize);

    return () => {
      if (resizeObserver) {
        resizeObserver.disconnect();
      }
      window.removeEventListener("resize", handleResize);
      if (workspaceRef.current) {
        if (activeWorkspaceRef === workspaceRef.current) {
          activeWorkspaceRef = null;
        }
        workspaceRef.current.dispose();
        workspaceRef.current = null;
      }
    };
  }, []);

  return <div ref={blocklyDivRef} className="w-full h-full overflow-hidden" />;
};
