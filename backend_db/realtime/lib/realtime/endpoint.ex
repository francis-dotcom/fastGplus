defmodule Realtime.Endpoint do
  use Phoenix.Endpoint, otp_app: :realtime

  socket "/socket", Realtime.UserSocket,
    websocket: [
      timeout: 45_000,
      check_origin: false  # Allow connections from any origin (configure in production)
    ],
    longpoll: false

  plug Plug.RequestId
  plug Plug.Telemetry, event_prefix: [:phoenix, :endpoint]
  
  plug Plug.Parsers,
    parsers: [:json],
    pass: ["application/json"],
    json_decoder: Jason
    
  plug Plug.MethodOverride
  plug Plug.Head
  plug Realtime.Router
end
