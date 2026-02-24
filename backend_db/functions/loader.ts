/**
 * SelfDB Serverless Function Runtime - Function Loader
 * Handles loading, unloading, and hot-reloading of function files
 */

import type { FunctionMetadata, ExecutionStatus, EventTrigger, DatabaseTrigger } from "./types.ts";
import {
  functionRegistry,
  completedRunOnceFunctions,
  eventBus,
  registerFunction,
  clearRegistry,
} from "./registry.ts";
import { setupDatabaseListener } from "./database.ts";
import { executeEventFunction, executeOneTimeFunction } from "./executor.ts";

// ─────────────────────────────────────────────────────────────────────────────
// Function Loading
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Load and register a function from a file path
 */
export async function loadFunction(filePath: string): Promise<FunctionMetadata | null> {
  try {
    console.log(`Loading function from: ${filePath}`);
    
    // Dynamic import with cache-busting timestamp
    const module = await import(filePath + `?ts=${Date.now()}`);

    if (typeof module.default !== "function") {
      console.log(`Module ${filePath} does not export a default function`);
      return null;
    }

    // Extract function name from file path
    const fileName = filePath.split("/").pop() || "";
    const functionName = fileName.replace(/\.ts$/, "");
    const httpPath = `/${functionName}`;

    // Check if this function was previously completed (if runOnce)
    const initialHasCompleted = completedRunOnceFunctions.has(functionName);

    const executionStatus: ExecutionStatus = {
      runCount: 0,
      hasCompleted: initialHasCompleted,
      lastResult: undefined,
      error: undefined,
    };

    // Get function metadata
    const metadata: FunctionMetadata = {
      name: functionName,
      description: module.description || "",
      triggers: module.triggers || [],
      handler: module.default,
      path: httpPath,
      filePath: filePath,
      status: executionStatus,
      runOnce: module.runOnce === true,
      env_vars: undefined,
    };

    // Load environment variables if they exist
    const envFilePath = filePath.replace(/\.ts$/, ".env.json");
    try {
      const envData = await Deno.readTextFile(envFilePath);
      metadata.env_vars = JSON.parse(envData);
      console.log(`Loaded env vars for function: ${functionName}`);
    } catch {
      // No env file or invalid JSON - that's OK
      console.log(`No env vars file found for function: ${functionName}`);
    }

    // If no triggers are defined, add default HTTP trigger
    if (!metadata.triggers || metadata.triggers.length === 0) {
      metadata.triggers = [{ type: "http" }];
    }

    // Register the function
    registerFunction(metadata);

    if (metadata.runOnce && metadata.status.hasCompleted) {
      console.log(`Registered (already completed) one-time function: ${functionName}`);
    }

    // Set up event listeners for event triggers
    const eventTriggers = metadata.triggers.filter((t) => t.type === "event") as EventTrigger[];
    eventTriggers.forEach((trigger) => {
      // Remove any existing listeners to avoid duplicates
      eventBus.removeAllListeners(trigger.event);

      eventBus.on(trigger.event, async (eventData: unknown) => {
        console.log(`Event triggered: ${trigger.event} for function ${functionName}`);
        await executeEventFunction(metadata, trigger.event, eventData);
      });
      console.log(`  - Event trigger: ${trigger.event}`);
    });

    // Set up database listeners for database triggers
    const dbTriggers = metadata.triggers.filter((t) => t.type === "database") as DatabaseTrigger[];
    for (const trigger of dbTriggers) {
      await setupDatabaseListener(metadata, trigger);
      console.log(
        `  - Database trigger: ${trigger.table} (${trigger.operations?.join(", ") || "all operations"})`
      );
    }

    // Log other trigger types
    metadata.triggers.forEach((trigger) => {
      if (trigger.type === "http") {
        console.log(`  - HTTP trigger: ${metadata.path}`);
      } else if (trigger.type === "schedule") {
        console.log(`  - Schedule trigger: ${(trigger as { cron: string }).cron}`);
      }
    });

    if (metadata.runOnce) {
      console.log(
        `  - Function configured for one-time execution${metadata.status.hasCompleted ? " (already completed)" : ""}`
      );
    }

    return metadata;
  } catch (err) {
    console.error(`Error loading function ${filePath}:`, err);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Function Scanning
// ─────────────────────────────────────────────────────────────────────────────

// Runtime infrastructure files that should NOT be loaded as user functions
const RUNTIME_FILES = new Set([
  "main.ts",
  "config.ts",
  "database.ts",
  "executor.ts",
  "http.ts",
  "loader.ts",
  "registry.ts",
  "scheduler.ts",
  "types.ts",
]);

/**
 * Scan directory and load all function files
 */
export async function scanAndLoadFunctions(): Promise<void> {
  // Clear the registry to reload definitions
  clearRegistry();

  // Scan directory for function files
  for await (const entry of Deno.readDir(".")) {
    if (
      entry.isFile &&
      entry.name.endsWith(".ts") &&
      !RUNTIME_FILES.has(entry.name) &&
      !entry.name.startsWith("_")
    ) {
      await loadFunction(`./${entry.name}`);
    }
  }

  console.log(`Loaded ${functionRegistry.size} functions`);

  // Execute all one-time functions that haven't completed yet
  const oneTimeFunctionsToExecute: FunctionMetadata[] = [];
  for (const fn of functionRegistry.values()) {
    if (fn.runOnce && !completedRunOnceFunctions.has(fn.name) && !fn.status.hasCompleted) {
      oneTimeFunctionsToExecute.push(fn);
    }
  }

  if (oneTimeFunctionsToExecute.length > 0) {
    console.log(`Found ${oneTimeFunctionsToExecute.length} one-time functions to execute`);

    for (const fn of oneTimeFunctionsToExecute) {
      console.log(`Auto-executing one-time function: ${fn.name}`);
      try {
        await executeOneTimeFunction(fn);
      } catch (err) {
        console.error(`Error auto-executing one-time function ${fn.name}:`, err);
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Function Deployment
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Deploy a function by writing its code to disk
 */
export async function deployFunction(
  functionName: string,
  code: string,
  env?: Record<string, string>
): Promise<{ success: boolean; message: string }> {
  const filePath = `./${functionName}.ts`;
  const envFilePath = `./${functionName}.env.json`;

  try {
    // Write function file to disk
    await Deno.writeTextFile(filePath, code);
    console.log(`Deployed function: ${functionName} (${code.length} bytes)`);

    // Store environment variables if provided
    if (env && Object.keys(env).length > 0) {
      await Deno.writeTextFile(envFilePath, JSON.stringify(env, null, 2));
      console.log(`Stored env vars for function: ${functionName}`);
    } else {
      // Remove env file if it exists and no env vars provided
      try {
        await Deno.remove(envFilePath);
      } catch {
        // Ignore if file doesn't exist
      }
    }

    // Reload functions to pick up the new code
    await scanAndLoadFunctions();

    return {
      success: true,
      message: `Function ${functionName} deployed successfully`,
    };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error(`Failed to deploy function ${functionName}:`, err);
    return {
      success: false,
      message: `Failed to deploy function: ${errorMessage}`,
    };
  }
}

/**
 * Undeploy a function by removing its file from disk
 */
export async function undeployFunction(
  functionName: string
): Promise<{ success: boolean; message: string }> {
  const filePath = `./${functionName}.ts`;
  const envFilePath = `./${functionName}.env.json`;

  try {
    // Remove function file
    try {
      await Deno.remove(filePath);
      console.log(`Removed function file: ${filePath}`);
    } catch (err) {
      if (err instanceof Deno.errors.NotFound) {
        console.warn(`Function file not found: ${filePath}`);
      } else {
        throw err;
      }
    }

    // Remove env file if exists
    try {
      await Deno.remove(envFilePath);
      console.log(`Removed env file: ${envFilePath}`);
    } catch {
      // Ignore if file doesn't exist
    }

    // Reload functions to unregister it
    await scanAndLoadFunctions();

    return {
      success: true,
      message: `Function ${functionName} undeployed successfully`,
    };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error(`Failed to undeploy function ${functionName}:`, err);
    return {
      success: false,
      message: `Failed to undeploy function: ${errorMessage}`,
    };
  }
}
