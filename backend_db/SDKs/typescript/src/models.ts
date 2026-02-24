/**
 * SelfDB SDK Models
 * 
 * TypeScript interfaces and types for the SelfDB API.
 */

// ─────────────────────────────────────────────────────────────────────────────
// User Models
// ─────────────────────────────────────────────────────────────────────────────

/**
 * User role enum (uppercase values)
 */
export type UserRole = 'USER' | 'ADMIN';

/**
 * Request model for creating a user
 * NOTE: API uses camelCase for firstName/lastName
 */
export interface UserCreate {
    email: string;
    password: string;
    firstName: string;
    lastName: string;
    role?: UserRole;
}

/**
 * Request model for updating a user (all fields optional)
 */
export interface UserUpdate {
    firstName?: string;
    lastName?: string;
    password?: string;
    role?: UserRole;
}

/**
 * User response model
 */
export interface UserRead {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    role: UserRole;
    createdAt: string;
    updatedAt: string;
}

/**
 * Login request
 */
export interface LoginRequest {
    email: string;
    password: string;
}

/**
 * Token pair response (access + refresh tokens)
 */
export interface TokenPair {
    access_token: string;
    refresh_token: string;
    token_type: string;
}

/**
 * Refresh token request
 */
export interface RefreshRequest {
    refreshToken: string;
}

/**
 * Logout request
 */
export interface LogoutRequest {
    refreshToken?: string;
}

/**
 * Logout response
 */
export interface LogoutResponse {
    message: string;
}

/**
 * User delete response
 */
export interface UserDeleteResponse {
    message: string;
    user_id: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Table Models
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Supported column types
 */
export type ColumnType = 'text' | 'varchar' | 'integer' | 'bigint' | 'boolean' | 'timestamp' | 'jsonb' | 'uuid';

/**
 * Column schema definition (flat object format, not JSON Schema)
 */
export interface ColumnSchema {
    type: ColumnType;
    nullable?: boolean;
    default?: unknown;
}

/**
 * Table schema as flat object mapping column names to schemas
 */
export interface TableSchema {
    [columnName: string]: ColumnSchema;
}

/**
 * Request model for creating a table
 */
export interface TableCreate {
    name: string;
    table_schema: TableSchema;
    public: boolean;
}

/**
 * Request model for updating a table
 * NOTE: Uses realtime_enabled (not realtime)
 */
export interface TableUpdate {
    name?: string;
    public?: boolean;
    realtime_enabled?: boolean;
}

/**
 * Column definition for adding a new column
 */
export interface ColumnDefinition {
    name: string;
    type: ColumnType;
    nullable?: boolean;
    default_value?: unknown;
}

/**
 * Column update model
 */
export interface ColumnUpdate {
    new_name?: string;
    type?: ColumnType;
    nullable?: boolean;
    default_value?: unknown;
}

/**
 * Table response model
 */
export interface TableRead {
    id: string;
    name: string;
    table_schema: TableSchema;
    public: boolean;
    realtime_enabled: boolean;
    owner_id: string;
    created_at: string;
    updated_at: string;
}

/**
 * Table data response with pagination metadata
 */
export interface TableDataResponse {
    data: Record<string, unknown>[];
    total: number;
    page: number;
    pageSize: number;
}

/**
 * Table delete response
 */
export interface TableDeleteResponse {
    message: string;
    table_id: string;
}

/**
 * Row delete response
 */
export interface RowDeleteResponse {
    message: string;
    row_id: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Storage Models
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Request model for creating a bucket
 */
export interface BucketCreate {
    name: string;
    public: boolean;
}

/**
 * Request model for updating a bucket
 */
export interface BucketUpdate {
    name?: string;
    public?: boolean;
}

/**
 * Bucket response model
 */
export interface BucketResponse {
    id: string;
    name: string;
    public: boolean;
    owner_id: string;
    created_at: string;
    updated_at: string;
    file_count?: number;
    total_size?: number;
}

/**
 * File upload response
 */
export interface FileUploadResponse {
    success: boolean;
    bucket: string;
    path: string;
    size: number;
    file_id: string;
}

/**
 * File response model
 */
export interface FileResponse {
    id: string;
    bucket_id: string;
    bucket_name: string;
    name: string;
    path: string;
    size: number;
    mime_type: string;
    metadata?: Record<string, unknown>;
    created_at: string;
    updated_at: string;
}

/**
 * File data response with pagination
 */
export interface FileDataResponse {
    data: FileResponse[];
    total: number;
    page: number;
    pageSize: number;
}

/**
 * Storage statistics response
 */
export interface StorageStatsResponse {
    total_files: number;
    total_size: number;
    buckets_count: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Realtime Models
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Realtime event types
 */
export type RealtimeEvent = 'INSERT' | 'UPDATE' | 'DELETE';

/**
 * Realtime payload received in callbacks
 */
export interface RealtimePayload {
    event: RealtimeEvent;
    table: string;
    new: Record<string, unknown> | null;
    old: Record<string, unknown> | null;
    raw: unknown;
}

/**
 * Realtime event callback type
 */
export type RealtimeCallback = (payload: RealtimePayload) => void;

// ─────────────────────────────────────────────────────────────────────────────
// Common Models
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Count response
 */
export interface CountResponse {
    count: number;
}

/**
 * Sort order
 */
export type SortOrder = 'asc' | 'desc';

/**
 * Pagination options
 */
export interface PaginationOptions {
    skip?: number;
    limit?: number;
    search?: string;
    sortBy?: string;
    sortOrder?: SortOrder;
}

/**
 * Validation error detail
 */
export interface ValidationErrorDetail {
    loc: (string | number)[];
    msg: string;
    type: string;
}

/**
 * HTTP Validation Error response
 */
export interface HTTPValidationError {
    detail: ValidationErrorDetail[];
}

/**
 * Generic error response
 */
export interface ErrorResponse {
    detail: string;
}
