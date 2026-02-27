import 'dotenv/config';

const env = process.env;

export const config = {
  port: parseInt(env.PORT ?? '3000', 10),
  nodeEnv: env.NODE_ENV ?? 'development',
  database: {
    url: env.DATABASE_URL ?? '',
  },
  paygate: {
    apiKey: env.PAYGATE_API_KEY ?? '',
    clientSecret: env.PAYGATE_CLIENT_SECRET ?? '',
    baseUrl: env.PAYGATE_BASE_URL ?? 'https://api.paygate.ng',
  },
  app: {
    baseUrl: env.APP_BASE_URL ?? 'https://grandpluscollege.com',
  },
} as const;
