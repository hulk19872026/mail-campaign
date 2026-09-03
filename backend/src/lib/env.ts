import * as dotenv from 'dotenv';
dotenv.config();

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (!value) {
    throw new Error(
      `Missing environment variable ${name}. Add it in Railway under your service > Variables.`
    );
  }
  return value;
}

export const env = {
  NODE_ENV: process.env.NODE_ENV ?? 'development',
  PORT: parseInt(process.env.PORT ?? '8080', 10),
  DATABASE_URL: required('DATABASE_URL'),
  SESSION_SECRET: required('SESSION_SECRET', 'dev-secret-not-for-production'),
  APP_URL: (process.env.APP_URL ?? 'http://localhost:8080').replace(/\/$/, ''),
  UPLOAD_DIR: process.env.UPLOAD_DIR ?? '/data/uploads',

  ADMIN_EMAIL: process.env.ADMIN_EMAIL ?? '',
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD ?? '',

  WAVE_API_TOKEN: process.env.WAVE_API_TOKEN ?? '',
  WAVE_BUSINESS_ID: process.env.WAVE_BUSINESS_ID ?? '',

  RESEND_API_KEY: process.env.RESEND_API_KEY ?? '',
  RESEND_FROM_EMAIL: process.env.RESEND_FROM_EMAIL ?? '',
  RESEND_FROM_NAME: process.env.RESEND_FROM_NAME ?? 'HULK Automation',
  RESEND_REPLY_TO: process.env.RESEND_REPLY_TO ?? '',
  RESEND_WEBHOOK_SECRET: process.env.RESEND_WEBHOOK_SECRET ?? '',
};

export const isProd = env.NODE_ENV === 'production';
