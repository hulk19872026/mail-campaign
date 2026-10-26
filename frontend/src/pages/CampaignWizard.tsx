import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, Check, Upload } from 'lucide-react';
import { api, errorText } from '../lib/api';
import { formatNumber } from '../lib/format';
import EmailEditor, { Block } from '../components/EmailEditor';
import SendCalendar from '../components/SendCalendar';
import {
  NO_REPEAT,
  Repeat,
  RepeatInterval,
  WEEKDAYS,
  describeRepeat,
  isRecurring,
  occurrencesFrom,
  todayIso,
  weekday,
} from '../lib/recurrence';
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

/** The repeat rule in the shape the API stores it. */
function repeatPayload(repeat: Repeat) {
  return {
    repeat_interval: repeat.interval,
    repeat_every: repeat.every,
    repeat_days: repeat.days,
    repeat_day_of_month: repeat.dayOfMonth,
    repeat_until: repeat.until,
    repeat_count: repeat.count,
  };
}

type Template = { id: number; name: string; description: string; subject: string; blocks: Block[] };

type Group = {
  id: number;
  name: string;
  description: string;
  color: string;
  member_count: string;
  emailable_count: string;
  textable_count: string;
};

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
  const [startDate, setStartDate] = useState(() => todayIso());
  const [sendTime, setSendTime] = useState('09:00');
  const [repeat, setRepeat] = useState<Repeat>(NO_REPEAT);
  const [endMode, setEndMode] = useState<'never' | 'count' | 'until'>('never');
  const [groups, setGroups] = useState<Group[]>([]);
  const [groupIds, setGroupIds] = useState<number[]>([]);
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
    api
      .get<{ groups: Group[] }>('/api/groups')
      .then((data) => setGroups(data.groups))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (current !== 'review') return;
    api
      .post('/api/campaigns/preview', {
        audience,
        audience_days: audienceDays,
        group_ids: groupIds,
        test_mode: testMode,
        blocks,
        subject,
        channel,
        sms_body: smsBody,
        flyer_path: flyer?.path,
        start_date: startDate,
        ...repeatPayload(repeat),
      })
      .then(setPreview)
      .catch((err) => toast.push('error', errorText(err)));
  }, [step, current]);

  /**
   * Switching to a repeat fills in the obvious rule from the day already
   * chosen — every week on that weekday, every month on that date — so the
   * calendar shows something sensible before anything else is touched.
   */
  const setRepeatInterval = (interval: RepeatInterval) => {
    setRepeat((r) => {
      if (interval === 'none') return NO_REPEAT;
      return {
        ...r,
        interval,
        every: 1,
        days: interval === 'weekly' ? (r.days.length ? r.days : [weekday(startDate)]) : [],
        dayOfMonth: interval === 'monthly' ? r.dayOfMonth ?? parseInt(startDate.slice(8, 10), 10) : null,
      };
    });
  };

  const toggleWeekday = (day: number) =>
    setRepeat((r) => ({
      ...r,
      days: r.days.includes(day) ? r.days.filter((d) => d !== day) : [...r.days, day].sort((a, b) => a - b),
    }));

  const setEnd = (mode: 'never' | 'count' | 'until') => {
    setEndMode(mode);
    // Only one ending can apply, so choosing one clears the other.
    setRepeat((r) => ({
      ...r,
      count: mode === 'count' ? r.count ?? 6 : null,
      until: mode === 'until' ? r.until : null,
    }));
  };

  const toggleGroup = (id: number) =>
    setGroupIds((list) => (list.includes(id) ? list.filter((g) => g !== id) : [...list, id]));

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
        group_ids: groupIds,
        test_mode: testMode,
        test_email: testEmail || null,
        start_date: startDate || null,
        send_time: sendTime,
        channel,
        sms_body: smsBody,
        flyer_path: flyer?.path ?? null,
        flyer_name: flyer?.name ?? null,
        flyer_kind: flyer?.kind ?? null,
        ...repeatPayload(repeat),
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
        group_ids: groupIds,
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
    customers: audience !== 'group' || groupIds.length > 0,
    template: blocks.length > 0,
    flyer: true,
    subject: subject.trim().length > 0,
    email: blocks.length > 0,
    message: smsBody.trim().length > 0,
    schedule:
      (!testMode || testEmail.trim().length > 0) &&
      startDate.length === 10 &&
      (repeat.interval !== 'weekly' || repeat.days.length > 0) &&
      (endMode !== 'until' || !!repeat.until) &&
      (endMode !== 'count' || !!repeat.count),
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
            <Radio
              checked={audience === 'group'}
              onChange={() => setAudience('group')}
              label="Specific customer groups"
              description="Lists you have put together yourself, on the Customer groups page."
            />
            {audience === 'group' && (
              <div className="space-y-2 rounded-xl2 border border-line bg-ink p-4">
                {groups.length === 0 ? (
                  <p className="text-sm text-muted">
                    You have not made any groups yet. Open Customer groups in the menu to create one —
                    contract holders, commercial accounts, one town — then come back here.
                  </p>
                ) : (
                  <>
                    <p className="text-sm text-soft">Pick one or more. Someone in two groups is still sent to once.</p>
                    {groups.map((group) => {
                      const reachable = Number(isSms ? group.textable_count : group.emailable_count);
                      return (
                        <button
                          key={group.id}
                          type="button"
                          onClick={() => toggleGroup(group.id)}
                          className={`flex w-full items-center justify-between gap-3 rounded-lg border p-3 text-left transition-colors ${
                            groupIds.includes(group.id)
                              ? 'border-accent bg-accent/5'
                              : 'border-line bg-panel hover:border-[#33414F]'
                          }`}
                        >
                          <span>
                            <span className="block text-sm font-medium text-white">{group.name}</span>
                            {group.description && (
                              <span className="mt-0.5 block text-xs text-muted">{group.description}</span>
                            )}
                          </span>
                          <Badge tone={reachable > 0 ? 'green' : 'grey'}>
                            {formatNumber(reachable)} {isSms ? 'textable' : 'emailable'}
                          </Badge>
                        </button>
                      );
                    })}
                    {groupIds.length === 0 && (
                      <p className="text-xs text-warn">Choose at least one group to continue.</p>
                    )}
                  </>
                )}
              </div>
            )}
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
          <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
            <div className="space-y-5">
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-white">How often should this go out?</p>
                  <HelpTip>
                    A repeating campaign goes through the whole audience again on each sending day. People
                    added to your list — or to the group — between sends are included next time.
                  </HelpTip>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {(
                    [
                      ['none', 'Once', 'Send this campaign one time.'],
                      ['daily', 'Every day', 'A short run, day after day.'],
                      ['weekly', 'Every week', 'On the weekdays you choose.'],
                      ['monthly', 'Every month', 'On the same date each month.'],
                    ] as [RepeatInterval, string, string][]
                  ).map(([value, label, description]) => (
                    <Radio
                      key={value}
                      checked={repeat.interval === value}
                      onChange={() => setRepeatInterval(value)}
                      label={label}
                      description={description}
                    />
                  ))}
                </div>
              </div>

              {isRecurring(repeat) && (
                <div className="space-y-4 rounded-xl2 border border-line bg-ink p-4">
                  <div className="flex flex-wrap items-end gap-3">
                    <Field label="Repeat every" className="w-[120px]">
                      <Select
                        value={repeat.every}
                        onChange={(e) =>
                          setRepeat((r) => ({ ...r, every: parseInt(e.target.value, 10) }))
                        }
                      >
                        {[1, 2, 3, 4, 6, 8, 12].map((n) => (
                          <option key={n} value={n}>
                            {n}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <p className="pb-3 text-sm text-soft">
                      {repeat.interval === 'daily' ? 'day' : repeat.interval === 'weekly' ? 'week' : 'month'}
                      {repeat.every === 1 ? '' : 's'}
                    </p>
                  </div>

                  {repeat.interval === 'weekly' && (
                    <div>
                      <p className="mb-1.5 text-sm font-medium text-soft">On these days</p>
                      <div className="flex flex-wrap gap-2">
                        {WEEKDAYS.map((day) => {
                          const on = repeat.days.includes(day.value);
                          return (
                            <button
                              key={day.value}
                              type="button"
                              onClick={() => toggleWeekday(day.value)}
                              className={`h-10 w-12 rounded-lg border text-xs font-semibold transition-colors ${
                                on
                                  ? 'border-accent bg-accent text-accent-text'
                                  : 'border-line bg-panel text-soft hover:border-[#33414F] hover:text-white'
                              }`}
                            >
                              {day.label}
                            </button>
                          );
                        })}
                      </div>
                      {repeat.days.length === 0 && (
                        <p className="mt-1.5 text-xs text-warn">Pick at least one day of the week.</p>
                      )}
                    </div>
                  )}

                  {repeat.interval === 'monthly' && (
                    <Field
                      label="On day of the month"
                      hint="The 29th, 30th and 31st fall back to the last day in shorter months."
                      className="max-w-[160px]"
                    >
                      <Select
                        value={repeat.dayOfMonth ?? (parseInt(startDate.slice(8, 10), 10) || 1)}
                        onChange={(e) =>
                          setRepeat((r) => ({ ...r, dayOfMonth: parseInt(e.target.value, 10) }))
                        }
                      >
                        {Array.from({ length: 31 }, (_, i) => i + 1).map((n) => (
                          <option key={n} value={n}>
                            {n}
                          </option>
                        ))}
                      </Select>
                    </Field>
                  )}

                  <div className="space-y-2 border-t border-line pt-4">
                    <p className="text-sm font-medium text-soft">Keep repeating</p>
                    <div className="flex flex-wrap items-center gap-2">
                      {(
                        [
                          ['never', 'Until I stop it'],
                          ['count', 'For a set number of sends'],
                          ['until', 'Until a date'],
                        ] as ['never' | 'count' | 'until', string][]
                      ).map(([mode, label]) => (
                        <button
                          key={mode}
                          type="button"
                          onClick={() => setEnd(mode)}
                          className={`rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
                            endMode === mode
                              ? 'border-accent bg-accent/10 text-accent'
                              : 'border-line bg-panel text-soft hover:border-[#33414F] hover:text-white'
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    {endMode === 'count' && (
                      <Field label="Number of sends" className="max-w-[160px]">
                        <Input
                          type="number"
                          min={1}
                          max={365}
                          value={repeat.count ?? ''}
                          onChange={(e) =>
                            setRepeat((r) => ({
                              ...r,
                              count: e.target.value ? Math.max(1, parseInt(e.target.value, 10)) : null,
                            }))
                          }
                        />
                      </Field>
                    )}
                    {endMode === 'until' && (
                      <Field label="Last possible send day" className="max-w-[220px]">
                        <Input
                          type="date"
                          min={startDate}
                          value={repeat.until ?? ''}
                          onChange={(e) => setRepeat((r) => ({ ...r, until: e.target.value || null }))}
                        />
                      </Field>
                    )}
                  </div>
                </div>
              )}

              <div className="flex flex-wrap gap-4 border-t border-line pt-5">
                <Field label="First sending day" className="max-w-[220px]">
                  <Input
                    type="date"
                    min={todayIso()}
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                  />
                </Field>
                <Field label="Sending starts at" className="max-w-[220px]">
                  <Input type="time" value={sendTime} onChange={(e) => setSendTime(e.target.value)} />
                </Field>
              </div>

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

            <div className="space-y-3">
              <SendCalendar repeat={repeat} startDate={startDate} onPickDate={setStartDate} />
              <p className="text-sm text-soft">{describeRepeat(repeat, startDate)}</p>
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
                label="Schedule"
                value={preview?.repeatDescription ?? describeRepeat(repeat, startDate)}
                hint="A repeating campaign sends to the whole audience again on each of these days."
              />
              <Summary label="First send" value={`${startDate} at ${sendTime}`} />
              {audience === 'group' && (
                <Summary
                  label="Groups"
                  value={
                    (preview?.groups ?? []).map((g: { name: string }) => g.name).join(', ') ||
                    groups
                      .filter((g) => groupIds.includes(g.id))
                      .map((g) => g.name)
                      .join(', ')
                  }
                />
              )}
              {isRecurring(repeat) && (
                <Summary
                  label={isSms ? 'Texts across the schedule' : 'Emails across the schedule'}
                  value={
                    repeat.count || repeat.until
                      ? formatNumber(preview?.totalSends ?? 0)
                      : `${formatNumber(preview?.recipients ?? 0)} every send, ongoing`
                  }
                  hint="Each repeat is a full send to the audience, so this is what it adds up to."
                />
              )}
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

            {isRecurring(repeat) && (
              <div className="grid gap-4 sm:grid-cols-[320px_1fr] sm:items-start">
                <SendCalendar repeat={repeat} startDate={startDate} />
                <div className="rounded-xl2 border border-line bg-ink p-4 text-sm">
                  <p className="font-medium text-white">This campaign repeats</p>
                  <p className="mt-1 text-muted">
                    It sends on each highlighted day at {sendTime}, to whoever matches the audience on
                    that day. You can pause or cancel it at any point from the campaign page.
                  </p>
                  <ul className="mt-3 space-y-1 text-xs text-soft">
                    {occurrencesFrom(repeat, startDate, 4).map((date) => (
                      <li key={date}>{date}</li>
                    ))}
                    {!repeat.count && !repeat.until && <li className="text-muted">…and onwards</li>}
                  </ul>
                </div>
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
