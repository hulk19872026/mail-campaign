import crypto from 'crypto';
import { env } from '../lib/env';
import { AppError } from '../lib/errors';

// Overridable so the integration can be exercised against a stand-in API in
// tests. Unset in production, where it is Resend's own API.
const RESEND_API = process.env.RESEND_API_BASE ?? 'https://api.resend.com';
const RESEND_ENDPOINT = `${RESEND_API}/emails`;

export type OutgoingEmail = {
  to: string;
  subject: string;
  html: string;
  text?: string;
  fromName: string;
  fromEmail: string;
  replyTo?: string;
  headers?: Record<string, string>;
  attachments?: { filename: string; content: string }[]; // content = base64
  tags?: { name: string; value: string }[];
};

export type SendOutcome =
  | { ok: true; id: string }
  | { ok: false; permanent: boolean; message: string };

/** Sends one email. Never throws for delivery problems — it classifies them instead. */
export async function sendEmail(email: OutgoingEmail): Promise<SendOutcome> {
  if (!env.RESEND_API_KEY) {
    return {
      ok: false,
      permanent: true,
      message: 'Resend is not connected. Add RESEND_API_KEY in Railway, then reconnect in Settings.',
    };
  }
  if (!email.fromEmail) {
    return {
      ok: false,
      permanent: true,
      message: 'No "from" address is set. Add one in Settings → Email.',
    };
  }

  const body: Record<string, any> = {
    from: `${email.fromName} <${email.fromEmail}>`,
    to: [email.to],
    subject: email.subject,
    html: email.html,
  };
  if (email.text) body.text = email.text;
  if (email.replyTo) body.reply_to = email.replyTo;
  if (email.headers) body.headers = email.headers;
  if (email.attachments?.length) body.attachments = email.attachments;
  if (email.tags?.length) body.tags = email.tags;

  let response: Response;
  try {
    response = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    // Network blip — worth retrying later.
    return { ok: false, permanent: false, message: `Could not reach Resend: ${String(err)}` };
  }

  const payload: any = await response.json().catch(() => ({}));

  if (response.ok && payload?.id) return { ok: true, id: payload.id };

  const message = payload?.message || payload?.error?.message || `Resend error ${response.status}`;

  // 401/403 = bad key, 422 = invalid address or unverified domain: retrying will not help.
  // 429 = rate limited, 5xx = their side: retry later.
  const permanent = [400, 401, 403, 404, 422].includes(response.status);
  return { ok: false, permanent, message };
}

export async function testResendConnection(): Promise<{ connected: boolean; message: string }> {
  if (!env.RESEND_API_KEY) {
    return { connected: false, message: 'No Resend API key is set yet.' };
  }
  try {
    const res = await fetch(`${RESEND_API}/domains`, {
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}` },
    });
    if (res.status === 401) {
      return {
        connected: false,
        message: 'Resend rejected the API key — it is invalid or has been revoked. Create a new one and put it in RESEND_API_KEY.',
      };
    }
    if (res.status === 403) {
      // 403 is not a bad key: Resend accepted it and refused this one endpoint.
      // A key created with sending-only access cannot read the domain list, and
      // telling its owner to generate a new one sends them in a circle.
      return {
        connected: true,
        message:
          'The API key works, but it is not allowed to read your domains, so verification status cannot be shown here. ' +
          'That is normal for a key created with sending-only access — sending is unaffected. Use a full-access key to see domains here.',
      };
    }
    if (!res.ok) {
      return { connected: false, message: `Resend responded with ${res.status}. Try again shortly.` };
    }
    const data: any = await res.json().catch(() => ({}));
    const domains: any[] = data?.data ?? [];
    const verified = domains.filter((d) => d.status === 'verified').map((d) => d.name);
    return {
      connected: true,
      message: verified.length
        ? `Connected. Verified domain: ${verified.join(', ')}.`
        : 'Connected, but no verified sending domain yet. Verify hulkautomation.com in Resend.',
    };
  } catch (err) {
    throw new AppError("Resend couldn't be reached right now. Try again shortly.", 502, String(err));
  }
}

export async function listResendDomains(): Promise<{ name: string; status: string }[]> {
  if (!env.RESEND_API_KEY) return [];
  const res = await fetch(`${RESEND_API}/domains`, {
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}` },
  });
  if (!res.ok) return [];
  const data: any = await res.json().catch(() => ({}));
  return (data?.data ?? []).map((d: any) => ({ name: d.name, status: d.status }));
}

/**
 * Verifies a Resend (Svix) webhook signature.
 * Returns true when no secret is configured, so webhooks still work before setup.
 */
export function verifyResendWebhook(headers: Record<string, any>, rawBody: string): boolean {
  const secret = env.RESEND_WEBHOOK_SECRET;
  if (!secret) return true;

  const id = headers['svix-id'];
  const timestamp = headers['svix-timestamp'];
  const signatureHeader = headers['svix-signature'];
  if (!id || !timestamp || !signatureHeader) return false;

  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  const expected = crypto
    .createHmac('sha256', key)
    .update(`${id}.${timestamp}.${rawBody}`)
    .digest('base64');

  return String(signatureHeader)
    .split(' ')
    .map((part) => part.split(',').pop() ?? '')
    .some((sig) => {
      const a = Buffer.from(sig);
      const b = Buffer.from(expected);
      return a.length === b.length && crypto.timingSafeEqual(a, b);
    });
}
