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
   * Tokenize balanced argument lists ignoring commas inside brackets/parens/quotes.
   */
  public static tokenize(s: string): string[] {
    const items: string[] = [];
    let cur = "";
    let depth = 0;
    let inQuote: string | null = null;

    for (let i = 0; i < s.length; i++) {
      const ch = s[i];

      // Handle quotes
      if ((ch === '"' || ch === "'") && (i === 0 || s[i - 1] !== "\\")) {
        if (!inQuote) {
          inQuote = ch;
        } else if (inQuote === ch) {
          inQuote = null;
        }
      }

      if (!inQuote) {
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
  public static parseItem(itemStr: string): ParsedStepNode {
    const tr = itemStr.trim();

    if (tr.startsWith("Condition(")) {
      const exprMatch = tr.match(/expression\s*=\s*(["'])([\s\S]*?)\1/);
      const expr = exprMatch ? exprMatch[2] : "status_code == 200";

      const btMatch = tr.match(/branch_true\s*=\s*\[([\s\S]*?)\]/);
      const btTokens = btMatch ? this.tokenize(btMatch[1]) : [];

      const bfMatch = tr.match(/branch_false\s*=\s*\[([\s\S]*?)\]/);
      const bfTokens = bfMatch ? this.tokenize(bfMatch[1]) : [];

      return {
        type: bfTokens.length > 0 ? "wpipe_if_else" : "wpipe_if",
        condition: expr,
        branchTrue: btTokens.map((t) => this.parseItem(t)),
        branchFalse: bfTokens.map((t) => this.parseItem(t)),
        raw: tr,
      };
    } else if (tr.startsWith("For(")) {
      const itersMatch = tr.match(/iterations\s*=\s*(\d+)/);
      const iters = itersMatch ? parseInt(itersMatch[1], 10) : 3;

      const stepsMatch = tr.match(/steps\s*=\s*\[([\s\S]*?)\]/);
      const stepTokens = stepsMatch ? this.tokenize(stepsMatch[1]) : [];

      return {
        type: "wpipe_for",
        iterations: iters,
        branchTrue: stepTokens.map((t) => this.parseItem(t)),
        raw: tr,
      };
    } else if (tr.startsWith("Parallel(")) {
      const mergeMatch = tr.match(/merge_policy\s*=\s*(["'])([\s\S]*?)\1/);
      const merge = mergeMatch ? mergeMatch[2] : "accumulate";

      const stepsMatch = tr.match(/steps\s*=\s*\[([\s\S]*?)\]/);
      const stepTokens = stepsMatch ? this.tokenize(stepsMatch[1]) : [];

      return {
        type: "wpipe_parallel",
        mergePolicy: merge,
        branchTrue: stepTokens.map((t) => this.parseItem(t)),
        raw: tr,
      };
    } else if (tr.startsWith("Background(")) {
      const stepMatch = tr.match(/step\s*=\s*([A-Za-z0-9_]+(?:\([^)]*\))?)/);
      const innerName = stepMatch ? stepMatch[1].split("(")[0].trim() : "AsyncTask";
      return {
        type: "wpipe_background",
        stepName: innerName,
        raw: tr,
      };
    } else {
      // Direct step invocation, e.g. HttpRequestContext(), Queso(), CleanDataStep(...)
      const nameMatch = tr.match(/^([A-Za-z0-9_]+)/);
      const stepName = nameMatch ? nameMatch[1] : "Step";
      return {
        type: "wpipe_step",
        stepName: stepName,
        raw: tr,
      };
    }
  }

  /**
   * Decompile Python source code of pipelines.py into Blockly workspace_state structure.
   */
  public static decompile(pythonCode: string): any | null {
    if (!pythonCode || !pythonCode.includes("pipe")) {
      return null;
    }

    // 1. Find set_steps list
    const m = pythonCode.match(/(?:set_steps|steps)\s*\(\s*\[([\s\S]*?)\]\s*\)/) ||
              pythonCode.match(/steps\s*=\s*\[([\s\S]*?)\]/);

    if (!m) {
      return null;
    }

    const stepsRaw = m[1];
    const tokens = this.tokenize(stepsRaw);
    const parsedSteps = tokens.map((t) => this.parseItem(t));

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
        return {
          type: "wpipe_background",
          id: makeId(),
          fields: {
            STEP_NAME: item.stepName || "AsyncTask",
          },
        };
      } else {
        // Step node: check whether it's a catalog step or a user-created custom Python step
        const sName = item.stepName || "Step";
        const wsStep = WorkspaceIndex.getStep(sName);
        const catSteps = CatalogManager.getSteps();
        const isOfficialOrPlugin = catSteps.some(
          (cs) => cs.name === sName || cs.func_name === sName
        );

        if (wsStep || !isOfficialOrPlugin) {
          if (wsStep && wsStep.isAiStep) {
            // AI Generated Step (Purple block: wpipe_ai_step)
            return {
              type: "wpipe_ai_step",
              id: makeId(),
              fields: {
                STEP_NAME: sName,
                AI_PROMPT: wsStep.aiPrompt || wsStep.description || "Paso generado con IA",
              },
            };
          }
          // Custom User Step (Blue block: wpipe_user_file_step)
          const fileName = wsStep ? path.basename(wsStep.filePath) : `${sName.toLowerCase()}.py`;
          return {
            type: "wpipe_user_file_step",
            id: makeId(),
            fields: {
              STEP_NAME: sName,
              FILE_NAME: fileName,
              FILE_STATUS: `📁 states/${fileName}`,
            },
          };
        } else {
          // Catalog Step (Green block: wpipe_step)
          const catEntry = catSteps.find((cs) => cs.name === sName || cs.func_name === sName);
          const ns = catEntry ? catEntry.namespace : "wpipe_steps";
          return {
            type: "wpipe_step",
            id: makeId(),
            fields: {
              REPO_FILTER: "ALL",
              CAT_FILTER: "ALL",
              SEARCH_FILTER: "",
              STEP_NAME: sName,
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

    // Construct root chain: Trigger -> Steps -> Response
    const triggerBlock: any = {
      type: "wpipe_trigger",
      id: "root_trigger",
      x: 80,
      y: 50,
      fields: {
        TRIGGER_TYPE: "api",
        TRIGGER_PARAM: "/run",
      },
    };

    const responseBlock: any = {
      type: "wpipe_response",
      id: "root_response",
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

    return {
      blocks: {
        languageVersion: 0,
        blocks: [triggerBlock],
      },
    };
  }
}
