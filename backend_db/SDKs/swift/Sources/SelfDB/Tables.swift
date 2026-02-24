import Foundation

/// Query builder for table data operations
public struct TableDataQuery: Sendable {
    private let client: HTTPClient
    private let tableId: String
    private var searchTerm: String?
    private var sortByColumn: String?
    private var sortOrderValue: SortOrder?
    private var pageNumber: Int?
    private var pageSizeValue: Int?
    
    init(client: HTTPClient, tableId: String) {
        self.client = client
        self.tableId = tableId
    }
    
    /// Set search term for filtering across all text columns
    public func search(_ term: String) -> TableDataQuery {
        var query = self
        query.searchTerm = term
        return query
    }
    
    /// Set sort column and order
    public func sort(_ column: String, _ order: SortOrder = .desc) -> TableDataQuery {
        var query = self
        query.sortByColumn = column
        query.sortOrderValue = order
        return query
    }
    
    /// Set page number (1-indexed)
    public func page(_ number: Int) -> TableDataQuery {
        var query = self
        query.pageNumber = number
        return query
    }
    
    /// Set results per page (1-1000)
    public func pageSize(_ size: Int) -> TableDataQuery {
        var query = self
        query.pageSizeValue = size
        return query
    }
    
    /// Execute the query and return results
    public func execute() async throws -> TableDataResponse {
        var params: [String: String] = [:]
        
        if let search = searchTerm { params["search"] = search }
        if let sortBy = sortByColumn { params["sort_by"] = sortBy }
        if let sortOrder = sortOrderValue { params["sort_order"] = sortOrder.rawValue }
        if let page = pageNumber { params["page"] = String(page) }
        if let pageSize = pageSizeValue { params["page_size"] = String(pageSize) }
        
        return try await client.get(path: "tables/\(tableId)/data", queryParams: params.isEmpty ? nil : params)
    }
}

/// Table data operations
public struct TableData: Sendable {
    private let client: HTTPClient
    
    init(client: HTTPClient) {
        self.client = client
    }
    
    /// Create a query builder for the specified table
    public func query(_ tableId: String) -> TableDataQuery {
        return TableDataQuery(client: client, tableId: tableId)
    }
    
    /// Fetch table data with pagination and filtering
    /// GET /tables/{table_id}/data
    public func fetch(
        _ tableId: String,
        page: Int = 1,
        pageSize: Int = 100,
        sortBy: String? = nil,
        sortOrder: SortOrder? = nil,
        search: String? = nil
    ) async throws -> TableDataResponse {
        var params: [String: String] = [
            "page": String(page),
            "page_size": String(pageSize)
        ]
        if let sortBy = sortBy { params["sort_by"] = sortBy }
        if let sortOrder = sortOrder { params["sort_order"] = sortOrder.rawValue }
        if let search = search { params["search"] = search }
        
        return try await client.get(path: "tables/\(tableId)/data", queryParams: params)
    }
    
    /// Insert a row into the table
    /// POST /tables/{table_id}/data
    public func insert(_ tableId: String, data: [String: AnyCodable]) async throws -> [String: AnyCodable] {
        return try await client.post(path: "tables/\(tableId)/data", body: data)
    }
    
    /// Update a row in the table
    /// PATCH /tables/{table_id}/data/{row_id}
    public func updateRow(
        _ tableId: String,
        rowId: String,
        updates: [String: AnyCodable],
        idColumn: String = "id"
    ) async throws -> [String: AnyCodable] {
        let params = ["id_column": idColumn]
        return try await client.patchWithParams(path: "tables/\(tableId)/data/\(rowId)", body: updates, queryParams: params)
    }
    
    /// Delete a row from the table
    /// DELETE /tables/{table_id}/data/{row_id}
    public func deleteRow(
        _ tableId: String,
        rowId: String,
        idColumn: String = "id"
    ) async throws -> RowDeleteResponse {
        let params = ["id_column": idColumn]
        return try await client.delete(path: "tables/\(tableId)/data/\(rowId)", queryParams: params)
    }
}

/// Table columns operations
public struct TableColumns: Sendable {
    private let client: HTTPClient
    
    init(client: HTTPClient) {
        self.client = client
    }
    
    /// Add a column to a table
    /// POST /tables/{table_id}/columns
    public func add(_ tableId: String, payload: ColumnDefinition) async throws -> TableRead {
        return try await client.post(path: "tables/\(tableId)/columns", body: payload)
    }
    
    /// Update a column in a table
    /// PATCH /tables/{table_id}/columns/{column_name}
    public func update(_ tableId: String, columnName: String, payload: ColumnUpdate) async throws -> TableRead {
        return try await client.patch(path: "tables/\(tableId)/columns/\(columnName)", body: payload)
    }
    
    /// Remove a column from a table
    /// DELETE /tables/{table_id}/columns/{column_name}
    public func remove(_ tableId: String, columnName: String) async throws -> TableRead {
        return try await client.delete(path: "tables/\(tableId)/columns/\(columnName)")
    }
}

/// Tables module for table management
public struct Tables: Sendable {
    private let client: HTTPClient
    
    /// Table data operations
    public let data: TableData
    
    /// Table columns operations
    public let columns: TableColumns
    
    init(client: HTTPClient) {
        self.client = client
        self.data = TableData(client: client)
        self.columns = TableColumns(client: client)
    }
    
    /// Get table count
    /// GET /tables/count
    public func count(search: String? = nil) async throws -> Int {
        var params: [String: String] = [:]
        if let search = search { params["search"] = search }
        
        let response: CountResponse = try await client.get(path: "tables/count", queryParams: params.isEmpty ? nil : params)
        return response.count
    }
    
    /// Create a new table
    /// POST /tables/
    public func create(payload: TableCreate) async throws -> TableRead {
        return try await client.post(path: "tables/", body: payload)
    }
    
    /// List tables with optional filtering and pagination
    /// GET /tables/
    public func list(
        skip: Int = 0,
        limit: Int = 100,
        search: String? = nil,
        sortBy: TableSortBy? = nil,
        sortOrder: SortOrder? = nil
    ) async throws -> [TableRead] {
        var params: [String: String] = [
            "skip": String(skip),
            "limit": String(limit)
        ]
        if let search = search { params["search"] = search }
        if let sortBy = sortBy { params["sort_by"] = sortBy.rawValue }
        if let sortOrder = sortOrder { params["sort_order"] = sortOrder.rawValue }
        
        return try await client.get(path: "tables/", queryParams: params)
    }
    
    /// Get a table by ID
    /// GET /tables/{table_id}
    public func get(_ tableId: String) async throws -> TableRead {
        return try await client.get(path: "tables/\(tableId)")
    }
    
    /// Update a table
    /// PATCH /tables/{table_id}
    public func update(_ tableId: String, payload: TableUpdate) async throws -> TableRead {
        return try await client.patch(path: "tables/\(tableId)", body: payload)
    }
    
    /// Delete a table
    /// DELETE /tables/{table_id}
    public func delete(_ tableId: String) async throws -> TableDeleteResponse {
        return try await client.delete(path: "tables/\(tableId)")
    }
}
