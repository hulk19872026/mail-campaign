import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Download, Pencil, Phone, Plus, Target, Trash2, Upload, UserPlus } from 'lucide-react';
import { api, errorText } from '../lib/api';
import { formatDate } from '../lib/format';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorNotice,
  Field,
  Input,
  Modal,
  Select,
  Spinner,
  Textarea,
  useToast,
} from '../components/ui';

type Prospect = {
  id: number;
  list: string;
  business_name: string;
  contact_name: string;
  email: string;
  phone: string;
  address: string;
  category: string;
  notes: string;
  source_url: string;
  status: string;
  last_contacted_at: string | null;
  next_follow_up: string | null;
  converted_customer_id: number | null;
  customer_id: number | null;
  customer_opted_out: boolean;
};

const LISTS = [
  { id: 'voip', label: 'VoIP / phone systems' },
  { id: 'violations', label: 'Intercom violations' },
  { id: 'construction', label: 'New construction' },
];

const STATUSES: { id: string; label: string }[] = [
  { id: 'new', label: 'New' },
  { id: 'contacted', label: 'Emailed' },
  { id: 'follow_up', label: 'Followed up' },
  { id: 'replied', label: 'Replied' },
  { id: 'meeting', label: 'Meeting set' },
  { id: 'quoted', label: 'Quoted' },
  { id: 'won', label: 'Won' },
  { id: 'lost', label: 'Lost' },
  { id: 'do_not_contact', label: 'Do not contact' },
];
const CAN_CONVERT = ['replied', 'meeting', 'quoted', 'won'];

const EMPTY_FORM = {
  business_name: '',
  contact_name: '',
  email: '',
  phone: '',
  address: '',
  category: '',
  notes: '',
};

export default function Prospects() {
  const [list, setList] = useState('voip');
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [prospects, setProspects] = useState<Prospect[]>([]);
  const [counts, setCounts] = useState<{ list: string; status: string; count: string }[]>([]);
  const [dueToday, setDueToday] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<Prospect | 'new' | null>(null);
  const [importing, setImporting] = useState(false);
  const toast = useToast();

  const load = () => {
    setError('');
    const params = new URLSearchParams({ list });
    if (status) params.set('status', status);
    if (search.trim()) params.set('search', search.trim());
    api
      .get<{ prospects: Prospect[]; counts: any[]; dueToday: number }>(`/api/prospects?${params}`)
      .then((data) => {
        setProspects(data.prospects);
        setCounts(data.counts);
        setDueToday(data.dueToday);
      })
      .catch((err) => setError(errorText(err)))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    const t = setTimeout(load, search ? 250 : 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list, status, search]);

  const countFor = (l: string, s?: string) =>
    counts.filter((c) => c.list === l && (!s || c.status === s)).reduce((n, c) => n + Number(c.count), 0);

  const ready = useMemo(
    () =>
      counts
        .filter((c) => c.list === list && ['new', 'contacted', 'follow_up'].includes(c.status))
        .reduce((n, c) => n + Number(c.count), 0),
    [counts, list]
  );

  const update = async (p: Prospect, changes: Partial<Prospect>) => {
    try {
      const { prospect } = await api.put<{ prospect: Prospect }>(`/api/prospects/${p.id}`, changes);
      setProspects((all) => all.map((x) => (x.id === p.id ? { ...x, ...prospect } : x)));
      load();
    } catch (err) {
      toast.push('error', errorText(err));
    }
  };

  const remove = async (p: Prospect) => {
    if (!confirm(`Remove ${p.business_name} from your prospects?`)) return;
    try {
      await api.del(`/api/prospects/${p.id}`);
      toast.push('success', 'Prospect removed.');
      load();
    } catch (err) {
      toast.push('error', errorText(err));
    }
  };

  const convert = async (p: Prospect) => {
    try {
      await api.post(`/api/prospects/${p.id}/convert`);
      toast.push('success', `${p.business_name} is now on your customer list.`);
      load();
    } catch (err) {
      toast.push('error', errorText(err));
    }
  };

  if (error) return <ErrorNotice error={error} onRetry={load} />;
  if (loading) return <Spinner label="Loading prospects" />;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">Prospects</h1>
          <p className="mt-1 text-sm text-muted">
            Businesses you want to win. Track them here, then send from Mailmeteor.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button icon={<Upload className="h-4 w-4" />} onClick={() => setImporting(true)}>
            Import CSV
          </Button>
          <a href={`/api/prospects/export/csv?list=${list}`}>
            <Button icon={<Download className="h-4 w-4" />}>Export for Mailmeteor</Button>
          </a>
          <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setEditing('new')}>
            Add prospect
          </Button>
        </div>
      </div>

      <Card className="border-warn/40">
        <div className="flex gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-warn" />
          <p className="text-sm text-soft">
            <span className="font-semibold text-white">This page never emails anyone.</span> Prospects haven't asked
            to hear from you, and Resend can close your account for cold email — which would stop your customer
            campaigns too. Export the list and send from Mailmeteor on your second domain. When someone replies, set
            them to <em>Replied</em> and add them as a customer.
          </p>
        </div>
      </Card>

      <div className="flex flex-wrap gap-2">
        {LISTS.map((l) => (
          <button
            key={l.id}
            onClick={() => {
              setList(l.id);
              setStatus('');
            }}
            className={`rounded-lg border px-3.5 py-2 text-sm font-medium ${
              list === l.id ? 'border-accent bg-accent/10 text-white' : 'border-line text-muted hover:text-white'
            }`}
          >
            {l.label} <span className="ml-1 text-xs text-muted">{countFor(l.id)}</span>
          </button>
        ))}
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Card>
          <p className="text-xs text-muted">Ready for outreach</p>
          <p className="mt-1 text-xl font-bold text-white sm:text-2xl">{ready}</p>
        </Card>
        <Card>
          <p className="text-xs text-muted">Follow-ups due today</p>
          <p className={`mt-1 text-xl font-bold sm:text-2xl ${dueToday ? 'text-warn' : 'text-white'}`}>{dueToday}</p>
        </Card>
        <Card>
          <p className="text-xs text-muted">Replied or better</p>
          <p className="mt-1 text-xl font-bold text-white sm:text-2xl">
            {['replied', 'meeting', 'quoted', 'won'].reduce((n, s) => n + countFor(list, s), 0)}
          </p>
        </Card>
      </div>

      <div className="flex flex-wrap gap-3">
        <Input
          placeholder="Search name, email, category or address"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="sm:max-w-xs"
        />
        <Select value={status} onChange={(e) => setStatus(e.target.value)} className="sm:w-auto">
          <option value="">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label} ({countFor(list, s.id)})
            </option>
          ))}
        </Select>
      </div>

      {prospects.length === 0 ? (
        <EmptyState
          title="No prospects here yet"
          message="Add businesses one at a time, or import a CSV with business_name, email, phone, address and category columns."
          icon={<Target className="h-7 w-7" />}
        />
      ) : (
        <Card padded={false}>
          <div className="divide-y divide-line">
            {prospects.map((p) => {
              const overdue = !!p.next_follow_up && p.next_follow_up.slice(0, 10) <= new Date().toLocaleDateString('en-CA');
              return (
                <div key={p.id} className="grid gap-3 p-4 lg:grid-cols-[2fr_2fr_1fr_1fr_auto] lg:items-center">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium text-white">{p.business_name}</p>
                      {p.category && <Badge tone="grey">{p.category}</Badge>}
                      {p.customer_id && <Badge tone="green">Already a customer</Badge>}
                      {p.customer_opted_out && <Badge tone="red">Unsubscribed</Badge>}
                    </div>
                    <p className="mt-0.5 truncate text-xs text-muted">{p.address || '—'}</p>
                    {p.notes && <p className="mt-1 text-xs text-soft">{p.notes}</p>}
                  </div>
                  <div className="min-w-0 text-sm">
                    <p className="text-soft">{p.contact_name || '—'}</p>
                    <p className="truncate text-muted">{p.email || 'No email'}</p>
                    {p.phone && (
                      <a href={`tel:${p.phone}`} className="inline-flex items-center gap-1 text-accent">
                        <Phone className="h-3 w-3" /> {p.phone}
                      </a>
                    )}
                  </div>
                  <div>
                    <Select value={p.status} onChange={(e) => update(p, { status: e.target.value })}>
                      {STATUSES.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.label}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <div className="text-xs">
                    <p className="text-muted">Next follow-up</p>
                    <Input
                      type="date"
                      value={p.next_follow_up ? p.next_follow_up.slice(0, 10) : ''}
                      onChange={(e) => update(p, { next_follow_up: e.target.value || null } as any)}
                      className={overdue ? 'border-warn' : ''}
                    />
                    {p.last_contacted_at && <p className="mt-1 text-muted">Emailed {formatDate(p.last_contacted_at)}</p>}
                  </div>
                  <div className="flex gap-1">
                    {CAN_CONVERT.includes(p.status) && !p.customer_id && (
                      <Button size="sm" variant="primary" icon={<UserPlus className="h-4 w-4" />} onClick={() => convert(p)}>
                        Add as customer
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" icon={<Pencil className="h-4 w-4" />} onClick={() => setEditing(p)} title="Edit" />
                    <Button size="sm" variant="ghost" icon={<Trash2 className="h-4 w-4" />} onClick={() => remove(p)} title="Remove" />
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      <ProspectForm
        open={editing !== null}
        prospect={editing === 'new' ? null : editing}
        list={list}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          load();
        }}
      />
      <ImportModal open={importing} list={list} onClose={() => setImporting(false)} onDone={load} />
    </div>
  );
}

function ProspectForm({
  open,
  prospect,
  list,
  onClose,
  onSaved,
}: {
  open: boolean;
  prospect: Prospect | null;
  list: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  useEffect(() => {
    if (!open) return;
    setForm(
      prospect
        ? {
            business_name: prospect.business_name,
            contact_name: prospect.contact_name,
            email: prospect.email,
            phone: prospect.phone,
            address: prospect.address,
            category: prospect.category,
            notes: prospect.notes,
          }
        : EMPTY_FORM
    );
  }, [open, prospect]);

  const set = (key: keyof typeof EMPTY_FORM) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const save = async () => {
    setSaving(true);
    try {
      if (prospect) await api.put(`/api/prospects/${prospect.id}`, form);
      else await api.post('/api/prospects', { ...form, list });
      toast.push('success', prospect ? 'Prospect updated.' : 'Prospect added.');
      onSaved();
    } catch (err) {
      toast.push('error', errorText(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={prospect ? 'Edit prospect' : 'Add prospect'}>
      <div className="space-y-4">
        <Field label="Business name">
          <Input value={form.business_name} onChange={set('business_name')} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Contact name">
            <Input value={form.contact_name} onChange={set('contact_name')} />
          </Field>
          <Field label="Category" hint="Dental, Law, Property manager…">
            <Input value={form.category} onChange={set('category')} />
          </Field>
          <Field label="Email" hint="Only addresses the business publishes">
            <Input type="email" value={form.email} onChange={set('email')} />
          </Field>
          <Field label="Phone">
            <Input value={form.phone} onChange={set('phone')} />
          </Field>
        </div>
        <Field label="Address">
          <Input value={form.address} onChange={set('address')} />
        </Field>
        <Field label="Notes">
          <Textarea value={form.notes} onChange={set('notes')} />
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={saving} onClick={save}>
            Save
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function ImportModal({
  open,
  list,
  onClose,
  onDone,
}: {
  open: boolean;
  list: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [csv, setCsv] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const readFile = (file?: File) => {
    if (!file) return;
    file.text().then(setCsv);
  };

  const submit = async () => {
    setBusy(true);
    try {
      const r = await api.post<{ added: number; duplicates: number; skipped: number }>('/api/prospects/import/csv', {
        csv,
        list,
      });
      toast.push(
        'success',
        `Added ${r.added}. ${r.duplicates ? `${r.duplicates} already on a list. ` : ''}${
          r.skipped ? `${r.skipped} rows had no name or email.` : ''
        }`
      );
      setCsv('');
      onClose();
      onDone();
    } catch (err) {
      toast.push('error', errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Import prospects" wide>
      <div className="space-y-4">
        <p className="text-sm text-muted">
          Columns are matched by name: <code>business_name</code>, <code>contact_name</code>, <code>email</code>,{' '}
          <code>phone</code>, <code>address</code>, <code>category</code>, <code>notes</code>, <code>source_url</code>.
          Anyone already on a list is skipped.
        </p>
        <input type="file" accept=".csv,text/csv" onChange={(e) => readFile(e.target.files?.[0])} className="text-sm text-muted" />
        <Textarea
          value={csv}
          onChange={(e) => setCsv(e.target.value)}
          placeholder="…or paste the CSV here"
          className="min-h-[200px] font-mono text-xs"
        />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} disabled={!csv.trim()} onClick={submit}>
            Import
          </Button>
        </div>
      </div>
    </Modal>
  );
}
