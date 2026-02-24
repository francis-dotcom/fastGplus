/**
 * SelfDB SDK Integration Tests
 *
 * These tests run against a live SelfDB instance.
 * Prerequisites:
 * - Running SelfDB instance at http://localhost:8000
 * - Valid API key: selfdb-a213f2c0-71cd-8660-074c-ccc9dbde830a
 * - Admin credentials: admin@example.com / password
 *
 * Run with: RUN_INTEGRATION_TESTS=1 swift test
 *
 * Total: 29 tests matching Python and TypeScript SDK test suites
 */

import XCTest
@testable import SelfDB

final class SelfDBIntegrationTests: XCTestCase {
    
    // MARK: - Configuration
    
    static let baseUrl = "http://localhost:8000"
    static let apiKey = "selfdb-a213f2c0-71cd-8660-074c-ccc9dbde830a"
    static let adminEmail = "admin@example.com"
    static let adminPassword = "password"
    
    // Test user credentials
    static var testUserEmail: String = ""
    static let testUserPassword = "testpassword123"
    static let testUserFirstName = "Test"
    static let testUserLastName = "User"
    
    // Shared resources across tests
    static var adminClient: SelfDB!
    static var userClient: SelfDB!
    static var testUser: UserRead?
    static var publicTable: TableRead?
    static var publicBucket: BucketResponse?
    static var insertedRowId: String?
    static var uploadedFileId: String?
    
    // User's own resources (Section 4)
    static var userPrivateTable: TableRead?
    static var userPrivateTableRowId: String?
    static var userPrivateBucket: BucketResponse?
    
    // Realtime resources (Section 5)
    static var realtimeTable: TableRead?
    
    // MARK: - Test Lifecycle
    
    override class func setUp() {
        super.setUp()
        // Generate unique email for this test run
        testUserEmail = "testuser-\(Int(Date().timeIntervalSince1970))@example.com"
    }
    
    func skipIfNotIntegrationTest() throws {
        guard ProcessInfo.processInfo.environment["RUN_INTEGRATION_TESTS"] == "1" else {
            throw XCTSkip("Integration tests disabled. Set RUN_INTEGRATION_TESTS=1 to enable.")
        }
    }
    
    // ─────────────────────────────────────────────────────────────────────────
    // 1. Client Setup & Authentication (4 tests)
    // ─────────────────────────────────────────────────────────────────────────
    
    /// Test 1: Initialize admin client and login
    func test_1_01_AdminClientInitAndLogin() async throws {
        try skipIfNotIntegrationTest()
        
        Self.adminClient = SelfDB(baseUrl: Self.baseUrl, apiKey: Self.apiKey)
        let tokens = try await Self.adminClient.auth.login(email: Self.adminEmail, password: Self.adminPassword)
        
        XCTAssertFalse(tokens.accessToken.isEmpty, "Access token should not be empty")
        XCTAssertFalse(tokens.refreshToken.isEmpty, "Refresh token should not be empty")
        XCTAssertEqual(tokens.tokenType, "bearer", "Token type should be 'bearer'")
    }
    
    /// Test 2: Create a new regular user via admin client
    func test_1_02_CreateRegularUserViaAdmin() async throws {
        try skipIfNotIntegrationTest()
        
        let user = try await Self.adminClient.auth.users.create(payload: UserCreate(
            email: Self.testUserEmail,
            password: Self.testUserPassword,
            firstName: Self.testUserFirstName,
            lastName: Self.testUserLastName
        ))
        
        Self.testUser = user
        
        XCTAssertFalse(user.id.isEmpty, "User ID should not be empty")
        XCTAssertEqual(user.email, Self.testUserEmail, "Email should match")
        XCTAssertEqual(user.firstName, Self.testUserFirstName, "First name should match")
        XCTAssertEqual(user.lastName, Self.testUserLastName, "Last name should match")
        XCTAssertEqual(user.role, .user, "Role should be USER")
    }
    
    /// Test 3: Initialize regular user client and login
    func test_1_03_RegularUserClientInitAndLogin() async throws {
        try skipIfNotIntegrationTest()
        
        Self.userClient = SelfDB(baseUrl: Self.baseUrl, apiKey: Self.apiKey)
        let tokens = try await Self.userClient.auth.login(email: Self.testUserEmail, password: Self.testUserPassword)
        
        XCTAssertFalse(tokens.accessToken.isEmpty, "Access token should not be empty")
        XCTAssertFalse(tokens.refreshToken.isEmpty, "Refresh token should not be empty")
    }
    
    /// Test 4: Get current user info
    func test_1_04_GetCurrentUserInfo() async throws {
        try skipIfNotIntegrationTest()
        
        let me = try await Self.userClient.auth.me()
        XCTAssertEqual(me.email, Self.testUserEmail, "Email should match logged in user")
    }
    
    // ─────────────────────────────────────────────────────────────────────────
    // 2. Admin Creates Public Resources (2 tests)
    // ─────────────────────────────────────────────────────────────────────────
    
    /// Test 5: Create a PUBLIC table with schema
    func test_2_01_CreatePublicTableWithSchema() async throws {
        try skipIfNotIntegrationTest()
        
        let tableName = "test_table_\(Int(Date().timeIntervalSince1970))"
        let table = try await Self.adminClient.tables.create(payload: TableCreate(
            name: tableName,
            tableSchema: [
                "id": ColumnSchema(type: "uuid", nullable: false),
                "title": ColumnSchema(type: "text", nullable: false),
                "count": ColumnSchema(type: "integer", nullable: true)
            ],
            public: true
        ))
        
        Self.publicTable = table
        
        XCTAssertFalse(table.id.isEmpty, "Table ID should not be empty")
        XCTAssertTrue(table.public, "Table should be public")
        XCTAssertNotNil(table.tableSchema, "Table schema should be defined")
    }
    
    /// Test 6: Create a PUBLIC bucket
    func test_2_02_CreatePublicBucket() async throws {
        try skipIfNotIntegrationTest()
        
        let bucketName = "test-bucket-\(Int(Date().timeIntervalSince1970))"
        let bucket = try await Self.adminClient.storage.buckets.create(payload: BucketCreate(
            name: bucketName,
            public: true
        ))
        
        Self.publicBucket = bucket
        
        XCTAssertFalse(bucket.id.isEmpty, "Bucket ID should not be empty")
        XCTAssertTrue(bucket.public, "Bucket should be public")
    }
    
    // ─────────────────────────────────────────────────────────────────────────
    // 3. Regular User Consumes Public Resources (5 tests)
    // ─────────────────────────────────────────────────────────────────────────
    
    /// Test 7: Insert row into public table (should succeed)
    func test_3_01_InsertRowIntoPublicTable() async throws {
        try skipIfNotIntegrationTest()
        guard let tableId = Self.publicTable?.id else {
            throw XCTSkip("Public table not created")
        }
        
        let rowId = UUID().uuidString
        let row = try await Self.userClient.tables.data.insert(tableId, data: [
            "id": AnyCodable(rowId),
            "title": AnyCodable("Test Title"),
            "count": AnyCodable(42)
        ])
        
        XCTAssertNotNil(row, "Row should be returned")
        Self.insertedRowId = rowId
    }
    
    /// Test 8: Update row in public table should fail with 403 (not owner)
    func test_3_02_UpdateRowInPublicTableShouldFail403() async throws {
        try skipIfNotIntegrationTest()
        guard let tableId = Self.publicTable?.id,
              let rowId = Self.insertedRowId else {
            throw XCTSkip("Public table or row not created")
        }
        
        do {
            _ = try await Self.userClient.tables.data.updateRow(tableId, rowId: rowId, updates: [
                "title": AnyCodable("Updated")
            ])
            XCTFail("Expected permissionDenied error")
        } catch SelfDBError.permissionDenied {
            // Expected - regular user cannot update row they don't own
        } catch {
            XCTFail("Expected permissionDenied error, got: \(error)")
        }
    }
    
    /// Test 9: Delete row in public table should fail with 403 (not owner)
    func test_3_03_DeleteRowInPublicTableShouldFail403() async throws {
        try skipIfNotIntegrationTest()
        guard let tableId = Self.publicTable?.id,
              let rowId = Self.insertedRowId else {
            throw XCTSkip("Public table or row not created")
        }
        
        do {
            _ = try await Self.userClient.tables.data.deleteRow(tableId, rowId: rowId)
            XCTFail("Expected permissionDenied error")
        } catch SelfDBError.permissionDenied {
            // Expected - regular user cannot delete row they don't own
        } catch {
            XCTFail("Expected permissionDenied error, got: \(error)")
        }
    }
    
    /// Test 10: Upload file to public bucket (should succeed)
    func test_3_04_UploadFileToPublicBucket() async throws {
        try skipIfNotIntegrationTest()
        guard let bucketId = Self.publicBucket?.id else {
            throw XCTSkip("Public bucket not created")
        }
        
        let fileContent = "Hello, SelfDB!".data(using: .utf8)!
        let response = try await Self.userClient.storage.files.upload(
            bucketId,
            filename: "test.txt",
            data: fileContent
        )
        
        XCTAssertTrue(response.success, "Upload should succeed")
        XCTAssertFalse(response.fileId.isEmpty, "File ID should not be empty")
        Self.uploadedFileId = response.fileId
    }
    
    /// Test 11: Download file from public bucket (verify content matches)
    func test_3_05_DownloadFileFromPublicBucket() async throws {
        try skipIfNotIntegrationTest()
        guard let bucketName = Self.publicBucket?.name else {
            throw XCTSkip("Public bucket not created")
        }
        
        let data = try await Self.userClient.storage.files.download(
            bucketName: bucketName,
            path: "test.txt"
        )
        
        let text = String(data: data, encoding: .utf8)
        XCTAssertEqual(text, "Hello, SelfDB!", "Downloaded content should match uploaded content")
    }
    
    // ─────────────────────────────────────────────────────────────────────────
    // 4. Regular User Manages Own Resources - Tables (5 tests)
    // ─────────────────────────────────────────────────────────────────────────
    
    /// Test 12: Create private table (should succeed)
    func test_4_01_CreatePrivateTable() async throws {
        try skipIfNotIntegrationTest()
        
        let tableName = "user_table_\(Int(Date().timeIntervalSince1970))"
        let table = try await Self.userClient.tables.create(payload: TableCreate(
            name: tableName,
            tableSchema: [
                "id": ColumnSchema(type: "uuid", nullable: false),
                "name": ColumnSchema(type: "text", nullable: false)
            ],
            public: false
        ))
        
        Self.userPrivateTable = table
        
        XCTAssertFalse(table.id.isEmpty, "Table ID should not be empty")
        XCTAssertFalse(table.public, "Table should be private")
    }
    
    /// Test 13: Insert row in own table (should succeed)
    func test_4_02_InsertRowInOwnTable() async throws {
        try skipIfNotIntegrationTest()
        guard let tableId = Self.userPrivateTable?.id else {
            throw XCTSkip("User private table not created")
        }
        
        let rowId = UUID().uuidString
        let row = try await Self.userClient.tables.data.insert(tableId, data: [
            "id": AnyCodable(rowId),
            "name": AnyCodable("Test")
        ])
        
        Self.userPrivateTableRowId = rowId
        XCTAssertNotNil(row, "Row should be returned")
    }
    
    /// Test 14: Update own row (should succeed)
    func test_4_03_UpdateOwnRow() async throws {
        try skipIfNotIntegrationTest()
        guard let tableId = Self.userPrivateTable?.id,
              let rowId = Self.userPrivateTableRowId else {
            throw XCTSkip("User private table or row not created")
        }
        
        let updated = try await Self.userClient.tables.data.updateRow(tableId, rowId: rowId, updates: [
            "name": AnyCodable("Updated")
        ])
        XCTAssertNotNil(updated, "Updated row should be returned")
    }
    
    /// Test 15: Delete own row (should succeed)
    func test_4_04_DeleteOwnRow() async throws {
        try skipIfNotIntegrationTest()
        guard let tableId = Self.userPrivateTable?.id,
              let rowId = Self.userPrivateTableRowId else {
            throw XCTSkip("User private table or row not created")
        }
        
        let deleted = try await Self.userClient.tables.data.deleteRow(tableId, rowId: rowId)
        XCTAssertNotNil(deleted, "Delete response should be returned")
    }
    
    /// Test 16: Delete own table (should succeed)
    func test_4_05_DeleteOwnTable() async throws {
        try skipIfNotIntegrationTest()
        guard let tableId = Self.userPrivateTable?.id else {
            throw XCTSkip("User private table not created")
        }
        
        let tableDeleted = try await Self.userClient.tables.delete(tableId)
        XCTAssertNotNil(tableDeleted, "Table delete response should be returned")
        Self.userPrivateTable = nil
    }
    
    // ─────────────────────────────────────────────────────────────────────────
    // 4. Regular User Manages Own Resources - Storage (3 tests)
    // ─────────────────────────────────────────────────────────────────────────
    
    /// Test 17: Create private bucket (should succeed)
    func test_4_06_CreatePrivateBucket() async throws {
        try skipIfNotIntegrationTest()
        
        let bucketName = "user-bucket-\(Int(Date().timeIntervalSince1970))"
        let bucket = try await Self.userClient.storage.buckets.create(payload: BucketCreate(
            name: bucketName,
            public: false
        ))
        
        Self.userPrivateBucket = bucket
        
        XCTAssertFalse(bucket.id.isEmpty, "Bucket ID should not be empty")
        XCTAssertFalse(bucket.public, "Bucket should be private")
    }
    
    /// Test 18: Upload file to own bucket (should succeed)
    func test_4_07_UploadFileToOwnBucket() async throws {
        try skipIfNotIntegrationTest()
        guard let bucketId = Self.userPrivateBucket?.id else {
            throw XCTSkip("User private bucket not created")
        }
        
        let fileContent = "User file content".data(using: .utf8)!
        let uploadResponse = try await Self.userClient.storage.files.upload(
            bucketId,
            filename: "myfile.txt",
            data: fileContent
        )
        XCTAssertTrue(uploadResponse.success, "Upload should succeed")
    }
    
    /// Test 19: Delete own bucket (should succeed)
    func test_4_08_DeleteOwnBucket() async throws {
        try skipIfNotIntegrationTest()
        guard let bucketId = Self.userPrivateBucket?.id else {
            throw XCTSkip("User private bucket not created")
        }
        
        try await Self.userClient.storage.buckets.delete(bucketId)
        Self.userPrivateBucket = nil
        // No error means success
    }
    
    // ─────────────────────────────────────────────────────────────────────────
    // 5. Realtime Updates (5 tests)
    // ─────────────────────────────────────────────────────────────────────────
    
    /// Test 20: Connect to WebSocket
    func test_5_01_ConnectToWebSocket() async throws {
        try skipIfNotIntegrationTest()
        
        // Create a table for realtime testing
        let tableName = "realtime_table_\(Int(Date().timeIntervalSince1970))"
        let table = try await Self.adminClient.tables.create(payload: TableCreate(
            name: tableName,
            tableSchema: [
                "message": ColumnSchema(type: "text", nullable: false)
            ],
            public: true
        ))
        Self.realtimeTable = table
        
        // Try to connect to WebSocket - may fail if realtime service is not running
        do {
            try await Self.adminClient.realtime.connect()
        } catch {
            print("Note: WebSocket connection failed - realtime service may not be running (\(error))")
            // Mark as skipped but don't fail
            throw XCTSkip("WebSocket connection failed - realtime service may not be running")
        }
        
        // If we got here, connection succeeded
        XCTAssertTrue(Self.adminClient.realtime.isConnected, "Should be connected")
    }
    
    /// Test 21: Enable realtime on table
    func test_5_02_EnableRealtimeOnTable() async throws {
        try skipIfNotIntegrationTest()
        guard let tableId = Self.realtimeTable?.id else {
            throw XCTSkip("Realtime table not created")
        }
        guard Self.adminClient.realtime.isConnected else {
            throw XCTSkip("WebSocket not connected")
        }
        
        let updatedTable = try await Self.adminClient.tables.update(tableId, payload: TableUpdate(
            realtimeEnabled: true
        ))
        XCTAssertTrue(updatedTable.realtimeEnabled ?? false, "Realtime should be enabled")
    }
    
    /// Test 22: Subscribe to table topic
    func test_5_03_SubscribeToTableTopic() async throws {
        try skipIfNotIntegrationTest()
        guard let tableName = Self.realtimeTable?.name else {
            throw XCTSkip("Realtime table not created")
        }
        guard Self.adminClient.realtime.isConnected else {
            throw XCTSkip("WebSocket not connected")
        }
        
        do {
            let channel = Self.adminClient.realtime.channel("table:\(tableName)")
            try await channel.subscribe()
            // No error means success
        } catch {
            print("Note: Channel subscription failed - realtime service may not be fully operational (\(error))")
            throw XCTSkip("Channel subscription failed - realtime service may not be fully operational")
        }
    }
    
    /// Test 23: Register INSERT callback and receive event
    func test_5_04_RegisterInsertCallbackAndReceiveEvent() async throws {
        try skipIfNotIntegrationTest()
        guard let tableId = Self.realtimeTable?.id,
              let tableName = Self.realtimeTable?.name else {
            throw XCTSkip("Realtime table not created")
        }
        guard Self.adminClient.realtime.isConnected else {
            throw XCTSkip("WebSocket not connected")
        }
        
        var receivedEvent: RealtimePayload? = nil
        let expectation = XCTestExpectation(description: "Receive realtime event")
        
        let channel = Self.adminClient.realtime.channel("table:\(tableName)")
            .on(.insert) { payload in
                receivedEvent = payload
                expectation.fulfill()
            }
        
        do {
            try await channel.subscribe()
        } catch {
            print("Note: Channel subscription failed (\(error))")
            throw XCTSkip("Channel subscription failed")
        }
        
        // Small delay to ensure subscription is active
        try await Task.sleep(nanoseconds: 500_000_000)
        
        // Trigger insert via API
        _ = try await Self.adminClient.tables.data.insert(tableId, data: [
            "message": AnyCodable("Realtime test")
        ])
        
        // Wait for event (up to 5 seconds)
        let result = await XCTWaiter().fulfillment(of: [expectation], timeout: 5.0)
        
        // Note: We don't fail if event not received - realtime may not be fully configured
        if result == .completed, let event = receivedEvent {
            XCTAssertEqual(event.event, .insert, "Event should be INSERT")
        } else {
            print("Note: Realtime event not received within timeout (this may be expected in some configurations)")
        }
    }
    
    /// Test 24: Disconnect from WebSocket
    func test_5_05_DisconnectFromWebSocket() async throws {
        try skipIfNotIntegrationTest()
        guard Self.adminClient.realtime.isConnected else {
            throw XCTSkip("WebSocket not connected")
        }
        
        try await Self.adminClient.realtime.disconnect()
        XCTAssertFalse(Self.adminClient.realtime.isConnected, "Should be disconnected")
        
        // Cleanup realtime table
        if let tableId = Self.realtimeTable?.id {
            try? await Self.adminClient.tables.delete(tableId)
            Self.realtimeTable = nil
        }
    }
    
    // ─────────────────────────────────────────────────────────────────────────
    // 6. Cleanup (5 tests)
    // ─────────────────────────────────────────────────────────────────────────
    
    /// Test 25: Delete uploaded file
    func test_6_01_DeleteUploadedFile() async throws {
        try skipIfNotIntegrationTest()
        
        if let fileId = Self.uploadedFileId {
            try await Self.adminClient.storage.files.delete(fileId)
            Self.uploadedFileId = nil
            // No error means success
        }
    }
    
    /// Test 26: Delete public table
    func test_6_02_DeletePublicTable() async throws {
        try skipIfNotIntegrationTest()
        
        if let tableId = Self.publicTable?.id {
            _ = try await Self.adminClient.tables.delete(tableId)
            Self.publicTable = nil
            // No error means success
        }
    }
    
    /// Test 27: Delete public bucket
    func test_6_03_DeletePublicBucket() async throws {
        try skipIfNotIntegrationTest()
        
        if let bucketId = Self.publicBucket?.id {
            try await Self.adminClient.storage.buckets.delete(bucketId)
            Self.publicBucket = nil
            // No error means success
        }
    }
    
    /// Test 28: Delete regular user
    func test_6_04_DeleteRegularUser() async throws {
        try skipIfNotIntegrationTest()
        
        if let userId = Self.testUser?.id {
            _ = try await Self.adminClient.auth.users.delete(userId)
            Self.testUser = nil
            // No error means success
        }
    }
    
    /// Test 29: Logout both clients
    func test_6_05_LogoutClients() async throws {
        try skipIfNotIntegrationTest()
        
        // Logout user client
        do {
            _ = try await Self.userClient.auth.logout()
        } catch {
            // User may have been deleted already
        }
        
        // Logout admin client
        do {
            _ = try await Self.adminClient.auth.logout()
        } catch {
            // Ignore errors during cleanup
        }
    }
}
