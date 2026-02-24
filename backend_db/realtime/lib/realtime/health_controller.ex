defmodule Realtime.HealthController do
  use Phoenix.Controller

  def index(conn, _params) do
    json(conn, %{status: "ok", service: "realtime"})
  end
end
