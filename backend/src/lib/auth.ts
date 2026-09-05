import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { NextFunction, Request, Response } from 'express';
import { env, isProd } from './env';
import { one, query } from './db';
import { log } from './logger';

export const SESSION_COOKIE = 'hulk_session';
const SESSION_HOURS = 12;

export type SessionUser = { id: number; email: string; name: string; role: string };

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: SessionUser;
    }
  }
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 12);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export function issueSession(res: Response, user: SessionUser): void {
  const token = jwt.sign(user, env.SESSION_SECRET, { expiresIn: `${SESSION_HOURS}h` });
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProd,
    maxAge: SESSION_HOURS * 60 * 60 * 1000,
    path: '/',
  });
}

export function clearSession(res: Response): void {
  res.clearCookie(SESSION_COOKIE, { path: '/' });
}

export function readSession(req: Request): SessionUser | null {
  const token = req.cookies?.[SESSION_COOKIE];
  if (!token) return null;
  try {
    const decoded = jwt.verify(token, env.SESSION_SECRET) as any;
    return { id: decoded.id, email: decoded.email, name: decoded.name, role: decoded.role };
  } catch {
    return null;
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const user = readSession(req);
  if (!user) {
    res.status(401).json({ error: 'Your session expired. Sign in again to continue.' });
    return;
  }
  req.user = user;
  next();
}

/**
 * Makes sure ADMIN_EMAIL can sign in.
 *
 * On a fresh database this creates the first account. On an existing database it
 * also creates the account when ADMIN_EMAIL was changed after the first boot —
 * otherwise the old address stays the only way in and the new one is rejected
 * with "That email and password don't match an account." Accounts that already
 * exist are never touched, so a password changed under Settings survives.
 */
export async function bootstrapAdmin(): Promise<void> {
  const email = env.ADMIN_EMAIL.trim().toLowerCase();
  const existing = await one<{ count: string }>('SELECT count(*)::text AS count FROM users');
  const userCount = Number(existing?.count ?? 0);

  if (!email || !env.ADMIN_PASSWORD) {
    if (userCount === 0) {
      log.warn('No users exist and ADMIN_EMAIL / ADMIN_PASSWORD are not set — nobody can sign in yet.');
    }
    return;
  }

  const already = await one<{ id: number }>('SELECT id FROM users WHERE lower(email) = $1', [email]);
  if (already) return;

  const hash = await hashPassword(env.ADMIN_PASSWORD);
  await query('INSERT INTO users (email, password_hash, name, role) VALUES ($1, $2, $3, $4)', [
    email,
    hash,
    email.split('@')[0].replace(/\W+/g, ' ').trim() || 'Admin',
    'admin',
  ]);
  log.info(
    userCount === 0
      ? `Created the first account for ${email}`
      : `Created an account for ${email} from ADMIN_EMAIL — ${userCount} other account(s) still exist`
  );
}
