import Config

# Static compile-time configuration
# Runtime configuration is in runtime.exs
config :realtime, Realtime.Endpoint,
  url: [host: "localhost"],
  render_errors: [view: Realtime.ErrorView, accepts: ~w(json)],
  pubsub_server: Realtime.PubSub,
  server: true

config :logger, level: :info
