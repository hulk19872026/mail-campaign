import fs from 'fs';
import path from 'path';
import express from 'express';
import cookieParser from 'cookie-parser';
import { env, isProd } from './lib/env';
import { log } from './lib/logger';
import { runMigrations } from './lib/migrate';
import { bootstrapAdmin, requireAuth } from './lib/auth';
import { errorMiddleware } from './lib/http';
import { seedTemplates } from './email/defaults';
import { authRouter } from './routes/auth';
import { customersRouter } from './routes/customers';
import { campaignsRouter } from './routes/campaigns';
import { manageRouter } from './routes/manage';
import { insightsRouter } from './routes/insights';
import { publicRouter } from './routes/public';
import { startScheduler } from './services/scheduler';

const app = express();
app.set('trust proxy', 1);

app.use(
  express.json({
    limit: '2mb',
    verify: (req: any, _res, buf) => {
      req.rawBody = buf.toString('utf8');
    },
  })
);
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Uploaded flyers and logos are public so email clients can load them.
fs.mkdirSync(env.UPLOAD_DIR, { recursive: true });
app.use('/uploads', express.static(env.UPLOAD_DIR, { maxAge: '7d' }));

// Unsubscribe pages, tracking, webhooks and health: no sign-in required.
app.use('/', publicRouter);

// Everything under /api needs a session, except signing in.
app.use('/api/auth', authRouter);
app.use('/api/customers', requireAuth, customersRouter);
app.use('/api/campaigns', requireAuth, campaignsRouter);
app.use('/api', requireAuth, manageRouter);
app.use('/api', requireAuth, insightsRouter);

// The browser app.
const frontendDir = path.resolve(__dirname, '../../frontend/dist');
if (fs.existsSync(frontendDir)) {
  app.use(express.static(frontendDir, { index: false }));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    res.sendFile(path.join(frontendDir, 'index.html'));
  });
} else {
  log.warn('No built frontend found — run "npm run build" in /frontend');
}

app.use(errorMiddleware);

async function main() {
  log.info('Starting HULK Automation Marketing Center', { env: env.NODE_ENV });
  await runMigrations();
  await bootstrapAdmin();
  await seedTemplates();
  startScheduler();

  app.listen(env.PORT, () => {
    log.info(`Listening on port ${env.PORT}`, { appUrl: env.APP_URL, production: isProd });
  });
}

main().catch((err) => {
  log.error('The application could not start', { error: String(err?.stack ?? err) });
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  log.error('Unhandled promise rejection', { reason: String(reason) });
});
