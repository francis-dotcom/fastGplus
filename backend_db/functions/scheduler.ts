/**
 * SelfDB Serverless Function Runtime - Scheduler
 * Handles cron-based scheduled function execution
 */

import { delay } from "https://deno.land/std@0.224.0/async/delay.ts";
import { config } from "./config.ts";
import type { FunctionMetadata, ScheduleTrigger } from "./types.ts";
import {
  functionRegistry,
  completedRunOnceFunctions,
  markFunctionCompleted,
} from "./registry.ts";
import { executeWithContext, reportExecutionResult } from "./executor.ts";

// ─────────────────────────────────────────────────────────────────────────────
// Cron Parser
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parse cron expression and check if it should run at the given time
 * Simple parser for "* * * * *" format (minute, hour, day, month, weekday)
 */
export function shouldRunCron(cronExpression: string, date: Date = new Date()): boolean {
  const parts = cronExpression.trim().split(" ");
  if (parts.length !== 5) return false;

  const minute = date.getMinutes();
  const hour = date.getHours();
  const day = date.getDate();
  const month = date.getMonth() + 1; // 1-12
  const weekday = date.getDay(); // 0-6, 0 is Sunday

  // Check each part of the cron expression
  if (parts[0] !== "*" && parseInt(parts[0]) !== minute) return false;
  if (parts[1] !== "*" && parseInt(parts[1]) !== hour) return false;
  if (parts[2] !== "*" && parseInt(parts[2]) !== day) return false;
  if (parts[3] !== "*" && parseInt(parts[3]) !== month) return false;
  if (parts[4] !== "*" && parseInt(parts[4]) !== weekday) return false;

  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// Scheduler State
// ─────────────────────────────────────────────────────────────────────────────

/** Track last run times for scheduled functions */
const lastRunTimes = new Map<string, Date>();

/** Scheduler running flag */
let isRunning = false;

// ─────────────────────────────────────────────────────────────────────────────
// Generate UUID
// ─────────────────────────────────────────────────────────────────────────────

const generateUUID = (): string => crypto.randomUUID();

// ─────────────────────────────────────────────────────────────────────────────
// Scheduled Execution
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Execute a scheduled function
 */
async function executeScheduledFunction(
  fn: FunctionMetadata,
  _trigger: ScheduleTrigger
): Promise<void> {
  const execution_id = generateUUID();
  const delivery_id = generateUUID();
  const startTime = performance.now();

  // Create a mock request for the handler
  const mockRequest = {
    method: "POST",
    headers: new Headers({
      "Content-Type": "application/json",
      "X-Trigger-Type": "schedule",
      "x-execution-id": execution_id,
      "x-delivery-id": delivery_id,
    }),
  };

  try {
    const result = await executeWithContext(fn, mockRequest);
    const executionTime = performance.now() - startTime;

    console.log(`Scheduled function ${fn.name} completed with result:`, result);

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
      [`[INFO] Scheduled function executed successfully in ${executionTime.toFixed(2)}ms`],
      executionTime
    );

    // If this is a one-time function, mark as completed only if successful
    if (fn.runOnce && result && (result as { success?: boolean }).success === true) {
      markFunctionCompleted(fn.name);
      console.log(
        `One-time scheduled function ${fn.name} has completed successfully and will not run again`
      );
    }
  } catch (err) {
    const executionTime = performance.now() - startTime;
    const errorMessage = err instanceof Error ? err.message : String(err);

    console.error(`Error in scheduled function ${fn.name}:`, err);
    fn.status.error = errorMessage;
    fn.status.lastRun = new Date();
    fn.status.runCount++;

    // Report execution failure to Backend
    await reportExecutionResult(
      execution_id,
      fn.name,
      false,
      { error: errorMessage },
      [`[ERROR] Scheduled function failed: ${errorMessage}`],
      executionTime
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Scheduler Loop
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Start the scheduler loop
 */
export async function startScheduler(): Promise<void> {
  if (isRunning) {
    console.warn("Scheduler is already running");
    return;
  }

  isRunning = true;
  console.log("Starting scheduler...");

  while (isRunning) {
    try {
      const now = new Date();
      let scheduledCount = 0;

      // Find all functions with schedule triggers
      for (const [name, fn] of functionRegistry.entries()) {
        // Skip one-time functions that have already completed
        if (fn.runOnce && completedRunOnceFunctions.has(name)) {
          continue;
        }

        const scheduleTriggers =
          (fn.triggers?.filter((t) => t.type === "schedule") as ScheduleTrigger[]) || [];

        for (const trigger of scheduleTriggers) {
          const triggerKey = `${name}:${trigger.cron}`;

          try {
            if (shouldRunCron(trigger.cron, now)) {
              // Check if it's been at least 50 seconds since the last run
              const lastRun = lastRunTimes.get(triggerKey);
              if (!lastRun || now.getTime() - lastRun.getTime() >= config.schedulerMinGap) {
                console.log(`Running scheduled function: ${name} at ${now.toISOString()}`);
                lastRunTimes.set(triggerKey, now);
                scheduledCount++;

                // Execute the function
                await executeScheduledFunction(fn, trigger);
              }
            }
          } catch (err) {
            console.error(`Error checking schedule for ${name}:`, err);
          }
        }
      }

      if (scheduledCount === 0 && now.getSeconds() < 10) {
        // Only log every minute if nothing was executed
        console.log(`Scheduler check at ${now.toISOString()} - no functions to execute`);
      }
    } catch (err) {
      console.error("Error in scheduler loop:", err);
    }

    // Wait for the next interval
    await delay(config.schedulerInterval);
  }
}

/**
 * Stop the scheduler
 */
export function stopScheduler(): void {
  isRunning = false;
  console.log("Scheduler stopped");
}

/**
 * Check if the scheduler is running
 */
export function isSchedulerRunning(): boolean {
  return isRunning;
}
