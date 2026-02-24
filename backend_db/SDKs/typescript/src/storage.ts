/**
 * SelfDB SDK Storage Module
 * 
 * Bucket and file management for storage operations.
 */

import { HttpClient } from './client';
import {
    BucketCreate,
    BucketUpdate,
    BucketResponse,
    FileUploadResponse,
    FileResponse,
    FileDataResponse,
    StorageStatsResponse,
    CountResponse,
    PaginationOptions,
} from './models';

/**
 * Buckets resource for bucket CRUD operations
 */
export class BucketsResource {
    constructor(private client: HttpClient) {}

    /**
     * Get bucket count
     * GET /storage/buckets/count
     */
    async count(options: { search?: string } = {}): Promise<CountResponse> {
        const query = options.search ? { search: options.search } : undefined;
        return this.client.get<CountResponse>('/storage/buckets/count', query);
    }

    /**
     * Create a bucket
     * POST /storage/buckets/
     */
    async create(bucket: BucketCreate): Promise<BucketResponse> {
        return this.client.post<BucketResponse>('/storage/buckets/', bucket);
    }

    /**
     * List buckets with optional pagination and search
     * GET /storage/buckets/
     */
    async list(options: PaginationOptions = {}): Promise<BucketResponse[]> {
        const query: Record<string, string | number | boolean | undefined> = {
            skip: options.skip,
            limit: options.limit,
            search: options.search,
            sort_by: options.sortBy,
            sort_order: options.sortOrder,
        };
        return this.client.get<BucketResponse[]>('/storage/buckets/', query);
    }

    /**
     * Get a bucket by ID
     * GET /storage/buckets/{bucket_id}
     */
    async get(bucketId: string): Promise<BucketResponse> {
        return this.client.get<BucketResponse>(`/storage/buckets/${bucketId}`);
    }

    /**
     * Update a bucket
     * PATCH /storage/buckets/{bucket_id}
     */
    async update(bucketId: string, updates: BucketUpdate): Promise<BucketResponse> {
        return this.client.patch<BucketResponse>(`/storage/buckets/${bucketId}`, updates);
    }

    /**
     * Delete a bucket
     * DELETE /storage/buckets/{bucket_id}
     */
    async delete(bucketId: string): Promise<void> {
        await this.client.delete<void>(`/storage/buckets/${bucketId}`);
    }
}

/**
 * Files resource for file operations
 */
export class FilesResource {
    constructor(private client: HttpClient) {}

    /**
     * Get storage statistics
     * GET /storage/files/stats
     */
    async stats(): Promise<StorageStatsResponse> {
        return this.client.get<StorageStatsResponse>('/storage/files/stats');
    }

    /**
     * Get total file count
     * GET /storage/files/total-count
     */
    async totalCount(options: { search?: string } = {}): Promise<CountResponse> {
        const query = options.search ? { search: options.search } : undefined;
        return this.client.get<CountResponse>('/storage/files/total-count', query);
    }

    /**
     * Get file count for a bucket
     * GET /storage/files/count
     */
    async count(options: { bucketId?: string; search?: string } = {}): Promise<CountResponse> {
        const query: Record<string, string | number | boolean | undefined> = {
            bucket_id: options.bucketId,
            search: options.search,
        };
        return this.client.get<CountResponse>('/storage/files/count', query);
    }

    /**
     * Upload a file to a bucket
     * POST /storage/files/upload
     * NOTE: Uses raw bytes body with query params (not multipart)
     */
    async upload(
        bucketId: string,
        options: {
            filename: string;
            data: ArrayBuffer | Uint8Array | Blob | string;
            path?: string;
            contentType?: string;
        }
    ): Promise<FileUploadResponse> {
        const query: Record<string, string | number | boolean | undefined> = {
            bucket_id: bucketId,
            filename: options.filename,
            path: options.path,
        };

        const headers: Record<string, string> = {};
        if (options.contentType) {
            headers['Content-Type'] = options.contentType;
        } else {
            headers['Content-Type'] = 'application/octet-stream';
        }

        // Convert data to appropriate format for fetch
        let body: Blob;
        if (typeof options.data === 'string') {
            body = new Blob([options.data]);
        } else if (options.data instanceof Blob) {
            body = options.data;
        } else if (options.data instanceof ArrayBuffer) {
            body = new Blob([options.data]);
        } else {
            // Uint8Array - create a new ArrayBuffer copy to avoid SharedArrayBuffer issues
            const copy = new Uint8Array(options.data).buffer;
            body = new Blob([copy]);
        }

        return this.client.postRaw<FileUploadResponse>('/storage/files/upload', body, query, headers);
    }

    /**
     * List files with optional pagination
     * GET /storage/files/
     */
    async list(options: {
        bucketId?: string;
        skip?: number;
        limit?: number;
        pageSize?: number;
        search?: string;
    } = {}): Promise<FileDataResponse> {
        const query: Record<string, string | number | boolean | undefined> = {
            bucket_id: options.bucketId,
            skip: options.skip,
            limit: options.limit,
            page_size: options.pageSize,
            search: options.search,
        };
        return this.client.get<FileDataResponse>('/storage/files/', query);
    }

    /**
     * Get a file by ID
     * GET /storage/files/{file_id}
     */
    async get(fileId: string): Promise<FileResponse> {
        return this.client.get<FileResponse>(`/storage/files/${fileId}`);
    }

    /**
     * Delete a file
     * DELETE /storage/files/{file_id}
     */
    async delete(fileId: string): Promise<void> {
        await this.client.delete<void>(`/storage/files/${fileId}`);
    }

    /**
     * Update file metadata
     * PATCH /storage/files/{file_id}
     */
    async updateMetadata(fileId: string, metadata: Record<string, unknown>): Promise<FileResponse> {
        return this.client.patch<FileResponse>(`/storage/files/${fileId}`, { metadata });
    }

    /**
     * Download a file by bucket name and path
     * GET /storage/files/download/{bucket_name}/{path}
     */
    async download(options: { bucketName: string; path: string }): Promise<ArrayBuffer> {
        const path = options.path.startsWith('/') ? options.path.slice(1) : options.path;
        return this.client.get<ArrayBuffer>(`/storage/files/download/${options.bucketName}/${path}`);
    }
}

/**
 * Storage module for bucket and file management
 */
export class Storage {
    public readonly buckets: BucketsResource;
    public readonly files: FilesResource;

    constructor(client: HttpClient) {
        this.buckets = new BucketsResource(client);
        this.files = new FilesResource(client);
    }
}
