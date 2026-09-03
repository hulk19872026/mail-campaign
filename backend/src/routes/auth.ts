import { Router } from 'express';
import { one, query } from '../lib/db';
import { handler } from '../lib/http';
import { AppError } from '../lib/errors';
import {
  clearSession,
  hashPassword,
  issueSession,
  readSession,
  requireAuth,
  verifyPassword,
} from '../lib/auth';
import { audit } from '../services/activity';

export const authRouter = Router();

authRouter.post(
  '/login',
  handler(async (req, res) => {
    const email = String(req.body?.email ?? '').trim().toLowerCase();
    const password = String(req.body?.password ?? '');
    if (!email || !password) throw new AppError('Enter your email address and password.', 400);

    const user = await one<any>('SELECT * FROM users WHERE lower(email) = $1', [email]);
    if (!user || !(await verifyPassword(password, user.password_hash))) {
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
