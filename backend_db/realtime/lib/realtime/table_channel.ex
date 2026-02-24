defmodule Realtime.TableChannel do
  @moduledoc """
  Phoenix Channel for realtime table subscriptions.
  
  Clients join channels in the format: table:<tablename>
  Example: table:users, table:products
  
  When a table change occurs (INSERT/UPDATE/DELETE), the payload is 
  broadcast to all subscribed clients via Phoenix Endpoint.broadcast/3.
  
  IMPORTANT: We do NOT manually subscribe to PubSub here because:
  1. Phoenix Endpoint.broadcast/3 already handles routing to channel subscribers
  2. Manual PubSub.subscribe causes duplicate messages (each socket process subscribes)
  3. The PostgresListener uses Endpoint.broadcast which routes through the channel layer
  """
  use Phoenix.Channel
  require Logger

  # Intercept the db_event to transform it before sending to clients
  intercept ["db_event"]

  @doc """
  Join a table channel to receive realtime updates.
  
  Channel format: table:<tablename>
  """
  def join("table:" <> table_name, _payload, socket) do
    channel = "table:#{table_name}"
    
    Logger.info("Client joining channel: #{channel}")
    
    # Tell PostgresListener to LISTEN on this PostgreSQL channel
    # PostgresListener will broadcast via Endpoint.broadcast/3 when notifications arrive
    Realtime.PostgresListener.subscribe(channel)
    
    {:ok, socket}
  end

  @doc """
  Handle outgoing db_event broadcasts from PostgresListener.
  Transform the generic event to the specific operation (insert, update, delete).
  
  This is called when Endpoint.broadcast/3 sends a "db_event" to this topic.
  """
  def handle_out("db_event", payload, socket) do
    # Extract the actual database operation from the payload
    event = Map.get(payload, "event", "change")
    # Push with the operation name as the event (e.g., "insert", "update", "delete")
    push(socket, String.downcase(to_string(event)), payload)
    {:noreply, socket}
  end

  @doc """
  Handle ping messages from clients.
  """
  def handle_in("ping", _payload, socket) do
    {:reply, {:ok, %{message: "pong"}}, socket}
  end

  def handle_in(_event, _payload, socket) do
    {:noreply, socket}
  end
end
