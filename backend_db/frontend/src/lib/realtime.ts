/**
 * Realtime WebSocket Service
 * 
 * Provides WebSocket connection to the SelfDB realtime service via Phoenix Channels.
 * The backend proxies WebSocket connections to the internal Phoenix server.
 * 
 * Usage:
 *   const realtime = new RealtimeService(apiKey, token);
 *   realtime.connect();
 *   
 *   const channel = realtime.channel('table:users');
 *   channel.on('INSERT', (payload) => console.log('New user:', payload));
 *   channel.on('UPDATE', (payload) => console.log('Updated user:', payload));
 *   channel.on('DELETE', (payload) => console.log('Deleted user:', payload));
 *   channel.on('*', (payload) => console.log('Any change:', payload));
 *   channel.subscribe();
 *   
 *   // Later:
 *   channel.unsubscribe();
 *   realtime.disconnect();
 */

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type RealtimeEvent = 'INSERT' | 'UPDATE' | 'DELETE' | '*';

export interface RealtimePayload {
    event: RealtimeEvent;
    table: string;
    new: Record<string, unknown> | null;
    old: Record<string, unknown> | null;
}

export type RealtimeCallback = (payload: RealtimePayload) => void;

interface PhoenixMessage {
    topic: string;
    event: string;
    payload: unknown;
    ref: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Channel Class
// ─────────────────────────────────────────────────────────────────────────────

export class RealtimeChannel {
    private topic: string;
    private service: RealtimeService;
    private callbacks: Map<RealtimeEvent | '*', Set<RealtimeCallback>> = new Map();
    private joined: boolean = false;
    private ref: number = 0;

    constructor(topic: string, service: RealtimeService) {
        this.topic = topic;
        this.service = service;
    }

    /**
     * Register a callback for a specific event type
     */
    on(event: RealtimeEvent | '*', callback: RealtimeCallback): this {
        if (!this.callbacks.has(event)) {
            this.callbacks.set(event, new Set());
        }
        this.callbacks.get(event)!.add(callback);
        return this;
    }

    /**
     * Remove a callback for a specific event type
     */
    off(event: RealtimeEvent | '*', callback: RealtimeCallback): this {
        this.callbacks.get(event)?.delete(callback);
        return this;
    }

    /**
     * Subscribe to the channel (join the Phoenix channel)
     */
    subscribe(): this {
        if (this.joined) return this;

        this.service._send({
            topic: this.topic,
            event: 'phx_join',
            payload: {},
            ref: String(++this.ref),
        });
        this.joined = true;
        return this;
    }

    /**
     * Unsubscribe from the channel (leave the Phoenix channel)
     */
    unsubscribe(): void {
        if (!this.joined) return;

        this.service._send({
            topic: this.topic,
            event: 'phx_leave',
            payload: {},
            ref: String(++this.ref),
        });
        this.joined = false;
        this.service._removeChannel(this.topic);
    }

    /**
     * Internal: Handle incoming message for this channel
     */
    _handleMessage(event: string, payload: unknown): void {
        // Handle Phoenix system events
        if (event === 'phx_reply' || event === 'phx_close') {
            return;
        }

        // Handle realtime events (INSERT, UPDATE, DELETE)
        const realtimePayload = payload as RealtimePayload;
        
        // Normalize the event name to uppercase for callback lookup
        // Phoenix sends lowercase ('insert', 'update', 'delete') but we register with uppercase
        const normalizedEvent = (realtimePayload.event || event).toUpperCase() as RealtimeEvent;
        
        console.log(`[Realtime Channel] ${this.topic} received event: ${event}, payload.event: ${realtimePayload.event}, normalized: ${normalizedEvent}`);
        
        // Call specific event callbacks
        const eventCallbacks = this.callbacks.get(normalizedEvent);
        eventCallbacks?.forEach(cb => cb(realtimePayload));

        // Call wildcard callbacks
        const wildcardCallbacks = this.callbacks.get('*');
        wildcardCallbacks?.forEach(cb => cb(realtimePayload));
    }

    get isJoined(): boolean {
        return this.joined;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Realtime Service Class
// ─────────────────────────────────────────────────────────────────────────────

export class RealtimeService {
    private ws: WebSocket | null = null;
    private apiKey: string;
    private token: string | null;
    private channels: Map<string, RealtimeChannel> = new Map();
    private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
    private reconnectAttempts: number = 0;
    private maxReconnectAttempts: number = 10;
    private reconnectDelay: number = 1000;
    private heartbeatRef: number = 0;
    private onConnectCallbacks: Set<() => void> = new Set();
    private onDisconnectCallbacks: Set<() => void> = new Set();

    constructor(apiKey: string, token: string | null = null) {
        this.apiKey = apiKey;
        this.token = token;
    }

    /**
     * Update the JWT token (e.g., after login)
     */
    setToken(token: string | null): void {
        this.token = token;
        // Reconnect with new token if already connected
        if (this.ws?.readyState === WebSocket.OPEN) {
            this.disconnect();
            this.connect();
        }
    }

    /**
     * Connect to the realtime service
     */
    connect(): void {
        if (this.ws?.readyState === WebSocket.OPEN) {
            return;
        }

        const wsUrl = this.buildWebSocketUrl();
        this.ws = new WebSocket(wsUrl);

        this.ws.onopen = () => {
            console.log('[Realtime] Connected');
            this.reconnectAttempts = 0;
            this.startHeartbeat();
            this.onConnectCallbacks.forEach(cb => cb());
            
            // Rejoin all channels after reconnect
            this.channels.forEach(channel => {
                if (channel.isJoined) {
                    channel.subscribe();
                }
            });
        };

        this.ws.onmessage = (event) => {
            try {
                const message: PhoenixMessage = JSON.parse(event.data);
                this.handleMessage(message);
            } catch (e) {
                console.error('[Realtime] Failed to parse message:', e);
            }
        };

        this.ws.onclose = () => {
            console.log('[Realtime] Disconnected');
            this.stopHeartbeat();
            this.onDisconnectCallbacks.forEach(cb => cb());
            this.attemptReconnect();
        };

        this.ws.onerror = (error) => {
            console.error('[Realtime] WebSocket error:', error);
        };
    }

    /**
     * Disconnect from the realtime service
     */
    disconnect(): void {
        this.stopHeartbeat();
        this.reconnectAttempts = this.maxReconnectAttempts; // Prevent reconnect
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
    }

    /**
     * Create or get a channel for a topic
     */
    channel(topic: string): RealtimeChannel {
        if (!this.channels.has(topic)) {
            this.channels.set(topic, new RealtimeChannel(topic, this));
        }
        return this.channels.get(topic)!;
    }

    /**
     * Register a callback for when connected
     */
    onConnect(callback: () => void): void {
        this.onConnectCallbacks.add(callback);
    }

    /**
     * Register a callback for when disconnected
     */
    onDisconnect(callback: () => void): void {
        this.onDisconnectCallbacks.add(callback);
    }

    /**
     * Check if connected
     */
    get isConnected(): boolean {
        return this.ws?.readyState === WebSocket.OPEN;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Internal Methods
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Internal: Send a message through the WebSocket
     */
    _send(message: PhoenixMessage): void {
        if (this.ws?.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(message));
        } else {
            console.warn('[Realtime] Cannot send message, not connected');
        }
    }

    /**
     * Internal: Remove a channel from tracking
     */
    _removeChannel(topic: string): void {
        this.channels.delete(topic);
    }

    private buildWebSocketUrl(): string {
        // Determine base URL based on environment
        const isDevMode = import.meta.env.DEV;
        let baseUrl: string;

        if (isDevMode) {
            // Development: use VITE_DEV_API_URL or localhost
            const devApiUrl = import.meta.env.VITE_DEV_API_URL || 'http://localhost:8000';
            baseUrl = devApiUrl.replace(/^http/, 'ws');
        } else {
            // Production: use current origin with /api proxy
            const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            baseUrl = `${protocol}//${window.location.host}/api`;
        }

        // Build query params
        const params = new URLSearchParams();
        params.set('X-API-Key', this.apiKey);
        if (this.token) {
            params.set('token', this.token);
        }

        return `${baseUrl}/realtime/socket?${params.toString()}`;
    }

    private handleMessage(message: PhoenixMessage): void {
        const { topic, event, payload } = message;

        // Handle Phoenix heartbeat response
        if (topic === 'phoenix' && event === 'phx_reply') {
            return;
        }

        // Route message to appropriate channel
        const channel = this.channels.get(topic);
        if (channel) {
            channel._handleMessage(event, payload);
        }
    }

    private startHeartbeat(): void {
        // Phoenix expects heartbeats every 30 seconds
        this.heartbeatInterval = setInterval(() => {
            this._send({
                topic: 'phoenix',
                event: 'heartbeat',
                payload: {},
                ref: String(++this.heartbeatRef),
            });
        }, 30000);
    }

    private stopHeartbeat(): void {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
        }
    }

    private attemptReconnect(): void {
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            console.log('[Realtime] Max reconnect attempts reached');
            return;
        }

        this.reconnectAttempts++;
        const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
        console.log(`[Realtime] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);

        setTimeout(() => {
            this.connect();
        }, delay);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Singleton Instance (optional convenience export)
// ─────────────────────────────────────────────────────────────────────────────

let realtimeInstance: RealtimeService | null = null;

/**
 * Get or create a singleton RealtimeService instance
 */
export function getRealtimeService(apiKey: string, token: string | null = null): RealtimeService {
    if (!realtimeInstance) {
        realtimeInstance = new RealtimeService(apiKey, token);
    } else if (token !== null) {
        realtimeInstance.setToken(token);
    }
    return realtimeInstance;
}
