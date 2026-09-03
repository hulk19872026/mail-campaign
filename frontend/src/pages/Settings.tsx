import { useEffect, useState } from 'react';
import { api, errorText } from '../lib/api';
import { formatDateTime } from '../lib/format';
import {
  Button,
  Card,
  ErrorNotice,
  Field,
  HelpTip,
  Input,
  SectionTitle,
  Select,
  Spinner,
  Toggle,
  useToast,
} from '../components/ui';

const TIMEZONES = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Phoenix',
  'America/Toronto',
  'UTC',
];

export default function SettingsPage() {
  const [settings, setSettings] = useState<any>(null);
  const [logs, setLogs] = useState<any[]>([]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [password, setPassword] = useState({ current: '', next: '' });
  const toast = useToast();

  const load = () => {
    setError('');
    api
      .get<{ settings: any }>('/api/settings')
      .then((data) => setSettings(data.settings))
      .catch((err) => setError(errorText(err)));
    api
      .get<{ logs: any[] }>('/api/logs')
      .then((data) => setLogs(data.logs))
      .catch(() => undefined);
  };

  useEffect(load, []);

  const save = async () => {
    setSaving(true);
    try {
      await api.put('/api/settings', settings);
      toast.push('success', 'Settings saved.');
    } catch (err) {
      toast.push('error', errorText(err));
    } finally {
      setSaving(false);
    }
  };

  const changePassword = async () => {
    try {
      await api.post('/api/auth/password', password);
      toast.push('success', 'Password changed.');
      setPassword({ current: '', next: '' });
    } catch (err) {
      toast.push('error', errorText(err));
    }
  };

  if (error) return <ErrorNotice error={error} onRetry={load} />;
  if (!settings) return <Spinner label="Loading settings" />;

  const set = (key: string) => (e: any) =>
    setSettings((s: any) => ({ ...s, [key]: e.target.type === 'number' ? Number(e.target.value) : e.target.value }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-white">Settings</h1>
        <p className="mt-1 text-sm text-muted">Company details, sending limits and email addresses.</p>
      </div>

      <Card>
        <SectionTitle title="General" subtitle="Shown in the footer of every marketing email." />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Company name">
            <Input value={settings.company_name} onChange={set('company_name')} />
          </Field>
          <Field label="Website">
            <Input value={settings.website} onChange={set('website')} />
          </Field>
          <Field
            label="Mailing address"
            hint="Marketing law in the US and Canada requires a physical postal address in every commercial email."
            className="sm:col-span-2"
          >
            <Input value={settings.mailing_address} onChange={set('mailing_address')} placeholder="123 Main St, Sayreville, NJ 08872" />
          </Field>
          <Field label="Phone shown in emails">
            <Input value={settings.support_phone} onChange={set('support_phone')} />
          </Field>
          <Field label="Timezone">
            <Select value={settings.timezone} onChange={set('timezone')}>
              {TIMEZONES.map((tz) => (
                <option key={tz} value={tz}>
                  {tz}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </Card>

      <Card>
        <SectionTitle title="Sending" subtitle="How fast and how much goes out each day." />
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Daily send limit" hint="Default 99. Never exceeded.">
            <Input type="number" min={1} max={500} value={settings.daily_limit} onChange={set('daily_limit')} />
          </Field>
          <Field label="Batch size" hint="Emails per batch. Default 10.">
            <Input type="number" min={1} max={50} value={settings.batch_size} onChange={set('batch_size')} />
          </Field>
          <Field label="Pause between batches (seconds)" hint="Default 30.">
            <Input
              type="number"
              min={0}
              max={3600}
              value={settings.batch_delay_seconds}
              onChange={set('batch_delay_seconds')}
            />
          </Field>
          <Field label="Sending starts at">
            <Input type="time" value={settings.send_time} onChange={set('send_time')} />
          </Field>
        </div>
        <div className="mt-4 flex items-center gap-2">
          <Toggle
            checked={settings.scheduler_enabled}
            onChange={(v) => setSettings((s: any) => ({ ...s, scheduler_enabled: v }))}
            label="Send campaigns automatically each day"
          />
          <HelpTip>
            Turn this off to stop all automatic sending without cancelling your campaigns. Nothing is lost — sending
            resumes exactly where it stopped.
          </HelpTip>
        </div>
      </Card>

      <Card>
        <SectionTitle title="Email addresses" subtitle="Your Resend API key stays in Railway and is never shown here." />
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="From name">
            <Input value={settings.from_name} onChange={set('from_name')} />
          </Field>
          <Field label="From address" hint="Must be on a domain verified in Resend.">
            <Input value={settings.from_email} onChange={set('from_email')} />
          </Field>
          <Field label="Reply-to address">
            <Input value={settings.reply_to} onChange={set('reply_to')} />
          </Field>
          <Field label="Logo address" hint="A public image URL used at the top of emails." className="sm:col-span-2">
            <Input value={settings.logo_url} onChange={set('logo_url')} />
          </Field>
          <Field label="Accent color">
            <Input type="color" value={settings.accent_color} onChange={set('accent_color')} className="h-11 p-1" />
          </Field>
        </div>
      </Card>

      <div className="flex justify-end">
        <Button variant="primary" size="lg" loading={saving} onClick={save}>
          Save changes
        </Button>
      </div>

      <Card>
        <SectionTitle title="Your password" />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Current password">
            <Input
              type="password"
              value={password.current}
              onChange={(e) => setPassword((p) => ({ ...p, current: e.target.value }))}
            />
          </Field>
          <Field label="New password" hint="At least 10 characters.">
            <Input
              type="password"
              value={password.next}
              onChange={(e) => setPassword((p) => ({ ...p, next: e.target.value }))}
            />
          </Field>
        </div>
        <Button className="mt-4" onClick={changePassword}>
          Change password
        </Button>
      </Card>

      <Card padded={false}>
        <div className="border-b border-line p-5">
          <SectionTitle title="Activity log" subtitle="Every important action, newest first." />
        </div>
        <div className="max-h-96 divide-y divide-line/60 overflow-y-auto">
          {logs.length === 0 && <p className="p-6 text-center text-sm text-muted">Nothing logged yet.</p>}
          {logs.map((entry) => (
            <div key={entry.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm">
              <span className="text-white">{entry.action}</span>
              <span className="text-xs text-muted">
                {entry.actor} · {formatDateTime(entry.created_at)}
              </span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
