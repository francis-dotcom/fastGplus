import Foundation

/// Users collection helper for CRUD operations
public struct UsersCollection: Sendable {
    private let client: HTTPClient
    
    init(client: HTTPClient) {
        self.client = client
    }
    
    /// Create a new user
    /// POST /users/
    public func create(payload: UserCreate) async throws -> UserRead {
        return try await client.post(path: "users/", body: payload)
    }
    
    /// List users with optional filtering and pagination
    /// GET /users/
    public func list(
        skip: Int = 0,
        limit: Int = 100,
        search: String? = nil,
        sortBy: String? = nil,
        sortOrder: SortOrder? = nil
    ) async throws -> [UserRead] {
        var params: [String: String] = [
            "skip": String(skip),
            "limit": String(limit)
        ]
        if let search = search { params["search"] = search }
        if let sortBy = sortBy { params["sort_by"] = sortBy }
        if let sortOrder = sortOrder { params["sort_order"] = sortOrder.rawValue }
        
        return try await client.get(path: "users/", queryParams: params)
    }
    
    /// Get a user by ID
    /// GET /users/{user_id}
    public func get(_ userId: String) async throws -> UserRead {
        return try await client.get(path: "users/\(userId)")
    }
    
    /// Update a user
    /// PATCH /users/{user_id}
    public func update(_ userId: String, payload: UserUpdate) async throws -> UserRead {
        return try await client.patch(path: "users/\(userId)", body: payload)
    }
    
    /// Delete a user
    /// DELETE /users/{user_id}
    public func delete(_ userId: String) async throws -> UserDeleteResponse {
        return try await client.delete(path: "users/\(userId)")
    }
}

/// Authentication module for user authentication and management
public struct Auth: Sendable {
    private let client: HTTPClient
    
    /// Users collection for CRUD operations
    public let users: UsersCollection
    
    init(client: HTTPClient) {
        self.client = client
        self.users = UsersCollection(client: client)
    }
    
    /// Login with email and password
    /// POST /users/token
    public func login(email: String, password: String) async throws -> TokenPair {
        let request = LoginRequest(email: email, password: password)
        let response: TokenPair = try await client.post(path: "users/token", body: request)
        await client.setAccessToken(response.accessToken)
        return response
    }
    
    /// Refresh the access token
    /// POST /users/token/refresh
    public func refresh(refreshToken: String) async throws -> TokenPair {
        let request = RefreshRequest(refreshToken: refreshToken)
        let response: TokenPair = try await client.post(path: "users/token/refresh", body: request)
        await client.setAccessToken(response.accessToken)
        return response
    }
    
    /// Logout (revoke refresh token)
    /// POST /users/logout
    public func logout(refreshToken: String? = nil) async throws -> LogoutResponse {
        let request = LogoutRequest(refreshToken: refreshToken)
        let response: LogoutResponse = try await client.post(path: "users/logout", body: request)
        await client.setAccessToken(nil)
        return response
    }
    
    /// Logout from all devices
    /// POST /users/logout/all
    public func logoutAll() async throws -> LogoutResponse {
        struct EmptyBody: Encodable {}
        let response: LogoutResponse = try await client.post(path: "users/logout/all", body: EmptyBody())
        await client.setAccessToken(nil)
        return response
    }
    
    /// Get current user info
    /// GET /users/me
    public func me() async throws -> UserRead {
        return try await client.get(path: "users/me")
    }
    
    /// Get user count
    /// GET /users/count
    public func count(search: String? = nil) async throws -> Int {
        var params: [String: String] = [:]
        if let search = search { params["search"] = search }
        
        let response: CountResponse = try await client.get(path: "users/count", queryParams: params.isEmpty ? nil : params)
        return response.count
    }
}
