defmodule Realtime.Application do
  @moduledoc """
  Main application supervisor for the realtime service.
  
  Starts:
  - Phoenix.PubSub for internal message passing
  - PostgresListener for direct LISTEN/NOTIFY from PostgreSQL
  - Phoenix.Endpoint for WebSocket connections
  """
  use Application
  require Logger

  def start(_type, _args) do
    Logger.info("Starting Realtime service...")
    
    children = [
      # PubSub for broadcasting between processes
      {Phoenix.PubSub, name: Realtime.PubSub},
      
      # Direct PostgreSQL listener - connects to DB and listens for NOTIFY events
      Realtime.PostgresListener,
      
      # Phoenix endpoint for WebSocket connections
      Realtime.Endpoint
    ]

    opts = [strategy: :one_for_one, name: Realtime.Supervisor]
    Supervisor.start_link(children, opts)
  end
end
