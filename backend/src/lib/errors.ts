export class AppError extends Error {
  status: number;
  friendly: string;
  constructor(friendly: string, status = 400, technical?: string) {
    super(technical || friendly);
    this.friendly = friendly;
    this.status = status;
  }
}

// Turns anything thrown by fetch/pg/etc. into a sentence a business owner can act on.
export function friendlyMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  if (err instanceof AppError) return err.friendly;
  if (/ECONNREFUSED|ENOTFOUND|EAI_AGAIN|fetch failed|ETIMEDOUT/i.test(raw))
    return "We couldn't reach that service right now. It's usually temporary — try again in a moment.";
  if (/duplicate key/i.test(raw)) return 'That record already exists.';
  if (/invalid input syntax/i.test(raw)) return "Something in that form wasn't in the right format.";
  if (/relation .* does not exist/i.test(raw))
    return 'The database is still setting up. Wait a few seconds and try again.';
  return 'Something went wrong on our side. Try again, and if it keeps happening check the logs page.';
}
