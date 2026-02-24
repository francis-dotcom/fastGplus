defmodule Realtime.PostgresListener do
  @moduledoc """
  Direct PostgreSQL LISTEN/NOTIFY listener.
  
  Connects directly to PostgreSQL (bypassing PgBouncer) to listen for 
  NOTIFY events on table:* channels. When a notification is received,
  it broadcasts the payload to the corresponding Phoenix channel.
  
  Channel format: table:<tablename>
  Example: table:users, table:products
  """
  use GenServer
  require Logger

  @reconnect_delay 5_000  # 5 seconds between reconnection attempts

  def start_link(_opts) do
    GenServer.start_link(__MODULE__, [], name: __MODULE__)
  end

  @impl true
  def init(_) do
    Logger.info("PostgresListener starting...")
    send(self(), :connect)
    {:ok, %{conn: nil, subscribed_channels: MapSet.new()}}
  end

  @impl true
  def handle_info(:connect, state) do
    config = Application.get_env(:realtime, Realtime.PostgresListener)
    
    # Use Postgrex.Notifications for LISTEN/NOTIFY support
    case Postgrex.Notifications.start_link(
      hostname: config[:hostname],
      port: config[:port],
      username: config[:username],
      password: config[:password],
      database: config[:database]
    ) do
      {:ok, conn} ->
        Logger.info("PostgresListener connected to PostgreSQL at #{config[:hostname]}:#{config[:port]}")
        {:noreply, %{state | conn: conn}}
        
      {:error, reason} ->
        Logger.error("PostgresListener failed to connect: #{inspect(reason)}")
        Process.send_after(self(), :connect, @reconnect_delay)
        {:noreply, state}
    end
  end

  @impl true
  def handle_info({:notification, _connection_pid, _ref, channel, payload}, state) do
    # Channel format from pg_notify: "table:tablename"
    Logger.debug("Received notification on channel #{channel}: #{payload}")
    
    # Parse JSON and broadcast via Endpoint.broadcast/3
    # This routes directly to Phoenix channels without manual PubSub subscription
    case Jason.decode(payload) do
      {:ok, data} ->
        # Broadcast to all clients subscribed to this channel topic
        # The event "db_event" will be handled by handle_info in TableChannel
        Realtime.Endpoint.broadcast(channel, "db_event", data)
        
      {:error, _} ->
        Logger.warning("Failed to decode notification payload: #{payload}")
        Realtime.Endpoint.broadcast(channel, "db_event", %{"raw" => payload})
    end
    
    {:noreply, state}
  end

  @impl true
  def handle_info({:DOWN, _ref, :process, _pid, reason}, state) do
    Logger.warning("PostgreSQL connection lost: #{inspect(reason)}")
    Process.send_after(self(), :connect, @reconnect_delay)
    {:noreply, %{state | conn: nil}}
  end

  @impl true
  def handle_info(msg, state) do
    Logger.debug("PostgresListener received unexpected message: #{inspect(msg)}")
    {:noreply, state}
  end

  @doc """
  Subscribe to a specific table channel for LISTEN.
  Called when a client joins a table channel.
  """
  def subscribe(channel) when is_binary(channel) do
    GenServer.cast(__MODULE__, {:subscribe, channel})
  end

  @impl true
  def handle_cast({:subscribe, channel}, %{conn: conn, subscribed_channels: channels} = state) do
    if conn && not MapSet.member?(channels, channel) do
      # Listen on the channel - Postgrex.Notifications will send messages to this process
      case Postgrex.Notifications.listen(conn, channel) do
        {:ok, _ref} ->
          Logger.info("Now listening on channel: #{channel}")
          {:noreply, %{state | subscribed_channels: MapSet.put(channels, channel)}}
        {:error, reason} ->
          Logger.error("Failed to listen on #{channel}: #{inspect(reason)}")
          {:noreply, state}
      end
    else
      {:noreply, state}
    end
  end
end
