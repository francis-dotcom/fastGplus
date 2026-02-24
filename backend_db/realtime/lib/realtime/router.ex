defmodule Realtime.Router do
  use Phoenix.Router
  import Plug.Conn

  pipeline :api do
    plug :accepts, ["json"]
  end

  scope "/", Realtime do
    pipe_through :api
    
    get "/health", HealthController, :index
  end
end
