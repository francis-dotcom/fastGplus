import Foundation

/// Request model for creating a bucket
public struct BucketCreate: Codable, Sendable {
    public let name: String
    public let `public`: Bool
    public let description: String?
    public let allowedMimeTypes: [String]?
    public let maxFileSize: Int?
    
    enum CodingKeys: String, CodingKey {
        case name
        case `public`
        case description
        case allowedMimeTypes = "allowed_mime_types"
        case maxFileSize = "max_file_size"
    }
    
    public init(name: String, `public`: Bool, description: String? = nil, allowedMimeTypes: [String]? = nil, maxFileSize: Int? = nil) {
        self.name = name
        self.public = `public`
        self.description = description
        self.allowedMimeTypes = allowedMimeTypes
        self.maxFileSize = maxFileSize
    }
}

/// Request model for updating a bucket
public struct BucketUpdate: Codable, Sendable {
    public var name: String?
    public var `public`: Bool?
    public var description: String?
    public var allowedMimeTypes: [String]?
    public var maxFileSize: Int?
    
    enum CodingKeys: String, CodingKey {
        case name
        case `public`
        case description
        case allowedMimeTypes = "allowed_mime_types"
        case maxFileSize = "max_file_size"
    }
    
    public init(name: String? = nil, `public`: Bool? = nil, description: String? = nil, allowedMimeTypes: [String]? = nil, maxFileSize: Int? = nil) {
        self.name = name
        self.public = `public`
        self.description = description
        self.allowedMimeTypes = allowedMimeTypes
        self.maxFileSize = maxFileSize
    }
}

/// Response model for bucket data
public struct BucketResponse: Codable, Sendable {
    public let id: String
    public let name: String
    public let `public`: Bool
    public let ownerId: String?
    public let description: String?
    public let allowedMimeTypes: [String]?
    public let maxFileSize: Int?
    public let createdAt: String?
    public let updatedAt: String?
    
    enum CodingKeys: String, CodingKey {
        case id
        case name
        case `public`
        case ownerId = "owner_id"
        case description
        case allowedMimeTypes = "allowed_mime_types"
        case maxFileSize = "max_file_size"
        case createdAt = "created_at"
        case updatedAt = "updated_at"
    }
}

/// Response model for file upload
public struct FileUploadResponse: Codable, Sendable {
    public let success: Bool
    public let bucket: String
    public let path: String
    public let size: Int
    public let fileId: String
    
    enum CodingKeys: String, CodingKey {
        case success
        case bucket
        case path
        case size
        case fileId = "file_id"
    }
}

/// Response model for file data
public struct FileResponse: Codable, Sendable {
    public let id: String
    public let bucketId: String
    public let name: String
    public let path: String
    public let size: Int
    public let mimeType: String?
    public let metadata: [String: AnyCodable]?
    public let createdAt: String?
    public let updatedAt: String?
    
    enum CodingKeys: String, CodingKey {
        case id
        case bucketId = "bucket_id"
        case name
        case path
        case size
        case mimeType = "mime_type"
        case metadata
        case createdAt = "created_at"
        case updatedAt = "updated_at"
    }
}

/// Response model for file listing
public struct FileDataResponse: Codable, Sendable {
    public let data: [FileResponse]
    public let total: Int
    public let page: Int
    public let pageSize: Int
    
    enum CodingKeys: String, CodingKey {
        case data
        case total
        case page
        case pageSize = "page_size"
    }
}

/// Response model for storage statistics
public struct StorageStatsResponse: Codable, Sendable {
    public let totalFiles: Int
    public let totalSize: Int
    public let totalBuckets: Int
    
    enum CodingKeys: String, CodingKey {
        case totalFiles = "total_files"
        case totalSize = "total_size"
        case totalBuckets = "total_buckets"
    }
}

/// Bucket sort by options
public enum BucketSortBy: String, Sendable {
    case name = "name"
    case createdAt = "created_at"
    case updatedAt = "updated_at"
}
