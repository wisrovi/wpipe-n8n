/**
 * WPipe Studio - Python Pipeline Decompiler
 * Parses Python source code (app/pipelines.py) into Blockly workspace_state JSON.
 * Powers true bidirectional sync: changes in Python code instantly reflect on visual blocks.
 * 
 * Author: William Rodriguez (wisrovi.dev)
 */

import * as uuid from "crypto";
import * as path from "path";
import { WorkspaceIndex } from "./workspaceIndex";
import { CatalogManager } from "./catalog";

export interface ParsedStepNode {
  type: string;
  stepName?: string;
  namespace?: string;
  condition?: string;
  branchTrue?: ParsedStepNode[];
  branchFalse?: ParsedStepNode[];
  iterations?: number;
  mergePolicy?: string;
  raw?: string;
}

export class PipelineDecompiler {
  /**
   * Extract balanced bracket content starting at a specific opening character index.
   */
  public static extractBalancedFromIndex(
    text: string,
    openCharIdx: number,
    openChar: string = "[",
    closeChar: string = "]"
  ): string | null {
    let depth = 1;
    let inQuote: string | null = null;

    for (let i = openCharIdx + 1; i < text.length; i++) {
      const ch = text[i];
      if ((ch === '"' || ch === "'") && (i === 0 || text[i - 1] !== "\\")) {
        if (!inQuote) inQuote = ch;
        else if (inQuote === ch) inQuote = null;
      } else if (!inQuote) {
        if (ch === openChar) depth++;
        else if (ch === closeChar) {
          depth--;
          if (depth === 0) {
            return text.substring(openCharIdx + 1, i);
          }
        }
      }
    }
    return null;
  }

  /**
   * Extract balanced bracket content starting from a matched prefix pattern in text.
   * E.g. prefix: /(?:set_steps|steps)\s*\(\s*\[/ -> extracts everything up to the matching closing ']'
   */
  public static extractBalanced(text: string, prefixRegex: RegExp, openChar: string = "[", closeChar: string = "]"): string | null {
    const match = prefixRegex.exec(text);
    if (!match) return null;
    const openIdx = match.index + match[0].lastIndexOf(openChar);
    if (openIdx < 0) return null;
    return this.extractBalancedFromIndex(text, openIdx, openChar, closeChar);
  }

  /**
   * Tokenize balanced argument lists ignoring commas inside brackets/parens/quotes and Python comments.
   */
  public static tokenize(s: string): string[] {
    const items: string[] = [];
    let cur = "";
    let depth = 0;
    let inQuote: string | null = null;
    let inComment = false;

    for (let i = 0; i < s.length; i++) {
      const ch = s[i];

      if (inComment) {
        if (ch === "\n" || ch === "\r") {
          inComment = false;
        }
        continue;
      }

      // Handle quotes
      if ((ch === '"' || ch === "'") && (i === 0 || s[i - 1] !== "\\")) {
        if (!inQuote) {
          inQuote = ch;
        } else if (inQuote === ch) {
          inQuote = null;
        }
      }

      if (!inQuote) {
        if (ch === "#") {
          inComment = true;
          continue;
        }

        if (ch === "[" || ch === "(" || ch === "{") depth++;
        else if (ch === "]" || ch === ")" || ch === "}") depth--;

        if (ch === "," && depth === 0) {
          if (cur.trim()) items.push(cur.trim());
          cur = "";
          continue;
        }
      }

      cur += ch;
    }
    if (cur.trim()) items.push(cur.trim());
    return items;
  }

  /**
   * Parse a single step string (e.g., StepName(), Condition(...), For(...))
   */
  public static parseItem(itemStr: string): ParsedStepNode | null {
    const tr = itemStr.trim();
    if (!tr || tr.startsWith("#")) {
      return null;
    }

    if (/(?:^|\b)(?:[a-zA-Z0-9_]+\.)?Condition\s*\(/.test(tr)) {
      const exprMatch = tr.match(/expression\s*=\s*(["'])([\s\S]*?)\1/);
      const expr = exprMatch ? exprMatch[2] : "status_code == 200";

      const btRaw = this.extractBalanced(tr, /branch_true\s*=\s*\[/);
      const btTokens = btRaw !== null ? this.tokenize(btRaw) : [];

      const bfRaw = this.extractBalanced(tr, /branch_false\s*=\s*\[/);
      const bfTokens = bfRaw !== null ? this.tokenize(bfRaw) : [];

      return {
        type: bfTokens.length > 0 ? "wpipe_if_else" : "wpipe_if",
        condition: expr,
        branchTrue: btTokens.map((t) => this.parseItem(t)).filter((s): s is ParsedStepNode => s !== null),
        branchFalse: bfTokens.map((t) => this.parseItem(t)).filter((s): s is ParsedStepNode => s !== null),
        raw: tr,
      };
    } else if (/(?:^|\b)(?:[a-zA-Z0-9_]+\.)?For\s*\(/.test(tr)) {
      const isWhile = tr.includes("validation_expression=");
      if (isWhile) {
        const valMatch = tr.match(/validation_expression\s*=\s*(["'])([\s\S]*?)\1/);
        const cond = valMatch ? valMatch[2] : "retry_count < 3";
        const stepsRaw = this.extractBalanced(tr, /steps\s*=\s*\[/);
        const stepTokens = stepsRaw !== null ? this.tokenize(stepsRaw) : [];
        return {
          type: "wpipe_while",
          condition: cond,
          branchTrue: stepTokens.map((t) => this.parseItem(t)).filter((s): s is ParsedStepNode => s !== null),
          raw: tr,
        };
      }
      const itersMatch = tr.match(/iterations\s*=\s*(\d+)/);
      const iters = itersMatch ? parseInt(itersMatch[1], 10) : 3;

      const stepsRaw = this.extractBalanced(tr, /steps\s*=\s*\[/);
      const stepTokens = stepsRaw !== null ? this.tokenize(stepsRaw) : [];

      return {
        type: "wpipe_for",
        iterations: iters,
        branchTrue: stepTokens.map((t) => this.parseItem(t)).filter((s): s is ParsedStepNode => s !== null),
        raw: tr,
      };
    } else if (/(?:^|\b)(?:[a-zA-Z0-9_]+\.)?Parallel\s*\(/.test(tr)) {
      const mergeMatch = tr.match(/merge_policy\s*=\s*(["'])([\s\S]*?)\1/);
      const merge = mergeMatch ? mergeMatch[2] : "accumulate";

      const stepsRaw = this.extractBalanced(tr, /steps\s*=\s*\[/);
      const stepTokens = stepsRaw !== null ? this.tokenize(stepsRaw) : [];

      return {
        type: "wpipe_parallel",
        mergePolicy: merge,
        branchTrue: stepTokens.map((t) => this.parseItem(t)).filter((s): s is ParsedStepNode => s !== null),
        raw: tr,
      };
    } else if (/(?:^|\b)(?:[a-zA-Z0-9_]+\.)?Background\s*\(/.test(tr)) {
      const stepMatch = tr.match(/step\s*=\s*([A-Za-z0-9_.]+(?:\([^)]*\))?)/);
      const innerName = stepMatch ? stepMatch[1].split("(")[0].trim() : "";
      const innerStep = innerName ? this.parseItem(stepMatch ? stepMatch[1] : innerName) : null;
      return {
        type: "wpipe_background",
        stepName: innerName || undefined,
        branchTrue: innerStep ? [innerStep] : [],
        raw: tr,
      };
    } else {
      // Direct step invocation, e.g. HttpRequestContext(), wpipe_steps.connectivity.http.HttpStep(), Queso(), CleanDataStep(...)
      // Supports dot-notation namespaces, keyword/positional parameters, and function references without parens
      const callMatch = tr.match(/^(?:([a-zA-Z0-9_.]+)\.)?([A-Za-z0-9_]+)(?:\s*\(([\s\S]*)\))?$/);
      if (!callMatch) {
        return null;
      }
      const pkgNamespace = callMatch[1] || undefined;
      const stepName = callMatch[2];
      return {
        type: "wpipe_step",
        stepName: stepName,
        namespace: pkgNamespace,
        raw: tr,
      };
    }
  }

  /**
   * Decompile Python source code (e.g. app/pipelines.py or modular pipeline file)
   * into Blockly workspace_state structure.
   * Supports single-pipeline scripts, multi-pipeline definitions, add_state chains, and variable references.
   */
  public static decompile(pythonCode: string): any | null {
    if (!pythonCode || (!pythonCode.includes("pipe") && !pythonCode.includes("Pipeline") && !pythonCode.includes("set_steps") && !pythonCode.includes("add_state"))) {
      return null;
    }

    // 1. Scan and extract all set_steps definitions (multi-pipeline support)
    const pipelineMatches: Array<{ varName: string; stepsRaw: string }> = [];
    const setStepsRegex = /(?:([a-zA-Z0-9_]+)\s*\.)?(?:set_steps|steps)\s*\(\s*\[/g;
    let match: RegExpExecArray | null;

    while ((match = setStepsRegex.exec(pythonCode)) !== null) {
      const varName = match[1] || "pipe";
      const openIdx = match.index + match[0].lastIndexOf("[");
      const extracted = this.extractBalancedFromIndex(pythonCode, openIdx, "[", "]");
      if (extracted !== null) {
        pipelineMatches.push({ varName, stepsRaw: extracted });
        setStepsRegex.lastIndex = openIdx + 1 + extracted.length;
      }
    }

    // 1b. Support variable assignment: `pipe.steps = [...]` or `steps = [...]`
    if (pipelineMatches.length === 0) {
      const stepsAssignRegex = /(?:([a-zA-Z0-9_]+)\s*\.)?steps\s*=\s*\[/g;
      while ((match = stepsAssignRegex.exec(pythonCode)) !== null) {
        const varName = match[1] || "pipe";
        const openIdx = match.index + match[0].lastIndexOf("[");
        const extracted = this.extractBalancedFromIndex(pythonCode, openIdx, "[", "]");
        if (extracted !== null) {
          pipelineMatches.push({ varName, stepsRaw: extracted });
          stepsAssignRegex.lastIndex = openIdx + 1 + extracted.length;
        }
      }
    }

    // 1c. Support variable reference: `pipe.set_steps(my_steps)` where `my_steps = [...]`
    if (pipelineMatches.length === 0) {
      const varCallRegex = /(?:([a-zA-Z0-9_]+)\s*\.)?set_steps\s*\(\s*([a-zA-Z0-9_]+)\s*\)/g;
      while ((match = varCallRegex.exec(pythonCode)) !== null) {
        const pipeVar = match[1] || "pipe";
        const listVar = match[2];
        const listDefRegex = new RegExp(`(?:^|\\n)\\s*${listVar}\\s*=\\s*\\[`);
        const extracted = this.extractBalanced(pythonCode, listDefRegex);
        if (extracted !== null) {
          pipelineMatches.push({ varName: pipeVar, stepsRaw: extracted });
        }
      }
    }

    // 1d. Support sequential `add_state(...)` calls:
    // e.g. pipe.add_state(Step1()); pipe.add_state(Step2())
    const addStateRegex = /(?:([a-zA-Z0-9_]+)\s*\.)?add_state\s*\(/g;
    const addStateMap: Map<string, string[]> = new Map();
    while ((match = addStateRegex.exec(pythonCode)) !== null) {
      const pVar = match[1] || "pipe";
      const openParenIdx = match.index + match[0].length - 1;
      const extractedArg = this.extractBalancedFromIndex(pythonCode, openParenIdx, "(", ")");
      if (extractedArg !== null && extractedArg.trim()) {
        if (!addStateMap.has(pVar)) {
          addStateMap.set(pVar, []);
        }
        addStateMap.get(pVar)!.push(extractedArg.trim());
        addStateRegex.lastIndex = openParenIdx + 1 + extractedArg.length;
      }
    }
    if (addStateMap.size > 0) {
      for (const [pVar, stepItems] of addStateMap.entries()) {
        const existing = pipelineMatches.find((pm) => pm.varName === pVar);
        if (!existing) {
          pipelineMatches.push({ varName: pVar, stepsRaw: stepItems.join(", ") });
        }
      }
    }

    if (pipelineMatches.length === 0) {
      const fallback = this.extractBalanced(pythonCode, /steps\s*=\s*\[/);
      if (fallback !== null) {
        pipelineMatches.push({ varName: "pipe", stepsRaw: fallback });
      }
    }

    if (pipelineMatches.length === 0) {
      return null;
    }

    // 2. Build Blockly Blocks chain
    let idCounter = 1;
    const makeId = () => `decompile_${Date.now()}_${idCounter++}`;

    const buildNode = (item: ParsedStepNode): any => {
      const itype = item.type;
      if (itype === "wpipe_if" || itype === "wpipe_if_else") {
        const block: any = {
          type: itype,
          id: makeId(),
          fields: {
            CONDITION: item.condition || "status_code == 200",
          },
        };

        if (item.branchTrue && item.branchTrue.length > 0) {
          block.inputs = {
            DO: {
              block: chainNodes(item.branchTrue),
            },
          };
        }

        if (itype === "wpipe_if_else" && item.branchFalse && item.branchFalse.length > 0) {
          if (!block.inputs) block.inputs = {};
          block.inputs.ELSE = {
            block: chainNodes(item.branchFalse),
          };
        }

        return block;
      } else if (itype === "wpipe_for") {
        const block: any = {
          type: "wpipe_for",
          id: makeId(),
          fields: {
            ITERATIONS: String(item.iterations || 3),
          },
        };
        if (item.branchTrue && item.branchTrue.length > 0) {
          block.inputs = {
            DO: {
              block: chainNodes(item.branchTrue),
            },
          };
        }
        return block;
      } else if (itype === "wpipe_while") {
        const block: any = {
          type: "wpipe_while",
          id: makeId(),
          fields: {
            CONDITION: item.condition || "retry_count < 3",
          },
        };
        if (item.branchTrue && item.branchTrue.length > 0) {
          block.inputs = {
            DO: {
              block: chainNodes(item.branchTrue),
            },
          };
        }
        return block;
      } else if (itype === "wpipe_parallel") {
        const block: any = {
          type: "wpipe_parallel",
          id: makeId(),
          fields: {
            MERGE_POLICY: item.mergePolicy || "accumulate",
          },
        };
        if (item.branchTrue && item.branchTrue.length > 0) {
          block.inputs = {
            DO: {
              block: chainNodes(item.branchTrue),
            },
          };
        }
        return block;
      } else if (itype === "wpipe_background") {
        const block: any = {
          type: "wpipe_background",
          id: makeId(),
          fields: {},
        };
        if (item.branchTrue && item.branchTrue.length > 0) {
          block.inputs = {
            DO: {
              block: chainNodes(item.branchTrue),
            },
          };
        }
        return block;
      } else {
        // Step node: check whether it's a catalog step or a user-created custom Python step
        const rawName = item.stepName || "Step";
        const sName = rawName.includes("Step")
          ? rawName.replace(/(?:[_\s-]*step)+$/i, "Step")
          : rawName;
        const wsStep = WorkspaceIndex.getStep(sName) || WorkspaceIndex.getStep(rawName);
        const catSteps = CatalogManager.getSteps();
        
        const isNamespaceOfficial = !!item.namespace && (
          item.namespace.startsWith("wpipe_steps") ||
          item.namespace.startsWith("wpipe_plugins")
        );
        
        const catEntry = catSteps.find(
          (cs) => cs.name === sName || cs.func_name === sName || cs.name === rawName || cs.func_name === rawName || cs.name === `${sName}Step` || (sName.endsWith('Step') && cs.name === sName.slice(0, -4)) || (item.namespace && cs.namespace === item.namespace && (cs.name === rawName || cs.func_name === rawName))
        );
        const isOfficialOrPlugin = isNamespaceOfficial || !!catEntry;

        if (wsStep || !isOfficialOrPlugin) {
          if (wsStep && wsStep.isAiStep) {
            // AI Generated Step (Purple block: wpipe_ai_step)
            return {
              type: "wpipe_ai_step",
              id: makeId(),
              fields: {
                STEP_NAME: wsStep.name || sName,
                AI_PROMPT: wsStep.aiPrompt || wsStep.description || "Paso generado con IA",
              },
            };
          }
          // Custom User Step (Blue block: wpipe_user_file_step)
          const effectiveName = wsStep ? wsStep.name : sName;
          const fallbackSnake = effectiveName
            .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
            .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
            .toLowerCase();
          const fileName = wsStep ? path.basename(wsStep.filePath) : `${fallbackSnake}.py`;
          return {
            type: "wpipe_user_file_step",
            id: makeId(),
            fields: {
              STEP_NAME: effectiveName,
              FILE_NAME: fileName,
              FILE_STATUS: `📁 states/${fileName}`,
            },
          };
        } else {
          // Catalog Step (Green block: wpipe_step)
          const effectiveStepName = catEntry ? (catEntry.func_name || catEntry.name) : (sName.toLowerCase() === "httpstep" ? "http" : sName);
          const ns = (catEntry && catEntry.namespace) || item.namespace || "wpipe_steps";
          return {
            type: "wpipe_step",
            id: makeId(),
            fields: {
              REPO_FILTER: "ALL",
              CAT_FILTER: "ALL",
              SEARCH_FILTER: "",
              STEP_NAME: effectiveStepName,
              NAMESPACE: ns,
            },
          };
        }
      }
    };

    const chainNodes = (items: ParsedStepNode[]): any => {
      if (!items || items.length === 0) return null;
      const first = buildNode(items[0]);
      let curr = first;
      for (let i = 1; i < items.length; i++) {
        const nextBlock = buildNode(items[i]);
        curr.next = { block: nextBlock };
        curr = nextBlock;
      }
      return first;
    };

    const topBlocks: any[] = [];

    pipelineMatches.forEach((pm, idx) => {
      const tokens = this.tokenize(pm.stepsRaw);
      const parsedSteps = tokens.map((t) => this.parseItem(t)).filter((s): s is ParsedStepNode => s !== null);

      let triggerType = "api";
      let triggerParam = idx === 0 ? "/run" : `/${pm.varName.replace(/^pipe_?/, "") || "sub"}`;

      const lowVar = pm.varName.toLowerCase();
      if (lowVar.includes("cron")) {
        triggerType = "cron";
        triggerParam = "0 * * * *";
      } else if (lowVar.includes("kafka")) {
        triggerType = "kafka";
        triggerParam = "events.input";
      } else if (lowVar.includes("redis")) {
        triggerType = "redis";
        triggerParam = "queue:tasks";
      } else if (lowVar.includes("webhook")) {
        triggerType = "webhook";
        triggerParam = "/webhook";
      } else if (lowVar.includes("cli")) {
        triggerType = "cli";
        triggerParam = "";
      }

      // Check if there is an explicit Pipeline or PipelineAsync instantiation with pipeline_name
      try {
        const nameRegex = new RegExp(`${pm.varName}\\s*=\\s*(?:Pipeline|PipelineAsync)\\s*\\(\\s*(?:pipeline_name\\s*=\\s*)?["']([^"']+)["']`);
        const nameMatch = nameRegex.exec(pythonCode);
        if (nameMatch) {
          const pipeName = nameMatch[1].toLowerCase();
          if (pipeName.includes("cron")) {
            triggerType = "cron";
            triggerParam = "0 * * * *";
          } else if (pipeName.includes("kafka")) {
            triggerType = "kafka";
            triggerParam = "events.input";
          } else if (pipeName.includes("redis")) {
            triggerType = "redis";
            triggerParam = "queue:tasks";
          } else if (pipeName.includes("webhook")) {
            triggerType = "webhook";
            triggerParam = "/webhook";
          }
        }
      } catch {}

      const triggerBlock: any = {
        type: "wpipe_trigger",
        id: idx === 0 ? "root_trigger" : `root_trigger_${idx}`,
        x: 80,
        y: 50 + idx * 320,
        fields: {
          TRIGGER_TYPE: triggerType,
          TRIGGER_PARAM: triggerParam,
        },
      };

      const responseBlock: any = {
        type: "wpipe_response",
        id: idx === 0 ? "root_response" : `root_response_${idx}`,
        fields: {
          RESPONSE_TYPE: "http_json",
          RESPONSE_PARAM: '{"status": "success", "data": context}',
        },
      };

      const bodyChain = chainNodes(parsedSteps);
      if (bodyChain) {
        triggerBlock.next = { block: bodyChain };
        let tail = bodyChain;
        while (tail && tail.next && tail.next.block) {
          tail = tail.next.block;
        }
        if (tail) {
          tail.next = { block: responseBlock };
        }
      } else {
        triggerBlock.next = { block: responseBlock };
      }

      topBlocks.push(triggerBlock);
    });

    return {
      blocks: {
        languageVersion: 0,
        blocks: topBlocks,
      },
    };
  }
}
