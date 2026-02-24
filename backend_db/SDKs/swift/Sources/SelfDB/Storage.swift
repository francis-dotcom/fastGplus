import Foundation

/// Files operations
public struct Files: Sendable {
    private let client: HTTPClient
    
    init(client: HTTPClient) {
        self.client = client
    }
    
    /// Get storage statistics
    /// GET /storage/files/stats
    public func stats() async throws -> StorageStatsResponse {
        return try await client.get(path: "storage/files/stats")
    }
    
    /// Get total file count
    /// GET /storage/files/total-count
    public func totalCount(search: String? = nil) async throws -> Int {
        var params: [String: String] = [:]
        if let search = search { params["search"] = search }
        
        let response: CountResponse = try await client.get(path: "storage/files/total-count", queryParams: params.isEmpty ? nil : params)
        return response.count
    }
    
    /// Get file count for a bucket
    /// GET /storage/files/count
    public func count(bucketId: String) async throws -> Int {
        let params = ["bucket_id": bucketId]
        let response: CountResponse = try await client.get(path: "storage/files/count", queryParams: params)
        return response.count
    }
    
    /// Upload a file to a bucket
    /// POST /storage/files/upload
    public func upload(
        _ bucketId: String,
        filename: String,
        data: Data,
        path: String? = nil
    ) async throws -> FileUploadResponse {
        var params: [String: String] = [
            "bucket_id": bucketId,
            "filename": filename
        ]
        if let path = path { params["path"] = path }
        
        return try await client.postRaw(path: "storage/files/upload", body: data, queryParams: params, contentType: "application/octet-stream")
    }
    
    /// List files with optional filtering
    /// GET /storage/files/
    public func list(
        bucketId: String? = nil,
        page: Int = 1,
        pageSize: Int = 100,
        search: String? = nil
    ) async throws -> FileDataResponse {
        var params: [String: String] = [
            "page": String(page),
            "page_size": String(pageSize)
        ]
        if let bucketId = bucketId { params["bucket_id"] = bucketId }
        if let search = search { params["search"] = search }
        
        return try await client.get(path: "storage/files/", queryParams: params)
    }
    
    /// Get a file by ID
    /// GET /storage/files/{file_id}
    public func get(_ fileId: String) async throws -> FileResponse {
        return try await client.get(path: "storage/files/\(fileId)")
    }
    
    /// Delete a file
    /// DELETE /storage/files/{file_id}
    public func delete(_ fileId: String) async throws {
        try await client.deleteEmpty(path: "storage/files/\(fileId)")
    }
    
    /// Update file metadata
    /// PATCH /storage/files/{file_id}
    public func updateMetadata(_ fileId: String, metadata: [String: AnyCodable]) async throws -> FileResponse {
        struct MetadataUpdate: Encodable {
            let metadata: [String: AnyCodable]
        }
        return try await client.patch(path: "storage/files/\(fileId)", body: MetadataUpdate(metadata: metadata))
    }
    
    /// Download a file
    /// GET /storage/files/download/{bucket_name}/{path}
    public func download(bucketName: String, path: String) async throws -> Data {
        let encodedPath = path.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? path
        return try await client.getRaw(path: "storage/files/download/\(bucketName)/\(encodedPath)")
    }
}

/// Buckets operations
public struct Buckets: Sendable {
    private let client: HTTPClient
    
    init(client: HTTPClient) {
        self.client = client
    }
    
    /// Get bucket count
    /// GET /storage/buckets/count
    public func count(search: String? = nil) async throws -> Int {
        var params: [String: String] = [:]
        if let search = search { params["search"] = search }
        
        let response: CountResponse = try await client.get(path: "storage/buckets/count", queryParams: params.isEmpty ? nil : params)
        return response.count
    }
    
    /// Create a new bucket
    /// POST /storage/buckets/
    public func create(payload: BucketCreate) async throws -> BucketResponse {
        return try await client.post(path: "storage/buckets/", body: payload)
    }
    
    /// List buckets with optional filtering
    /// GET /storage/buckets/
    public func list(
        skip: Int = 0,
        limit: Int = 100,
        search: String? = nil,
        sortBy: BucketSortBy? = nil,
        sortOrder: SortOrder? = nil
    ) async throws -> [BucketResponse] {
        var params: [String: String] = [
            "skip": String(skip),
            "limit": String(limit)
        ]
        if let search = search { params["search"] = search }
        if let sortBy = sortBy { params["sort_by"] = sortBy.rawValue }
        if let sortOrder = sortOrder { params["sort_order"] = sortOrder.rawValue }
        
        return try await client.get(path: "storage/buckets/", queryParams: params)
    }
    
    /// Get a bucket by ID
    /// GET /storage/buckets/{bucket_id}
    public func get(_ bucketId: String) async throws -> BucketResponse {
        return try await client.get(path: "storage/buckets/\(bucketId)")
    }
    
    /// Update a bucket
    /// PATCH /storage/buckets/{bucket_id}
    public func update(_ bucketId: String, payload: BucketUpdate) async throws -> BucketResponse {
        return try await client.patch(path: "storage/buckets/\(bucketId)", body: payload)
    }
    
    /// Delete a bucket
    /// DELETE /storage/buckets/{bucket_id}
    public func delete(_ bucketId: String) async throws {
        try await client.deleteEmpty(path: "storage/buckets/\(bucketId)")
    }
}

/// Storage module for bucket and file management
public struct Storage: Sendable {
    /// Buckets operations
    public let buckets: Buckets
    
    /// Files operations
    public let files: Files
    
    init(client: HTTPClient) {
        self.buckets = Buckets(client: client)
        self.files = Files(client: client)
    }
}
