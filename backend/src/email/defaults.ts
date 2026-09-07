import { one, query } from '../lib/db';
import { Block } from './render';

type SeedTemplate = {
  name: string;
  description: string;
  subject: string;
  blocks: Block[];
};

const b = (id: string, block: any): Block => ({ id, ...block });

export const SEED_TEMPLATES: SeedTemplate[] = [
  {
    name: 'Maintenance contract offer',
    description: 'Introduces the three maintenance plans and asks for a booking.',
    subject: 'Protect Your Security System Before It Fails',
    blocks: [
      b('logo', { type: 'logo' }),
      b('headline', { type: 'headline', text: 'Is your security system ready for what comes next?' }),
      b('intro', {
        type: 'paragraph',
        text:
          'Hi {{first_name}},\n\nKeeping your security and low-voltage systems maintained can help prevent unexpected failures — usually at the worst possible moment. We offer three maintenance plans for {{company_name}}, and every one of them includes scheduled inspections by the same techs who installed your equipment.',
      }),
      b('plans', { type: 'plans', plans: ['basic', 'pro', 'elite'] }),
      b('cta', {
        type: 'button',
        label: 'Schedule your maintenance',
        url: 'https://hulkautomation.com',
        interest: 'Maintenance plan',
      }),
      b('textus', {
        type: 'textus',
        label: 'Text us',
        message: 'Hi HULK Automation, I would like to hear about the maintenance plans.',
      }),
      b('close', {
        type: 'paragraph',
        text: 'Reply to this email if you would rather talk it through — we will call you back the same day.',
      }),
    ],
  },
  {
    name: 'Seasonal system check-up',
    description: 'Shorter note offering a single inspection visit, with a flyer.',
    subject: 'A quick check-up for your cameras and alarm',
    blocks: [
      b('logo', { type: 'logo' }),
      b('flyer', { type: 'flyer', caption: 'This month\u2019s maintenance flyer' }),
      b('headline', { type: 'headline', text: 'When did your cameras last get looked at?' }),
      b('intro', {
        type: 'paragraph',
        text:
          'Hi {{first_name}},\n\nDust, weather and firmware drift take a quiet toll on camera, alarm and access control equipment. A short inspection now is far cheaper than an emergency call later.',
      }),
      b('services', { type: 'services' }),
      b('cta', {
        type: 'button',
        label: 'Book an inspection',
        url: 'https://hulkautomation.com',
        interest: 'Inspection',
      }),
      b('textus', {
        type: 'textus',
        label: 'Text us',
        message: 'Hi HULK Automation, I would like to book an inspection.',
      }),
    ],
  },
  {
    name: 'Service reminder',
    description: 'Plain, friendly reminder for customers you have not contacted in a while.',
    subject: 'Still here when your system needs us',
    blocks: [
      b('logo', { type: 'logo' }),
      b('headline', { type: 'headline', text: 'Need a hand with your system?' }),
      b('intro', {
        type: 'paragraph',
        text:
          'Hi {{first_name}},\n\nIt has been a while since we worked on the systems at {{company_name}}. If anything is acting up — a camera offline, a reader that stops reading, phones dropping calls — we can take a look.',
      }),
      b('cta', {
        type: 'button',
        label: 'Request service',
        url: 'https://hulkautomation.com',
        interest: 'Service request',
      }),
      b('textus', {
        type: 'textus',
        label: 'Text us',
        message: 'Hi HULK Automation, I need a hand with my system.',
      }),
      b('divider', { type: 'divider' }),
      b('plans', { type: 'plans', plans: ['pro'] }),
    ],
  },
];

export async function seedTemplates(): Promise<void> {
  const row = await one<{ count: string }>('SELECT count(*)::text AS count FROM email_templates');
  if (row && Number(row.count) > 0) return;
  for (const t of SEED_TEMPLATES) {
    await query(
      `INSERT INTO email_templates (name, description, subject, blocks, is_system)
       VALUES ($1, $2, $3, $4, true)`,
      [t.name, t.description, t.subject, JSON.stringify(t.blocks)]
    );
  }
}
