## SDK Integration Testing Criteria

The SDK must pass the following integration test scenarios against a running SelfDB instance.

### Prerequisites
- Running SelfDB instance at `http://localhost:8000`
- Valid API key `selfdb-a213f2c0-71cd-8660-074c-ccc9dbde830a`
- Admin credentials (`admin@example.com` / `password`)

### Test Scenarios

#### 1. Client Setup & Authentication
- Initialize two SDK clients (admin + regular user)
- Admin signs in with existing credentials
- Create a new regular user via admin client
- Regular user signs in with new credentials

#### 2. Admin Creates Public Resources
- Create a PUBLIC table with schema: `{ id: UUID, title: TEXT, count: INTEGER }`
- Create a PUBLIC bucket
- Verify both resources return valid IDs

#### 3. Regular User Consumes Public Resources
**Tables:**
- Insert row into public table (should succeed)
- Update row in public table (should fail with 403 - not owner)
- Delete row in public table (should fail with 403 - not owner)

**Storage:**
- Upload file to public bucket (should succeed)
- Download file from public bucket (should succeed, verify content matches)

#### 4. Regular User Manages Own Resources
**Tables:**
- Create private table (should succeed)
- Insert row (should succeed)
- Update own row (should succeed)
- Delete own row (should succeed)
- Delete own table (should succeed)

**Storage:**
- Create private bucket (should succeed)
- Upload file to own bucket (should succeed)
- Delete own bucket (should succeed)

#### 5. Realtime Updates
- Connect to WebSocket
- Admin enables realtime on public table
- Subscribe to `table:{table_name}` topic
- Register callback for `INSERT` event
- Trigger insert via API
- Verify callback receives event within 5 seconds
- Disconnect from WebSocket

#### 6. Cleanup
- Admin deletes public table
- Admin deletes public bucket
- Admin deletes regular user
- Close both clients

### Expected Results
- All permission checks correctly return 403 for unauthorized operations
- All owner operations succeed
- Realtime events propagate within timeout
- No resource leaks after cleanup
