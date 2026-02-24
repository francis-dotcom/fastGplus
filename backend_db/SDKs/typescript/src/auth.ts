/**
 * SelfDB SDK Auth Module
 * 
 * Authentication and user management.
 */

import { HttpClient } from './client';
import {
    UserCreate,
    UserUpdate,
    UserRead,
    LoginRequest,
    TokenPair,
    RefreshRequest,
    LogoutRequest,
    LogoutResponse,
    UserDeleteResponse,
    CountResponse,
    PaginationOptions,
} from './models';

/**
 * Users collection for CRUD operations
 */
export class UsersResource {
    constructor(private client: HttpClient) {}

    /**
     * Create a new user
     * POST /users/
     */
    async create(data: UserCreate): Promise<UserRead> {
        return this.client.post<UserRead>('/users/', data);
    }

    /**
     * List users with optional pagination and search
     * GET /users/
     */
    async list(options: PaginationOptions = {}): Promise<UserRead[]> {
        const query: Record<string, string | number | boolean | undefined> = {
            skip: options.skip,
            limit: options.limit,
            search: options.search,
            sort_by: options.sortBy,
            sort_order: options.sortOrder,
        };
        return this.client.get<UserRead[]>('/users/', query);
    }

    /**
     * Get a user by ID
     * GET /users/{user_id}
     */
    async get(userId: string): Promise<UserRead> {
        return this.client.get<UserRead>(`/users/${userId}`);
    }

    /**
     * Update a user
     * PATCH /users/{user_id}
     */
    async update(userId: string, data: UserUpdate): Promise<UserRead> {
        return this.client.patch<UserRead>(`/users/${userId}`, data);
    }

    /**
     * Delete a user
     * DELETE /users/{user_id}
     */
    async delete(userId: string): Promise<UserDeleteResponse> {
        return this.client.delete<UserDeleteResponse>(`/users/${userId}`);
    }
}

/**
 * Auth module for authentication and user management
 */
export class Auth {
    public readonly users: UsersResource;

    constructor(private client: HttpClient) {
        this.users = new UsersResource(client);
    }

    /**
     * Login with email and password
     * POST /users/token
     */
    async login(credentials: LoginRequest): Promise<TokenPair> {
        const result = await this.client.post<TokenPair>('/users/token', credentials);
        
        // Store tokens in client
        this.client.setAccessToken(result.access_token);
        this.client.setRefreshToken(result.refresh_token);
        
        return result;
    }

    /**
     * Refresh access token
     * POST /users/token/refresh
     */
    async refresh(request: RefreshRequest): Promise<TokenPair> {
        const body = { refresh_token: request.refreshToken };
        const result = await this.client.post<TokenPair>('/users/token/refresh', body);
        
        // Update stored tokens
        this.client.setAccessToken(result.access_token);
        this.client.setRefreshToken(result.refresh_token);
        
        return result;
    }

    /**
     * Logout (revoke refresh token)
     * POST /users/logout
     */
    async logout(request?: LogoutRequest): Promise<LogoutResponse> {
        const body = request?.refreshToken ? { refresh_token: request.refreshToken } : {};
        const result = await this.client.post<LogoutResponse>('/users/logout', body);
        
        // Clear stored tokens
        this.client.setAccessToken(null);
        this.client.setRefreshToken(null);
        
        return result;
    }

    /**
     * Logout from all devices
     * POST /users/logout/all
     */
    async logoutAll(): Promise<LogoutResponse> {
        const result = await this.client.post<LogoutResponse>('/users/logout/all');
        
        // Clear stored tokens
        this.client.setAccessToken(null);
        this.client.setRefreshToken(null);
        
        return result;
    }

    /**
     * Get current user
     * GET /users/me
     */
    async me(): Promise<UserRead> {
        return this.client.get<UserRead>('/users/me');
    }

    /**
     * Get user count
     * GET /users/count
     */
    async count(options: { search?: string } = {}): Promise<CountResponse> {
        const query = options.search ? { search: options.search } : undefined;
        return this.client.get<CountResponse>('/users/count', query);
    }
}
