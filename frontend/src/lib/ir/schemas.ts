import { z } from "zod";

export const StepOriginSchema = z.enum(["catalog", "user_imported", "described"]);
export type StepOrigin = z.infer<typeof StepOriginSchema>;

export const InferredLevelSchema = z.enum(["exact", "trusted", "heuristic", "declared"]);
export type InferredLevel = z.infer<typeof InferredLevelSchema>;

export const ContextContractSchema = z.object({
  reads: z.array(z.string()).default([]),
  writes: z.array(z.string()).default([]),
  inferred: InferredLevelSchema.default("exact"),
});
export type ContextContract = z.infer<typeof ContextContractSchema>;

export const NodeDataSchema = z.object({
  label: z.string(),
  node_type: z.enum(["trigger", "response", "step", "condition", "for", "while", "parallel", "background"]).default("step"),
  trigger_type: z.enum(["api", "kafka", "redis", "cron", "webhook", "cli"]).nullable().optional(),
  trigger_param: z.string().nullable().optional(),
  response_type: z.enum(["http_json", "kafka_publish", "redis_publish", "file_export", "terminate"]).nullable().optional(),
  response_param: z.string().nullable().optional(),
  namespace: z.string().nullable().optional(),
  func_name: z.string().nullable().optional(),
  origin: StepOriginSchema.default("catalog"),
  params: z.record(z.any()).default({}),
  contract: ContextContractSchema.default({ reads: [], writes: [], inferred: "exact" }),
  condition_expression: z.string().nullable().optional(),
  for_iterations: z.number().nullable().optional(),
  merge_policy: z.enum(["accumulate", "last_wins"]).default("accumulate"),
  notes: z.string().nullable().optional(),
  code_snippet: z.string().nullable().optional(),
  parent_id: z.string().nullable().optional(),
  slot_type: z.enum(["if_body", "else_body", "loop_body", "parallel_body", "background_body"]).nullable().optional(),
  has_else: z.boolean().nullable().optional(),
  block_type: z.string().nullable().optional(),
});
export type NodeData = z.infer<typeof NodeDataSchema>;

export const PositionSchema = z.object({
  x: z.number().default(0),
  y: z.number().default(0),
});

export const CanvasNodeSchema = z.object({
  id: z.string(),
  type: z.string().default("default"),
  position: PositionSchema,
  data: NodeDataSchema,
});
export type CanvasNode = z.infer<typeof CanvasNodeSchema>;

export const CanvasEdgeSchema = z.object({
  id: z.string(),
  source: z.string(),
  target: z.string(),
  label: z.string().nullable().optional(),
  sourceHandle: z.string().nullable().optional(),
  targetHandle: z.string().nullable().optional(),
});
export type CanvasEdge = z.infer<typeof CanvasEdgeSchema>;

export const ViewportSchema = z.object({
  x: z.number().default(0),
  y: z.number().default(0),
  zoom: z.number().default(1),
});

export const CanvasIRSchema = z.object({
  nodes: z.array(CanvasNodeSchema).default([]),
  edges: z.array(CanvasEdgeSchema).default([]),
  viewport: ViewportSchema.default({ x: 0, y: 0, zoom: 1 }),
});
export type CanvasIR = z.infer<typeof CanvasIRSchema>;
