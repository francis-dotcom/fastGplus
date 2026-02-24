import Foundation

/// Column schema definition for table creation
public struct ColumnSchema: Codable, Sendable {
    public let type: String
    public var nullable: Bool?
    public var defaultValue: AnyCodable?
    
    enum CodingKeys: String, CodingKey {
        case type
        case nullable
        case defaultValue = "default"
    }
    
    public init(type: String, nullable: Bool? = nil, defaultValue: AnyCodable? = nil) {
        self.type = type
        self.nullable = nullable
        self.defaultValue = defaultValue
    }
}

/// Request model for creating a table
public struct TableCreate: Codable, Sendable {
    public let name: String
    public let tableSchema: [String: ColumnSchema]
    public let `public`: Bool
    public let description: String?
    
    enum CodingKeys: String, CodingKey {
        case name
        case tableSchema = "table_schema"
        case `public`
        case description
    }
    
    public init(name: String, tableSchema: [String: ColumnSchema], `public`: Bool, description: String? = nil) {
        self.name = name
        self.tableSchema = tableSchema
        self.public = `public`
        self.description = description
    }
}

/// Request model for updating a table
public struct TableUpdate: Codable, Sendable {
    public var name: String?
    public var `public`: Bool?
    public var realtimeEnabled: Bool?
    public var description: String?
    
    enum CodingKeys: String, CodingKey {
        case name
        case `public`
        case realtimeEnabled = "realtime_enabled"
        case description
    }
    
    public init(name: String? = nil, `public`: Bool? = nil, realtimeEnabled: Bool? = nil, description: String? = nil) {
        self.name = name
        self.public = `public`
        self.realtimeEnabled = realtimeEnabled
        self.description = description
    }
}

/// Response model for table data
public struct TableRead: Codable, Sendable {
    public let id: String
    public let name: String
    public let tableSchema: [String: ColumnSchema]?
    public let `public`: Bool
    public let ownerId: String?
    public let realtimeEnabled: Bool?
    public let description: String?
    public let createdAt: String?
    public let updatedAt: String?
    
    enum CodingKeys: String, CodingKey {
        case id
        case name
        case tableSchema = "table_schema"
        case `public`
        case ownerId = "owner_id"
        case realtimeEnabled = "realtime_enabled"
        case description
        case createdAt = "created_at"
        case updatedAt = "updated_at"
    }
}

/// Request model for adding a column
public struct ColumnDefinition: Codable, Sendable {
    public let name: String
    public let type: String
    public var nullable: Bool?
    public var defaultValue: AnyCodable?
    
    enum CodingKeys: String, CodingKey {
        case name
        case type
        case nullable
        case defaultValue = "default"
    }
    
    public init(name: String, type: String, nullable: Bool? = nil, defaultValue: AnyCodable? = nil) {
        self.name = name
        self.type = type
        self.nullable = nullable
        self.defaultValue = defaultValue
    }
}

/// Request model for updating a column
public struct ColumnUpdate: Codable, Sendable {
    public var newName: String?
    public var nullable: Bool?
    public var defaultValue: AnyCodable?
    
    enum CodingKeys: String, CodingKey {
        case newName = "new_name"
        case nullable
        case defaultValue = "default"
    }
    
    public init(newName: String? = nil, nullable: Bool? = nil, defaultValue: AnyCodable? = nil) {
        self.newName = newName
        self.nullable = nullable
        self.defaultValue = defaultValue
    }
}

/// Response model for table data queries
public struct TableDataResponse: Codable, Sendable {
    public let data: [[String: AnyCodable]]
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

/// Response model for table deletion
public struct TableDeleteResponse: Codable, Sendable {
    public let status: String
    public let id: String
    public let name: String
}

/// Response model for row deletion
public struct RowDeleteResponse: Codable, Sendable {
    public let status: String
    public let tableId: String
    public let rowId: String
    
    enum CodingKeys: String, CodingKey {
        case status
        case tableId = "table_id"
        case rowId = "row_id"
    }
}

/// Sort order enum
public enum SortOrder: String, Sendable {
    case asc = "asc"
    case desc = "desc"
}

/// Table sort by options
public enum TableSortBy: String, Sendable {
    case name = "name"
    case createdAt = "created_at"
    case updatedAt = "updated_at"
}
