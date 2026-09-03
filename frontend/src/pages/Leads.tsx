import { useEffect, useState } from 'react';
import { Wrench } from 'lucide-react';
import { api, errorText } from '../lib/api';
import { formatDate, fullName } from '../lib/format';
import { Badge, Card, EmptyState, ErrorNotice, Select, Spinner, statusTone, useToast } from '../components/ui';

const STATUSES = ['new', 'contacted', 'quoted', 'won', 'lost'];

export default function Leads() {
  const [leads, setLeads] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const toast = useToast();

  const load = () => {
    setError('');
    api
      .get<{ leads: any[] }>('/api/leads')
      .then((data) => setLeads(data.leads))
      .catch((err) => setError(errorText(err)))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const setStatus = async (id: number, status: string) => {
    try {
      await api.put(`/api/leads/${id}`, { status });
      setLeads((list) => list.map((l) => (l.id === id ? { ...l, status } : l)));
      toast.push('success', 'Lead updated.');
    } catch (err) {
      toast.push('error', errorText(err));
    }
  };

  if (error) return <ErrorNotice error={error} onRetry={load} />;
  if (loading) return <Spinner label="Loading leads" />;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-white">Maintenance leads</h1>
        <p className="mt-1 text-sm text-muted">
          Customers who clicked a maintenance or service button in one of your emails.
        </p>
      </div>

      {leads.length === 0 ? (
        <EmptyState
          title="No leads yet"
          message="When someone clicks 'Schedule your maintenance' in an email, they land here automatically."
          icon={<Wrench className="h-7 w-7" />}
        />
      ) : (
        <Card padded={false}>
          <div className="hidden overflow-x-auto lg:block">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-line text-xs text-muted">
                <tr>
                  <th className="px-4 py-3 font-medium">Customer</th>
                  <th className="px-3 py-3 font-medium">Company</th>
                  <th className="px-3 py-3 font-medium">Email</th>
                  <th className="px-3 py-3 font-medium">Campaign</th>
                  <th className="px-3 py-3 font-medium">Interest</th>
                  <th className="px-3 py-3 font-medium">Date</th>
                  <th className="px-3 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {leads.map((lead) => (
                  <tr key={lead.id} className="border-b border-line/60">
                    <td className="px-4 py-3 font-medium text-white">{fullName(lead)}</td>
                    <td className="px-3 py-3 text-muted">{lead.company_name || '—'}</td>
                    <td className="px-3 py-3 text-muted">{lead.email}</td>
                    <td className="px-3 py-3 text-muted">{lead.campaign_name || '—'}</td>
                    <td className="px-3 py-3 text-soft">{lead.interest}</td>
                    <td className="px-3 py-3 text-muted">{formatDate(lead.created_at)}</td>
                    <td className="px-3 py-3">
                      <Select value={lead.status} onChange={(e) => setStatus(lead.id, e.target.value)} className="w-auto">
                        {STATUSES.map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </Select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="divide-y divide-line lg:hidden">
            {leads.map((lead) => (
              <div key={lead.id} className="space-y-2 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-medium text-white">{fullName(lead)}</p>
                    <p className="text-xs text-muted">{lead.email}</p>
                  </div>
                  <Badge tone={statusTone(lead.status)}>{lead.status}</Badge>
                </div>
                <p className="text-sm text-soft">{lead.interest}</p>
                <p className="text-xs text-muted">
                  {lead.campaign_name || 'No campaign'} · {formatDate(lead.created_at)}
                </p>
                <Select value={lead.status} onChange={(e) => setStatus(lead.id, e.target.value)}>
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </Select>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
