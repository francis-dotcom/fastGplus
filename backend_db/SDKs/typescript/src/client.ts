/**
 * SelfDB SDK HTTP Client
 * 
 * Base HTTP client for making API requests with authentication and error handling.
 */

import {
    SelfDBError,
    APIConnectionError,
    BadRequestError,
    AuthenticationError,
    PermissionDeniedError,
    NotFoundError,
    ConflictError,
    InternalServerError,
} from './errors';

/**
 * HTTP client configuration
 */
export interface HttpClientConfig {
    baseUrl: string;
    apiKey: string;
    timeout?: number;
}

/**
 * Request options
 */
export interface RequestOptions {
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE' | 'PUT';
    path: string;
    body?: unknown;
    query?: Record<string, string | number | boolean | undefined>;
    headers?: Record<string, string>;
    rawBody?: boolean;
}

/**
 * HTTP Client for SelfDB API
 */
export class HttpClient {
    private baseUrl: string;
    private apiKey: string;
    private timeout: number;
    private accessToken: string | null = null;
    private refreshToken: string | null = null;

    constructor(config: HttpClientConfig) {
        this.baseUrl = config.baseUrl.replace(/\/$/, '');
        this.apiKey = config.apiKey;
        this.timeout = config.timeout ?? 30000;
    }

    /**
     * Set the access token for authenticated requests
     */
    setAccessToken(token: string | null): void {
        this.accessToken = token;
    }

    /**
     * Get the current access token
     */
    getAccessToken(): string | null {
        return this.accessToken;
    }

    /**
     * Set the refresh token
     */
    setRefreshToken(token: string | null): void {
        this.refreshToken = token;
    }

    /**
     * Get the current refresh token
     */
    getRefreshToken(): string | null {
        return this.refreshToken;
    }

    /**
     * Build query string from parameters
     */
    private buildQueryString(query?: Record<string, string | number | boolean | undefined>): string {
        if (!query) return '';
        
        const params = new URLSearchParams();
        for (const [key, value] of Object.entries(query)) {
            if (value !== undefined && value !== null) {
                params.append(key, String(value));
            }
        }
        
        const queryString = params.toString();
        return queryString ? `?${queryString}` : '';
    }

    /**
     * Handle API errors based on status code
     */
    private handleError(status: number, data: unknown): never {
        // Extract message from various response formats
        let message = 'An error occurred';
        const dataObj = data as { detail?: string | Array<{ msg?: string }> };
        
        if (typeof dataObj?.detail === 'string') {
            message = dataObj.detail;
        } else if (Array.isArray(dataObj?.detail) && dataObj.detail.length > 0) {
            // Validation error format
            message = dataObj.detail.map(e => e.msg || String(e)).join('; ');
        }

        switch (status) {
            case 400:
                throw new BadRequestError(message, data);
            case 401:
                throw new AuthenticationError(message, data);
            case 403:
                throw new PermissionDeniedError(message, data);
            case 404:
                throw new NotFoundError(message, data);
            case 409:
                throw new ConflictError(message, data);
            case 422:
                throw new BadRequestError(message, data);
            case 500:
            case 502:
            case 503:
            case 504:
                throw new InternalServerError(message, data);
            default:
                throw new SelfDBError(message, status, 'UNKNOWN_ERROR', data);
        }
    }

    /**
     * Make an HTTP request
     */
    async request<T>(options: RequestOptions): Promise<T> {
        const { method, path, body, query, headers = {}, rawBody = false } = options;
        const url = `${this.baseUrl}${path}${this.buildQueryString(query)}`;

        // Build headers
        const requestHeaders: Record<string, string> = {
            'X-API-Key': this.apiKey,
            ...headers,
        };

        // Add authorization header if we have an access token
        if (this.accessToken) {
            requestHeaders['Authorization'] = `Bearer ${this.accessToken}`;
        }

        // Add content type for JSON bodies
        if (body && !rawBody) {
            requestHeaders['Content-Type'] = 'application/json';
        }

        // Set up abort controller for timeout
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeout);

        try {
            const response = await fetch(url, {
                method,
                headers: requestHeaders,
                body: rawBody ? (body as BodyInit) : (body ? JSON.stringify(body) : undefined),
                signal: controller.signal,
            });

            clearTimeout(timeoutId);

            // Handle no content responses
            if (response.status === 204) {
                return {} as T;
            }

            // Parse response based on content type
            const contentType = response.headers.get('content-type');
            let data: unknown;

            if (contentType?.includes('application/json')) {
                data = await response.json();
            } else if (contentType?.includes('application/octet-stream') || contentType?.includes('image/') || contentType?.includes('audio/') || contentType?.includes('video/')) {
                data = await response.arrayBuffer();
            } else {
                data = await response.text();
            }

            // Handle error responses
            if (!response.ok) {
                this.handleError(response.status, data);
            }

            return data as T;
        } catch (error) {
            clearTimeout(timeoutId);

            if (error instanceof SelfDBError) {
                throw error;
            }

            if (error instanceof Error) {
                if (error.name === 'AbortError') {
                    throw new APIConnectionError('Request timed out');
                }
                throw new APIConnectionError(error.message);
            }

            throw new APIConnectionError('An unknown error occurred');
        }
    }

    /**
     * GET request
     */
    async get<T>(path: string, query?: Record<string, string | number | boolean | undefined>, headers?: Record<string, string>): Promise<T> {
        return this.request<T>({ method: 'GET', path, query, headers });
    }

    /**
     * POST request
     */
    async post<T>(path: string, body?: unknown, query?: Record<string, string | number | boolean | undefined>, headers?: Record<string, string>): Promise<T> {
        return this.request<T>({ method: 'POST', path, body, query, headers });
    }

    /**
     * POST request with raw body (for file uploads)
     */
    async postRaw<T>(path: string, body: BodyInit, query?: Record<string, string | number | boolean | undefined>, headers?: Record<string, string>): Promise<T> {
        return this.request<T>({ method: 'POST', path, body, query, headers, rawBody: true });
    }

    /**
     * PATCH request
     */
    async patch<T>(path: string, body?: unknown, query?: Record<string, string | number | boolean | undefined>, headers?: Record<string, string>): Promise<T> {
        return this.request<T>({ method: 'PATCH', path, body, query, headers });
    }

    /**
     * DELETE request
     */
    async delete<T>(path: string, query?: Record<string, string | number | boolean | undefined>, headers?: Record<string, string>): Promise<T> {
        return this.request<T>({ method: 'DELETE', path, query, headers });
    }
}
