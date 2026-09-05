import { Router } from 'express';
import { one, query } from '../lib/db';
import { handler } from '../lib/http';
import { AppError } from '../lib/errors';
import {
  clearSession,
  hashPassword,
  looksLikeBcryptHash,
  issueSession,
  readSession,
  requireAuth,
  verifyPassword,
} from '../lib/auth';
import { audit } from '../services/activity';
import { log } from '../lib/logger';

export const authRouter = Router();

authRouter.post(
  '/login',
  handler(async (req, res) => {
    const email = String(req.body?.email ?? '').trim().toLowerCase();
    const password = String(req.body?.password ?? '');
    if (!email || !password) throw new AppError('Enter your email address and password.', 400);

    // btrim so an address stored with stray whitespace still matches what the
    // person types. $1 is already trimmed and lowercased above.
    const user = await one<any>('SELECT * FROM users WHERE lower(btrim(email)) = $1', [email]);
    if (user && !looksLikeBcryptHash(user.password_hash)) {
      // Every password check against this row will fail, and it would otherwise
      // be indistinguishable from a wrong password. Say so; the hash is not
      // logged, only its shape.
      log.error(
        `The stored password for ${email} is not a usable bcrypt hash — reset it with ` +
          '"node backend/dist/scripts/admin.js set-password <email> <password>".'
      );
    }
    if (!user || !(await verifyPassword(password, user.password_hash))) {
      // The reply stays vague on purpose — it must not tell a stranger which
      // addresses have accounts. The server log may say so; only you read it.
      log.warn(
        user
          ? `Sign-in failed for ${email}: the account exists, the password did not match.`
          : `Sign-in failed for ${email}: no account has that address.`
      );
      throw new AppError("That email and password don't match an account.", 401);
    }
    await query('UPDATE users SET last_login_at = now() WHERE id = $1', [user.id]);
    const session = { id: user.id, email: user.email, name: user.name, role: user.role };
    issueSession(res, session);
    await audit('user.login', { actor: user.email, entity: 'user', entityId: user.id });
    res.json({ user: session });
  })
);

authRouter.post('/logout', (req, res) => {
  clearSession(res);
  res.json({ ok: true });
});

authRouter.get('/me', (req, res) => {
  const user = readSession(req);
  if (!user) {
    res.status(401).json({ error: 'Not signed in' });
    return;
  }
  res.json({ user });
});

authRouter.post(
  '/password',
  requireAuth,
  handler(async (req, res) => {
    const current = String(req.body?.current ?? '');
    const next = String(req.body?.next ?? '');
    if (next.length < 10) throw new AppError('Choose a password of at least 10 characters.', 400);
    const user = await one<any>('SELECT * FROM users WHERE id = $1', [req.user!.id]);
    if (!user || !(await verifyPassword(current, user.password_hash))) {
      throw new AppError('Your current password was not correct.', 401);
    }
    await query('UPDATE users SET password_hash = $2 WHERE id = $1', [
      user.id,
      await hashPassword(next),
    ]);
    await audit('user.password_changed', { actor: user.email, entity: 'user', entityId: user.id });
    res.json({ ok: true });
  })
);
