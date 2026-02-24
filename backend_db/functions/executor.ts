/**
 * SelfDB Serverless Function Runtime - Function Executor
 * Handles function execution with timeout, logging, and result reporting
 */

import { config } from "./config.ts";
import type { FunctionMetadata, FunctionContext, ExecutionResult } from "./types.ts";
import { markFunctionCompleted, completedRunOnceFunctions } from "./registry.ts";

// ─────────────────────────────────────────────────────────────────────────────
// UUID Generation
// ─────────────────────────────────────────────────────────────────────────────

export const generateUUID = (): string => crypto.randomUUID();

// ─────────────────────────────────────────────────────────────────────────────
// Backend API Client
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Call the backend API
 */
export async function callBackend(
  path: string,
  options: RequestInit = {}
): Promise<unknown> {
  const url = path.startsWith("http")
    ? path
    : `${config.backendUrl}${path.startsWith("/") ? path : "/" + path}`;

  const headers = new Headers(options.headers || {});
  headers.set("x-api-key", config.apiKey);
  if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");

  const resp = await fetch(url, { ...options, headers });
  const text = await resp.text();

  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }

  if (!resp.ok) {
    throw new Error(`Backend error ${resp.status}: ${text}`);
  }

  return data;
}

// ─────────────────────────────────────────────────────────────────────────────
// Execution Context
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a function execution context
 */
export function createFunctionContext(
  fn: FunctionMetadata,
  executionId?: string,
  deliveryId?: string
): FunctionContext {
  return {
    env: fn.env_vars || {},
    callBackend: async (path: string, options?: RequestInit) => {
      const headers = new Headers(options?.headers || {});
      if (executionId) headers.set("x-execution-id", executionId);
      if (deliveryId) headers.set("x-delivery-id", deliveryId);
      return callBackend(path, { ...options, headers });
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Function Execution
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Execute a function with timeout
 */
export async function executeWithTimeout(
  fn: FunctionMetadata,
  request: unknown,
  context: FunctionContext,
  timeout: number = config.functionTimeout
): Promise<Response> {
  return new Promise((resolve) => {
    const timeoutId = setTimeout(() => {
      console.warn(`Function execution timed out after ${timeout}ms`);
      resolve(
        new Response(JSON.stringify({ error: "Function execution timed out" }), {
          status: 504,
          headers: { "Content-Type": "application/json" },
        })
      );
    }, timeout);

    Promise.resolve()
      .then(async () => {
        try {
          const result = await fn.handler(request, context);
          clearTimeout(timeoutId);

          if (result instanceof Response) {
            resolve(result);
          } else {
            resolve(
              new Response(JSON.stringify(result), {
                headers: { "Content-Type": "application/json" },
              })
            );
          }
        } catch (error) {
          clearTimeout(timeoutId);
          console.error("Function execution error:", error);
          const errorMessage = error instanceof Error ? error.message : "Unknown error";
          resolve(
            new Response(
              JSON.stringify({
                error: "Function execution failed",
                message: errorMessage,
              }),
              {
                status: 500,
                headers: { "Content-Type": "application/json" },
              }
            )
          );
        }
      });
  });
}

/**
 * Execute a function with context (without Response wrapping)
 */
export async function executeWithContext(
  fn: FunctionMetadata,
  request: unknown,
  executionId?: string,
  deliveryId?: string
): Promise<unknown> {
  const context = createFunctionContext(fn, executionId, deliveryId);
  return fn.handler(request, context);
}

// ─────────────────────────────────────────────────────────────────────────────
// Execution Result Reporting
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Report execution result to Backend
 */
export async function reportExecutionResult(
  execution_id: string,
  function_name: string,
  success: boolean,
  result: unknown,
  logs: string[],
  execution_time_ms: number,
  delivery_id?: string
): Promise<void> {
  try {
    const requestBody: ExecutionResult = {
      execution_id,
      function_name,
      success,
      result,
      logs,
      execution_time_ms,
      timestamp: new Date().toISOString(),
    };

    if (delivery_id) {
      requestBody.delivery_id = delivery_id;
    }

    const headers: HeadersInit = {
      "Content-Type": "application/json",
      "x-execution-id": execution_id,
      "x-api-key": config.apiKey,
    };

    if (delivery_id) {
      (headers as Record<string, string>)["x-delivery-id"] = delivery_id;
    }

    const response = await fetch(
      `${config.backendUrl}/functions/${function_name}/execution-result`,
      {
        method: "POST",
        headers,
        body: JSON.stringify(requestBody),
      }
    );

    if (!response.ok) {
      console.error(`Failed to report execution result: HTTP ${response.status}`);
    } else {
      console.log(`Execution result reported for ${execution_id}`);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`Error reporting execution result: ${errorMessage}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Webhook Execution
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Execute webhook with log capture and result callback
 */
export async function executeWebhook(
  functionName: string,
  fn: FunctionMetadata,
  payload: unknown,
  env_vars: Record<string, string>,
  execution_id: string,
  delivery_id: string
): Promise<void> {
  const startTime = performance.now();
  const logs: string[] = [];

  // Capture console output
  const originalLog = console.log;
  const originalError = console.error;
  const originalWarn = console.warn;

  try {
    console.log = (...args: unknown[]) => {
      const msg = args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ");
      logs.push(`[LOG] ${msg}`);
      originalLog(...args);
    };

    console.error = (...args: unknown[]) => {
      const msg = args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ");
      logs.push(`[ERROR] ${msg}`);
      originalError(...args);
    };

    console.warn = (...args: unknown[]) => {
      const msg = args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ");
      logs.push(`[WARN] ${msg}`);
      originalWarn(...args);
    };

    // Create webhook context with env_vars
    const webhookContext: FunctionContext = {
      env: env_vars || {},
      callBackend: async (path: string, options?: RequestInit) => {
        const headers = new Headers(options?.headers || {});
        headers.set("x-execution-id", execution_id);
        headers.set("x-delivery-id", delivery_id);
        headers.set("x-api-key", config.apiKey);
        return callBackend(path, { ...options, headers });
      },
    };

    // Create mock webhook request
    const webhookRequest = {
      method: "POST",
      url: new URL(`http://localhost:${config.port}/webhook/${functionName}`),
      headers: new Headers({
        "Content-Type": "application/json",
        "x-execution-id": execution_id,
        "x-delivery-id": delivery_id,
      }),
      json: async () => payload,
      text: async () => JSON.stringify(payload),
    };

    // Execute handler with timeout
    const result = await Promise.race([
      fn.handler(webhookRequest, webhookContext),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Webhook execution timeout")), config.functionTimeout)
      ),
    ]);

    const executionTime = performance.now() - startTime;

    // Update function status
    fn.status.lastRun = new Date();
    fn.status.runCount++;
    fn.status.lastResult = result;

    logs.push(`[INFO] Webhook execution completed in ${executionTime.toFixed(2)}ms`);

    // Send execution result back to Backend
    await reportExecutionResult(
      execution_id,
      functionName,
      true,
      result,
      logs,
      executionTime,
      delivery_id
    );
  } catch (error) {
    const executionTime = performance.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);

    fn.status.error = errorMessage;
    fn.status.lastRun = new Date();
    fn.status.runCount++;

    logs.push(`[ERROR] Webhook failed: ${errorMessage}`);

    // Report failure to Backend
    await reportExecutionResult(
      execution_id,
      functionName,
      false,
      { error: errorMessage },
      logs,
      executionTime,
      delivery_id
    );
  } finally {
    // Restore console
    console.log = originalLog;
    console.error = originalError;
    console.warn = originalWarn;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Event Execution
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Execute a function triggered by an event
 */
export async function executeEventFunction(
  fn: FunctionMetadata,
  eventName: string,
  eventData: unknown
): Promise<unknown> {
  // If it's a runOnce function, check completion status first
  if (fn.runOnce && completedRunOnceFunctions.has(fn.name)) {
    console.log(`Skipping one-time event function ${fn.name} as it has already completed.`);
    return { success: true, message: "One-time function already completed." };
  }

  const execution_id = generateUUID();
  const delivery_id = generateUUID();
  const startTime = performance.now();

  try {
    // Create a mock request for the handler
    const mockRequest = {
      method: "POST",
      headers: new Headers({
        "Content-Type": "application/json",
        "X-Trigger-Type": "event",
        "X-Event-Name": eventName,
        "x-execution-id": execution_id,
        "x-delivery-id": delivery_id,
      }),
      json: () => Promise.resolve(eventData),
    };

    const result = await executeWithContext(fn, mockRequest, execution_id, delivery_id);
    const executionTime = performance.now() - startTime;

    console.log(`Event function ${fn.name} completed with result:`, result);

    // Update function status
    fn.status.lastRun = new Date();
    fn.status.runCount++;
    fn.status.lastResult = result;

    // Report execution result to Backend
    await reportExecutionResult(
      execution_id,
      fn.name,
      true,
      result,
      [`[INFO] Event trigger executed successfully in ${executionTime.toFixed(2)}ms`],
      executionTime,
      delivery_id
    );

    // If this is a one-time function, mark as completed only if successful
    if (fn.runOnce && result && (result as { success?: boolean }).success === true) {
      markFunctionCompleted(fn.name);
      console.log(
        `One-time event function ${fn.name} has completed successfully and will not run again`
      );
    }

    return result;
  } catch (err) {
    const executionTime = performance.now() - startTime;
    const errorMessage = err instanceof Error ? err.message : String(err);

    console.error(`Error in event function ${fn.name}:`, err);
    fn.status.error = errorMessage;
    fn.status.lastRun = new Date();
    fn.status.runCount++;

    // Report execution failure to Backend
    await reportExecutionResult(
      execution_id,
      fn.name,
      false,
      { error: errorMessage },
      [`[ERROR] Event trigger failed: ${errorMessage}`],
      executionTime,
      delivery_id
    );

    throw err;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// One-Time Function Execution
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Execute a one-time function
 */
export async function executeOneTimeFunction(fn: FunctionMetadata): Promise<unknown> {
  // Double check completion status
  if (completedRunOnceFunctions.has(fn.name) || fn.status.hasCompleted) {
    console.log(`Skipping execution of one-time function ${fn.name} as it has already completed.`);
    return { success: true, message: "Already completed" };
  }

  const execution_id = generateUUID();
  const delivery_id = generateUUID();
  const startTime = performance.now();

  try {
    // Create a mock request for the handler
    const mockRequest = {
      method: "POST",
      headers: new Headers({
        "Content-Type": "application/json",
        "X-Trigger-Type": "once",
        "x-execution-id": execution_id,
        "x-delivery-id": delivery_id,
      }),
    };

    const result = await executeWithContext(fn, mockRequest, execution_id, delivery_id);
    const executionTime = performance.now() - startTime;

    console.log(`One-time function ${fn.name} completed with result:`, result);

    // Update function status
    fn.status.lastRun = new Date();
    fn.status.runCount++;
    fn.status.lastResult = result;

    // Report execution result to Backend
    await reportExecutionResult(
      execution_id,
      fn.name,
      true,
      result,
      [`[INFO] One-time function executed successfully in ${executionTime.toFixed(2)}ms`],
      executionTime
    );

    // Only mark as completed if the function was successful
    if (result && (result as { success?: boolean }).success === true) {
      markFunctionCompleted(fn.name);
      console.log(
        `One-time function ${fn.name} has completed successfully and will not run again`
      );
    }

    return result;
  } catch (err) {
    const executionTime = performance.now() - startTime;
    const errorMessage = err instanceof Error ? err.message : String(err);

    console.error(`Error in one-time function ${fn.name}:`, err);
    fn.status.error = errorMessage;
    fn.status.lastRun = new Date();
    fn.status.runCount++;

    // Report execution failure to Backend
    await reportExecutionResult(
      execution_id,
      fn.name,
      false,
      { error: errorMessage },
      [`[ERROR] One-time function failed: ${errorMessage}`],
      executionTime
    );

    throw err;
  }
}
