/**
 * Account recovery from the command line — run it against the live database when
 * sign-in keeps failing and the deploy log has not made the reason obvious.
 *
 * In the Railway shell for the service:
 *
 *   node backend/dist/scripts/admin.js list
 *   node backend/dist/scripts/admin.js set-password david@hulkautomation.com "new password"
 *
 * Locally (backend/.env supplies DATABASE_URL):
 *
 *   npm run admin -- list
 *   npm run admin -- set-password david@hulkautomation.com "new password"
 *
 * `list` prints every account, so you can see the exact address to type — a typo
 * or a leftover address from an earlier ADMIN_EMAIL shows up immediately.
 * `set-password` sets the password for that address, creating the account if it
 * does not exist yet. It takes effect at once; no redeploy needed.
 */
import { one, pool, query } from '../lib/db';
import { hashPassword } from '../lib/auth';

async function list(): Promise<void> {
  const users = await query<{
    id: number;
    email: string;
    role: string;
    last_login_at: Date | null;
    created_at: Date;
  }>('SELECT id, email, role, last_login_at, created_at FROM users ORDER BY id');

  if (users.length === 0) {
    console.log('No accounts exist. Create one with: set-password <email> <password>');
    return;
  }
  console.log(`${users.length} account(s):`);
  for (const user of users) {
    const seen = user.last_login_at ? user.last_login_at.toISOString() : 'never signed in';
    console.log(`  #${user.id}  ${user.email}  (${user.role}, ${seen})`);
  }
}

async function setPassword(rawEmail: string, password: string): Promise<void> {
  const email = rawEmail.trim().toLowerCase();
  if (!email.includes('@')) throw new Error(`"${rawEmail}" does not look like an email address.`);
  if (password.length < 10) throw new Error('Choose a password of at least 10 characters.');

  const hash = await hashPassword(password);
  const existing = await one<{ id: number }>('SELECT id FROM users WHERE lower(btrim(email)) = $1', [email]);

  if (existing) {
    await query('UPDATE users SET password_hash = $2 WHERE id = $1', [existing.id, hash]);
    console.log(`Password updated for ${email}. Sign in with it now — no redeploy needed.`);
    return;
  }
  await query('INSERT INTO users (email, password_hash, name, role) VALUES ($1, $2, $3, $4)', [
    email,
    hash,
    email.split('@')[0].replace(/\W+/g, ' ').trim() || 'Admin',
    'admin',
  ]);
  console.log(`Created ${email}. Sign in with it now — no redeploy needed.`);
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  switch (command) {
    case 'list':
      await list();
      break;
    case 'set-password':
      if (args.length < 2) throw new Error('Usage: set-password <email> <password>');
      await setPassword(args[0], args.slice(1).join(' '));
      break;
    default:
      console.log('Usage:');
      console.log('  node backend/dist/scripts/admin.js list');
      console.log('  node backend/dist/scripts/admin.js set-password <email> <password>');
      process.exitCode = command ? 1 : 0;
  }
}

main()
  .catch((err) => {
    console.error(String(err?.message ?? err));
    process.exitCode = 1;
  })
  .finally(() => pool.end());
