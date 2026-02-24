import Foundation

/// Main SelfDB client
public final class SelfDB: Sendable {
    /// HTTP client for API requests
    private let client: HTTPClient
    
    /// Base URL of the SelfDB instance
    public let baseUrl: String
    
    /// API key for authentication
    public let apiKey: String
    
    /// Authentication module
    public let auth: Auth
    
    /// Tables module
    public let tables: Tables
    
    /// Storage module (buckets + files)
    public let storage: Storage
    
    /// Realtime module for WebSocket-based updates
    public let realtime: Realtime
    
    /// Initialize a new SelfDB client
    /// - Parameters:
    ///   - baseUrl: The base URL of your SelfDB instance (e.g., "http://localhost:8000")
    ///   - apiKey: Your API key for authentication
    public init(baseUrl: String, apiKey: String) {
        self.baseUrl = baseUrl
        self.apiKey = apiKey
        self.client = HTTPClient(baseUrl: baseUrl, apiKey: apiKey)
        
        self.auth = Auth(client: client)
        self.tables = Tables(client: client)
        self.storage = Storage(client: client)
        self.realtime = Realtime(baseUrl: baseUrl, apiKey: apiKey, client: client)
    }
}
