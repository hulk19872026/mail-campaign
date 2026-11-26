import { useEffect, useState } from 'react';
import { CheckCircle2, Mail, PauseCircle, PlayCircle, Send, XCircle } from 'lucide-react';
import { api, errorText } from '../lib/api';
import { formatDate } from '../lib/format';
import { Badge, Button, Card, Field, Input, Modal, Spinner, Textarea, Toggle, useToast } from './ui';

export type OutreachSettings = {
  enabled: boolean;
  lists: string[];
  daily_new_limit: number;
  start_time: string;
  end_time: string;
  gap_minutes: number;
  track_opens: boolean;
  from_name: string;
  signature: string;
};

type Step = { list: string; step: number; subject: string; body: string };

export type OutreachInfo = {
  settings: OutreachSettings;
  configured: boolean;
  sender: string;
  problems: string[];
  steps: Step[];
  waiting: { list: string; count: string }[];
  recent: {
    id: number;
    step: number;
    to_email: string;
    subject: string;
    error: string;
    sent_at: string;
    opened_at: string | null;
    open_count: number;
    business_name: string | null;
  }[];
  stats: { sentToday: number; newToday: number };
  state: { lastResult: string; lastRunAt: string | null; lastInboxCheckAt: string | null; lastInboxResult: string; lastError: string };
};

const STEP_LABELS = ['', 'Email 1 — day 1', 'Email 2 — day 4 (reply in same thread)', 'Email 3 — day 10 (last one)'];

/** The strip at the top of the Prospects page: is automatic sending on, and how is today going. */
export function OutreachBar({
  info,
  onOpen,
}: {
  info: OutreachInfo | null;
  onOpen: () => void;
}) {
  if (!info) return null;
  const on = info.settings.enabled && info.problems.length === 0;
  return (
    <Card className={on ? 'border-accent/40' : 'border-warn/40'}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 gap-3">
          {on ? (
            <PlayCircle className="mt-0.5 h-5 w-5 shrink-0 text-accent" />
          ) : (
            <PauseCircle className="mt-0.5 h-5 w-5 shrink-0 text-warn" />
          )}
          <div className="min-w-0 text-sm">
            <p className="font-semibold text-white">
              Automatic emails {on ? 'on' : 'off'}
              {info.sender && <span className="font-normal text-muted"> · from {info.sender}</span>}
            </p>
            <p className="text-soft">
              {on
                ? `${info.stats.newToday} of ${info.settings.daily_new_limit} new prospects emailed today, ${info.stats.sentToday} emails in all. Monday–Friday, ${info.settings.start_time}–${info.settings.end_time}.`
                : info.problems[0] ??
                  'Nothing is emailed until you switch it on. Prospects never go through Resend, so customer campaigns are never at risk.'}
            </p>
            {on && info.state.lastResult && <p className="text-xs text-muted">Last check: {info.state.lastResult}</p>}
          </div>
        </div>
        <Button icon={<Mail className="h-4 w-4" />} onClick={onOpen}>
          Automatic emails
        </Button>
      </div>
    </Card>
  );
}

export function OutreachModal({
  open,
  lists,
  initialList,
  onClose,
  onChanged,
}: {
  open: boolean;
  lists: { id: string; label: string }[];
  initialList: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [info, setInfo] = useState<OutreachInfo | null>(null);
  const [settings, setSettings] = useState<OutreachSettings | null>(null);
  const [list, setList] = useState(initialList);
  const [steps, setSteps] = useState<Record<string, Step[]>>({});
  const [testTo, setTestTo] = useState('');
  const [busy, setBusy] = useState('');
  const [connection, setConnection] = useState<{ smtp: string; imap: string } | null>(null);
  const toast = useToast();

  const load = () =>
    api.get<OutreachInfo>('/api/outreach').then((data) => {
      setInfo(data);
      setSettings(data.settings);
      const byList: Record<string, Step[]> = {};
      for (const l of lists) {
        byList[l.id] = [1, 2, 3].map(
          (n) => data.steps.find((s) => s.list === l.id && s.step === n) ?? { list: l.id, step: n, subject: '', body: '' }
        );
      }
      setSteps(byList);
    });

  useEffect(() => {
    if (!open) return;
    setList(initialList);
    setConnection(null);
    load().catch((err) => toast.push('error', errorText(err)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    try {
      await fn();
    } catch (err) {
      toast.push('error', errorText(err));
    } finally {
      setBusy('');
    }
  };

  const saveSettings = (patch: Partial<OutreachSettings> = {}) =>
    run('settings', async () => {
      const { settings: saved } = await api.put<{ settings: OutreachSettings }>('/api/outreach', { ...settings, ...patch });
      setSettings(saved);
      toast.push('success', patch.enabled === true ? 'Automatic emails are on.' : patch.enabled === false ? 'Automatic emails are off.' : 'Settings saved.');
      await load();
      onChanged();
    });

  const saveSteps = () =>
    run('steps', async () => {
      await api.put(`/api/outreach/steps/${list}`, { steps: steps[list] });
      toast.push('success', 'Emails saved.');
      await load();
    });

  const sendTest = (step: number) =>
    run(`test${step}`, async () => {
      await api.put(`/api/outreach/steps/${list}`, { steps: steps[list] });
      const r = await api.post<{ to: string; sample: string }>('/api/outreach/test', { list, step, to: testTo.trim() || undefined });
      toast.push('success', `Test sent to ${r.to}, filled in with ${r.sample}.`);
    });

  const verify = () =>
    run('verify', async () => {
      setConnection(await api.post<{ smtp: string; imap: string }>('/api/outreach/verify'));
    });

  const checkInbox = () =>
    run('inbox', async () => {
      const r = await api.post<{ result: string }>('/api/outreach/check-inbox');
      toast.push('success', `Inbox checked: ${r.result}`);
      await load();
      onChanged();
    });

  const setStep = (n: number, key: 'subject' | 'body', value: string) =>
    setSteps((all) => ({
      ...all,
      [list]: all[list].map((s) => (s.step === n ? { ...s, [key]: value } : s)),
    }));

  const set = <K extends keyof OutreachSettings>(key: K, value: OutreachSettings[K]) =>
    setSettings((s) => (s ? { ...s, [key]: value } : s));

  return (
    <Modal open={open} onClose={onClose} title="Automatic emails to prospects" wide>
      {!info || !settings ? (
        <Spinner label="Loading" />
      ) : (
        <div className="space-y-6">
          {/* ------------------------------ status ------------------------------ */}
          <section className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-sm">
                <p className="text-soft">
                  Sending from{' '}
                  <span className="font-semibold text-white">{info.sender || 'no mailbox yet'}</span> through Gmail —
                  never through Resend.
                </p>
                <p className="text-xs text-muted">
                  Monday to Friday only. Follow-ups stop as soon as someone replies; bounced addresses are set to Do not
                  contact.
                </p>
              </div>
              <div className="flex gap-2">
                <Button size="sm" loading={busy === 'verify'} disabled={!info.configured} onClick={verify}>
                  Test connection
                </Button>
                <Button size="sm" loading={busy === 'inbox'} disabled={!info.configured} onClick={checkInbox}>
                  Check for replies now
                </Button>
              </div>
            </div>
            {connection && (
              <div className="space-y-1 text-sm">
                {(['smtp', 'imap'] as const).map((k) => (
                  <p key={k} className="flex items-start gap-2">
                    {connection[k] === 'ok' ? (
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
                    ) : (
                      <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-danger" />
                    )}
                    <span className="text-soft">
                      {k === 'smtp' ? 'Sending' : 'Reading replies'}: {connection[k] === 'ok' ? 'connected' : connection[k]}
                    </span>
                  </p>
                ))}
              </div>
            )}
            {info.problems.length > 0 && (
              <ul className="space-y-1 rounded-lg border border-warn/40 p-3 text-sm text-soft">
                {info.problems.map((p) => (
                  <li key={p}>• {p}</li>
                ))}
              </ul>
            )}
            <div className="flex flex-wrap items-center gap-3">
              {settings.enabled ? (
                <Button loading={busy === 'settings'} icon={<PauseCircle className="h-4 w-4" />} onClick={() => saveSettings({ enabled: false })}>
                  Pause automatic emails
                </Button>
              ) : (
                <Button
                  variant="primary"
                  loading={busy === 'settings'}
                  icon={<PlayCircle className="h-4 w-4" />}
                  onClick={() => saveSettings({ enabled: true })}
                >
                  Switch on automatic emails
                </Button>
              )}
              <span className="text-xs text-muted">
                Switch on only after the mailbox has warmed up for about two weeks.
              </span>
            </div>
          </section>

          {/* ----------------------------- settings ----------------------------- */}
          <section className="space-y-4 border-t border-line pt-5">
            <h4 className="text-sm font-semibold text-white">Who and when</h4>
            <div className="space-y-2">
              <p className="text-sm font-medium text-soft">Lists to email</p>
              {lists.map((l) => {
                const waiting = Number(info.waiting.find((w) => w.list === l.id)?.count ?? 0);
                return (
                  <label key={l.id} className="flex items-center gap-2 text-sm text-soft">
                    <input
                      type="checkbox"
                      checked={settings.lists.includes(l.id)}
                      onChange={(e) =>
                        set('lists', e.target.checked ? [...settings.lists, l.id] : settings.lists.filter((x) => x !== l.id))
                      }
                    />
                    {l.label} <span className="text-xs text-muted">({waiting} not emailed yet)</span>
                  </label>
                );
              })}
            </div>
            <div className="grid gap-4 sm:grid-cols-4">
              <Field label="New prospects per weekday" hint="Follow-ups are extra">
                <Input
                  type="number"
                  min={0}
                  max={30}
                  value={settings.daily_new_limit}
                  onChange={(e) => set('daily_new_limit', Number(e.target.value))}
                />
              </Field>
              <Field label="Start sending at">
                <Input type="time" value={settings.start_time} onChange={(e) => set('start_time', e.target.value)} />
              </Field>
              <Field label="Stop sending at">
                <Input type="time" value={settings.end_time} onChange={(e) => set('end_time', e.target.value)} />
              </Field>
              <Field label="Minutes between emails">
                <Input
                  type="number"
                  min={3}
                  max={120}
                  value={settings.gap_minutes}
                  onChange={(e) => set('gap_minutes', Number(e.target.value))}
                />
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Sender name" hint="What prospects see in their inbox">
                <Input value={settings.from_name} onChange={(e) => set('from_name', e.target.value)} />
              </Field>
              <div className="pt-7">
                <Toggle
                  checked={settings.track_opens}
                  onChange={(v) => set('track_opens', v)}
                  label="Track opens (roughly right — replies are the only sure sign)"
                />
              </div>
            </div>
            <Field
              label="Signature"
              hint="Goes under every email. Leave empty to use your company name and phone from Settings. Your mailing address and an opt-out line are always added after it."
            >
              <Textarea value={settings.signature} onChange={(e) => set('signature', e.target.value)} className="min-h-[80px]" />
            </Field>
            <div className="flex justify-end">
              <Button variant="primary" loading={busy === 'settings'} onClick={() => saveSettings()}>
                Save settings
              </Button>
            </div>
          </section>

          {/* ------------------------------ emails ------------------------------ */}
          <section className="space-y-4 border-t border-line pt-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h4 className="text-sm font-semibold text-white">The three emails</h4>
              <div className="flex flex-wrap gap-2">
                {lists.map((l) => (
                  <button
                    key={l.id}
                    onClick={() => setList(l.id)}
                    className={`rounded-lg border px-3 py-1.5 text-xs font-medium ${
                      list === l.id ? 'border-accent bg-accent/10 text-white' : 'border-line text-muted hover:text-white'
                    }`}
                  >
                    {l.label}
                  </button>
                ))}
              </div>
            </div>
            <p className="text-xs text-muted">
              Fill-ins: <code>{'{{first_name}}'}</code> (or “there”), <code>{'{{business_name}}'}</code>,{' '}
              <code>{'{{address}}'}</code>, <code>{'{{contact_name}}'}</code>, <code>{'{{category}}'}</code>. Keep them
              short and plain — no links or pictures. Leave an email empty to stop the sequence before it.
            </p>
            {(steps[list] ?? []).map((s) => (
              <div key={s.step} className="space-y-2 rounded-lg border border-line p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium text-white">{STEP_LABELS[s.step]}</p>
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={<Send className="h-3.5 w-3.5" />}
                    loading={busy === `test${s.step}`}
                    disabled={!info.configured || !s.body.trim()}
                    onClick={() => sendTest(s.step)}
                  >
                    Send me a test
                  </Button>
                </div>
                {s.step === 1 && (
                  <Input placeholder="Subject" value={s.subject} onChange={(e) => setStep(1, 'subject', e.target.value)} />
                )}
                <Textarea value={s.body} onChange={(e) => setStep(s.step, 'body', e.target.value)} />
              </div>
            ))}
            <div className="flex flex-wrap items-end justify-between gap-3">
              <Field label="Send tests to" hint="Empty = the address you sign in with" className="sm:w-72">
                <Input type="email" value={testTo} onChange={(e) => setTestTo(e.target.value)} />
              </Field>
              <Button variant="primary" loading={busy === 'steps'} onClick={saveSteps}>
                Save emails
              </Button>
            </div>
          </section>

          {/* ------------------------------ recent ------------------------------ */}
          <section className="space-y-2 border-t border-line pt-5">
            <h4 className="text-sm font-semibold text-white">Recently sent</h4>
            {info.recent.length === 0 ? (
              <p className="text-sm text-muted">Nothing sent yet.</p>
            ) : (
              <div className="divide-y divide-line text-sm">
                {info.recent.map((m) => (
                  <div key={m.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <div className="min-w-0">
                      <p className="truncate text-soft">
                        {m.business_name ?? m.to_email} <span className="text-muted">· email {m.step}</span>
                      </p>
                      {m.error && <p className="text-xs text-danger">{m.error}</p>}
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted">
                      {m.error ? (
                        <Badge tone="red">Failed</Badge>
                      ) : m.opened_at ? (
                        <Badge tone="green">Opened{m.open_count > 1 ? ` ×${m.open_count}` : ''}</Badge>
                      ) : (
                        <Badge tone="grey">Sent</Badge>
                      )}
                      {formatDate(m.sent_at)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      )}
    </Modal>
  );
}
