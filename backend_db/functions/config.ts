/**
 * SelfDB Serverless Function Runtime - Configuration
 * Environment variables and CORS settings
 */

// ─────────────────────────────────────────────────────────────────────────────
// Environment Configuration
// ─────────────────────────────────────────────────────────────────────────────

export const config = {
  // Backend API settings
  backendUrl: Deno.env.get("BACKEND_URL") || "http://backend:8000",
  apiKey: Deno.env.get("API_KEY") || "",

  // Database settings
  postgres: {
    user: Deno.env.get("POSTGRES_USER") || "postgres",
    password: Deno.env.get("POSTGRES_PASSWORD") || "postgres",
    database: Deno.env.get("POSTGRES_DB") || "selfdb",
    host: Deno.env.get("POSTGRES_HOST") || "db",
    port: parseInt(Deno.env.get("POSTGRES_PORT") || "5432"),
  },

  // Server settings
  port: parseInt(Deno.env.get("FUNCTIONS_INTERNAL_PORT") || "8090"),
  functionTimeout: parseInt(Deno.env.get("FUNCTION_TIMEOUT") || "30000"),

  // Scheduler settings
  schedulerInterval: 5000, // 5 seconds
  schedulerMinGap: 50000, // 50 seconds minimum between runs

  // File watcher settings
  reloadDebounce: 1000, // 1 second

  // Database reconnection interval
  dbReconnectInterval: 30000, // 30 seconds
};

// ─────────────────────────────────────────────────────────────────────────────
// CORS Configuration
// ─────────────────────────────────────────────────────────────────────────────

const corsOrigins = Deno.env.get("CORS_ORIGINS") || "http://localhost:3000";

export const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": corsOrigins.split(",")[0],
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey, x-api-key",
  "Access-Control-Max-Age": "86400",
};

// ─────────────────────────────────────────────────────────────────────────────
// Validation
// ─────────────────────────────────────────────────────────────────────────────

export function validateConfig(): void {
  if (!config.apiKey) {
    console.warn("Warning: API_KEY not set");
  }
  if (!config.backendUrl) {
    console.warn("Warning: BACKEND_URL not set");
  }
}
