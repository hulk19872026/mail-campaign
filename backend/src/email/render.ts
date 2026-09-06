import { env } from '../lib/env';
import { signToken } from '../lib/tokens';
import { AppSettings } from '../services/settings';

export type Block =
  | { id: string; type: 'logo'; url?: string; alt?: string }
  | { id: string; type: 'headline'; text: string }
  | { id: string; type: 'paragraph'; text: string }
  | { id: string; type: 'image'; url: string; alt?: string; link?: string }
  | { id: string; type: 'flyer'; caption?: string }
  | { id: string; type: 'button'; label: string; url: string; interest?: string }
  | { id: string; type: 'textus'; label?: string; message?: string; number?: string }
  | { id: string; type: 'divider' }
  | { id: string; type: 'spacer'; height?: number }
  | { id: string; type: 'plans'; plans?: ('basic' | 'pro' | 'elite')[] }
  | { id: string; type: 'services' };

export type RenderContext = {
  settings: AppSettings;
  customer: {
    id?: number | null;
    first_name?: string;
    last_name?: string;
    company_name?: string;
    email: string;
  };
  campaignId?: number | null;
  recipientId?: number | null;
  flyerUrl?: string | null;
  tracking?: boolean;
};

const PLANS = {
  basic: {
    name: 'HULK BASIC',
    items: [
      'Preventative system inspection',
      'Camera inspection',
      'Alarm system inspection',
      'Access control inspection',
      'Basic troubleshooting',
      'Priority scheduling',
    ],
  },
  pro: {
    name: 'HULK PRO',
    items: [
      'Everything in BASIC',
      'Quarterly inspections',
      'Remote system checks',
      'Priority service',
      'Discounted labor',
      'System health reporting',
    ],
  },
  elite: {
    name: 'HULK ELITE',
    items: [
      'Everything in PRO',
      'Monthly system monitoring',
      'Priority emergency service',
      'Annual system certification',
      'Preferred pricing',
      'Complete low-voltage system management',
    ],
  },
};

const SERVICES = [
  'Security cameras / CCTV',
  'Access control',
  'Burglar & alarm systems',
  'Intercom & door entry',
  'VoIP business phones',
  'Networking & low voltage',
];

export function escapeHtml(value: string): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Replaces {{first_name}} style merge tags. Unknown tags become an empty string. */
export function personalize(text: string, ctx: RenderContext): string {
  const c = ctx.customer;
  const map: Record<string, string> = {
    first_name: c.first_name || 'there',
    last_name: c.last_name || '',
    company_name: c.company_name || c.first_name || 'your business',
    email: c.email || '',
    company: ctx.settings.company_name,
    website: ctx.settings.website,
  };
  return String(text ?? '').replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (_m, key) => map[String(key).toLowerCase()] ?? '');
}

/**
 * Keeps only the digits, and a leading +, so the number is safe inside an
 * `sms:` link however it was typed in Settings.
 */
export function smsHref(number: string, message?: string): string {
  const trimmed = String(number ?? '').trim();
  const digits = trimmed.replace(/[^0-9]/g, '');
  if (!digits) return '';
  const dialable = trimmed.startsWith('+') ? `+${digits}` : digits;
  // iOS wants `?&body=`, Android accepts it, so this one form works on both.
  return message ? `sms:${dialable}?&body=${encodeURIComponent(message)}` : `sms:${dialable}`;
}

/** The number a "Text us" block dials: its own, else the one in Settings. */
function textNumber(block: { number?: string }, ctx: RenderContext): string {
  return block.number?.trim() || ctx.settings.sms_number || ctx.settings.support_phone || '';
}

function trackedUrl(url: string, ctx: RenderContext, interest?: string): string {
  // Only http(s) links can travel through the click redirect. Sending `sms:`
  // or `tel:` through it would break the tap on the phone it is meant for.
  if (!/^https?:/i.test(url)) return url;
  if (!ctx.tracking || !ctx.recipientId) return url;
  const token = signToken({
    r: ctx.recipientId,
    c: ctx.campaignId ?? null,
    u: ctx.customer.id ?? null,
    i: interest ?? null,
  });
  return `${env.APP_URL}/t/click/${token}?u=${encodeURIComponent(url)}`;
}

export function unsubscribeUrl(ctx: RenderContext): string {
  const token = signToken({
    u: ctx.customer.id ?? null,
    e: ctx.customer.email,
    c: ctx.campaignId ?? null,
  });
  return `${env.APP_URL}/u/${token}`;
}

function openPixel(ctx: RenderContext): string {
  if (!ctx.tracking || !ctx.recipientId) return '';
  const token = signToken({ r: ctx.recipientId, c: ctx.campaignId ?? null, u: ctx.customer.id ?? null });
  return `<img src="${env.APP_URL}/t/open/${token}.gif" width="1" height="1" alt="" style="display:block;border:0;" />`;
}

function renderBlock(block: Block, ctx: RenderContext): string {
  const accent = ctx.settings.accent_color || '#22C55E';
  switch (block.type) {
    case 'logo': {
      const src = block.url || ctx.settings.logo_url;
      if (!src)
        return `<tr><td style="padding:28px 32px 8px;font:700 22px/1.2 Helvetica,Arial,sans-serif;color:#0f1115;letter-spacing:-0.4px;">${escapeHtml(
          ctx.settings.company_name
        )}</td></tr>`;
      return `<tr><td style="padding:24px 32px 8px;"><img src="${escapeHtml(src)}" alt="${escapeHtml(
        block.alt || ctx.settings.company_name
      )}" style="max-width:200px;height:auto;display:block;border:0;" /></td></tr>`;
    }
    case 'headline':
      return `<tr><td style="padding:12px 32px 4px;font:700 26px/1.25 Helvetica,Arial,sans-serif;color:#0f1115;">${escapeHtml(
        personalize(block.text, ctx)
      )}</td></tr>`;
    case 'paragraph': {
      const paragraphs = personalize(block.text, ctx)
        .split(/\n{2,}/)
        .map(
          (p) =>
            `<p style="margin:0 0 14px;font:400 16px/1.6 Helvetica,Arial,sans-serif;color:#3b4252;">${escapeHtml(
              p
            ).replace(/\n/g, '<br />')}</p>`
        )
        .join('');
      return `<tr><td style="padding:8px 32px;">${paragraphs}</td></tr>`;
    }
    case 'image': {
      const img = `<img src="${escapeHtml(block.url)}" alt="${escapeHtml(
        block.alt || ''
      )}" style="width:100%;max-width:536px;height:auto;display:block;border:0;border-radius:10px;" />`;
      const wrapped = block.link
        ? `<a href="${escapeHtml(trackedUrl(block.link, ctx))}">${img}</a>`
        : img;
      return `<tr><td style="padding:12px 32px;">${wrapped}</td></tr>`;
    }
    case 'flyer': {
      if (!ctx.flyerUrl) return '';
      const isImage = /\.(png|jpe?g|gif|webp)$/i.test(ctx.flyerUrl);
      if (!isImage) {
        return `<tr><td style="padding:12px 32px;"><a href="${escapeHtml(
          trackedUrl(ctx.flyerUrl, ctx, 'Flyer download')
        )}" style="display:inline-block;padding:12px 20px;border-radius:8px;background:#0f1115;color:#ffffff;font:600 15px/1 Helvetica,Arial,sans-serif;text-decoration:none;">View the flyer (PDF)</a></td></tr>`;
      }
      const caption = block.caption
        ? `<div style="margin-top:8px;font:400 13px/1.5 Helvetica,Arial,sans-serif;color:#6b7280;">${escapeHtml(
            personalize(block.caption, ctx)
          )}</div>`
        : '';
      return `<tr><td style="padding:12px 32px;"><a href="${escapeHtml(
        trackedUrl(ctx.flyerUrl, ctx, 'Flyer')
      )}"><img src="${escapeHtml(
        ctx.flyerUrl
      )}" alt="Flyer" style="width:100%;max-width:536px;height:auto;display:block;border:0;border-radius:10px;" /></a>${caption}</td></tr>`;
    }
    case 'button':
      return `<tr><td style="padding:18px 32px 22px;"><a href="${escapeHtml(
        trackedUrl(block.url || ctx.settings.website, ctx, block.interest || block.label)
      )}" style="display:inline-block;padding:15px 26px;border-radius:10px;background:${escapeHtml(
        accent
      )};color:#0b0f14;font:700 16px/1 Helvetica,Arial,sans-serif;text-decoration:none;">${escapeHtml(
        personalize(block.label, ctx)
      )}</a></td></tr>`;
    case 'textus': {
      const href = smsHref(textNumber(block, ctx), personalize(block.message || '', ctx));
      // With no number configured there is nothing to tap, so show nothing
      // rather than a dead button.
      if (!href) return '';
      const label = personalize(block.label || 'Text us', ctx);
      return `<tr><td style="padding:6px 32px 18px;"><a href="${escapeHtml(
        href
      )}" style="display:inline-block;padding:15px 26px;border-radius:10px;background:#0f1115;color:#ffffff;font:700 16px/1 Helvetica,Arial,sans-serif;text-decoration:none;">${escapeHtml(
        label
      )}</a><div style="margin-top:8px;font:400 13px/1.5 Helvetica,Arial,sans-serif;color:#6b7280;">Or text us at ${escapeHtml(
        textNumber(block, ctx)
      )}</div></td></tr>`;
    }
    case 'divider':
      return `<tr><td style="padding:8px 32px;"><div style="height:1px;background:#e5e7eb;"></div></td></tr>`;
    case 'spacer':
      return `<tr><td style="height:${Math.max(4, Math.min(80, block.height ?? 16))}px;"></td></tr>`;
    case 'services':
      return `<tr><td style="padding:8px 32px 16px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="font:400 15px/1.9 Helvetica,Arial,sans-serif;color:#3b4252;">${SERVICES.map(
        (s) => `&bull; ${escapeHtml(s)}`
      ).join('<br />')}</td></tr></table></td></tr>`;
    case 'plans': {
      const chosen = block.plans?.length ? block.plans : (['basic', 'pro', 'elite'] as const);
      const cards = chosen
        .map((key) => {
          const plan = PLANS[key as keyof typeof PLANS];
          if (!plan) return '';
          return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:12px;border:1px solid #e5e7eb;border-radius:12px;">
            <tr><td style="padding:16px 18px;">
              <div style="font:700 15px/1.2 Helvetica,Arial,sans-serif;color:#0f1115;margin-bottom:8px;">${escapeHtml(
                plan.name
              )}</div>
              <div style="font:400 14px/1.8 Helvetica,Arial,sans-serif;color:#4b5563;">${plan.items
                .map((i) => `&bull; ${escapeHtml(i)}`)
                .join('<br />')}</div>
            </td></tr></table>`;
        })
        .join('');
      return `<tr><td style="padding:8px 32px;">${cards}</td></tr>`;
    }
    default:
      return '';
  }
}

/**
 * Puts the flyer ahead of the written content so it is the first thing the
 * recipient sees, with the information following underneath. Any leading logo
 * stays above it so the email still identifies the sender at a glance.
 */
export function orderBlocks(blocks: Block[]): Block[] {
  const list = (blocks || []).filter(Boolean);
  const flyerAt = list.findIndex((b) => b.type === 'flyer');
  if (flyerAt < 0) return list;
  const flyer = list[flyerAt];
  const rest = list.filter((_, i) => i !== flyerAt);
  let at = 0;
  while (at < rest.length && rest[at].type === 'logo') at += 1;
  return [...rest.slice(0, at), flyer, ...rest.slice(at)];
}

export function renderEmail(
  blocks: Block[],
  ctx: RenderContext
): { html: string; text: string } {
  const s = ctx.settings;
  const ordered = orderBlocks(blocks);
  const body = ordered.map((b) => renderBlock(b, ctx)).join('');
  const unsub = unsubscribeUrl(ctx);
  const address = s.mailing_address
    ? `${escapeHtml(s.mailing_address)}<br />`
    : '';

  const html = `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<meta name="color-scheme" content="light" />
<title>${escapeHtml(s.company_name)}</title>
</head>
<body style="margin:0;padding:0;background:#f3f4f6;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:24px 12px;">
  <tr><td align="center">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:100%;background:#ffffff;border-radius:16px;overflow:hidden;">
      <tr><td style="height:6px;background:${escapeHtml(s.accent_color || '#22C55E')};"></td></tr>
      ${body}
      <tr><td style="padding:20px 32px 28px;border-top:1px solid #e5e7eb;">
        <div style="font:400 12px/1.7 Helvetica,Arial,sans-serif;color:#6b7280;">
          ${escapeHtml(s.company_name)}<br />
          ${address}
          ${s.support_phone ? `${escapeHtml(s.support_phone)}<br />` : ''}
          <a href="${escapeHtml(s.website)}" style="color:#6b7280;">${escapeHtml(s.website)}</a>
        </div>
        <div style="margin-top:12px;font:400 12px/1.7 Helvetica,Arial,sans-serif;color:#9ca3af;">
          Don't want to receive these emails?
          <a href="${escapeHtml(unsub)}" style="color:#6b7280;text-decoration:underline;">Unsubscribe</a>
        </div>
      </td></tr>
    </table>
  </td></tr>
</table>
${openPixel(ctx)}
</body></html>`;

  const text = plainText(ordered, ctx, unsub);
  return { html, text };
}

function plainText(blocks: Block[], ctx: RenderContext, unsub: string): string {
  const lines: string[] = [];
  for (const b of blocks || []) {
    if (b.type === 'flyer') {
      if (ctx.flyerUrl) lines.push(b.caption ? personalize(b.caption, ctx) : 'Flyer', ctx.flyerUrl, '');
    } else if (b.type === 'headline') lines.push(personalize(b.text, ctx), '');
    else if (b.type === 'paragraph') lines.push(personalize(b.text, ctx), '');
    else if (b.type === 'button') lines.push(`${personalize(b.label, ctx)}: ${b.url}`, '');
    else if (b.type === 'textus') {
      const number = b.number?.trim() || ctx.settings.sms_number || ctx.settings.support_phone || '';
      if (number) lines.push(`${personalize(b.label || 'Text us', ctx)}: ${number}`, '');
    }
    else if (b.type === 'plans')
      for (const key of b.plans?.length ? b.plans : (['basic', 'pro', 'elite'] as const)) {
        const plan = PLANS[key as keyof typeof PLANS];
        if (plan) lines.push(plan.name, ...plan.items.map((i) => `- ${i}`), '');
      }
    else if (b.type === 'services') lines.push(...SERVICES.map((s) => `- ${s}`), '');
  }
  lines.push(
    '---',
    ctx.settings.company_name,
    ctx.settings.mailing_address,
    ctx.settings.website,
    `Unsubscribe: ${unsub}`
  );
  return lines.filter((l) => l !== undefined).join('\n');
}
