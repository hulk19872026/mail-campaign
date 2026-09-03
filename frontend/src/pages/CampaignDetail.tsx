import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, errorText } from '../lib/api';
import { formatDateTime, formatNumber, fullName } from '../lib/format';
import {
  Badge,
  Button,
  Card,
  ErrorNotice,
  Field,
  Input,
  Modal,
  Progress,
  Spinner,
  statusTone,
  useToast,
} from '../components/ui';

export default function CampaignDetail() {
  const { id } = useParams();
  const [data, setData] = useState<any>(null);
  const [recipients, setRecipients] = useState<any[]>([]);
  const [filter, setFilter] = useState('all');
  const [error, setError] = useState('');
  const [testOpen, setTestOpen] = useState(false);
  const [testEmail, setTestEmail] = useState('');
  const toast = useToast();
  const navigate = useNavigate();

  const load = () => {
    setError('');
    api
      .get(`/api/campaigns/${id}`)
      .then(setData)
      .catch((err) => setError(errorText(err)));
    api
      .get<{ recipients: any[] }>(`/api/campaigns/${id}/recipients?status=${filter}`)
      .then((r) => setRecipients(r.recipients))
      .catch(() => undefined);
  };

  useEffect(load, [id, filter]);
  useEffect(() => {
    const timer = setInterval(load, 30_000);
    return () => clearInterval(timer);
  }, [id, filter]);

  const act = async (action: string) => {
    try {
      await api.post(`/api/campaigns/${id}/${action}`);
      toast.push('success', `Campaign ${action === 'start' ? 'started' : action + 'd'}.`);
      load();
    } catch (err) {
      toast.push('error', errorText(err));
    }
  };

  const remove = async () => {
    if (!confirm('Delete this campaign and its history?')) return;
    try {
      await api.del(`/api/campaigns/${id}`);
      navigate('/campaigns');
    } catch (err) {
      toast.push('error', errorText(err));
    }
  };

  const sendTest = async () => {
    try {
      await api.post(`/api/campaigns/${id}/test`, { email: testEmail });
      toast.push('success', `Test sent to ${testEmail}.`);
      setTestOpen(false);
    } catch (err) {
      toast.push('error', errorText(err));
    }
  };

  if (error) return <ErrorNotice error={error} onRetry={load} />;
  if (!data) return <Spinner label="Loading campaign" />;

  const c = data.campaign;
  const counts = data.counts ?? {};
  const sent = Number(counts.sent ?? 0);
  const total = Number(counts.total ?? 0);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">{c.name}</h1>
          <p className="mt-1 text-sm text-muted">{c.subject}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge tone={statusTone(c.status)}>{c.status}</Badge>
          {c.test_mode && <Badge tone="amber">Test mode</Badge>}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {c.status === 'active' && <Button onClick={() => act('pause')}>Pause campaign</Button>}
        {['paused', 'draft', 'scheduled'].includes(c.status) && (
          <Button variant="primary" onClick={() => act(c.status === 'paused' ? 'resume' : 'start')}>
            {c.status === 'paused' ? 'Resume campaign' : 'Start campaign'}
          </Button>
        )}
        {['active', 'paused'].includes(c.status) && (
          <Button variant="danger" onClick={() => act('cancel')}>
            Cancel campaign
          </Button>
        )}
        <Button onClick={() => setTestOpen(true)}>Send test</Button>
        {c.status !== 'active' && (
          <Button variant="ghost" onClick={remove}>
            Delete
          </Button>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <div className="mb-2 flex justify-between text-sm text-soft">
            <span>
              {formatNumber(sent)} of {formatNumber(total)} sent
            </span>
            <span className="text-muted">{total ? Math.round((sent / total) * 100) : 0}%</span>
          </div>
          <Progress value={sent} max={total || 1} />

          <dl className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Stat label="Queued" value={counts.queued} />
            <Stat label="Failed" value={counts.failed} />
            <Stat label="Opened" value={counts.opened} />
            <Stat label="Clicked" value={counts.clicked} />
          </dl>
        </Card>

        <Card>
          <h2 className="mb-3 text-base font-semibold text-white">Sending schedule</h2>
          <dl className="space-y-3 text-sm">
            <Row label="Daily limit" value={`${data.dailyLimit} emails`} />
            <Row label="Sent today" value={`${data.sentToday} / ${data.dailyLimit}`} />
            <Row label="Starts at" value={c.send_time} />
            <Row label="First send day" value={c.start_date ?? 'Immediately'} />
            <Row
              label="Estimated days left"
              value={`${Math.ceil(Number(counts.queued ?? 0) / Math.max(1, data.dailyLimit))}`}
            />
          </dl>
        </Card>
      </div>

      <Card padded={false}>
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-4">
          <h2 className="mr-auto text-base font-semibold text-white">Queue</h2>
          {['all', 'queued', 'sent', 'failed', 'unsubscribed'].map((f) => (
            <Button key={f} size="sm" variant={filter === f ? 'primary' : 'secondary'} onClick={() => setFilter(f)}>
              {f}
            </Button>
          ))}
        </div>

        <div className="divide-y divide-line/60">
          {recipients.length === 0 && <p className="p-6 text-center text-sm text-muted">Nothing here yet.</p>}
          {recipients.map((r) => (
            <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
              <div>
                <p className="text-white">{fullName(r)}</p>
                <p className="text-xs text-muted">{r.email}</p>
              </div>
              <div className="flex items-center gap-3 text-xs text-muted">
                {r.sent_at && <span>{formatDateTime(r.sent_at)}</span>}
                {r.error_message && <span className="max-w-[220px] truncate text-danger">{r.error_message}</span>}
                <Badge tone={statusTone(r.status)}>{r.status}</Badge>
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Modal open={testOpen} onClose={() => setTestOpen(false)} title="Send a test email">
        <Field label="Send to" hint="Goes to this address only. No customer receives it.">
          <Input type="email" value={testEmail} onChange={(e) => setTestEmail(e.target.value)} />
        </Field>
        <div className="mt-5 flex justify-end gap-2">
          <Button onClick={() => setTestOpen(false)}>Cancel</Button>
          <Button variant="primary" onClick={sendTest}>
            Send test
          </Button>
        </div>
      </Modal>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: any }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-1 text-xl font-bold text-white">{formatNumber(value)}</dd>
    </div>
  );
}

function Row({ label, value }: { label: string; value: any }) {
  return (
    <div className="flex justify-between">
      <dt className="text-muted">{label}</dt>
      <dd className="text-white">{value}</dd>
    </div>
  );
}
