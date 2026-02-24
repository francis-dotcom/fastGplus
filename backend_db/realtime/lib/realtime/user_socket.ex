defmodule Realtime.UserSocket do
  use Phoenix.Socket

  # Table changes channel - format: table:<tablename>
  # Example: table:users, table:products
  channel "table:*", Realtime.TableChannel

  @doc """
  Connect callback - accepts connections from backend proxy.
  Backend handles JWT validation and passes user context in params.
  
  Expected params from backend proxy:
  - user_id: UUID string (optional, nil for anonymous)
  - role: string like "USER" or "ADMIN" (optional)
  """
  def connect(params, socket, _connect_info) do
    # Backend already validated JWT - just extract user context
    user_id = params["user_id"]
    role = params["role"]
    
    socket = socket
      |> assign(:user_id, user_id)
      |> assign(:role, role)
    
    {:ok, socket}
  end

  def id(socket) do
    # Use user_id for socket identification (for targeted messaging)
    case socket.assigns[:user_id] do
      nil -> nil
      user_id -> "user:#{user_id}"
    end
  end
end
