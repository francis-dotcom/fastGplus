/**
 * SelfDB SDK Realtime Module
 * 
 * Phoenix Channels WebSocket implementation for realtime updates.
 */

import { HttpClient } from './client';
import { RealtimePayload, RealtimeCallback, RealtimeEvent } from './models';

/**
 * WebSocket interface that works in both Node.js and browser
 */
interface WebSocketLike {
    readonly readyState: number;
    onopen: ((event: unknown) => void) | null;
    onclose: ((event: unknown) => void) | null;
    onerror: ((event: unknown) => void) | null;
    onmessage: ((event: { data: string }) => void) | null;
    send(data: string): void;
    close(): void;
}

/**
 * Get WebSocket constructor (works in both Node.js and browser)
 */
async function getWebSocketClass(): Promise<new (url: string) => WebSocketLike> {
    if (typeof WebSocket !== 'undefined') {
        return WebSocket as unknown as new (url: string) => WebSocketLike;
    }
    // Node.js - dynamically import ws
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ws = await import(/* webpackIgnore: true */ 'ws');
    return (ws.default || ws) as unknown as new (url: string) => WebSocketLike;
}

/**
 * Phoenix message format
 */
interface PhoenixMessage {
    topic: string;
    event: string;
    payload: Record<string, unknown>;
    ref: string | null;
}

/**
 * Channel state
 */
type ChannelState = 'closed' | 'joining' | 'joined' | 'leaving';

/**
 * Realtime channel for subscribing to events
 */
export class RealtimeChannel {
    private state: ChannelState = 'closed';
    private handlers: Map<string, RealtimeCallback[]> = new Map();
    private joinRef: string | null = null;

    constructor(
        public readonly topic: string,
        private realtime: Realtime
    ) {}

    /**
     * Register an event handler
     */
    on(event: RealtimeEvent | '*', callback: RealtimeCallback): RealtimeChannel {
        const eventKey = event === '*' ? '*' : event;
        const handlers = this.handlers.get(eventKey) || [];
        handlers.push(callback);
        this.handlers.set(eventKey, handlers);
        return this;
    }

    /**
     * Remove an event handler
     */
    off(event: RealtimeEvent | '*', callback?: RealtimeCallback): RealtimeChannel {
        const eventKey = event === '*' ? '*' : event;
        if (callback) {
            const handlers = this.handlers.get(eventKey) || [];
            const index = handlers.indexOf(callback);
            if (index > -1) {
                handlers.splice(index, 1);
            }
            this.handlers.set(eventKey, handlers);
        } else {
            this.handlers.delete(eventKey);
        }
        return this;
    }

    /**
     * Subscribe to the channel (sends phx_join)
     */
    async subscribe(): Promise<void> {
        if (this.state === 'joined' || this.state === 'joining') {
            return;
        }

        this.state = 'joining';
        this.joinRef = this.realtime.generateRef();

        await this.realtime.send({
            topic: this.topic,
            event: 'phx_join',
            payload: {},
            ref: this.joinRef,
        });

        this.state = 'joined';
    }

    /**
     * Unsubscribe from the channel (sends phx_leave)
     */
    async unsubscribe(): Promise<void> {
        if (this.state === 'closed' || this.state === 'leaving') {
            return;
        }

        this.state = 'leaving';

        await this.realtime.send({
            topic: this.topic,
            event: 'phx_leave',
            payload: {},
            ref: this.realtime.generateRef(),
        });

        this.state = 'closed';
        this.handlers.clear();
    }

    /**
     * Handle incoming message for this channel
     */
    handleMessage(event: string, payload: Record<string, unknown>): void {
        // Create realtime payload
        const realtimePayload: RealtimePayload = {
            event: event as RealtimeEvent,
            table: (payload.table as string) || this.topic.replace('table:', ''),
            new: (payload.new as Record<string, unknown>) || null,
            old: (payload.old as Record<string, unknown>) || null,
            raw: payload,
        };

        // Call specific event handlers
        const handlers = this.handlers.get(event) || [];
        for (const handler of handlers) {
            try {
                handler(realtimePayload);
            } catch (error) {
                console.error(`Error in realtime handler for ${event}:`, error);
            }
        }

        // Call wildcard handlers
        const wildcardHandlers = this.handlers.get('*') || [];
        for (const handler of wildcardHandlers) {
            try {
                handler(realtimePayload);
            } catch (error) {
                console.error('Error in realtime wildcard handler:', error);
            }
        }
    }

    /**
     * Get channel state
     */
    getState(): ChannelState {
        return this.state;
    }
}

/**
 * Realtime connection state
 */
type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'disconnecting';

/**
 * Realtime module for Phoenix Channels WebSocket
 */
export class Realtime {
    private socket: WebSocketLike | null = null;
    private state: ConnectionState = 'disconnected';
    private channels: Map<string, RealtimeChannel> = new Map();
    private refCounter = 0;
    private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
    private pendingMessages: PhoenixMessage[] = [];
    private messageResolvers: Map<string, { resolve: () => void; reject: (error: Error) => void }> = new Map();

    constructor(private client: HttpClient, private baseUrl: string, private apiKey: string) {}

    /**
     * Generate a unique reference for messages
     */
    generateRef(): string {
        this.refCounter++;
        return String(this.refCounter);
    }

    /**
     * Get WebSocket URL
     */
    private getWebSocketUrl(): string {
        const wsBaseUrl = this.baseUrl.replace(/^http/, 'ws');
        const token = this.client.getAccessToken() || '';
        return `${wsBaseUrl}/realtime/socket?X-API-Key=${this.apiKey}&token=${token}`;
    }

    /**
     * Connect to the realtime server
     */
    async connect(): Promise<void> {
        if (this.state === 'connected' || this.state === 'connecting') {
            return;
        }

        this.state = 'connecting';

        // Get WebSocket class (browser or Node.js)
        const WebSocketClass = await getWebSocketClass();
        const url = this.getWebSocketUrl();

        return new Promise((resolve, reject) => {
            const socket = new WebSocketClass(url);
            this.socket = socket;

            socket.onopen = () => {
                this.state = 'connected';
                this.startHeartbeat();
                
                // Send any pending messages
                for (const message of this.pendingMessages) {
                    this.sendImmediate(message);
                }
                this.pendingMessages = [];
                
                resolve();
            };

            socket.onclose = () => {
                this.state = 'disconnected';
                this.stopHeartbeat();
            };

            socket.onerror = () => {
                if (this.state === 'connecting') {
                    reject(new Error('Failed to connect to realtime server'));
                }
            };

            socket.onmessage = (event) => {
                this.handleMessage(event.data);
            };
        });
    }

    /**
     * Disconnect from the realtime server
     */
    async disconnect(): Promise<void> {
        if (this.state === 'disconnected' || this.state === 'disconnecting') {
            return;
        }

        this.state = 'disconnecting';
        this.stopHeartbeat();

        // Unsubscribe from all channels
        for (const channel of this.channels.values()) {
            await channel.unsubscribe();
        }
        this.channels.clear();

        if (this.socket) {
            this.socket.close();
            this.socket = null;
        }

        this.state = 'disconnected';
    }

    /**
     * Create or get a channel for a topic
     */
    channel(topic: string): RealtimeChannel {
        let channel = this.channels.get(topic);
        if (!channel) {
            channel = new RealtimeChannel(topic, this);
            this.channels.set(topic, channel);
        }
        return channel;
    }

    /**
     * Send a message
     */
    async send(message: PhoenixMessage): Promise<void> {
        if (this.state !== 'connected' || !this.socket) {
            this.pendingMessages.push(message);
            return;
        }

        return new Promise((resolve, reject) => {
            if (message.ref) {
                this.messageResolvers.set(message.ref, { resolve, reject });
                
                // Timeout for response
                setTimeout(() => {
                    if (this.messageResolvers.has(message.ref!)) {
                        this.messageResolvers.delete(message.ref!);
                        resolve(); // Don't reject, just resolve (best effort)
                    }
                }, 5000);
            }

            this.sendImmediate(message);
            
            if (!message.ref) {
                resolve();
            }
        });
    }

    /**
     * Send a message immediately
     */
    private sendImmediate(message: PhoenixMessage): void {
        if (this.socket && this.socket.readyState === 1) { // 1 = OPEN
            // Phoenix protocol uses array format: [join_ref, ref, topic, event, payload]
            const phoenixMessage = [null, message.ref, message.topic, message.event, message.payload];
            this.socket.send(JSON.stringify(phoenixMessage));
        }
    }

    /**
     * Handle incoming WebSocket message
     */
    private handleMessage(data: string): void {
        try {
            // Phoenix protocol uses array format: [join_ref, ref, topic, event, payload]
            const [_joinRef, ref, topic, event, payload] = JSON.parse(data);

            // Handle reply messages
            if (event === 'phx_reply' && ref && this.messageResolvers.has(ref)) {
                const resolver = this.messageResolvers.get(ref)!;
                this.messageResolvers.delete(ref);
                
                if (payload.status === 'ok') {
                    resolver.resolve();
                } else {
                    resolver.reject(new Error(payload.response?.reason || 'Unknown error'));
                }
                return;
            }

            // Route to appropriate channel
            const channel = this.channels.get(topic);
            if (channel) {
                channel.handleMessage(event, payload || {});
            }
        } catch (error) {
            console.error('Error handling realtime message:', error);
        }
    }

    /**
     * Start heartbeat interval
     */
    private startHeartbeat(): void {
        this.heartbeatInterval = setInterval(() => {
            this.send({
                topic: 'phoenix',
                event: 'heartbeat',
                payload: {},
                ref: this.generateRef(),
            });
        }, 30000); // 30 seconds
    }

    /**
     * Stop heartbeat interval
     */
    private stopHeartbeat(): void {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
        }
    }

    /**
     * Get connection state
     */
    getState(): ConnectionState {
        return this.state;
    }
}
