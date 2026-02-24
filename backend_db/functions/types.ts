/**
 * SelfDB Serverless Function Runtime - Type Definitions
 * Defines trigger types, execution status, and function metadata interfaces
 */

// ─────────────────────────────────────────────────────────────────────────────
// Trigger Types
// ─────────────────────────────────────────────────────────────────────────────

export type HttpTrigger = {
  type: "http";
  method?: string | string[];
  path?: string;
};

export type ScheduleTrigger = {
  type: "schedule";
  cron: string;
  name?: string;
};

export type DatabaseTrigger = {
  type: "database";
  table: string;
  operations?: string[];
  channel?: string;
};

export type EventTrigger = {
  type: "event";
  event: string;
};

export type OneTimeTrigger = {
  type: "once";
  condition?: string;
};

export type WebhookTrigger = {
  type: "webhook";
  method?: string;
};

export type Trigger =
  | HttpTrigger
  | ScheduleTrigger
  | DatabaseTrigger
  | EventTrigger
  | OneTimeTrigger
  | WebhookTrigger;

// ─────────────────────────────────────────────────────────────────────────────
// Execution Status
// ─────────────────────────────────────────────────────────────────────────────

export type ExecutionStatus = {
  lastRun?: Date;
  runCount: number;
  hasCompleted: boolean;
  lastResult?: unknown;
  error?: string;
};

// ─────────────────────────────────────────────────────────────────────────────
// Function Metadata
// ─────────────────────────────────────────────────────────────────────────────

export interface FunctionMetadata {
  name: string;
  description?: string;
  triggers?: Trigger[];
  handler: (req: unknown, ctx: FunctionContext) => Promise<unknown>;
  path: string;
  filePath: string;
  status: ExecutionStatus;
  runOnce?: boolean;
  env_vars?: Record<string, string>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Function Context
// ─────────────────────────────────────────────────────────────────────────────

export interface FunctionContext {
  env: Record<string, string>;
  callBackend: (path: string, options?: RequestInit) => Promise<unknown>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Webhook Execution Request
// ─────────────────────────────────────────────────────────────────────────────

export interface WebhookExecutionRequest {
  payload: unknown;
  env_vars: Record<string, string>;
  execution_id: string;
  delivery_id: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Execution Result
// ─────────────────────────────────────────────────────────────────────────────

export interface ExecutionResult {
  execution_id: string;
  function_name: string;
  success: boolean;
  result: unknown;
  logs: string[];
  execution_time_ms: number;
  timestamp: string;
  delivery_id?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Deploy Request
// ─────────────────────────────────────────────────────────────────────────────

export interface DeployRequest {
  functionName: string;
  code: string;
  isActive?: boolean;
  env?: Record<string, string>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Health Status
// ─────────────────────────────────────────────────────────────────────────────

export interface HealthStatus {
  status: "ok" | "degraded" | "error";
  functions: number;
  database: "connected" | "disconnected";
  listeners: string[];
}
