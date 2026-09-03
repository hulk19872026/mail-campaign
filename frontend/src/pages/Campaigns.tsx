import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Mail, Plus } from 'lucide-react';
import { api, errorText } from '../lib/api';
import { formatDate, formatNumber } from '../lib/format';
import { Badge, Button, Card, EmptyState, ErrorNotice, Progress, Spinner, statusTone } from '../components/ui';

type Campaign = {
  id: number;
  name: string;
  subject: string;
  status: string;
  test_mode: boolean;
  total_recipients: number;
  sent_count: string;
  queued_count: string;
  failed_count: string;
  created_at: string;
};

export default function Campaigns() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = () => {
    setError('');
    api
      .get<{ campaigns: Campaign[] }>('/api/campaigns')
      .then((data) => setCampaigns(data.campaigns))
      .catch((err) => setError(errorText(err)))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">Campaigns</h1>
          <p className="mt-1 text-sm text-muted">Every campaign sends a little each day until it finishes.</p>
        </div>
        <Link to="/campaigns/new">
          <Button variant="primary" icon={<Plus className="h-4 w-4" />}>
            Create campaign
          </Button>
        </Link>
      </div>

      {error ? (
        <ErrorNotice error={error} onRetry={load} />
      ) : loading ? (
        <Spinner label="Loading campaigns" />
      ) : campaigns.length === 0 ? (
        <EmptyState
          title="No campaigns yet"
          message="Create your first campaign and start reaching your customers."
          icon={<Mail className="h-7 w-7" />}
          action={
            <Link to="/campaigns/new">
              <Button variant="primary">Create campaign</Button>
            </Link>
          }
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {campaigns.map((c) => {
            const sent = Number(c.sent_count);
            return (
              <Link key={c.id} to={`/campaigns/${c.id}`}>
                <Card className="h-full transition-colors hover:border-[#33414F]">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-white">{c.name}</p>
                      <p className="mt-1 text-sm text-muted">{c.subject}</p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-2">
                      <Badge tone={statusTone(c.status)}>{c.status}</Badge>
                      {c.test_mode && <Badge tone="amber">Test mode</Badge>}
                    </div>
                  </div>

                  <div className="mt-5">
                    <div className="mb-2 flex justify-between text-xs text-muted">
                      <span>
                        {formatNumber(sent)} of {formatNumber(c.total_recipients)} sent
                      </span>
                      <span>{formatNumber(c.queued_count)} remaining</span>
                    </div>
                    <Progress value={sent} max={c.total_recipients || 1} />
                  </div>

                  <p className="mt-4 text-xs text-muted">
                    Created {formatDate(c.created_at)}
                    {Number(c.failed_count) > 0 && ` · ${c.failed_count} failed`}
                  </p>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
