import { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, Trash2 } from 'lucide-react';
import { api } from '../lib/api';
import { Button, Card, Field, Input, Select, Textarea } from './ui';

export type Block = {
  id: string;
  type: string;
  text?: string;
  label?: string;
  url?: string;
  alt?: string;
  caption?: string;
  interest?: string;
  message?: string;
  number?: string;
  height?: number;
  plans?: string[];
};

const BLOCK_LIBRARY: { type: string; label: string; make: () => Block }[] = [
  { type: 'logo', label: 'Logo', make: () => ({ id: rid(), type: 'logo' }) },
  {
    type: 'headline',
    label: 'Headline',
    make: () => ({ id: rid(), type: 'headline', text: 'Is your security system ready for what comes next?' }),
  },
  {
    type: 'paragraph',
    label: 'Paragraph',
    make: () => ({
      id: rid(),
      type: 'paragraph',
      text: 'Hi {{first_name}},\n\nKeeping your security and low-voltage systems maintained helps prevent unexpected failures.',
    }),
  },
  { type: 'image', label: 'Image', make: () => ({ id: rid(), type: 'image', url: '', alt: '' }) },
  { type: 'flyer', label: 'Flyer', make: () => ({ id: rid(), type: 'flyer', caption: '' }) },
  {
    type: 'button',
    label: 'Button',
    make: () => ({
      id: rid(),
      type: 'button',
      label: 'Schedule your maintenance',
      url: 'https://hulkautomation.com',
      interest: 'Maintenance plan',
    }),
  },
  {
    type: 'textus',
    label: 'Text us button',
    make: () => ({
      id: rid(),
      type: 'textus',
      label: 'Text us',
      message: 'Hi HULK Automation, I would like to ask about ',
    }),
  },
  {
    type: 'plans',
    label: 'Maintenance plans',
    make: () => ({ id: rid(), type: 'plans', plans: ['basic', 'pro', 'elite'] }),
  },
  { type: 'services', label: 'Service list', make: () => ({ id: rid(), type: 'services' }) },
  { type: 'divider', label: 'Divider', make: () => ({ id: rid(), type: 'divider' }) },
  { type: 'spacer', label: 'Spacer', make: () => ({ id: rid(), type: 'spacer', height: 24 }) },
];

function rid() {
  return Math.random().toString(36).slice(2, 9);
}

export default function EmailEditor({
  blocks,
  onChange,
  flyerPath,
}: {
  blocks: Block[];
  onChange: (blocks: Block[]) => void;
  flyerPath?: string | null;
}) {
  const [html, setHtml] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => {
      api
        .post<{ html: string }>('/api/templates/render', { blocks, flyer_path: flyerPath })
        .then((data) => setHtml(data.html))
        .catch(() => undefined);
    }, 250);
    return () => clearTimeout(timer);
  }, [blocks, flyerPath]);

  const update = (id: string, patch: Partial<Block>) =>
    onChange(blocks.map((b) => (b.id === id ? { ...b, ...patch } : b)));

  const move = (index: number, direction: -1 | 1) => {
    const next = [...blocks];
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <div className="space-y-3">
        <div className="flex flex-wrap gap-2">
          {BLOCK_LIBRARY.map((item) => (
            <Button key={item.type} size="sm" onClick={() => onChange([...blocks, item.make()])}>
              + {item.label}
            </Button>
          ))}
        </div>

        {blocks.length === 0 && (
          <Card>
            <p className="text-sm text-muted">
              Add blocks above to build the email. Most campaigns are a logo, a headline, a paragraph, the
              maintenance plans and a button.
            </p>
          </Card>
        )}

        {blocks.map((block, index) => (
          <Card key={block.id} className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold capitalize text-white">{block.type}</span>
              <div className="flex gap-1">
                <button
                  onClick={() => move(index, -1)}
                  className="rounded p-1.5 text-muted hover:bg-raised hover:text-white"
                  aria-label="Move up"
                >
                  <ArrowUp className="h-4 w-4" />
                </button>
                <button
                  onClick={() => move(index, 1)}
                  className="rounded p-1.5 text-muted hover:bg-raised hover:text-white"
                  aria-label="Move down"
                >
                  <ArrowDown className="h-4 w-4" />
                </button>
                <button
                  onClick={() => onChange(blocks.filter((b) => b.id !== block.id))}
                  className="rounded p-1.5 text-muted hover:bg-raised hover:text-danger"
                  aria-label="Remove block"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>

            {block.type === 'headline' && (
              <Input value={block.text ?? ''} onChange={(e) => update(block.id, { text: e.target.value })} />
            )}

            {block.type === 'paragraph' && (
              <Field
                label="Text"
                hint="Use {{first_name}}, {{last_name}}, {{company_name}} or {{email}} to personalize."
              >
                <Textarea value={block.text ?? ''} onChange={(e) => update(block.id, { text: e.target.value })} />
              </Field>
            )}

            {block.type === 'button' && (
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Button text">
                  <Input value={block.label ?? ''} onChange={(e) => update(block.id, { label: e.target.value })} />
                </Field>
                <Field label="Link">
                  <Input value={block.url ?? ''} onChange={(e) => update(block.id, { url: e.target.value })} />
                </Field>
                <Field
                  label="Records a lead as"
                  hint="Clicks on this button create a maintenance lead with this label."
                  className="sm:col-span-2"
                >
                  <Input
                    value={block.interest ?? ''}
                    onChange={(e) => update(block.id, { interest: e.target.value })}
                  />
                </Field>
              </div>
            )}

            {block.type === 'textus' && (
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Button text">
                  <Input value={block.label ?? ''} onChange={(e) => update(block.id, { label: e.target.value })} />
                </Field>
                <Field label="Number" hint="Leave empty to use the texting number from Settings.">
                  <Input
                    value={block.number ?? ''}
                    onChange={(e) => update(block.id, { number: e.target.value })}
                    placeholder="+1 732 555 0142"
                  />
                </Field>
                <Field
                  label="Message they start with"
                  hint="Pre-fills their text app. Taps open the phone directly, so these are not counted as clicks."
                  className="sm:col-span-2"
                >
                  <Input
                    value={block.message ?? ''}
                    onChange={(e) => update(block.id, { message: e.target.value })}
                  />
                </Field>
              </div>
            )}

            {block.type === 'image' && (
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Image address">
                  <Input value={block.url ?? ''} onChange={(e) => update(block.id, { url: e.target.value })} />
                </Field>
                <Field label="Description for screen readers">
                  <Input value={block.alt ?? ''} onChange={(e) => update(block.id, { alt: e.target.value })} />
                </Field>
              </div>
            )}

            {block.type === 'flyer' && (
              <Field label="Caption" hint="The flyer you upload on the campaign appears here.">
                <Input value={block.caption ?? ''} onChange={(e) => update(block.id, { caption: e.target.value })} />
              </Field>
            )}

            {block.type === 'plans' && (
              <Field label="Which plans to show">
                <Select
                  value={(block.plans ?? []).join(',')}
                  onChange={(e) => update(block.id, { plans: e.target.value.split(',') })}
                >
                  <option value="basic,pro,elite">All three plans</option>
                  <option value="basic">HULK Basic only</option>
                  <option value="pro">HULK Pro only</option>
                  <option value="elite">HULK Elite only</option>
                  <option value="pro,elite">Pro and Elite</option>
                </Select>
              </Field>
            )}

            {block.type === 'spacer' && (
              <Field label="Height in pixels">
                <Input
                  type="number"
                  value={block.height ?? 24}
                  onChange={(e) => update(block.id, { height: parseInt(e.target.value, 10) || 24 })}
                />
              </Field>
            )}
          </Card>
        ))}
      </div>

      <div className="lg:sticky lg:top-24 lg:h-fit">
        <p className="mb-2 text-sm text-muted">Preview — this is what your customer receives</p>
        <div className="overflow-hidden rounded-xl2 border border-line bg-white">
          <iframe
            title="Email preview"
            srcDoc={html}
            className="h-[620px] w-full border-0"
            sandbox="allow-same-origin"
          />
        </div>
      </div>
    </div>
  );
}
