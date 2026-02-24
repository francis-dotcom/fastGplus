/**
 * SelfDB Serverless Function Runtime - Database Connection
 * Manages PostgreSQL connection for LISTEN/NOTIFY functionality
 */

import postgres from "https://deno.land/x/postgresjs@v3.4.5/mod.js";
import { config } from "./config.ts";
import type { DatabaseTrigger, FunctionMetadata } from "./types.ts";

// ─────────────────────────────────────────────────────────────────────────────
// Database State
// ─────────────────────────────────────────────────────────────────────────────

/** PostgreSQL connection for LISTEN/NOTIFY */
let sql: ReturnType<typeof postgres> | null = null;

/** Map of active database listeners */
const dbListeners = new Map<string, boolean>();

// ─────────────────────────────────────────────────────────────────────────────
// Connection Management
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get the current database connection status
 */
export function isConnected(): boolean {
  return sql !== null;
}

/**
 * Get the list of active listener channels
 */
export function getActiveListeners(): string[] {
  return Array.from(dbListeners.keys());
}

/**
 * Setup database connection for LISTEN/NOTIFY
 */
export async function setupDatabaseConnection(): Promise<boolean> {
  if (sql) {
    try {
      await sql.end();
    } catch (e) {
      console.error("Error closing existing database connection:", e);
    }
  }

  try {
    sql = postgres({
      user: config.postgres.user,
      password: config.postgres.password,
      database: config.postgres.database,
      host: config.postgres.host,
      port: config.postgres.port,
      onnotice: (notice: unknown) => {
        console.log("PostgreSQL notice:", notice);
      },
    });

    console.log("Connected to database for LISTEN/NOTIFY");

    // Re-establish all active listeners
    for (const channel of dbListeners.keys()) {
      await setupChannelListener(channel);
    }

    console.log("Database connection ready for notifications");
    return true;
  } catch (error) {
    console.error("Failed to connect to database:", error);
    sql = null;
    return false;
  }
}

/**
 * Close database connection
 */
export async function closeDatabaseConnection(): Promise<void> {
  if (sql) {
    try {
      await sql.end();
      sql = null;
      dbListeners.clear();
      console.log("Database connection closed");
    } catch (e) {
      console.error("Error closing database connection:", e);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Channel Listeners
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Setup a listener for a specific channel
 */
async function setupChannelListener(channel: string): Promise<boolean> {
  if (!sql) {
    await setupDatabaseConnection();
    if (!sql) return false;
  }

  try {
    await sql.listen(channel, (payload: string) => {
      console.log(`Received notification on channel ${channel}:`, payload);
      // Emit event for notification handler
      notificationHandlers.forEach((handler) => handler(channel, payload));
    });

    dbListeners.set(channel, true);
    console.log(`Set up LISTEN on channel: ${channel}`);
    return true;
  } catch (error) {
    console.error(`Error setting up listener for channel ${channel}:`, error);
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Notification Handlers
// ─────────────────────────────────────────────────────────────────────────────

type NotificationHandler = (channel: string, payload: string) => void;
const notificationHandlers: NotificationHandler[] = [];

/**
 * Register a notification handler
 */
export function onNotification(handler: NotificationHandler): void {
  notificationHandlers.push(handler);
}

// ─────────────────────────────────────────────────────────────────────────────
// Database Triggers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a PostgreSQL trigger for a table
 */
export async function createDatabaseTrigger(
  table: string,
  channel: string,
  operations: string[] = ["INSERT", "UPDATE", "DELETE"]
): Promise<boolean> {
  if (!sql) {
    const connected = await setupDatabaseConnection();
    if (!connected) {
      console.error(`Failed to create database trigger for table ${table}`);
      return false;
    }
  }

  try {
    // Check if the trigger function exists
    const functionExists = await sql!`
      SELECT EXISTS (
        SELECT 1 FROM pg_proc
        WHERE proname = ${"notify_" + table + "_changes"}
      );
    `;

    if (!functionExists[0].exists) {
      // Create the trigger function if it doesn't exist
      await sql!.unsafe(`
        CREATE OR REPLACE FUNCTION notify_${table}_changes()
        RETURNS TRIGGER AS $$
        DECLARE
          payload JSON;
        BEGIN
          IF (TG_OP = 'DELETE') THEN
            payload = json_build_object(
              'operation', TG_OP,
              'table', TG_TABLE_NAME,
              'old_data', row_to_json(OLD)
            );
          ELSE
            payload = json_build_object(
              'operation', TG_OP,
              'table', TG_TABLE_NAME,
              'data', row_to_json(NEW),
              'old_data', CASE WHEN TG_OP = 'UPDATE' THEN row_to_json(OLD) ELSE NULL END
            );
          END IF;

          PERFORM pg_notify('${channel}', payload::text);
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
      `);
      console.log(`Created trigger function notify_${table}_changes`);
    }

    // Check if the trigger exists
    try {
      const triggerExists = await sql!`
        SELECT EXISTS (
          SELECT 1 FROM pg_trigger
          WHERE tgname = ${table + "_notify_trigger"}
            AND tgrelid = ${table}::regclass
        );
      `;

      if (!triggerExists[0].exists) {
        const operationsStr = operations.join(" OR ");
        await sql!.unsafe(`
          CREATE TRIGGER ${table}_notify_trigger
          AFTER ${operationsStr} ON "${table}"
          FOR EACH ROW
          EXECUTE FUNCTION notify_${table}_changes();
        `);
        console.log(
          `Created database trigger for table ${table} on operations: ${operations.join(", ")}`
        );
      }
    } catch (_e) {
      console.log(
        `Table ${table} does not exist yet, trigger will be created when table is created`
      );
    }

    return true;
  } catch (error) {
    console.error(`Error creating database trigger for table ${table}:`, error);
    return false;
  }
}

/**
 * Setup a database listener for a function's database trigger
 */
export async function setupDatabaseListener(
  _fn: FunctionMetadata,
  trigger: DatabaseTrigger
): Promise<void> {
  const channel = trigger.channel || `${trigger.table}_changes`;

  if (!sql) {
    const connected = await setupDatabaseConnection();
    if (!connected) {
      console.error(`Failed to set up database listener for channel ${channel}`);
      return;
    }
  }

  try {
    if (!dbListeners.has(channel)) {
      await setupChannelListener(channel);

      if (trigger.table) {
        await createDatabaseTrigger(trigger.table, channel, trigger.operations);
      }
    }
  } catch (error) {
    console.error(`Error setting up database listener for channel ${channel}:`, error);
  }
}

/**
 * Send a notification to a channel
 */
export async function sendNotification(channel: string, payload: string): Promise<boolean> {
  if (!sql) {
    const connected = await setupDatabaseConnection();
    if (!connected) return false;
  }

  try {
    await sql!.notify(channel, payload);
    console.log(`Sent notification on channel ${channel}: ${payload}`);
    return true;
  } catch (error) {
    console.error(`Error sending notification on channel ${channel}:`, error);
    return false;
  }
}
