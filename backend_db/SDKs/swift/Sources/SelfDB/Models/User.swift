import Foundation

/// User role enumeration
public enum UserRole: String, Codable, Sendable {
    case user = "USER"
    case admin = "ADMIN"
}

/// Request model for creating a user
public struct UserCreate: Codable, Sendable {
    public let email: String
    public let password: String
    public let firstName: String
    public let lastName: String
    public let role: UserRole?
    
    public init(email: String, password: String, firstName: String, lastName: String, role: UserRole? = nil) {
        self.email = email
        self.password = password
        self.firstName = firstName
        self.lastName = lastName
        self.role = role
    }
}

/// Request model for updating a user
public struct UserUpdate: Codable, Sendable {
    public var firstName: String?
    public var lastName: String?
    public var password: String?
    public var role: UserRole?
    
    public init(firstName: String? = nil, lastName: String? = nil, password: String? = nil, role: UserRole? = nil) {
        self.firstName = firstName
        self.lastName = lastName
        self.password = password
        self.role = role
    }
}

/// Response model for user data
public struct UserRead: Codable, Sendable {
    public let id: String
    public let email: String
    public let firstName: String?
    public let lastName: String?
    public let role: UserRole
    public let createdAt: String?
    public let updatedAt: String?
    
    enum CodingKeys: String, CodingKey {
        case id
        case email
        case firstName
        case lastName
        case role
        case createdAt = "created_at"
        case updatedAt = "updated_at"
    }
}

/// Response model for token pair
public struct TokenPair: Codable, Sendable {
    public let accessToken: String
    public let refreshToken: String
    public let tokenType: String
    
    enum CodingKeys: String, CodingKey {
        case accessToken = "access_token"
        case refreshToken = "refresh_token"
        case tokenType = "token_type"
    }
}

/// Request model for login
public struct LoginRequest: Codable, Sendable {
    public let email: String
    public let password: String
    
    public init(email: String, password: String) {
        self.email = email
        self.password = password
    }
}

/// Request model for refresh token
public struct RefreshRequest: Codable, Sendable {
    public let refreshToken: String
    
    enum CodingKeys: String, CodingKey {
        case refreshToken = "refresh_token"
    }
    
    public init(refreshToken: String) {
        self.refreshToken = refreshToken
    }
}

/// Request model for logout
public struct LogoutRequest: Codable, Sendable {
    public let refreshToken: String?
    
    enum CodingKeys: String, CodingKey {
        case refreshToken = "refresh_token"
    }
    
    public init(refreshToken: String? = nil) {
        self.refreshToken = refreshToken
    }
}

/// Response model for logout
public struct LogoutResponse: Codable, Sendable {
    public let message: String
}

/// Response model for user deletion
public struct UserDeleteResponse: Codable, Sendable {
    public let status: String
    public let id: String
}

/// Response model for count queries
public struct CountResponse: Codable, Sendable {
    public let count: Int
}
