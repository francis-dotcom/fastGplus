/**
 * SelfDB Serverless Function Runtime - Function Registry
 * Manages the in-memory registry of loaded functions and event bus
 */

import type { FunctionMetadata, EventTrigger } from "./types.ts";

// ─────────────────────────────────────────────────────────────────────────────
// Simple EventEmitter Implementation
// ─────────────────────────────────────────────────────────────────────────────

type EventListener = (...args: unknown[]) => void;

class EventEmitter {
  #events = new Map<string, EventListener[]>();

  on(event: string, listener: EventListener): this {
    if (!this.#events.has(event)) {
      this.#events.set(event, []);
    }
    this.#events.get(event)!.push(listener);
    return this;
  }

  removeAllListeners(event: string): this {
    if (this.#events.has(event)) {
      this.#events.delete(event);
    }
    return this;
  }

  emit(event: string, ...args: unknown[]): boolean {
    if (!this.#events.has(event)) {
      return false;
    }
    for (const listener of this.#events.get(event)!) {
      listener(...args);
    }
    return true;
  }

  hasListeners(event: string): boolean {
    return this.#events.has(event) && this.#events.get(event)!.length > 0;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Global Registry State
// ─────────────────────────────────────────────────────────────────────────────

/** Registry of all loaded functions by name */
export const functionRegistry = new Map<string, FunctionMetadata>();

/** Set of function names that have completed (for runOnce functions) */
export const completedRunOnceFunctions = new Set<string>();

/** Event bus for custom event triggers */
export const eventBus = new EventEmitter();

// ─────────────────────────────────────────────────────────────────────────────
// Registry Operations
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Register a function in the registry
 */
export function registerFunction(fn: FunctionMetadata): void {
  functionRegistry.set(fn.name, fn);
  console.log(`Registered function: ${fn.name}`);
}

/**
 * Unregister a function from the registry
 */
export function unregisterFunction(name: string): boolean {
  const fn = functionRegistry.get(name);
  if (fn) {
    // Clean up event listeners
    const eventTriggers = fn.triggers?.filter((t) => t.type === "event") as EventTrigger[] || [];
    eventTriggers.forEach((trigger) => {
      eventBus.removeAllListeners(trigger.event);
    });
    
    functionRegistry.delete(name);
    console.log(`Unregistered function: ${name}`);
    return true;
  }
  return false;
}

/**
 * Get a function by name
 */
export function getFunction(name: string): FunctionMetadata | undefined {
  return functionRegistry.get(name);
}

/**
 * Get all registered functions
 */
export function getAllFunctions(): FunctionMetadata[] {
  return Array.from(functionRegistry.values());
}

/**
 * Clear the registry (used during reload)
 */
export function clearRegistry(): void {
  functionRegistry.clear();
}

/**
 * Mark a function as completed (for runOnce functions)
 */
export function markFunctionCompleted(name: string): void {
  completedRunOnceFunctions.add(name);
  const fn = functionRegistry.get(name);
  if (fn) {
    fn.status.hasCompleted = true;
  }
  console.log(`Marked function as completed: ${name}`);
}

/**
 * Check if a function has completed
 */
export function isFunctionCompleted(name: string): boolean {
  return completedRunOnceFunctions.has(name);
}

/**
 * Get registry statistics
 */
export function getRegistryStats(): {
  total: number;
  completed: number;
  active: number;
} {
  const total = functionRegistry.size;
  const completed = completedRunOnceFunctions.size;
  const active = total - completed;
  return { total, completed, active };
}
