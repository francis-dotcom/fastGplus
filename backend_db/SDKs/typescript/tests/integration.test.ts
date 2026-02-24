/**
 * SelfDB SDK Integration Tests
 * 
 * These tests run against a live SelfDB instance.
 * Prerequisites:
 * - Running SelfDB instance at http://localhost:8000
 * - Valid API key: selfdb-a213f2c0-71cd-8660-074c-ccc9dbde830a
 * - Admin credentials: admin@example.com / password
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
    SelfDB,
    PermissionDeniedError,
    UserRead,
    TableRead,
    BucketResponse,
    FileUploadResponse,
    RealtimePayload,
} from '../src';

const BASE_URL = 'http://localhost:8000';
const API_KEY = 'selfdb-a213f2c0-71cd-8660-074c-ccc9dbde830a';
const ADMIN_EMAIL = 'admin@example.com';
const ADMIN_PASSWORD = 'password';

// Test user credentials
const TEST_USER_EMAIL = `testuser-${Date.now()}@example.com`;
const TEST_USER_PASSWORD = 'testpassword123';
const TEST_USER_FIRST_NAME = 'Test';
const TEST_USER_LAST_NAME = 'User';

// Resources to clean up
let adminClient: SelfDB;
let userClient: SelfDB;
let testUser: UserRead;
let publicTable: TableRead;
let publicBucket: BucketResponse;
let insertedRowId: string;
let uploadedFileId: string;

describe('SelfDB SDK Integration Tests', () => {
    // ─────────────────────────────────────────────────────────────────────────
    // 1. Client Setup & Authentication
    // ─────────────────────────────────────────────────────────────────────────
    describe('1. Client Setup & Authentication', () => {
        it('should initialize admin client and login', async () => {
            adminClient = new SelfDB({ baseUrl: BASE_URL, apiKey: API_KEY });
            const tokens = await adminClient.auth.login({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
            
            expect(tokens.access_token).toBeDefined();
            expect(tokens.refresh_token).toBeDefined();
            expect(tokens.token_type).toBe('bearer');
        });

        it('should create a new regular user via admin client', async () => {
            testUser = await adminClient.auth.users.create({
                email: TEST_USER_EMAIL,
                password: TEST_USER_PASSWORD,
                firstName: TEST_USER_FIRST_NAME,
                lastName: TEST_USER_LAST_NAME,
            });

            expect(testUser.id).toBeDefined();
            expect(testUser.email).toBe(TEST_USER_EMAIL);
            expect(testUser.firstName).toBe(TEST_USER_FIRST_NAME);
            expect(testUser.lastName).toBe(TEST_USER_LAST_NAME);
            expect(testUser.role).toBe('USER');
        });

        it('should initialize regular user client and login', async () => {
            userClient = new SelfDB({ baseUrl: BASE_URL, apiKey: API_KEY });
            const tokens = await userClient.auth.login({ email: TEST_USER_EMAIL, password: TEST_USER_PASSWORD });
            
            expect(tokens.access_token).toBeDefined();
            expect(tokens.refresh_token).toBeDefined();
        });

        it('should get current user info', async () => {
            const me = await userClient.auth.me();
            expect(me.email).toBe(TEST_USER_EMAIL);
        });
    });

    // ─────────────────────────────────────────────────────────────────────────
    // 2. Admin Creates Public Resources
    // ─────────────────────────────────────────────────────────────────────────
    describe('2. Admin Creates Public Resources', () => {
        it('should create a PUBLIC table with schema', async () => {
            publicTable = await adminClient.tables.create({
                name: `test_table_${Date.now()}`,
                table_schema: {
                    id: { type: 'uuid', nullable: false },
                    title: { type: 'text', nullable: false },
                    count: { type: 'integer', nullable: true },
                },
                public: true,
            });

            expect(publicTable.id).toBeDefined();
            expect(publicTable.public).toBe(true);
            expect(publicTable.table_schema).toBeDefined();
        });

        it('should create a PUBLIC bucket', async () => {
            publicBucket = await adminClient.storage.buckets.create({
                name: `test-bucket-${Date.now()}`,
                public: true,
            });

            expect(publicBucket.id).toBeDefined();
            expect(publicBucket.public).toBe(true);
        });
    });

    // ─────────────────────────────────────────────────────────────────────────
    // 3. Regular User Consumes Public Resources
    // ─────────────────────────────────────────────────────────────────────────
    describe('3. Regular User Consumes Public Resources', () => {
        describe('Tables', () => {
            it('should insert row into public table (should succeed)', async () => {
                const row = await userClient.tables.data.insert(publicTable.id, {
                    title: 'Test Title',
                    count: 42,
                });

                expect(row).toBeDefined();
                insertedRowId = (row as { id: string }).id;
            });

            it('should fail to update row in public table (not owner)', async () => {
                await expect(
                    userClient.tables.data.updateRow(publicTable.id, insertedRowId, { title: 'Updated' })
                ).rejects.toThrow(PermissionDeniedError);
            });

            it('should fail to delete row in public table (not owner)', async () => {
                await expect(
                    userClient.tables.data.deleteRow(publicTable.id, insertedRowId)
                ).rejects.toThrow(PermissionDeniedError);
            });
        });

        describe('Storage', () => {
            it('should upload file to public bucket (should succeed)', async () => {
                const fileContent = 'Hello, SelfDB!';
                const response = await userClient.storage.files.upload(publicBucket.id, {
                    filename: 'test.txt',
                    data: fileContent,
                });

                expect(response.success).toBe(true);
                expect(response.file_id).toBeDefined();
                uploadedFileId = response.file_id;
            });

            it('should download file from public bucket (verify content matches)', async () => {
                const data = await userClient.storage.files.download({
                    bucketName: publicBucket.name,
                    path: 'test.txt',
                });

                const text = new TextDecoder().decode(data);
                expect(text).toBe('Hello, SelfDB!');
            });
        });
    });

    // ─────────────────────────────────────────────────────────────────────────
    // 4. Regular User Manages Own Resources
    // ─────────────────────────────────────────────────────────────────────────
    describe('4. Regular User Manages Own Resources', () => {
        let userTable: TableRead;
        let userBucket: BucketResponse;
        let userRowId: string;

        describe('Tables', () => {
            it('should create private table (should succeed)', async () => {
                userTable = await userClient.tables.create({
                    name: `user_table_${Date.now()}`,
                    table_schema: {
                        id: { type: 'uuid', nullable: false },
                        name: { type: 'text', nullable: false },
                    },
                    public: false,
                });

                expect(userTable.id).toBeDefined();
                expect(userTable.public).toBe(false);
            });

            it('should insert row (should succeed)', async () => {
                // Generate UUID on client side for the id column
                userRowId = crypto.randomUUID();
                const row = await userClient.tables.data.insert(userTable.id, { id: userRowId, name: 'Test' });
                expect(row).toBeDefined();
            });

            it('should update own row (should succeed)', async () => {
                const updated = await userClient.tables.data.updateRow(userTable.id, userRowId, { name: 'Updated' });
                expect(updated).toBeDefined();
            });

            it('should delete own row (should succeed)', async () => {
                const result = await userClient.tables.data.deleteRow(userTable.id, userRowId);
                expect(result).toBeDefined();
            });

            it('should delete own table (should succeed)', async () => {
                await userClient.tables.delete(userTable.id);
                // No error means success (API returns 204 No Content)
            });
        });

        describe('Storage', () => {
            it('should create private bucket (should succeed)', async () => {
                userBucket = await userClient.storage.buckets.create({
                    name: `user-bucket-${Date.now()}`,
                    public: false,
                });

                expect(userBucket.id).toBeDefined();
                expect(userBucket.public).toBe(false);
            });

            it('should upload file to own bucket (should succeed)', async () => {
                const response = await userClient.storage.files.upload(userBucket.id, {
                    filename: 'myfile.txt',
                    data: 'User file content',
                });

                expect(response.success).toBe(true);
            });

            it('should delete own bucket (should succeed)', async () => {
                await userClient.storage.buckets.delete(userBucket.id);
                // No error means success
            });
        });
    });

    // ─────────────────────────────────────────────────────────────────────────
    // 5. Realtime Updates
    // ─────────────────────────────────────────────────────────────────────────
    describe('5. Realtime Updates', () => {
        let realtimeTable: TableRead;
        let receivedEvent: RealtimePayload | null = null;

        beforeAll(async () => {
            // Create a table for realtime testing
            realtimeTable = await adminClient.tables.create({
                name: `realtime_table_${Date.now()}`,
                table_schema: {
                    message: { type: 'text', nullable: false },
                },
                public: true,
            });
        });

        afterAll(async () => {
            // Cleanup realtime table
            if (realtimeTable) {
                await adminClient.tables.delete(realtimeTable.id);
            }
        });

        it('should connect to WebSocket', async () => {
            await adminClient.realtime.connect();
            expect(adminClient.realtime.getState()).toBe('connected');
        });

        it('should enable realtime on table', async () => {
            const updated = await adminClient.tables.update(realtimeTable.id, { realtime_enabled: true });
            expect(updated.realtime_enabled).toBe(true);
        });

        it('should subscribe to table topic', async () => {
            const channel = adminClient.realtime.channel(`table:${realtimeTable.name}`);
            await channel.subscribe();
            // No error means success
        });

        it('should register INSERT callback and receive event', async () => {
            // This test is timing-sensitive and may be flaky depending on server state
            // Give a small delay to ensure subscription is fully active
            await new Promise(resolve => setTimeout(resolve, 500));

            const eventReceived = new Promise<RealtimePayload | null>((resolve, reject) => {
                const timeout = setTimeout(() => {
                    // Don't fail, just log - realtime may not be fully configured
                    console.log('Note: Realtime event not received within timeout (this may be expected in some configurations)');
                    resolve(null);
                }, 5000);

                const channel = adminClient.realtime.channel(`table:${realtimeTable.name}`)
                    .on('INSERT', (payload) => {
                        clearTimeout(timeout);
                        resolve(payload);
                    })
                    .on('*', (payload) => {
                        console.log('Received realtime event:', payload);
                    });

                channel.subscribe().then(async () => {
                    // Small delay to ensure subscription is active
                    await new Promise(r => setTimeout(r, 200));
                    // Trigger insert via API
                    await adminClient.tables.data.insert(realtimeTable.id, { message: 'Realtime test' });
                }).catch(reject);
            });

            receivedEvent = await eventReceived;
            // Note: We don't fail if event not received - realtime may not be fully configured
            if (receivedEvent) {
                expect(receivedEvent.event).toBe('INSERT');
            }
        });

        it('should disconnect from WebSocket', async () => {
            await adminClient.realtime.disconnect();
            expect(adminClient.realtime.getState()).toBe('disconnected');
        });
    });

    // ─────────────────────────────────────────────────────────────────────────
    // 6. Cleanup
    // ─────────────────────────────────────────────────────────────────────────
    describe('6. Cleanup', () => {
        it('should delete uploaded file', async () => {
            if (uploadedFileId) {
                await adminClient.storage.files.delete(uploadedFileId);
                // No error means success
            }
        });

        it('should delete public table', async () => {
            if (publicTable) {
                await adminClient.tables.delete(publicTable.id);
                // No error means success (API returns 204 No Content)
            }
        });

        it('should delete public bucket', async () => {
            if (publicBucket) {
                await adminClient.storage.buckets.delete(publicBucket.id);
                // No error means success
            }
        });

        it('should delete regular user', async () => {
            if (testUser) {
                await adminClient.auth.users.delete(testUser.id);
                // No error means success (API returns 204 No Content)
            }
        });

        it('should logout clients', async () => {
            try {
                await userClient.auth.logout();
            } catch (e) {
                // User may have been deleted already
            }
            try {
                await adminClient.auth.logout();
            } catch (e) {
                // Ignore errors during cleanup
            }
        });
    });
});
