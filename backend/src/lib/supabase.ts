import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config } from '../config.js';

let client: SupabaseClient | null = null;

/**
 * Server-side Supabase client (use service role for admin operations).
 * Install: npm install @supabase/supabase-js
 */
export function getSupabase(): SupabaseClient {
  if (!client) {
    if (!config.supabase.url || !config.supabase.serviceRoleKey) {
      throw new Error('Supabase URL and SERVICE_ROLE_KEY are required for server client');
    }
    client = createClient(config.supabase.url, config.supabase.serviceRoleKey);
  }
  return client;
}
