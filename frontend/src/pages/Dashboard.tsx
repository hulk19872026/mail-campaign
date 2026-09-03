import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { MousePointerClick, Mail, MailOpen, Send, Users, Wrench } from 'lucide-react';
import { api, errorText } from '../lib/api';
import { formatDateTime, formatNumber, greeting } from '../lib/format';
import { Badge, Button, Card, EmptyState, ErrorNotice, HelpTip, Progress, Spinner, StatusDot } from '../components/ui';

type DashboardData = {
  customers: { total: number; active: number; unsubscribed: number };
  emails: { sent: number; openRate: number; clickRate: number };
  today: { sent: number; limit: number; remaining: number; limitReached: boolean };
  leads: { total: number; new: number };
  activeCampaign: null | {
    id: number;
    name: string;
    status: string;
    sent: number;
    queued: number;
    total: number;
    estimatedDays: number;
  };
  nextSend: string;
  timezone: string;
};

type SystemStatus = {
  database: boolean;
  wave: boolean;
  resend: boolean;
  scheduler: boolean;
  lastSchedulerRun: string | null;
};

export default function Dashboard({ user }: { user: { name: string; email: string } }) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [error, setError] = useState('');

  const load = () => {
    setError('');
    Promise.all([api.get<DashboardData>('/api/dashboard'), api.get<SystemStatus>('/api/status')])
      .then(([dashboard, system]) => {
        setData(dashboard);
        setStatus(system);
      })
      .catch((err) => setError(errorText(err)));
  };

  useEffect(() => {
    load();
    const timer = setInterval(load, 60_000);
    return () => clearInterval(timer);
  }, []);

  if (error) return <ErrorNotice error={error} onRetry={load} />;
  if (!data) return <Spinner label="Loading your numbers" />;

  const firstName = (user.name || user.email).split(/[\s@.]/)[0];
  const displayName = firstName.charAt(0).toUpperCase() + firstName.slice(1);

  const stats = [
    { label: 'Customers', value: formatNumber(data.customers.total), icon: Users, to: '/customers' },
    { label: 'Emails sent', value: formatNumber(data.emails.sent), icon: Send, to: '/analytics' },
    {
      label: 'Sent today',
      value: `${data.today.sent} / ${data.today.limit}`,
      icon: Mail,
      to: '/schedule',
    },
    { label: 'Open rate', value: `${data.emails.openRate}%`, icon: MailOpen, to: '/analytics' },
    { label: 'Click rate', value: `${data.emails.clickRate}%`, icon: MousePointerClick, to: '/analytics' },
    { label: 'Maintenance leads', value: formatNumber(data.leads.total), icon: Wrench, to: '/leads' },
  ];

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">
          {greeting()}, {displayName}
        </h1>
        <p className="mt-1 text-sm text-muted">Your HULK Automation marketing center</p>
      </header>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        {stats.map(({ label, value, icon: Icon, to }) => (
          <Link key={label} to={to}>
            <Card className="h-full transition-colors hover:border-[#33414F]">
              <Icon className="mb-3 h-5 w-5 text-accent" />
              <p className="text-2xl font-bold tracking-tight text-white">{value}</p>
              <p className="mt-1 text-xs text-muted">{label}</p>
            </Card>
          </Link>
        ))}
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-base font-semibold text-white">Today's campaign</h2>
            {data.activeCampaign ? (
              <Badge tone={data.activeCampaign.status === 'active' ? 'green' : 'amber'}>
                <StatusDot ok={data.activeCampaign.status === 'active'} warn />
                Campaign {data.activeCampaign.status}
              </Badge>
            ) : (
              <Badge tone="grey">No campaign running</Badge>
            )}
          </div>

          {data.activeCampaign ? (
            <>
              <Link
                to={`/campaigns/${data.activeCampaign.id}`}
                className="text-sm font-medium text-white underline-offset-4 hover:underline"
              >
                {data.activeCampaign.name}
              </Link>

              <div className="mt-5">
                <div className="mb-2 flex items-center justify-between text-sm">
                  <span className="flex items-center gap-1.5 text-soft">
                    {data.today.sent} / {data.today.limit} emails sent today
                    <HelpTip>
                      The system sends at most {data.today.limit} marketing emails per calendar day, then waits
                      until tomorrow. You can change the limit in Settings.
                    </HelpTip>
                  </span>
                  <span className="text-muted">
                    {Math.round((data.today.sent / Math.max(1, data.today.limit)) * 100)}%
                  </span>
                </div>
                <Progress value={data.today.sent} max={data.today.limit} />
                {data.today.limitReached && (
                  <p className="mt-2 text-xs text-warn">
                    Daily limit reached. Sending resumes {formatDateTime(data.nextSend)}.
                  </p>
                )}
              </div>

              <dl className="mt-6 grid grid-cols-2 gap-4 border-t border-line pt-5 sm:grid-cols-4">
                <div>
                  <dt className="text-xs text-muted">Next send</dt>
                  <dd className="mt-1 text-sm font-medium text-white">{formatDateTime(data.nextSend)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted">Customers remaining</dt>
                  <dd className="mt-1 text-sm font-medium text-white">
                    {formatNumber(data.activeCampaign.queued)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted">Delivered so far</dt>
                  <dd className="mt-1 text-sm font-medium text-white">{formatNumber(data.activeCampaign.sent)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted">Days left</dt>
                  <dd className="mt-1 text-sm font-medium text-white">
                    {data.activeCampaign.estimatedDays} business days
                  </dd>
                </div>
              </dl>
            </>
          ) : (
            <EmptyState
              title="No campaign is running"
              message="Create your first campaign and start reaching your customers. The system sends it out for you, a little each day."
              action={
                <Link to="/campaigns/new">
                  <Button variant="primary">Create campaign</Button>
                </Link>
              }
              icon={<Mail className="h-7 w-7" />}
            />
          )}
        </Card>

        <div className="space-y-5">
          <Card>
            <h2 className="mb-1 text-base font-semibold text-white">Today's email limit</h2>
            <p className="text-3xl font-bold tracking-tight text-white">
              {data.today.sent} <span className="text-muted">/ {data.today.limit}</span>
            </p>
            <div className="mt-3">
              <Progress
                value={data.today.sent}
                max={data.today.limit}
                tone={data.today.limitReached ? 'warn' : 'accent'}
              />
            </div>
            <p className="mt-3 text-sm text-muted">
              {data.today.limitReached
                ? 'Daily limit reached. Next sending period is tomorrow.'
                : `${data.today.remaining} emails still available today.`}
            </p>
          </Card>

          <Card>
            <h2 className="mb-3 text-base font-semibold text-white">System status</h2>
            <ul className="space-y-2.5 text-sm">
              {[
                ['Database', status?.database],
                ['Wave Accounting', status?.wave],
                ['Resend', status?.resend],
                ['Automatic sending', status?.scheduler],
              ].map(([label, ok]) => (
                <li key={String(label)} className="flex items-center justify-between">
                  <span className="text-muted">{label}</span>
                  <span className="flex items-center gap-2 text-soft">
                    <StatusDot ok={!!ok} />
                    {ok ? 'Connected' : 'Needs setup'}
                  </span>
                </li>
              ))}
            </ul>
            {status?.lastSchedulerRun && (
              <p className="mt-4 border-t border-line pt-3 text-xs text-muted">
                Last automatic check: {formatDateTime(status.lastSchedulerRun)}
              </p>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
