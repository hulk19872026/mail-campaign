import { useEffect, useState } from 'react';
import { api, errorText } from '../lib/api';
import { formatDateTime, formatNumber } from '../lib/format';
import { Badge, Button, Card, ErrorNotice, Field, Input, Spinner, StatusDot, useToast } from '../components/ui';

export default function Integrations() {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [testing, setTesting] = useState('');
  const [testEmail, setTestEmail] = useState('');
  const [businesses, setBusinesses] = useState<{ id: string; name: string }[]>([]);
  const [choosing, setChoosing] = useState('');
  const toast = useToast();

  const load = () => {
    setError('');
    api
      .get('/api/integrations')
      .then(setData)
      .catch((err) => setError(errorText(err)));
  };

  useEffect(load, []);

  const syncWave = async () => {
    setSyncing(true);
    try {
      const result = await api.post<{ imported: number; updated: number; skipped: number }>(
        '/api/integrations/wave/sync'
      );
      toast.push(
        'success',
        `${result.imported} new customers imported, ${result.updated} updated, ${result.skipped} skipped without an email address.`
      );
      load();
    } catch (err) {
      toast.push('error', errorText(err));
    } finally {
      setSyncing(false);
    }
  };

  const test = async (service: 'wave' | 'resend') => {
    setTesting(service);
    try {
      const result = await api.post<{
        connected: boolean;
        message: string;
        businesses?: { id: string; name: string }[];
      }>(`/api/integrations/${service}/test`);
      toast.push(result.connected ? 'success' : 'error', result.message);
      // Keep the businesses on the page rather than only in the toast: the id is
      // long, and a toast cuts off the very value needed to fix the problem.
      if (service === 'wave') setBusinesses(result.businesses ?? []);
      load();
    } catch (err) {
      toast.push('error', errorText(err));
    } finally {
      setTesting('');
    }
  };

  const chooseBusiness = async (business: { id: string; name: string }) => {
    setChoosing(business.id);
    try {
      await api.put('/api/settings', { wave_business_id: business.id });
      toast.push('success', `Now syncing customers from ${business.name}.`);
      load();
    } catch (err) {
      toast.push('error', errorText(err));
    } finally {
      setChoosing('');
    }
  };

  const sendTestEmail = async () => {
    try {
      const result = await api.post<{ message: string }>('/api/integrations/resend/test-email', {
        email: testEmail,
      });
      toast.push('success', result.message);
    } catch (err) {
      toast.push('error', errorText(err));
    }
  };

  if (error) return <ErrorNotice error={error} onRetry={load} />;
  if (!data) return <Spinner label="Checking connections" />;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-white">Integrations</h1>
        <p className="mt-1 text-sm text-muted">Where your customers come from, and how your email goes out.</p>
      </div>

      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-white">Wave Accounting</h2>
            <p className="mt-1 text-sm text-muted">Your customer list is pulled from Wave.</p>
          </div>
          <Badge tone={data.wave.configured ? 'green' : 'amber'}>
            <StatusDot ok={data.wave.configured} warn />
            {data.wave.configured ? 'Connected' : 'Needs setup'}
          </Badge>
        </div>

        <dl className="mt-5 grid gap-4 sm:grid-cols-3">
          <div>
            <dt className="text-xs text-muted">Customers imported</dt>
            <dd className="mt-1 text-xl font-bold text-white">{formatNumber(data.wave.customers)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Last synchronization</dt>
            <dd className="mt-1 text-sm text-white">{formatDateTime(data.wave.lastSync?.finished_at)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Result</dt>
            <dd className="mt-1 text-sm text-white">
              {data.wave.lastSync
                ? `${data.wave.lastSync.status} — ${data.wave.lastSync.imported} new, ${data.wave.lastSync.skipped} skipped`
                : 'Not synced yet'}
            </dd>
          </div>
        </dl>

        {data.wave.lastSync?.error && (
          <p className="mt-3 rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-white">
            {data.wave.lastSync.error}
          </p>
        )}

        {businesses.length > 0 && (
          <div className="mt-4 rounded-lg border border-line bg-ink/40 p-3">
            <p className="text-xs text-muted">
              Businesses on this Wave token. Choose the one to import customers from.
            </p>
            <ul className="mt-2 space-y-2">
              {businesses.map((business) => {
                const active = business.id === data.wave.businessId;
                return (
                  <li
                    key={business.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-panel px-3 py-2"
                  >
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-white">{business.name}</span>
                      <code className="block break-all text-xs text-muted">{business.id}</code>
                    </span>
                    {active ? (
                      <Badge tone="green">
                        <StatusDot ok />
                        In use
                      </Badge>
                    ) : (
                      <Button
                        loading={choosing === business.id}
                        onClick={() => chooseBusiness(business)}
                      >
                        Use this
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        <div className="mt-5 flex flex-wrap gap-2">
          <Button variant="primary" loading={syncing} onClick={syncWave}>
            Sync customers
          </Button>
          <Button loading={testing === 'wave'} onClick={() => test('wave')}>
            Test connection
          </Button>
        </div>
        <p className="mt-3 text-xs text-muted">
          Only customers with a valid email address are imported. Existing records are matched on their Wave ID, so
          syncing twice never creates duplicates.
        </p>
      </Card>

      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-white">Resend</h2>
            <p className="mt-1 text-sm text-muted">Delivers your marketing emails.</p>
          </div>
          <Badge tone={data.resend.configured ? 'green' : 'amber'}>
            <StatusDot ok={data.resend.configured} warn />
            {data.resend.configured ? 'Connected' : 'Needs setup'}
          </Badge>
        </div>

        <dl className="mt-5 grid gap-4 sm:grid-cols-3">
          <div>
            <dt className="text-xs text-muted">From address</dt>
            <dd className="mt-1 text-sm text-white">{data.resend.fromEmail || 'Not set'}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Emails sent today</dt>
            <dd className="mt-1 text-xl font-bold text-white">{data.resend.sentToday}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Remaining today</dt>
            <dd className="mt-1 text-xl font-bold text-white">{data.resend.remaining}</dd>
          </div>
        </dl>

        <div className="mt-5 flex flex-wrap items-center gap-2">
          <Field label="Send a test email to" className="min-w-[240px] flex-1">
            <Input type="email" value={testEmail} onChange={(e) => setTestEmail(e.target.value)} placeholder="you@hulkautomation.com" />
          </Field>
          <Button className="mt-6" onClick={sendTestEmail}>
            Send test
          </Button>
          <Button className="mt-6" loading={testing === 'resend'} onClick={() => test('resend')}>
            Test connection
          </Button>
        </div>
        <p className="mt-3 text-xs text-muted">
          Your API key lives in Railway's environment variables and is never shown in the browser.
        </p>
      </Card>
    </div>
  );
}
