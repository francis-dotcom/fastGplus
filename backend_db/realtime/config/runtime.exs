import Config

# Runtime configuration - environment variables are read at runtime
# This file is evaluated when the application starts, not at compile time
# All values come from .env via docker-compose - no hardcoded fallbacks

config :realtime, Realtime.Endpoint,
  http: [port: String.to_integer(System.get_env("PORT")), ip: {0, 0, 0, 0}],
  secret_key_base: System.get_env("SECRET_KEY_BASE")

# PostgreSQL connection for LISTEN/NOTIFY
# Connects directly to PostgreSQL (not PgBouncer) for reliable LISTEN support
config :realtime, Realtime.PostgresListener,
  hostname: System.get_env("POSTGRES_HOST"),
  port: String.to_integer(System.get_env("POSTGRES_PORT")),
  username: System.get_env("POSTGRES_USER"),
  password: System.get_env("POSTGRES_PASSWORD"),
  database: System.get_env("POSTGRES_DB")
