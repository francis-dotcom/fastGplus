import Foundation

/// All errors that can be thrown by the SelfDB SDK
public enum SelfDBError: Error, LocalizedError {
    /// Network connection failure
    case connectionError(Error)
    /// Bad request (400)
    case badRequest(String)
    /// Authentication failed (401)
    case authenticationError
    /// Permission denied (403)
    case permissionDenied
    /// Resource not found (404)
    case notFound
    /// Conflict (409)
    case conflict
    /// Internal server error (500)
    case internalServerError
    /// Unexpected status code
    case unexpectedStatusCode(Int, String?)
    /// Invalid response format
    case invalidResponse
    /// Encoding error
    case encodingError(Error)
    /// Decoding error
    case decodingError(Error)
    /// WebSocket error
    case webSocketError(String)
    
    public var errorDescription: String? {
        switch self {
        case .connectionError(let error):
            return "Connection error: \(error.localizedDescription)"
        case .badRequest(let message):
            return "Bad request: \(message)"
        case .authenticationError:
            return "Authentication failed"
        case .permissionDenied:
            return "Permission denied"
        case .notFound:
            return "Resource not found"
        case .conflict:
            return "Conflict"
        case .internalServerError:
            return "Internal server error"
        case .unexpectedStatusCode(let code, let message):
            return "Unexpected status code \(code): \(message ?? "No message")"
        case .invalidResponse:
            return "Invalid response format"
        case .encodingError(let error):
            return "Encoding error: \(error.localizedDescription)"
        case .decodingError(let error):
            return "Decoding error: \(error.localizedDescription)"
        case .webSocketError(let message):
            return "WebSocket error: \(message)"
        }
    }
}
