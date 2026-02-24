/**
 * SelfDB TypeScript/JavaScript SDK
 * 
 * Full Self-Hosted BaaS Built for AI Agents.
 */

import { HttpClient, HttpClientConfig } from './client';
import { Auth } from './auth';
import { Tables } from './tables';
import { Storage } from './storage';
import { Realtime } from './realtime';

/**
 * SelfDB client configuration
 */
export interface SelfDBConfig {
    baseUrl: string;
    apiKey: string;
    timeout?: number;
}

/**
 * Main SelfDB client
 */
export class SelfDB {
    private client: HttpClient;
    
    public readonly auth: Auth;
    public readonly tables: Tables;
    public readonly storage: Storage;
    public readonly realtime: Realtime;

    constructor(config: SelfDBConfig) {
        const httpConfig: HttpClientConfig = {
            baseUrl: config.baseUrl,
            apiKey: config.apiKey,
            timeout: config.timeout,
        };

        this.client = new HttpClient(httpConfig);
        this.auth = new Auth(this.client);
        this.tables = new Tables(this.client);
        this.storage = new Storage(this.client);
        this.realtime = new Realtime(this.client, config.baseUrl, config.apiKey);
    }
}

// Re-export everything
export * from './errors';
export * from './models';
export * from './auth';
export * from './tables';
export * from './storage';
export * from './realtime';
