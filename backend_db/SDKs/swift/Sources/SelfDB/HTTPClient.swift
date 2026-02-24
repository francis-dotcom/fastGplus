import Foundation

/// HTTP client for making API requests
public actor HTTPClient {
    private let baseUrl: URL
    private let apiKey: String
    private let session: URLSession
    private var accessToken: String?
    
    private let encoder: JSONEncoder
    private let decoder: JSONDecoder
    
    public init(baseUrl: String, apiKey: String) {
        guard let url = URL(string: baseUrl) else {
            fatalError("Invalid base URL: \(baseUrl)")
        }
        self.baseUrl = url
        self.apiKey = apiKey
        
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 30
        config.timeoutIntervalForResource = 60
        self.session = URLSession(configuration: config)
        
        self.encoder = JSONEncoder()
        self.decoder = JSONDecoder()
    }
    
    /// Set the access token for authenticated requests
    public func setAccessToken(_ token: String?) {
        self.accessToken = token
    }
    
    /// Get the current access token
    public func getAccessToken() -> String? {
        return accessToken
    }
    
    /// Build URL with path and query parameters
    private func buildURL(path: String, queryParams: [String: String]? = nil) throws -> URL {
        var urlString = baseUrl.absoluteString
        if !urlString.hasSuffix("/") && !path.hasPrefix("/") {
            urlString += "/"
        }
        urlString += path
        
        guard var components = URLComponents(string: urlString) else {
            throw SelfDBError.badRequest("Invalid URL path: \(path)")
        }
        
        if let params = queryParams, !params.isEmpty {
            components.queryItems = params.map { URLQueryItem(name: $0.key, value: $0.value) }
        }
        
        guard let url = components.url else {
            throw SelfDBError.badRequest("Failed to build URL with params")
        }
        
        return url
    }
    
    /// Build a request with common headers
    private func buildRequest(url: URL, method: String, body: Data? = nil, contentType: String = "application/json") -> URLRequest {
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue(apiKey, forHTTPHeaderField: "X-API-Key")
        request.setValue(contentType, forHTTPHeaderField: "Content-Type")
        
        if let token = accessToken {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        
        if let body = body {
            request.httpBody = body
        }
        
        return request
    }
    
    /// Handle response and map errors
    private func handleResponse<T: Decodable>(_ data: Data, _ response: URLResponse) throws -> T {
        guard let httpResponse = response as? HTTPURLResponse else {
            throw SelfDBError.invalidResponse
        }
        
        switch httpResponse.statusCode {
        case 200...299:
            do {
                return try decoder.decode(T.self, from: data)
            } catch {
                throw SelfDBError.decodingError(error)
            }
        case 400:
            let message = String(data: data, encoding: .utf8) ?? "Bad request"
            throw SelfDBError.badRequest(message)
        case 401:
            throw SelfDBError.authenticationError
        case 403:
            throw SelfDBError.permissionDenied
        case 404:
            throw SelfDBError.notFound
        case 409:
            throw SelfDBError.conflict
        case 500...599:
            throw SelfDBError.internalServerError
        default:
            let message = String(data: data, encoding: .utf8)
            throw SelfDBError.unexpectedStatusCode(httpResponse.statusCode, message)
        }
    }
    
    /// Handle response for requests that don't return a body
    private func handleEmptyResponse(_ data: Data, _ response: URLResponse) throws {
        guard let httpResponse = response as? HTTPURLResponse else {
            throw SelfDBError.invalidResponse
        }
        
        switch httpResponse.statusCode {
        case 200...299:
            return
        case 400:
            let message = String(data: data, encoding: .utf8) ?? "Bad request"
            throw SelfDBError.badRequest(message)
        case 401:
            throw SelfDBError.authenticationError
        case 403:
            throw SelfDBError.permissionDenied
        case 404:
            throw SelfDBError.notFound
        case 409:
            throw SelfDBError.conflict
        case 500...599:
            throw SelfDBError.internalServerError
        default:
            let message = String(data: data, encoding: .utf8)
            throw SelfDBError.unexpectedStatusCode(httpResponse.statusCode, message)
        }
    }
    
    // MARK: - HTTP Methods
    
    /// Perform a GET request
    public func get<T: Decodable>(path: String, queryParams: [String: String]? = nil) async throws -> T {
        let url = try buildURL(path: path, queryParams: queryParams)
        let request = buildRequest(url: url, method: "GET")
        
        do {
            let (data, response) = try await session.data(for: request)
            return try handleResponse(data, response)
        } catch let error as SelfDBError {
            throw error
        } catch {
            throw SelfDBError.connectionError(error)
        }
    }
    
    /// Perform a GET request and return raw data
    public func getRaw(path: String, queryParams: [String: String]? = nil) async throws -> Data {
        let url = try buildURL(path: path, queryParams: queryParams)
        let request = buildRequest(url: url, method: "GET")
        
        do {
            let (data, response) = try await session.data(for: request)
            guard let httpResponse = response as? HTTPURLResponse else {
                throw SelfDBError.invalidResponse
            }
            
            switch httpResponse.statusCode {
            case 200...299:
                return data
            case 400:
                throw SelfDBError.badRequest(String(data: data, encoding: .utf8) ?? "Bad request")
            case 401:
                throw SelfDBError.authenticationError
            case 403:
                throw SelfDBError.permissionDenied
            case 404:
                throw SelfDBError.notFound
            case 409:
                throw SelfDBError.conflict
            case 500...599:
                throw SelfDBError.internalServerError
            default:
                throw SelfDBError.unexpectedStatusCode(httpResponse.statusCode, String(data: data, encoding: .utf8))
            }
        } catch let error as SelfDBError {
            throw error
        } catch {
            throw SelfDBError.connectionError(error)
        }
    }
    
    /// Perform a POST request
    public func post<T: Decodable, B: Encodable>(path: String, body: B, queryParams: [String: String]? = nil) async throws -> T {
        let url = try buildURL(path: path, queryParams: queryParams)
        
        let bodyData: Data
        do {
            bodyData = try encoder.encode(body)
        } catch {
            throw SelfDBError.encodingError(error)
        }
        
        let request = buildRequest(url: url, method: "POST", body: bodyData)
        
        do {
            let (data, response) = try await session.data(for: request)
            return try handleResponse(data, response)
        } catch let error as SelfDBError {
            throw error
        } catch {
            throw SelfDBError.connectionError(error)
        }
    }
    
    /// Perform a POST request with raw data body
    public func postRaw<T: Decodable>(path: String, body: Data, queryParams: [String: String]? = nil, contentType: String = "application/octet-stream") async throws -> T {
        let url = try buildURL(path: path, queryParams: queryParams)
        let request = buildRequest(url: url, method: "POST", body: body, contentType: contentType)
        
        do {
            let (data, response) = try await session.data(for: request)
            return try handleResponse(data, response)
        } catch let error as SelfDBError {
            throw error
        } catch {
            throw SelfDBError.connectionError(error)
        }
    }
    
    /// Perform a POST request without expecting a response body
    public func postEmpty<B: Encodable>(path: String, body: B) async throws {
        let url = try buildURL(path: path)
        
        let bodyData: Data
        do {
            bodyData = try encoder.encode(body)
        } catch {
            throw SelfDBError.encodingError(error)
        }
        
        let request = buildRequest(url: url, method: "POST", body: bodyData)
        
        do {
            let (data, response) = try await session.data(for: request)
            try handleEmptyResponse(data, response)
        } catch let error as SelfDBError {
            throw error
        } catch {
            throw SelfDBError.connectionError(error)
        }
    }
    
    /// Perform a PATCH request
    public func patch<T: Decodable, B: Encodable>(path: String, body: B) async throws -> T {
        let url = try buildURL(path: path)
        
        let bodyData: Data
        do {
            bodyData = try encoder.encode(body)
        } catch {
            throw SelfDBError.encodingError(error)
        }
        
        let request = buildRequest(url: url, method: "PATCH", body: bodyData)
        
        do {
            let (data, response) = try await session.data(for: request)
            return try handleResponse(data, response)
        } catch let error as SelfDBError {
            throw error
        } catch {
            throw SelfDBError.connectionError(error)
        }
    }
    
    /// Perform a PATCH request with query parameters
    public func patchWithParams<T: Decodable, B: Encodable>(path: String, body: B, queryParams: [String: String]? = nil) async throws -> T {
        let url = try buildURL(path: path, queryParams: queryParams)
        
        let bodyData: Data
        do {
            bodyData = try encoder.encode(body)
        } catch {
            throw SelfDBError.encodingError(error)
        }
        
        let request = buildRequest(url: url, method: "PATCH", body: bodyData)
        
        do {
            let (data, response) = try await session.data(for: request)
            return try handleResponse(data, response)
        } catch let error as SelfDBError {
            throw error
        } catch {
            throw SelfDBError.connectionError(error)
        }
    }
    
    /// Perform a DELETE request
    public func delete<T: Decodable>(path: String, queryParams: [String: String]? = nil) async throws -> T {
        let url = try buildURL(path: path, queryParams: queryParams)
        let request = buildRequest(url: url, method: "DELETE")
        
        do {
            let (data, response) = try await session.data(for: request)
            return try handleResponse(data, response)
        } catch let error as SelfDBError {
            throw error
        } catch {
            throw SelfDBError.connectionError(error)
        }
    }
    
    /// Perform a DELETE request without expecting a response body
    public func deleteEmpty(path: String, queryParams: [String: String]? = nil) async throws {
        let url = try buildURL(path: path, queryParams: queryParams)
        let request = buildRequest(url: url, method: "DELETE")
        
        do {
            let (data, response) = try await session.data(for: request)
            try handleEmptyResponse(data, response)
        } catch let error as SelfDBError {
            throw error
        } catch {
            throw SelfDBError.connectionError(error)
        }
    }
}
