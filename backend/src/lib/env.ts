import { randomBytes } from 'crypto';
import * as dotenv from 'dotenv';
import { log } from './logger';
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

/**
 * The key that signs session cookies. It used to fall back to a fixed string, so
 * a deploy without SESSION_SECRET set was signing sessions with a value that is
 * published in this repository — anyone could mint a valid admin cookie. In
 * production we now fall back to a random key instead: the app still starts, but
 * the sessions it issues cannot be forged. Set SESSION_SECRET to stop everyone
 * being signed out on each deploy.
 */
function sessionSecret(): string {
  const configured = process.env.SESSION_SECRET?.trim();
  if (configured) return configured;
  if (process.env.NODE_ENV === 'production') {
    log.warn(
      'SESSION_SECRET is not set. Using a random key for this boot, so everyone is signed ' +
        'out whenever the app restarts. Set SESSION_SECRET to a long random string.'
    );
    return randomBytes(48).toString('hex');
  }
  return 'dev-secret-not-for-production';
}

export const env = {
  NODE_ENV: process.env.NODE_ENV ?? 'development',
  PORT: parseInt(process.env.PORT ?? '8080', 10),
  DATABASE_URL: required('DATABASE_URL'),
  SESSION_SECRET: sessionSecret(),
  APP_URL: (process.env.APP_URL ?? 'http://localhost:8080').replace(/\/$/, ''),
  UPLOAD_DIR: process.env.UPLOAD_DIR ?? '/data/uploads',

  ADMIN_EMAIL: process.env.ADMIN_EMAIL ?? '',
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD ?? '',
  ADMIN_PASSWORD_RESET: (process.env.ADMIN_PASSWORD_RESET ?? '').trim().toLowerCase() === 'true',

  WAVE_API_TOKEN: process.env.WAVE_API_TOKEN ?? '',
  WAVE_BUSINESS_ID: process.env.WAVE_BUSINESS_ID ?? '',

  RESEND_API_KEY: process.env.RESEND_API_KEY ?? '',
  RESEND_FROM_EMAIL: process.env.RESEND_FROM_EMAIL ?? '',
  RESEND_FROM_NAME: process.env.RESEND_FROM_NAME ?? 'HULK Automation',
  RESEND_REPLY_TO: process.env.RESEND_REPLY_TO ?? '',
  RESEND_WEBHOOK_SECRET: process.env.RESEND_WEBHOOK_SECRET ?? '',
};

export const isProd = env.NODE_ENV === 'production';
