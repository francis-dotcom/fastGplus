import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import { API_KEY } from '../lib/api';
import { RealtimeService } from '../lib/realtime';
import { 
    loginForAccessTokenUsersTokenPost, 
    readUsersMeUsersMeGet,
    refreshAccessTokenUsersTokenRefreshPost,
    logoutUsersLogoutPost
} from '../client/sdk.gen';
import type { UserRead, LoginRequest } from '../client/types.gen';

interface AuthContextType {
    user: UserRead | null;
    token: string | null;
    isAuthenticated: boolean;
    isLoading: boolean;
    realtime: RealtimeService | null;
    login: (data: LoginRequest) => Promise<void>;
    logout: () => Promise<void>;
    refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Token storage keys
const ACCESS_TOKEN_KEY = 'token';
const REFRESH_TOKEN_KEY = 'refresh_token';

export function AuthProvider({ children }: { children: React.ReactNode }) {
    const [user, setUser] = useState<UserRead | null>(null);
    const [token, setToken] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const realtimeRef = useRef<RealtimeService | null>(null);
    const refreshTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Refresh the access token using the refresh token
    const refreshToken = useCallback(async (): Promise<boolean> => {
        const storedRefreshToken = localStorage.getItem(REFRESH_TOKEN_KEY);
        if (!storedRefreshToken) {
            return false;
        }

        try {
            const { data, error } = await refreshAccessTokenUsersTokenRefreshPost({
                body: { refresh_token: storedRefreshToken },
                headers: { 'X-API-Key': API_KEY }
            });

            if (error || !data) {
                // Refresh failed - clear tokens
                localStorage.removeItem(ACCESS_TOKEN_KEY);
                localStorage.removeItem(REFRESH_TOKEN_KEY);
                setToken(null);
                setUser(null);
                return false;
            }

            // Store new tokens
            localStorage.setItem(ACCESS_TOKEN_KEY, data.access_token);
            localStorage.setItem(REFRESH_TOKEN_KEY, data.refresh_token);
            setToken(data.access_token);

            // Schedule next refresh (5 minutes before expiry)
            const refreshInMs = (data.expires_in - 300) * 1000; // 5 min before expiry
            if (refreshTimeoutRef.current) {
                clearTimeout(refreshTimeoutRef.current);
            }
            refreshTimeoutRef.current = setTimeout(() => {
                refreshToken();
            }, Math.max(refreshInMs, 60000)); // At least 1 minute

            return true;
        } catch (error) {
            console.error('Token refresh failed', error);
            localStorage.removeItem(ACCESS_TOKEN_KEY);
            localStorage.removeItem(REFRESH_TOKEN_KEY);
            setToken(null);
            setUser(null);
            return false;
        }
    }, []);

    // Initialize realtime service
    useEffect(() => {
        // Create realtime service with API key
        realtimeRef.current = new RealtimeService(API_KEY, token);
        
        // Connect to realtime service
        realtimeRef.current.connect();
        
        // Cleanup on unmount
        return () => {
            realtimeRef.current?.disconnect();
            if (refreshTimeoutRef.current) {
                clearTimeout(refreshTimeoutRef.current);
            }
        };
    }, []); // Only run once on mount

    // Update realtime token when it changes
    useEffect(() => {
        if (realtimeRef.current) {
            realtimeRef.current.setToken(token);
        }
    }, [token]);

    useEffect(() => {
        const initAuth = async () => {
            const storedToken = localStorage.getItem(ACCESS_TOKEN_KEY);
            const storedRefreshToken = localStorage.getItem(REFRESH_TOKEN_KEY);
            
            if (storedToken) {
                setToken(storedToken);
                try {
                    const { data } = await readUsersMeUsersMeGet({
                        headers: { 'X-API-Key': API_KEY }
                    });
                    if (data) {
                        setUser(data);
                        // Schedule token refresh
                        if (storedRefreshToken) {
                            // Refresh in 25 minutes (assuming 30 min token expiry)
                            refreshTimeoutRef.current = setTimeout(() => {
                                refreshToken();
                            }, 25 * 60 * 1000);
                        }
                    } else {
                        // Token might be invalid, try refresh
                        if (storedRefreshToken) {
                            const refreshed = await refreshToken();
                            if (refreshed) {
                                const { data: userData } = await readUsersMeUsersMeGet({
                                    headers: { 'X-API-Key': API_KEY }
                                });
                                if (userData) {
                                    setUser(userData);
                                }
                            }
                        } else {
                            localStorage.removeItem(ACCESS_TOKEN_KEY);
                            setToken(null);
                        }
                    }
                } catch (error) {
                    console.error('Failed to fetch user', error);
                    // Try refresh token
                    if (storedRefreshToken) {
                        const refreshed = await refreshToken();
                        if (refreshed) {
                            try {
                                const { data: userData } = await readUsersMeUsersMeGet({
                                    headers: { 'X-API-Key': API_KEY }
                                });
                                if (userData) {
                                    setUser(userData);
                                }
                            } catch {
                                // Give up
                            }
                        }
                    } else {
                        localStorage.removeItem(ACCESS_TOKEN_KEY);
                        setToken(null);
                    }
                }
            }
            setIsLoading(false);
        };

        initAuth();
    }, [refreshToken]);

    const login = async (credentials: LoginRequest) => {
        try {
            const { data, error } = await loginForAccessTokenUsersTokenPost({
                body: credentials,
                headers: { 'X-API-Key': API_KEY }
            });

            if (error) {
                throw new Error('Login failed');
            }

            if (data) {
                // Store both tokens
                localStorage.setItem(ACCESS_TOKEN_KEY, data.access_token);
                localStorage.setItem(REFRESH_TOKEN_KEY, data.refresh_token);
                setToken(data.access_token);
                
                // Schedule token refresh (5 minutes before expiry)
                const refreshInMs = (data.expires_in - 300) * 1000;
                if (refreshTimeoutRef.current) {
                    clearTimeout(refreshTimeoutRef.current);
                }
                refreshTimeoutRef.current = setTimeout(() => {
                    refreshToken();
                }, Math.max(refreshInMs, 60000));
                
                // Fetch user details
                const userResponse = await readUsersMeUsersMeGet({
                    headers: { 'X-API-Key': API_KEY }
                });
                if (userResponse.data) {
                    setUser(userResponse.data);
                }
            }
        } catch (error) {
            console.error('Login error', error);
            throw error;
        }
    };

    const logout = async () => {
        try {
            const storedRefreshToken = localStorage.getItem(REFRESH_TOKEN_KEY);
            
            // Call logout endpoint to revoke refresh token
            if (token) {
                await logoutUsersLogoutPost({
                    body: storedRefreshToken ? { refresh_token: storedRefreshToken } : {},
                    headers: { 'X-API-Key': API_KEY }
                });
            }
        } catch (error) {
            console.error('Logout error', error);
            // Continue with local logout even if server logout fails
        } finally {
            // Clear local state
            localStorage.removeItem(ACCESS_TOKEN_KEY);
            localStorage.removeItem(REFRESH_TOKEN_KEY);
            setUser(null);
            setToken(null);
            
            if (refreshTimeoutRef.current) {
                clearTimeout(refreshTimeoutRef.current);
                refreshTimeoutRef.current = null;
            }
        }
    };

    const refreshUser = async () => {
        if (!token) return;
        try {
            const userResponse = await readUsersMeUsersMeGet({
                headers: { 'X-API-Key': API_KEY }
            });
            if (userResponse.data) {
                setUser(userResponse.data);
            }
        } catch (error) {
            console.error('Failed to refresh user', error);
        }
    };

    return (
        <AuthContext.Provider value={{ user, token, isAuthenticated: !!user, isLoading, realtime: realtimeRef.current, login, logout, refreshUser }}>
            {children}
        </AuthContext.Provider>
    );
}

export function useAuth() {
    const context = useContext(AuthContext);
    if (context === undefined) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return context;
}
