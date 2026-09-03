import { useEffect, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { BarChart3 } from 'lucide-react';
import { api, errorText } from '../lib/api';
import { formatNumber } from '../lib/format';
import { Card, EmptyState, ErrorNotice, Select, Spinner } from '../components/ui';

const AXIS = { stroke: '#8B97A5', fontSize: 12 };

export default function Analytics() {
  const [data, setData] = useState<any>(null);
  const [days, setDays] = useState(30);
  const [error, setError] = useState('');

  const load = () => {
    setError('');
    api
      .get(`/api/analytics?days=${days}`)
      .then(setData)
      .catch((err) => setError(errorText(err)));
  };

  useEffect(load, [days]);

  if (error) return <ErrorNotice error={error} onRetry={load} />;
  if (!data) return <Spinner label="Crunching the numbers" />;

  const t = data.totals ?? {};
  const sent = Number(t.sent ?? 0);
  const openRate = sent ? Math.round((Number(t.opened) / sent) * 1000) / 10 : 0;
  const clickRate = sent ? Math.round((Number(t.clicked) / sent) * 1000) / 10 : 0;

  const series = (data.series ?? []).map((row: any) => ({
    day: row.day.slice(5),
    sent: Number(row.sent),
    opened: Number(row.opened),
    clicked: Number(row.clicked),
  }));

  const campaigns = (data.campaigns ?? []).map((c: any) => ({
    name: c.name.length > 18 ? `${c.name.slice(0, 18)}…` : c.name,
    sent: Number(c.sent),
    opened: Number(c.opened),
    clicked: Number(c.clicked),
  }));

  if (sent === 0) {
    return (
      <div className="space-y-5">
        <h1 className="text-2xl font-bold tracking-tight text-white">Analytics</h1>
        <EmptyState
          title="Nothing to measure yet"
          message="Once your first campaign starts sending, open rates and clicks appear here."
          icon={<BarChart3 className="h-7 w-7" />}
        />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">Analytics</h1>
          <p className="mt-1 text-sm text-muted">How your emails are performing.</p>
        </div>
        <Select value={days} onChange={(e) => setDays(parseInt(e.target.value, 10))} className="w-auto">
          <option value={7}>Last 7 days</option>
          <option value={30}>Last 30 days</option>
          <option value={90}>Last 90 days</option>
        </Select>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 xl:grid-cols-7">
        {[
          ['Sent', t.sent],
          ['Delivered', t.delivered],
          ['Opened', t.opened],
          ['Clicked', t.clicked],
          ['Bounced', t.bounced],
          ['Failed', t.failed],
          ['Unsubscribed', t.unsubscribed],
        ].map(([label, value]) => (
          <Card key={String(label)}>
            <p className="text-2xl font-bold text-white">{formatNumber(value as any)}</p>
            <p className="mt-1 text-xs text-muted">{label}</p>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <p className="text-sm text-muted">Open rate</p>
          <p className="mt-1 text-3xl font-bold text-white">{openRate}%</p>
        </Card>
        <Card>
          <p className="text-sm text-muted">Click rate</p>
          <p className="mt-1 text-3xl font-bold text-white">{clickRate}%</p>
        </Card>
      </div>

      <Card>
        <h2 className="mb-4 text-base font-semibold text-white">Emails over time</h2>
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={series}>
              <CartesianGrid strokeDasharray="3 3" stroke="#212B36" />
              <XAxis dataKey="day" {...AXIS} />
              <YAxis {...AXIS} allowDecimals={false} />
              <Tooltip
                contentStyle={{ background: '#131A22', border: '1px solid #212B36', borderRadius: 10, color: '#fff' }}
              />
              <Line type="monotone" dataKey="sent" stroke="#22C55E" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="opened" stroke="#60A5FA" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="clicked" stroke="#F5A524" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <Card>
        <h2 className="mb-4 text-base font-semibold text-white">Campaign performance</h2>
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={campaigns}>
              <CartesianGrid strokeDasharray="3 3" stroke="#212B36" />
              <XAxis dataKey="name" {...AXIS} />
              <YAxis {...AXIS} allowDecimals={false} />
              <Tooltip
                cursor={{ fill: '#182029' }}
                contentStyle={{ background: '#131A22', border: '1px solid #212B36', borderRadius: 10, color: '#fff' }}
              />
              <Bar dataKey="sent" fill="#22C55E" radius={[6, 6, 0, 0]} />
              <Bar dataKey="opened" fill="#60A5FA" radius={[6, 6, 0, 0]} />
              <Bar dataKey="clicked" fill="#F5A524" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>
    </div>
  );
}
