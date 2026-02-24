/**
 * SelfDB Serverless Function Runtime - HTTP Server
 * Handles HTTP requests and routing for the function runtime
 */

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { corsHeaders, config } from "./config.ts";
import type {
  FunctionMetadata,
  HttpTrigger,
  HealthStatus,
  DeployRequest,
  WebhookExecutionRequest,
} from "./types.ts";
import { functionRegistry, getFunction, eventBus, getRegistryStats } from "./registry.ts";
import { isConnected, getActiveListeners, sendNotification } from "./database.ts";
import { deployFunction, undeployFunction, scanAndLoadFunctions } from "./loader.ts";
import {
  executeWithTimeout,
  executeWebhook,
  createFunctionContext,
  generateUUID,
  reportExecutionResult,
} from "./executor.ts";

// ─────────────────────────────────────────────────────────────────────────────
// Response Helpers
// ─────────────────────────────────────────────────────────────────────────────

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

function errorResponse(error: string, status = 400, message?: string): Response {
  return jsonResponse({ error, ...(message && { message }) }, status);
}

// ─────────────────────────────────────────────────────────────────────────────
// Request Handler
// ─────────────────────────────────────────────────────────────────────────────

async function handleRequest(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;

  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  // Health check endpoint
  if (path === "/health") {
    const health: HealthStatus = {
      status: "ok",
      functions: functionRegistry.size,
      database: isConnected() ? "connected" : "disconnected",
      listeners: getActiveListeners(),
    };
    return jsonResponse(health);
  }

  // Deployment endpoint - receives function code from Backend
  if (path === "/deploy" && req.method === "POST") {
    try {
      const body = (await req.json()) as DeployRequest;
      const { functionName, code, env } = body;

      if (!functionName || !code) {
        return errorResponse("Missing functionName or code");
      }

      const result = await deployFunction(functionName, code, env);
      return jsonResponse(result, result.success ? 200 : 500);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return errorResponse("Deployment failed", 500, errorMessage);
    }
  }

  // Undeploy endpoint - removes function from Deno
  if (path.startsWith("/deploy/") && req.method === "DELETE") {
    try {
      const functionName = path.replace("/deploy/", "");
      const result = await undeployFunction(functionName);
      return jsonResponse(result, result.success ? 200 : 500);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return errorResponse("Undeploy failed", 500, errorMessage);
    }
  }

  // Invoke endpoint - receives invocation requests from Backend (webhooks, etc.)
  if (path.startsWith("/invoke/") && req.method === "POST") {
    try {
      const functionName = path.replace("/invoke/", "");
      const fn = getFunction(functionName);

      if (!fn) {
        return errorResponse(`Function '${functionName}' not found`, 404);
      }

      const body = (await req.json()) as { payload?: unknown; delivery_id?: string };
      const { payload, delivery_id } = body;

      const execution_id = generateUUID();
      const startTime = performance.now();

      console.log(`Invoke triggered for ${functionName}: execution_id=${execution_id}, delivery_id=${delivery_id}`);

      try {
        // Create mock request with payload
        const mockRequest = new Request("http://localhost/invoke", {
          method: "POST",
          headers: new Headers({
            "Content-Type": "application/json",
            "x-trigger-type": "invoke",
            "x-execution-id": execution_id,
            "x-delivery-id": delivery_id || "",
          }),
          body: JSON.stringify(payload || {}),
        });

        const context = createFunctionContext(fn, execution_id, delivery_id || "");
        const response = await executeWithTimeout(fn, mockRequest, context);
        const executionTime = performance.now() - startTime;

        // Parse response
        let result: unknown;
        try {
          result = await response.clone().json();
        } catch {
          result = await response.text();
        }

        // Update function status
        fn.status.lastRun = new Date();
        fn.status.runCount++;
        fn.status.lastResult = result;

        // Report execution result to Backend
        await reportExecutionResult(
          execution_id,
          functionName,
          response.status < 400,
          result,
          [`[INFO] Invoked function executed successfully in ${executionTime.toFixed(2)}ms`],
          executionTime,
          delivery_id
        );

        return jsonResponse({
          success: true,
          execution_id,
          delivery_id,
          result,
          execution_time_ms: executionTime,
        });
      } catch (err) {
        const executionTime = performance.now() - startTime;
        const errorMessage = err instanceof Error ? err.message : String(err);

        fn.status.lastRun = new Date();
        fn.status.runCount++;
        fn.status.error = errorMessage;

        await reportExecutionResult(
          execution_id,
          functionName,
          false,
          { error: errorMessage },
          [`[ERROR] Invoked function failed: ${errorMessage}`],
          executionTime,
          delivery_id
        );

        return errorResponse("Function execution failed", 500, errorMessage);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return errorResponse("Invoke failed", 500, errorMessage);
    }
  }

  // Webhook trigger endpoint - receives webhook execution requests from Backend
  if (path.startsWith("/webhook/") && req.method === "POST") {
    try {
      const functionName = path.replace("/webhook/", "");
      const fn = getFunction(functionName);

      if (!fn) {
        return errorResponse("Function not found", 404);
      }

      const body = (await req.json()) as WebhookExecutionRequest;
      const { payload, env_vars, execution_id, delivery_id } = body;

      console.log(
        `Webhook triggered for ${functionName}: execution_id=${execution_id}, delivery_id=${delivery_id}`
      );

      // Start execution asynchronously (don't wait for completion)
      executeWebhook(functionName, fn, payload, env_vars, execution_id, delivery_id);

      // Return immediately with queued status
      return jsonResponse(
        {
          success: true,
          message: "Webhook queued for execution",
          execution_id,
          delivery_id,
        },
        202
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return errorResponse("Webhook execution failed", 500, errorMessage);
    }
  }

  // List functions endpoint
  if (path === "/functions") {
    const functions = Array.from(functionRegistry.entries()).map(([name, fn]) => ({
      name,
      path: fn.path,
      description: fn.description,
      triggers: fn.triggers,
      status: {
        lastRun: fn.status.lastRun,
        runCount: fn.status.runCount,
        hasCompleted: fn.status.hasCompleted,
        error: fn.status.error,
      },
      runOnce: fn.runOnce,
    }));

    return jsonResponse(functions);
  }

  // Get function status endpoint
  if (path.startsWith("/function-status/")) {
    const functionName = path.replace("/function-status/", "");
    const fn = getFunction(functionName);

    if (!fn) {
      return errorResponse(`Function '${functionName}' not found`, 404);
    }

    return jsonResponse({
      name: fn.name,
      status: {
        lastRun: fn.status.lastRun,
        runCount: fn.status.runCount,
        hasCompleted: fn.status.hasCompleted,
        lastResult: fn.status.lastResult,
        error: fn.status.error,
      },
      runOnce: fn.runOnce,
    });
  }

  // Reload functions endpoint
  if (path === "/reload") {
    await scanAndLoadFunctions();
    const stats = getRegistryStats();
    return jsonResponse({ success: true, count: stats.total });
  }

  // Emit event endpoint
  if (path === "/emit-event" && req.method === "POST") {
    try {
      const body = (await req.json()) as { event?: string; data?: unknown };

      if (!body.event) {
        return errorResponse("Missing 'event' field in request body");
      }

      const eventName = body.event;
      const eventData = body.data || {};

      // Check if any functions are listening for this event
      let hasListeners = false;
      for (const fn of functionRegistry.values()) {
        const eventTriggers = fn.triggers?.filter((t) => t.type === "event") || [];
        if (eventTriggers.some((t) => (t as { event: string }).event === eventName)) {
          hasListeners = true;
          break;
        }
      }

      // Emit the event
      eventBus.emit(eventName, eventData);

      return jsonResponse({
        success: true,
        event: eventName,
        hasListeners,
        message: hasListeners
          ? `Event '${eventName}' emitted and will be processed by listeners`
          : `Event '${eventName}' emitted but no functions are listening for it`,
      });
    } catch {
      return errorResponse("Invalid JSON in request body");
    }
  }

  // Database notification endpoint
  if (path === "/db-notify" && req.method === "POST") {
    try {
      const body = (await req.json()) as { channel?: string; payload?: unknown };

      if (!body.channel) {
        return errorResponse("Missing 'channel' field in request body");
      }

      const channel = body.channel;
      const payload = body.payload ? JSON.stringify(body.payload) : "";

      const success = await sendNotification(channel, payload);
      if (!success) {
        return errorResponse("Database connection not available", 500);
      }

      return jsonResponse({
        success: true,
        channel,
        message: `Notification sent on channel '${channel}'`,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Error sending notification";
      return errorResponse(errorMessage, 500);
    }
  }

  // Handle function execution via HTTP
  return handleFunctionExecution(req, path);
}

// ─────────────────────────────────────────────────────────────────────────────
// Function Execution Handler
// ─────────────────────────────────────────────────────────────────────────────

async function handleFunctionExecution(req: Request, path: string): Promise<Response> {
  // Extract function name from path
  const segments = path.split("/").filter(Boolean);
  const functionName = segments[0];

  if (!functionName) {
    return errorResponse("Function name not specified");
  }

  // Find the function
  const fn = getFunction(functionName);

  if (!fn) {
    return errorResponse(`Function '${functionName}' not found`, 404);
  }

  // Check if the function has an HTTP trigger
  const httpTriggers = (fn.triggers?.filter((t) => t.type === "http") as HttpTrigger[]) || [];

  if (httpTriggers.length === 0) {
    return errorResponse(`Function '${functionName}' does not have an HTTP trigger`);
  }

  // Check if the HTTP method is allowed
  const allowedMethods = httpTriggers.flatMap((t) =>
    t.method ? (Array.isArray(t.method) ? t.method : [t.method]) : ["GET", "POST", "PUT", "DELETE", "PATCH"]
  );

  if (!allowedMethods.includes(req.method)) {
    return errorResponse(`Method '${req.method}' not allowed for function '${functionName}'`, 405);
  }

  // Execute the function
  const startTime = performance.now();
  const execution_id = generateUUID();
  const delivery_id = generateUUID();

  try {
    // Add execution headers to request
    const enhancedReq = new Request(req.url, {
      method: req.method,
      headers: new Headers(req.headers),
      body: req.body,
    });
    enhancedReq.headers.set("x-execution-id", execution_id);
    enhancedReq.headers.set("x-delivery-id", delivery_id);

    const context = createFunctionContext(fn, execution_id, delivery_id);
    const response = await executeWithTimeout(fn, enhancedReq, context);
    const executionTime = performance.now() - startTime;

    // Update function status
    fn.status.lastRun = new Date();
    fn.status.runCount++;
    fn.status.lastResult = { status: response.status, statusText: response.statusText };

    // Report execution result to Backend
    await reportExecutionResult(
      execution_id,
      functionName,
      response.status < 400,
      { status: response.status, statusText: response.statusText },
      [`[INFO] HTTP function executed successfully in ${executionTime.toFixed(2)}ms`],
      executionTime
    );

    // Add CORS headers to the response
    const headers = new Headers(response.headers);
    Object.entries(corsHeaders).forEach(([key, value]) => {
      headers.set(key, value);
    });

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  } catch (err) {
    const executionTime = performance.now() - startTime;
    const errorMessage = err instanceof Error ? err.message : String(err);

    console.error(`Error executing function '${functionName}':`, err);

    // Update function status
    fn.status.lastRun = new Date();
    fn.status.runCount++;
    fn.status.error = errorMessage;

    // Report execution failure to Backend
    await reportExecutionResult(
      execution_id,
      functionName,
      false,
      { error: errorMessage },
      [`[ERROR] HTTP function failed: ${errorMessage}`],
      executionTime
    );

    return errorResponse("Internal server error", 500, errorMessage);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Server Startup
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Start the HTTP server
 */
export async function startServer(): Promise<void> {
  console.log(`SelfDB Serverless Function Runtime listening on :${config.port}`);
  await serve(handleRequest, { port: config.port });
}
