import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, Check, Upload } from 'lucide-react';
import { api, errorText } from '../lib/api';
import { formatNumber } from '../lib/format';
import EmailEditor, { Block } from '../components/EmailEditor';
import { Badge, Button, Card, Field, HelpTip, Input, Radio, Select, Textarea, Toggle, useToast } from '../components/ui';

// Steps are keyed rather than numbered: a text blast skips the template, flyer,
// subject and email builder, so position alone cannot say which screen is which.
const EMAIL_STEPS = ['name', 'customers', 'template', 'flyer', 'subject', 'email', 'schedule', 'review'] as const;
const SMS_STEPS = ['name', 'customers', 'message', 'schedule', 'review'] as const;

type StepKey = (typeof EMAIL_STEPS)[number] | (typeof SMS_STEPS)[number];

const STEP_LABELS: Record<StepKey, string> = {
  name: 'Name',
  customers: 'Customers',
  template: 'Template',
  flyer: 'Flyer',
  subject: 'Subject',
  email: 'Email',
  message: 'Message',
  schedule: 'Schedule',
  review: 'Review',
};

/**
 * GSM-7 fits 160 characters in one segment, 153 each once a message needs
 * several; anything outside that alphabet halves it. Each segment is billed
 * separately, which is worth seeing before a blast goes out.
 */
function segmentsOf(body: string): { characters: number; segments: number; unicode: boolean } {
  const gsm =
    /^[A-Za-z0-9@£$¥èéùìòÇØøÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&'()*+,\-./:;<=>?¡ÄÖÑÜ§¿äöñüà\n\r\f^{}\\[~\]|€]*$/;
  const unicode = !gsm.test(body);
  const single = unicode ? 70 : 160;
  const multi = unicode ? 67 : 153;
  const characters = body.length;
  const segments = characters === 0 ? 0 : characters <= single ? 1 : Math.ceil(characters / multi);
  return { characters, segments, unicode };
}

type Template = { id: number; name: string; description: string; subject: string; blocks: Block[] };

export default function CampaignWizard() {
  const [step, setStep] = useState(0);
  const [channel, setChannel] = useState<'email' | 'sms'>('email');
  const [smsBody, setSmsBody] = useState('');
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

  const isSms = channel === 'sms';
  const steps: readonly StepKey[] = isSms ? SMS_STEPS : EMAIL_STEPS;
  const current = steps[Math.min(step, steps.length - 1)];

  useEffect(() => {
    api
      .get<{ templates: Template[] }>('/api/templates')
      .then((data) => setTemplates(data.templates))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (current !== 'review') return;
    api
      .post('/api/campaigns/preview', {
        audience,
        audience_days: audienceDays,
        test_mode: testMode,
        blocks,
        subject,
        channel,
        sms_body: smsBody,
        flyer_path: flyer?.path,
      })
      .then(setPreview)
      .catch((err) => toast.push('error', errorText(err)));
  }, [step, current]);

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
        // The flyer leads the email, so it goes in just below the logo.
        setBlocks((list) => {
          const at = list.findIndex((b) => b.type !== 'logo');
          const block = { id: Math.random().toString(36).slice(2, 9), type: 'flyer' as const };
          const index = at < 0 ? list.length : at;
          return [...list.slice(0, index), block, ...list.slice(index)];
        });
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
        channel,
        sms_body: smsBody,
        flyer_path: flyer?.path ?? null,
        flyer_name: flyer?.name ?? null,
        flyer_kind: flyer?.kind ?? null,
      });
      await api.post(`/api/campaigns/${created.campaign.id}/start`);
      toast.push('success', isSms ? 'Text blast started.' : 'Campaign started. The system takes it from here.');
      navigate(`/campaigns/${created.campaign.id}`);
    } catch (err) {
      toast.push('error', errorText(err));
    } finally {
      setSaving(false);
    }
  };

  const sendTest = async () => {
    const target = testEmail.trim();
    if (isSms ? target.replace(/[^0-9]/g, '').length < 10 : !target.includes('@')) {
      toast.push('error', isSms ? 'Enter the number the test text should go to.' : 'Enter the address the test should go to.');
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
        channel,
        sms_body: smsBody,
        flyer_path: flyer?.path ?? null,
        flyer_name: flyer?.name ?? null,
        flyer_kind: flyer?.kind ?? null,
      });
      await api.post(`/api/campaigns/${created.campaign.id}/test`, isSms ? { phone: target } : { email: target });
      toast.push('success', `Test sent to ${target}. The draft was saved.`);
    } catch (err) {
      toast.push('error', errorText(err));
    }
  };

  const canContinue: Record<StepKey, boolean> = {
    name: name.trim().length > 0,
    customers: true,
    template: blocks.length > 0,
    flyer: true,
    subject: subject.trim().length > 0,
    email: blocks.length > 0,
    message: smsBody.trim().length > 0,
    schedule: !testMode || testEmail.trim().length > 0,
    review: true,
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-white">Create campaign</h1>
        <p className="mt-1 text-sm text-muted">
          {steps.length} short steps. Nothing sends until you press start on the last one.
        </p>
      </div>

      <ol className="flex flex-wrap gap-2">
        {steps.map((key, index) => (
          <li key={key}>
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
              {STEP_LABELS[key]}
            </button>
          </li>
        ))}
      </ol>

      {testMode && (
        <div className="flex items-center gap-3 rounded-xl2 border border-warn/40 bg-warn/10 px-4 py-3">
          <AlertTriangle className="h-5 w-5 shrink-0 text-warn" />
          <p className="text-sm font-medium text-white">
            Test mode is on — no customers will receive this campaign. It goes only to{' '}
            {testEmail || (isSms ? 'your test number' : 'your test address')}.
          </p>
        </div>
      )}

      <Card>
        {current === 'name' && (
          <div className="space-y-5">
            <Field label="Campaign name" hint="Only you see this. It keeps your list organised.">
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="September maintenance contract campaign"
                autoFocus
              />
            </Field>

            <div className="space-y-3 border-t border-line pt-5">
              <p className="text-sm font-medium text-white">How should this go out?</p>
              <Radio
                checked={channel === 'email'}
                onChange={() => {
                  setChannel('email');
                  setStep(0);
                }}
                label="Email campaign"
                description="The full email builder, with a flyer, plans and buttons."
              />
              <Radio
                checked={channel === 'sms'}
                onChange={() => {
                  setChannel('sms');
                  setStep(0);
                }}
                label="Text blast"
                description="A short text message. Only customers who have agreed to receive texts are included."
              />
            </div>
          </div>
        )}

        {current === 'customers' && (
          <div className="space-y-3">
            <p className="text-sm text-muted">
              Unsubscribed customers are always excluded, whichever option you pick.
            </p>
            {isSms && (
              <div className="rounded-xl2 border border-warn/40 bg-warn/10 px-4 py-3 text-sm text-white">
                A text blast only reaches customers who have a phone number and are marked as having
                agreed to receive texts. Everyone else is skipped, however you choose here.
              </div>
            )}
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

        {current === 'template' && (
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

        {current === 'flyer' && (
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

        {current === 'subject' && (
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

        {current === 'email' && <EmailEditor blocks={blocks} onChange={setBlocks} flyerPath={flyer?.path} />}

        {current === 'message' && (
          <div className="space-y-4">
            <Field
              label="Text message"
              hint="Use {{first_name}}, {{last_name}} or {{company_name}} to personalize. Keep it short — texts are billed per segment."
            >
              <Textarea
                value={smsBody}
                onChange={(e) => setSmsBody(e.target.value)}
                rows={5}
                placeholder="Hi {{first_name}}, HULK Automation has maintenance inspection spots open this month. Reply here or call 212-687-9116."
                autoFocus
              />
            </Field>

            <div className="flex flex-wrap items-center gap-3 text-xs">
              <Badge tone={segmentsOf(smsBody).segments > 1 ? 'amber' : 'green'}>
                {segmentsOf(smsBody).characters} characters · {segmentsOf(smsBody).segments} segment
                {segmentsOf(smsBody).segments === 1 ? '' : 's'}
              </Badge>
              {segmentsOf(smsBody).unicode && (
                <span className="text-muted">
                  Contains characters outside the basic set (an emoji or a curly quote), which cuts a
                  segment from 160 characters to 70.
                </span>
              )}
            </div>

            <div className="rounded-xl2 border border-line bg-ink p-4">
              <p className="text-xs text-muted">This is sent as:</p>
              <p className="mt-2 whitespace-pre-wrap text-sm text-white">
                {smsBody.trim()
                  ? `${smsBody.trim()}${/\bSTOP\b/i.test(smsBody) ? '' : '\n\nReply STOP to opt out.'}`
                  : 'Your message appears here.'}
              </p>
              <p className="mt-3 text-xs text-muted">
                The opt-out line is added automatically when your message does not already have one.
                Marketing texts are required to carry it.
              </p>
            </div>
          </div>
        )}

        {current === 'schedule' && (
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
                <Field label={isSms ? 'Test number' : 'Test address'} className="mt-3 max-w-sm">
                  <Input
                    type={isSms ? 'tel' : 'email'}
                    value={testEmail}
                    onChange={(e) => setTestEmail(e.target.value)}
                    placeholder={isSms ? '+1 212 687 9116' : 'david@hulkautomation.com'}
                  />
                </Field>
              )}
            </div>
          </div>
        )}

        {current === 'review' && (
          <div className="space-y-5">
            <h2 className="text-lg font-semibold text-white">
              {isSms ? 'Text blast ready' : 'Campaign ready'}
            </h2>
            <dl className="grid gap-4 sm:grid-cols-2">
              <Summary label="Campaign" value={name} />
              <Summary
                label="Recipients"
                value={formatNumber(preview?.recipients ?? 0)}
                hint={isSms ? 'Only customers with a number and texting consent are counted.' : undefined}
              />
              <Summary
                label="Daily limit"
                value={`${preview?.dailyLimit ?? 99} ${isSms ? 'texts' : 'emails'} per day`}
                hint="The system never sends more than this in one calendar day."
              />
              <Summary label="Estimated completion" value={`${preview?.estimatedDays ?? 1} business days`} />
              <Summary label="From" value={preview?.from ?? ''} />
              {!isSms && <Summary label="Subject" value={subject} />}
              {isSms && (
                <Summary
                  label="Message size"
                  value={
                    preview?.smsSegments
                      ? `${preview.smsSegments.characters} characters · ${preview.smsSegments.segments} segment${
                          preview.smsSegments.segments === 1 ? '' : 's'
                        } each`
                      : '—'
                  }
                  hint="Every segment is billed separately, for every recipient."
                />
              )}
            </dl>

            {isSms && preview && !preview.smsReady && (
              <div className="flex items-center gap-3 rounded-xl2 border border-danger/40 bg-danger/10 px-4 py-3">
                <AlertTriangle className="h-5 w-5 shrink-0 text-danger" />
                <p className="text-sm text-white">
                  Texting is not connected yet. Add the Twilio credentials and a sending number before
                  starting this blast — Settings → Texting shows what is missing.
                </p>
              </div>
            )}

            {isSms && preview?.recipients === 0 && (
              <div className="flex items-center gap-3 rounded-xl2 border border-warn/40 bg-warn/10 px-4 py-3">
                <AlertTriangle className="h-5 w-5 shrink-0 text-warn" />
                <p className="text-sm text-white">
                  Nobody in this audience has both a phone number and texting consent, so this blast
                  would reach no one. Mark who has agreed on the Customers page first.
                </p>
              </div>
            )}

            {testMode && <Badge tone="amber">Test mode — only {testEmail} receives this</Badge>}

            {isSms && preview?.smsBody && (
              <div className="rounded-xl2 border border-line bg-ink p-4">
                <p className="text-xs text-muted">Every recipient gets:</p>
                <p className="mt-2 whitespace-pre-wrap text-sm text-white">{preview.smsBody}</p>
              </div>
            )}

            {!isSms && preview?.html && (
              <div className="overflow-hidden rounded-xl2 border border-line bg-white">
                <iframe title="Final preview" srcDoc={preview.html} className="h-[420px] w-full border-0" sandbox="" />
              </div>
            )}

            <div className="flex flex-wrap items-center gap-3 border-t border-line pt-5">
              <Input
                type={isSms ? 'tel' : 'email'}
                value={testEmail}
                onChange={(e) => setTestEmail(e.target.value)}
                placeholder={isSms ? 'Send a test text to…' : 'Send a test to…'}
                className="max-w-xs"
              />
              <Button onClick={sendTest}>Send test</Button>
              <div className="flex-1" />
              <Button variant="primary" size="lg" loading={saving} onClick={launch}>
                {isSms ? 'Start text blast' : 'Start campaign'}
              </Button>
            </div>
          </div>
        )}
      </Card>

      <div className="flex items-center justify-between">
        <Button onClick={() => (step === 0 ? navigate('/campaigns') : setStep((s) => s - 1))}>
          {step === 0 ? 'Cancel' : 'Back'}
        </Button>
        {step < steps.length - 1 && (
          <Button variant="primary" disabled={!canContinue[current]} onClick={() => setStep((s) => s + 1)}>
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
