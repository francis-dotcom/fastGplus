import Foundation

/// Realtime event types
public enum RealtimeEvent: String, Sendable {
    case insert = "INSERT"
    case update = "UPDATE"
    case delete = "DELETE"
    case all = "*"
}

/// Payload received in realtime callbacks
public struct RealtimePayload: @unchecked Sendable {
    public let event: RealtimeEvent
    public let table: String
    public let new: [String: Any]?
    public let old: [String: Any]?
    public let raw: [String: Any]
    
    init(event: RealtimeEvent, table: String, new: [String: Any]?, old: [String: Any]?, raw: [String: Any]) {
        self.event = event
        self.table = table
        self.new = new
        self.old = old
        self.raw = raw
    }
}

/// Callback type for realtime events
public typealias RealtimeCallback = @Sendable (RealtimePayload) -> Void

/// Realtime channel for subscribing to events
public final class RealtimeChannel: @unchecked Sendable {
    private let topic: String
    private weak var realtime: Realtime?
    private var eventHandlers: [RealtimeEvent: [RealtimeCallback]] = [:]
    private let lock = NSLock()
    
    init(topic: String, realtime: Realtime) {
        self.topic = topic
        self.realtime = realtime
    }
    
    /// Register a handler for a specific event type
    @discardableResult
    public func on(_ event: RealtimeEvent, handler: @escaping RealtimeCallback) -> RealtimeChannel {
        lock.lock()
        defer { lock.unlock() }
        
        if eventHandlers[event] == nil {
            eventHandlers[event] = []
        }
        eventHandlers[event]?.append(handler)
        return self
    }
    
    /// Subscribe to the channel
    public func subscribe() async throws {
        try await realtime?.joinChannel(topic: topic)
    }
    
    /// Unsubscribe from the channel
    public func unsubscribe() async throws {
        try await realtime?.leaveChannel(topic: topic)
    }
    
    /// Handle an incoming event
    func handleEvent(_ eventType: RealtimeEvent, payload: RealtimePayload) {
        lock.lock()
        let handlers = eventHandlers[eventType] ?? []
        let allHandlers = eventHandlers[.all] ?? []
        lock.unlock()
        
        for handler in handlers {
            handler(payload)
        }
        for handler in allHandlers {
            handler(payload)
        }
    }
    
    /// Get the topic name
    func getTopic() -> String {
        return topic
    }
}

/// Realtime module for WebSocket-based real-time updates using Phoenix Channels
public final class Realtime: @unchecked Sendable {
    private let baseUrl: String
    private let apiKey: String
    private weak var client: HTTPClient?
    
    private var webSocket: URLSessionWebSocketTask?
    private var session: URLSession?
    private var channels: [String: RealtimeChannel] = [:]
    private var messageRef: Int = 0
    private var heartbeatTask: Task<Void, Never>?
    private var receiveTask: Task<Void, Never>?
    private var _isConnected: Bool = false
    private let lock = NSLock()
    
    /// Whether the realtime connection is active
    public var isConnected: Bool {
        lock.lock()
        defer { lock.unlock() }
        return _isConnected
    }
    
    init(baseUrl: String, apiKey: String, client: HTTPClient) {
        self.baseUrl = baseUrl
        self.apiKey = apiKey
        self.client = client
    }
    
    /// Connect to the realtime server
    public func connect() async throws {
        lock.lock()
        guard !_isConnected else {
            lock.unlock()
            return
        }
        lock.unlock()
        
        // Get the access token
        guard let token = await client?.getAccessToken() else {
            throw SelfDBError.authenticationError
        }
        
        // Build WebSocket URL (matching Python/TypeScript SDKs)
        var wsUrl = baseUrl
            .replacingOccurrences(of: "http://", with: "ws://")
            .replacingOccurrences(of: "https://", with: "wss://")
        
        if wsUrl.hasSuffix("/") {
            wsUrl = String(wsUrl.dropLast())
        }
        wsUrl += "/realtime/socket?X-API-Key=\(apiKey)&token=\(token)"
        
        guard let url = URL(string: wsUrl) else {
            throw SelfDBError.badRequest("Invalid WebSocket URL")
        }
        
        session = URLSession(configuration: .default)
        webSocket = session?.webSocketTask(with: url)
        webSocket?.resume()
        
        lock.lock()
        _isConnected = true
        lock.unlock()
        
        // Start receiving messages
        startReceiving()
        
        // Start heartbeat
        startHeartbeat()
    }
    
    /// Disconnect from the realtime server
    public func disconnect() async throws {
        lock.lock()
        _isConnected = false
        heartbeatTask?.cancel()
        heartbeatTask = nil
        receiveTask?.cancel()
        receiveTask = nil
        
        let channelsCopy = channels
        channels.removeAll()
        lock.unlock()
        
        // Leave all channels
        for (topic, _) in channelsCopy {
            try? await leaveChannel(topic: topic)
        }
        
        webSocket?.cancel(with: .goingAway, reason: nil)
        webSocket = nil
        session = nil
    }
    
    /// Create a channel for a topic
    public func channel(_ topic: String) -> RealtimeChannel {
        lock.lock()
        defer { lock.unlock() }
        
        if let existing = channels[topic] {
            return existing
        }
        
        let channel = RealtimeChannel(topic: topic, realtime: self)
        channels[topic] = channel
        return channel
    }
    
    /// Join a channel (internal)
    func joinChannel(topic: String) async throws {
        guard isConnected else {
            throw SelfDBError.webSocketError("Not connected")
        }
        
        let ref = nextRef()
        try await sendPhoenixMessage(joinRef: nil, ref: ref, topic: topic, event: "phx_join", payload: [:])
    }
    
    /// Leave a channel (internal)
    func leaveChannel(topic: String) async throws {
        guard isConnected else { return }
        
        let ref = nextRef()
        try await sendPhoenixMessage(joinRef: nil, ref: ref, topic: topic, event: "phx_leave", payload: [:])
        
        lock.lock()
        channels.removeValue(forKey: topic)
        lock.unlock()
    }
    
    /// Get next message reference
    private func nextRef() -> String {
        lock.lock()
        defer { lock.unlock() }
        messageRef += 1
        return String(messageRef)
    }
    
    /// Send a Phoenix message in array format: [join_ref, ref, topic, event, payload]
    private func sendPhoenixMessage(joinRef: String?, ref: String, topic: String, event: String, payload: [String: Any]) async throws {
        guard let webSocket = webSocket else {
            throw SelfDBError.webSocketError("WebSocket not connected")
        }
        
        // Phoenix protocol uses array format
        let message: [Any] = [joinRef as Any, ref, topic, event, payload]
        let data = try JSONSerialization.data(withJSONObject: message)
        let string = String(data: data, encoding: .utf8) ?? "[]"
        
        try await webSocket.send(.string(string))
    }
    
    /// Start receiving messages
    private func startReceiving() {
        receiveTask = Task { [weak self] in
            while let self = self, self.isConnected {
                do {
                    guard let webSocket = self.webSocket else { break }
                    let message = try await webSocket.receive()
                    
                    switch message {
                    case .string(let text):
                        self.handleMessage(text)
                    case .data(let data):
                        if let text = String(data: data, encoding: .utf8) {
                            self.handleMessage(text)
                        }
                    @unknown default:
                        break
                    }
                } catch {
                    if self.isConnected {
                        // Connection error
                        break
                    }
                }
            }
        }
    }
    
    /// Handle incoming message in Phoenix array format: [join_ref, ref, topic, event, payload]
    private func handleMessage(_ text: String) {
        guard let data = text.data(using: .utf8),
              let array = try? JSONSerialization.jsonObject(with: data) as? [Any],
              array.count >= 5 else { return }
        
        // Phoenix array format: [join_ref, ref, topic, event, payload]
        let topic = array[2] as? String ?? ""
        let event = array[3] as? String ?? ""
        let payload = array[4] as? [String: Any] ?? [:]
        
        // Handle Phoenix system events
        if event == "phx_reply" || event == "phx_close" {
            return
        }
        
        // Handle broadcast events (INSERT, UPDATE, DELETE)
        // Note: Phoenix may send lowercase ('insert', 'update', 'delete')
        let normalizedEvent = event.uppercased()
        if normalizedEvent == "INSERT" || normalizedEvent == "UPDATE" || normalizedEvent == "DELETE" {
            let eventType: RealtimeEvent
            switch normalizedEvent {
            case "INSERT": eventType = .insert
            case "UPDATE": eventType = .update
            case "DELETE": eventType = .delete
            default: return
            }
            
            // Extract table name from topic (format: "table:name")
            let tableName = topic.hasPrefix("table:") ? String(topic.dropFirst(6)) : topic
            
            // Build payload
            let newData = payload["new"] as? [String: Any]
            let oldData = payload["old"] as? [String: Any]
            
            let realtimePayload = RealtimePayload(
                event: eventType,
                table: tableName,
                new: newData,
                old: oldData,
                raw: payload
            )
            
            // Dispatch to channel
            lock.lock()
            let channel = channels[topic]
            lock.unlock()
            
            channel?.handleEvent(eventType, payload: realtimePayload)
        }
    }
    
    /// Start heartbeat
    private func startHeartbeat() {
        heartbeatTask = Task { [weak self] in
            while let self = self, self.isConnected {
                try? await Task.sleep(nanoseconds: 30_000_000_000) // 30 seconds
                
                guard self.isConnected else { break }
                
                let ref = self.nextRef()
                try? await self.sendPhoenixMessage(joinRef: nil, ref: ref, topic: "phoenix", event: "heartbeat", payload: [:])
            }
        }
    }
}
