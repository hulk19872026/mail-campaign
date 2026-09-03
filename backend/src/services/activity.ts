import { query } from '../lib/db';
import { log } from '../lib/logger';

export async function audit(
  action: string,
  opts: { actor?: string; entity?: string; entityId?: string | number; details?: any } = {}
): Promise<void> {
  try {
    await query(
      `INSERT INTO audit_logs (actor, action, entity, entity_id, details)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        opts.actor ?? 'system',
        action,
        opts.entity ?? '',
        opts.entityId != null ? String(opts.entityId) : '',
        JSON.stringify(opts.details ?? {}),
      ]
    );
  } catch (err) {
    log.error('Could not write audit log', { action, error: String(err) });
  }
}

export async function notify(
  level: 'info' | 'success' | 'warning' | 'error',
  title: string,
  message = ''
): Promise<void> {
  try {
    await query('INSERT INTO notifications (level, title, message) VALUES ($1, $2, $3)', [
      level,
      title,
      message,
    ]);
  } catch (err) {
    log.error('Could not write notification', { title, error: String(err) });
  }
}
