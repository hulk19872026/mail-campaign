import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { NextFunction, Request, Response } from 'express';
import { env, isProd } from './env';
import { query } from './db';
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

/** A bcrypt hash, not a plaintext password or a truncated column value. */
export function looksLikeBcryptHash(value: unknown): boolean {
  return typeof value === 'string' && /^\$2[aby]\$\d{2}\$.{53}$/.test(value);
}

/**
 * Warns when a credential arrived with characters that were almost certainly not
 * meant to be part of it. Pasting into a hosting dashboard picks up a trailing
 * space or wrapping quotes, and the password that then gets hashed is not the one
 * anybody types. Reports only the shape of the problem — never the value.
 */
function warnAboutStrayCharacters(name: string, value: string): void {
  if (value !== value.trim()) {
    log.warn(`${name} starts or ends with whitespace. It is used exactly as stored, spaces included.`);
  }
  const trimmed = value.trim();
  if (trimmed.length > 1 && /^(".*"|'.*')$/s.test(trimmed)) {
    log.warn(`${name} is wrapped in quotes. The quotes count as part of the value — remove them.`);
  }
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
 * with "That email and password don't match an account."
 *
 * An account that already exists keeps its password, so one changed under
 * Settings survives a redeploy. Set ADMIN_PASSWORD_RESET=true to force that
 * account's password back to ADMIN_PASSWORD on the next boot — the way back in
 * when the password itself is what no longer matches. Remove the variable
 * afterwards, or every redeploy undoes your Settings password.
 */
export async function bootstrapAdmin(): Promise<void> {
  if (env.ADMIN_EMAIL) warnAboutStrayCharacters('ADMIN_EMAIL', env.ADMIN_EMAIL);
  if (env.ADMIN_PASSWORD) warnAboutStrayCharacters('ADMIN_PASSWORD', env.ADMIN_PASSWORD);

  const email = env.ADMIN_EMAIL.trim().toLowerCase();
  const accounts = await query<{ email: string }>('SELECT email FROM users ORDER BY id');

  if (!email || !env.ADMIN_PASSWORD) {
    if (accounts.length === 0) {
      log.warn('No users exist and ADMIN_EMAIL / ADMIN_PASSWORD are not set — nobody can sign in yet.');
    }
    return;
  }

  const already = accounts.find((row) => row.email.trim().toLowerCase() === email);
  if (already) {
    if (env.ADMIN_PASSWORD_RESET) {
      await query('UPDATE users SET password_hash = $2 WHERE lower(btrim(email)) = $1', [
        email,
        await hashPassword(env.ADMIN_PASSWORD),
      ]);
      log.warn(
        `ADMIN_PASSWORD_RESET is set — the password for ${email} is now ADMIN_PASSWORD. ` +
          'Remove ADMIN_PASSWORD_RESET so the next deploy stops overwriting it.'
      );
    } else {
      log.info(`Sign-in account ready for ${email}`);
    }
    return;
  }

  await query('INSERT INTO users (email, password_hash, name, role) VALUES ($1, $2, $3, $4)', [
    email,
    await hashPassword(env.ADMIN_PASSWORD),
    email.split('@')[0].replace(/\W+/g, ' ').trim() || 'Admin',
    'admin',
  ]);
  log.info(
    accounts.length === 0
      ? `Created the first account for ${email}`
      : `Created an account for ${email} from ADMIN_EMAIL — existing accounts: ${accounts
          .map((row) => row.email)
          .join(', ')}`
  );
}
