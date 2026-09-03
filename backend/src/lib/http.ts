import { NextFunction, Request, RequestHandler, Response } from 'express';
import { AppError, friendlyMessage } from './errors';
import { log } from './logger';
import { isProd } from './env';

export const handler =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<any>): RequestHandler =>
  (req, res, next) => {
    fn(req, res, next).catch(next);
  };

export function errorMiddleware(err: any, req: Request, res: Response, _next: NextFunction): void {
  const status = err instanceof AppError ? err.status : 500;
  if (status >= 500) {
    log.error('Request failed', { path: req.path, error: String(err?.stack ?? err) });
  }
  res.status(status).json({
    error: friendlyMessage(err),
    details: isProd && status >= 500 ? undefined : String(err?.message ?? err),
  });
}

export function actorOf(req: Request): string {
  return req.user?.email ?? 'system';
}

export function intParam(value: any, fallback = 0): number {
  const n = parseInt(String(value), 10);
  return Number.isFinite(n) ? n : fallback;
}
