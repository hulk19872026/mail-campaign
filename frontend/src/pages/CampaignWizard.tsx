import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, Check, Upload } from 'lucide-react';
import { api, errorText } from '../lib/api';
import { formatNumber } from '../lib/format';
import EmailEditor, { Block } from '../components/EmailEditor';
import { Badge, Button, Card, Field, HelpTip, Input, Radio, Select, Toggle, useToast } from '../components/ui';

const STEPS = [
  'Name',
  'Customers',
  'Template',
  'Flyer',
  'Subject',
  'Email',
  'Schedule',
  'Review',
];

type Template = { id: number; name: string; description: string; subject: string; blocks: Block[] };

export default function CampaignWizard() {
  const [step, setStep] = useState(0);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [name, setName] = useState('');
  const [audience, setAudience] = useState('active');
  const [audienceDays, setAudienceDays] = useState(90);
  const [templateId, setTemplateId] = useState<number | null>(null);
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [subject, setSubject] = useState('');
  const [flyer, setFlyer] = useState<{ path: string; name: string; kind: string } | null>(null);
  const [testMode, setTestMode] = useState(false);
  const [testEmail, setTestEmail] = useState('');
  const [startChoice, setStartChoice] = useState('today');
  const [startDate, setStartDate] = useState('');
  const [sendTime, setSendTime] = useState('09:00');
  const [preview, setPreview] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const toast = useToast();
  const navigate = useNavigate();

  useEffect(() => {
    api
      .get<{ templates: Template[] }>('/api/templates')
      .then((data) => setTemplates(data.templates))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (step !== 7) return;
    api
      .post('/api/campaigns/preview', {
        audience,
        audience_days: audienceDays,
        test_mode: testMode,
        blocks,
        subject,
        flyer_path: flyer?.path,
      })
      .then(setPreview)
      .catch((err) => toast.push('error', errorText(err)));
  }, [step]);

  const chooseTemplate = (template: Template) => {
    setTemplateId(template.id);
    setBlocks(template.blocks ?? []);
    if (!subject) setSubject(template.subject);
  };

  const uploadFlyer = async (file: File) => {
    try {
      const result = await api.upload<{ path: string; name: string; kind: string }>('/api/uploads', file);
      setFlyer(result);
      if (!blocks.some((b) => b.type === 'flyer')) {
        setBlocks((list) => [...list, { id: Math.random().toString(36).slice(2, 9), type: 'flyer' }]);
      }
      toast.push('success', 'Flyer uploaded.');
    } catch (err) {
      toast.push('error', errorText(err));
    }
  };

  const launch = async () => {
    setSaving(true);
    try {
      const created = await api.post<{ campaign: { id: number } }>('/api/campaigns', {
        name,
        subject,
        template_id: templateId,
        blocks,
        audience,
        audience_days: audienceDays,
        test_mode: testMode,
        test_email: testEmail || null,
        start_date: startChoice === 'date' ? startDate : null,
        send_time: sendTime,
        flyer_path: flyer?.path ?? null,
        flyer_name: flyer?.name ?? null,
        flyer_kind: flyer?.kind ?? null,
      });
      await api.post(`/api/campaigns/${created.campaign.id}/start`);
      toast.push('success', 'Campaign started. The system takes it from here.');
      navigate(`/campaigns/${created.campaign.id}`);
    } catch (err) {
      toast.push('error', errorText(err));
    } finally {
      setSaving(false);
    }
  };

  const sendTest = async () => {
    if (!testEmail.includes('@')) {
      toast.push('error', 'Enter the address the test should go to.');
      return;
    }
    try {
      const created = await api.post<{ campaign: { id: number } }>('/api/campaigns', {
        name: name || 'Draft campaign',
        subject,
        template_id: templateId,
        blocks,
        audience,
        audience_days: audienceDays,
        flyer_path: flyer?.path ?? null,
        flyer_name: flyer?.name ?? null,
        flyer_kind: flyer?.kind ?? null,
      });
      await api.post(`/api/campaigns/${created.campaign.id}/test`, { email: testEmail });
      toast.push('success', `Test sent to ${testEmail}. The draft was saved.`);
    } catch (err) {
      toast.push('error', errorText(err));
    }
  };

  const canContinue = [
    name.trim().length > 0,
    true,
    blocks.length > 0,
    true,
    subject.trim().length > 0,
    blocks.length > 0,
    !testMode || testEmail.includes('@'),
    true,
  ][step];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-white">Create campaign</h1>
        <p className="mt-1 text-sm text-muted">
          Eight short steps. Nothing sends until you press start on the last one.
        </p>
      </div>

      <ol className="flex flex-wrap gap-2">
        {STEPS.map((label, index) => (
          <li key={label}>
            <button
              onClick={() => index < step && setStep(index)}
              className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium ${
                index === step
                  ? 'border-accent bg-accent/10 text-accent'
                  : index < step
                  ? 'border-line bg-raised text-soft'
                  : 'border-line text-muted'
              }`}
            >
              {index < step ? <Check className="h-3.5 w-3.5" /> : <span>{index + 1}</span>}
              {label}
            </button>
          </li>
        ))}
      </ol>

      {testMode && (
        <div className="flex items-center gap-3 rounded-xl2 border border-warn/40 bg-warn/10 px-4 py-3">
          <AlertTriangle className="h-5 w-5 shrink-0 text-warn" />
          <p className="text-sm font-medium text-white">
            Test mode is on — no customers will receive this campaign. It goes only to {testEmail || 'your test address'}.
          </p>
        </div>
      )}

      <Card>
        {step === 0 && (
          <Field label="Campaign name" hint="Only you see this. It keeps your list organised.">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="September maintenance contract campaign"
              autoFocus
            />
          </Field>
        )}

        {step === 1 && (
          <div className="space-y-3">
            <p className="text-sm text-muted">
              Unsubscribed customers are always excluded, whichever option you pick.
            </p>
            <Radio
              checked={audience === 'all'}
              onChange={() => setAudience('all')}
              label="All customers"
              description="Everyone in your list with a valid email address."
            />
            <Radio
              checked={audience === 'active'}
              onChange={() => setAudience('active')}
              label="Active customers"
              description="Everyone except disabled and unsubscribed records."
            />
            <Radio
              checked={audience === 'never_emailed'}
              onChange={() => setAudience('never_emailed')}
              label="Customers who have never received a campaign"
            />
            <Radio
              checked={audience === 'not_in_days'}
              onChange={() => setAudience('not_in_days')}
              label="Customers not emailed recently"
              description="Give people a rest between campaigns."
            />
            {audience === 'not_in_days' && (
              <Field label="Not emailed in the last" className="max-w-[200px]">
                <Select value={audienceDays} onChange={(e) => setAudienceDays(parseInt(e.target.value, 10))}>
                  <option value={30}>30 days</option>
                  <option value={60}>60 days</option>
                  <option value={90}>90 days</option>
                  <option value={180}>180 days</option>
                </Select>
              </Field>
            )}
          </div>
        )}

        {step === 2 && (
          <div className="grid gap-3 sm:grid-cols-2">
            {templates.map((template) => (
              <button
                key={template.id}
                onClick={() => chooseTemplate(template)}
                className={`rounded-xl2 border p-4 text-left transition-colors ${
                  templateId === template.id ? 'border-accent bg-accent/5' : 'border-line hover:border-[#33414F]'
                }`}
              >
                <p className="font-medium text-white">{template.name}</p>
                <p className="mt-1 text-xs text-muted">{template.description}</p>
                <p className="mt-3 text-xs text-soft">Subject: {template.subject}</p>
              </button>
            ))}
            <button
              onClick={() => {
                setTemplateId(null);
                setBlocks([]);
              }}
              className={`rounded-xl2 border border-dashed p-4 text-left ${
                templateId === null && blocks.length === 0 ? 'border-accent' : 'border-line'
              }`}
            >
              <p className="font-medium text-white">Start from scratch</p>
              <p className="mt-1 text-xs text-muted">Build the email block by block in the next steps.</p>
            </button>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4">
            <input
              ref={fileInput}
              type="file"
              accept=".png,.jpg,.jpeg,.pdf"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && uploadFlyer(e.target.files[0])}
            />
            <div className="rounded-xl2 border border-dashed border-line p-8 text-center">
              <Upload className="mx-auto mb-3 h-7 w-7 text-muted" />
              <p className="text-sm text-soft">PNG, JPG or PDF, up to 8 MB.</p>
              <p className="mt-1 text-xs text-muted">
                Images appear inside the email. PDFs are attached and linked.
              </p>
              <Button className="mt-4" onClick={() => fileInput.current?.click()}>
                Choose a file
              </Button>
            </div>
            {flyer && (
              <div className="flex items-center justify-between rounded-lg border border-line bg-ink px-4 py-3">
                <span className="text-sm text-white">{flyer.name}</span>
                <Button size="sm" variant="ghost" onClick={() => setFlyer(null)}>
                  Remove
                </Button>
              </div>
            )}
            <p className="text-sm text-muted">A flyer is optional — you can skip this step.</p>
          </div>
        )}

        {step === 4 && (
          <Field
            label="Subject line"
            hint="Keep it under about 60 characters so phones don't cut it off."
          >
            <Input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Protect your security system before it fails"
              autoFocus
            />
          </Field>
        )}

        {step === 5 && <EmailEditor blocks={blocks} onChange={setBlocks} flyerPath={flyer?.path} />}

        {step === 6 && (
          <div className="space-y-4">
            <div className="space-y-3">
              <Radio checked={startChoice === 'today'} onChange={() => setStartChoice('today')} label="Start today" />
              <Radio
                checked={startChoice === 'tomorrow'}
                onChange={() => {
                  setStartChoice('tomorrow');
                  const d = new Date();
                  d.setDate(d.getDate() + 1);
                  setStartDate(d.toISOString().slice(0, 10));
                }}
                label="Start tomorrow"
              />
              <Radio checked={startChoice === 'date'} onChange={() => setStartChoice('date')} label="Choose a date" />
              {startChoice === 'date' && (
                <Field label="First sending day" className="max-w-[220px]">
                  <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
                </Field>
              )}
            </div>

            <Field label="Sending starts at" className="max-w-[220px]">
              <Input type="time" value={sendTime} onChange={(e) => setSendTime(e.target.value)} />
            </Field>

            <div className="rounded-xl2 border border-line bg-ink p-4">
              <Toggle checked={testMode} onChange={setTestMode} label="Test mode — send only to one address" />
              {testMode && (
                <Field label="Test address" className="mt-3 max-w-sm">
                  <Input
                    type="email"
                    value={testEmail}
                    onChange={(e) => setTestEmail(e.target.value)}
                    placeholder="david@hulkautomation.com"
                  />
                </Field>
              )}
            </div>
          </div>
        )}

        {step === 7 && (
          <div className="space-y-5">
            <h2 className="text-lg font-semibold text-white">Campaign ready</h2>
            <dl className="grid gap-4 sm:grid-cols-2">
              <Summary label="Campaign" value={name} />
              <Summary label="Recipients" value={formatNumber(preview?.recipients ?? 0)} />
              <Summary
                label="Daily limit"
                value={`${preview?.dailyLimit ?? 99} emails per day`}
                hint="The system never sends more than this in one calendar day."
              />
              <Summary label="Estimated completion" value={`${preview?.estimatedDays ?? 1} business days`} />
              <Summary label="From" value={preview?.from ?? ''} />
              <Summary label="Subject" value={subject} />
            </dl>

            {testMode && <Badge tone="amber">Test mode — only {testEmail} receives this</Badge>}

            {preview?.html && (
              <div className="overflow-hidden rounded-xl2 border border-line bg-white">
                <iframe title="Final preview" srcDoc={preview.html} className="h-[420px] w-full border-0" sandbox="" />
              </div>
            )}

            <div className="flex flex-wrap items-center gap-3 border-t border-line pt-5">
              <Input
                type="email"
                value={testEmail}
                onChange={(e) => setTestEmail(e.target.value)}
                placeholder="Send a test to…"
                className="max-w-xs"
              />
              <Button onClick={sendTest}>Send test</Button>
              <div className="flex-1" />
              <Button variant="primary" size="lg" loading={saving} onClick={launch}>
                Start campaign
              </Button>
            </div>
          </div>
        )}
      </Card>

      <div className="flex items-center justify-between">
        <Button onClick={() => (step === 0 ? navigate('/campaigns') : setStep((s) => s - 1))}>
          {step === 0 ? 'Cancel' : 'Back'}
        </Button>
        {step < STEPS.length - 1 && (
          <Button variant="primary" disabled={!canContinue} onClick={() => setStep((s) => s + 1)}>
            Continue
          </Button>
        )}
      </div>
    </div>
  );
}

function Summary({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <dt className="flex items-center gap-1.5 text-xs text-muted">
        {label}
        {hint && <HelpTip>{hint}</HelpTip>}
      </dt>
      <dd className="mt-1 text-sm font-medium text-white">{value || '—'}</dd>
    </div>
  );
}
