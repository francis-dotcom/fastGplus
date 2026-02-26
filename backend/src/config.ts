import 'dotenv/config';

const env = process.env;

export const config = {
  port: parseInt(env.PORT ?? '3000', 10),
  nodeEnv: env.NODE_ENV ?? 'development',
  supabase: {
    url: env.SUPABASE_URL ?? '',
    anonKey: env.SUPABASE_ANON_KEY ?? '',
    serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY ?? '',
  },
} as const;
