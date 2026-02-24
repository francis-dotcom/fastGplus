/**
 * SelfDB Serverless Function Runtime - Main Entry Point
 * Initializes and starts the function runtime server
 */

import { validateConfig, config } from "./config.ts";
import { setupDatabaseConnection } from "./database.ts";
import { scanAndLoadFunctions } from "./loader.ts";
import { startScheduler } from "./scheduler.ts";
import { startServer } from "./http.ts";

// ─────────────────────────────────────────────────────────────────────────────
// File Watcher
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Start file watcher to detect changes and reload functions
 */
async function startFileWatcher(): Promise<void> {
  const watcher = Deno.watchFs(".");
  let reloadTimeout: number | undefined;

  for await (const event of watcher) {
    if (event.kind === "create" || event.kind === "modify" || event.kind === "remove") {
      const affectedFiles = event.paths.filter(
        (path) =>
          path.endsWith(".ts") &&
          !path.endsWith("main.ts") &&
          !path.includes("node_modules")
      );

      if (affectedFiles.length > 0) {
        console.log(`Detected file changes in: ${affectedFiles.join(", ")}. Debouncing reload...`);
        clearTimeout(reloadTimeout);
        reloadTimeout = setTimeout(async () => {
          console.log("Debounced reload: Scanning and loading functions...");
          await scanAndLoadFunctions();
        }, config.reloadDebounce);
      }
    }
  }
}

/**
 * Start database reconnection watchdog
 */
function startDatabaseWatchdog(): void {
  setInterval(async () => {
    const { setupDatabaseConnection, isConnected } = await import("./database.ts");
    if (!isConnected()) {
      console.log("Database connection lost, attempting to reconnect...");
      await setupDatabaseConnection();
    }
  }, config.dbReconnectInterval);
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Entry Point
// ─────────────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("SelfDB Serverless Function Runtime starting...");

  // Validate configuration
  validateConfig();

  // Initialize database connection for LISTEN/NOTIFY
  await setupDatabaseConnection();

  // Load all functions initially
  await scanAndLoadFunctions();

  // Start the scheduler in the background
  startScheduler();

  // Start file watcher in the background
  startFileWatcher().catch((err) => {
    console.error("File watcher error:", err);
  });

  // Start database reconnection watchdog
  startDatabaseWatchdog();

  // Start the HTTP server (this will block)
  await startServer();
}

// Start the server
main().catch((err) => {
  console.error("Fatal error:", err);
  Deno.exit(1);
});
