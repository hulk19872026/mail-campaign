import { useEffect, useState } from 'react';
import { api, errorText } from '../lib/api';
import { formatDateTime } from '../lib/format';
import { Badge, Button, Card, ErrorNotice, HelpTip, Progress, Spinner, StatusDot, useToast } from '../components/ui';

export default function Schedule() {
  const [status, setStatus] = useState<any>(null);
  const [dashboard, setDashboard] = useState<any>(null);
  const [error, setError] = useState('');
  const [running, setRunning] = useState(false);
  const toast = useToast();

  const load = () => {
    setError('');
    Promise.all([api.get('/api/status'), api.get('/api/dashboard')])
      .then(([s, d]) => {
        setStatus(s);
        setDashboard(d);
      })
      .catch((err) => setError(errorText(err)));
  };

  useEffect(() => {
    load();
    const timer = setInterval(load, 30_000);
    return () => clearInterval(timer);
  }, []);

  const runNow = async () => {
    setRunning(true);
    try {
      const result = await api.post<{ sent: number; failed: number; reason?: string }>('/api/campaigns/run-now');
      toast.push(
        result.sent > 0 ? 'success' : 'info',
        result.sent > 0
          ? `Sent ${result.sent} emails.`
          : result.reason ?? 'Nothing to send right now.'
      );
      load();
    } catch (err) {
      toast.push('error', errorText(err));
    } finally {
      setRunning(false);
    }
  };

  if (error) return <ErrorNotice error={error} onRetry={load} />;
  if (!status || !dashboard) return <Spinner label="Checking the schedule" />;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-white">Schedule</h1>
        <p className="mt-1 text-sm text-muted">
          Sending runs on its own. This page shows what it is doing and when it runs next.
        </p>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <div className="mb-3 flex items-center gap-2">
            <h2 className="text-base font-semibold text-white">Today's email limit</h2>
            <HelpTip>
              A calendar-day cap. When it is reached, sending stops and picks up again the next day at your chosen
              time — no action needed from you.
            </HelpTip>
          </div>
          <p className="text-3xl font-bold text-white">
            {dashboard.today.sent} <span className="text-muted">/ {dashboard.today.limit}</span>
          </p>
          <div className="mt-3">
            <Progress
              value={dashboard.today.sent}
              max={dashboard.today.limit}
              tone={dashboard.today.limitReached ? 'warn' : 'accent'}
            />
          </div>
          <p className="mt-3 text-sm text-muted">
            {dashboard.today.limitReached
              ? `Daily limit reached. Next sending period: ${formatDateTime(dashboard.nextSend)}.`
              : `${dashboard.today.remaining} emails still available today.`}
          </p>

          <div className="mt-6 border-t border-line pt-5">
            <Button variant="primary" loading={running} onClick={runNow}>
              Send the next batch now
            </Button>
            <p className="mt-2 text-xs text-muted">
              Optional. Sending happens automatically every five minutes during your sending window.
            </p>
          </div>
        </Card>

        <Card>
          <h2 className="mb-3 text-base font-semibold text-white">System status</h2>
          <ul className="space-y-2.5 text-sm">
            {[
              ['Backend', true],
              ['Database', status.database],
              ['Wave', status.wave],
              ['Resend', status.resend],
              ['Scheduler', status.scheduler],
            ].map(([label, ok]) => (
              <li key={String(label)} className="flex items-center justify-between">
                <span className="text-muted">{label}</span>
                <span className="flex items-center gap-2 text-soft">
                  <StatusDot ok={!!ok} />
                  {ok ? 'Running' : 'Not ready'}
                </span>
              </li>
            ))}
          </ul>
          <dl className="mt-4 space-y-2 border-t border-line pt-4 text-xs text-muted">
            <div className="flex justify-between">
              <dt>Timezone</dt>
              <dd className="text-soft">{status.timezone}</dd>
            </div>
            <div className="flex justify-between">
              <dt>Sends from</dt>
              <dd className="text-soft">{status.sendTime}</dd>
            </div>
            <div className="flex justify-between">
              <dt>Last check</dt>
              <dd className="text-soft">{formatDateTime(status.lastSchedulerRun)}</dd>
            </div>
          </dl>
          {status.activeCampaign && (
            <div className="mt-4 border-t border-line pt-4">
              <Badge tone="green">Running: {status.activeCampaign.name}</Badge>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
