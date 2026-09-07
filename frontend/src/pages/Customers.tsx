import { useEffect, useRef, useState } from 'react';
import { Download, Plus, Search, Upload, Users } from 'lucide-react';
import { api, errorText } from '../lib/api';
import { formatDate, formatNumber, fullName } from '../lib/format';
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
  Toggle,
  useToast,
} from '../components/ui';

type Customer = {
  id: number;
  first_name: string;
  last_name: string;
  company_name: string;
  email: string;
  phone: string;
  address: string;
  status: string;
  marketing_opt_out: boolean;
  sms_opt_in: boolean;
  last_emailed_at: string | null;
  last_texted_at: string | null;
  wave_customer_id: string | null;
  campaigns_sent: string;
};

export default function Customers() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [sort, setSort] = useState('name');
  const [selected, setSelected] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<Customer | null>(null);
  const [creating, setCreating] = useState(false);
  const [detail, setDetail] = useState<any>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const toast = useToast();

  const load = () => {
    setLoading(true);
    setError('');
    api
      .get<{ customers: Customer[]; total: number }>(
        `/api/customers?search=${encodeURIComponent(search)}&status=${status}&sort=${sort}&page=${page}`
      )
      .then((data) => {
        setCustomers(data.customers);
        setTotal(data.total);
      })
      .catch((err) => setError(errorText(err)))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    const timer = setTimeout(load, search ? 300 : 0);
    return () => clearTimeout(timer);
  }, [search, status, sort, page]);

  const bulk = async (action: string) => {
    if (action === 'delete' && !confirm(`Delete ${selected.length} customers? This cannot be undone.`)) return;
    // Recording consent is a claim that these people actually agreed. Worth one
    // deliberate confirmation, because it is what makes them textable.
    if (
      action === 'sms_opt_in' &&
      !confirm(
        `Mark ${selected.length} customers as having agreed to receive texts?\n\n` +
          'Only do this for customers who actually gave consent — on a signed work order, a form, ' +
          'or in writing. They become reachable by every text blast.'
      )
    )
      return;
    try {
      await api.post('/api/customers/bulk', { ids: selected, action });
      toast.push('success', `${selected.length} customers updated.`);
      setSelected([]);
      load();
    } catch (err) {
      toast.push('error', errorText(err));
    }
  };

  const importCsv = async (file: File) => {
    const text = await file.text();
    try {
      const result = await api.post<{ imported: number; updated: number; skipped: number }>(
        '/api/customers/import/csv',
        { csv: text }
      );
      toast.push(
        'success',
        `${result.imported} added, ${result.updated} updated, ${result.skipped} skipped.`
      );
      load();
    } catch (err) {
      toast.push('error', errorText(err));
    }
  };

  const openProfile = async (id: number) => {
    setDetail({ loading: true });
    try {
      setDetail(await api.get(`/api/customers/${id}`));
    } catch (err) {
      toast.push('error', errorText(err));
      setDetail(null);
    }
  };

  const pageCount = Math.max(1, Math.ceil(total / 50));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">Customers</h1>
          <p className="mt-1 text-sm text-muted">{formatNumber(total)} people in your list</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <input
            ref={fileInput}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && importCsv(e.target.files[0])}
          />
          <Button icon={<Upload className="h-4 w-4" />} onClick={() => fileInput.current?.click()}>
            Import CSV
          </Button>
          <a href="/api/customers/export/csv">
            <Button icon={<Download className="h-4 w-4" />}>Export CSV</Button>
          </a>
          <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>
            Add customer
          </Button>
        </div>
      </div>

      <Card padded={false}>
        <div className="flex flex-wrap items-center gap-3 border-b border-line p-4">
          <div className="relative min-w-[200px] flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <Input
              value={search}
              onChange={(e) => {
                setPage(1);
                setSearch(e.target.value);
              }}
              placeholder="Search name, company, email or phone"
              className="pl-9"
            />
          </div>
          <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-auto">
            <option value="all">All customers</option>
            <option value="active">Active</option>
            <option value="disabled">Disabled</option>
            <option value="unsubscribed">Unsubscribed</option>
            <option value="sms_ready">Can be texted</option>
            <option value="sms_missing">Has a phone, no texting consent</option>
          </Select>
          <Select value={sort} onChange={(e) => setSort(e.target.value)} className="w-auto">
            <option value="name">Sort by name</option>
            <option value="company">Sort by company</option>
            <option value="recent">Newest first</option>
            <option value="last_email">Last emailed</option>
          </Select>
        </div>

        {selected.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 border-b border-line bg-accent/5 px-4 py-3 text-sm">
            <span className="text-soft">{selected.length} selected</span>
            <Button size="sm" onClick={() => bulk('enable')}>
              Enable
            </Button>
            <Button size="sm" onClick={() => bulk('disable')}>
              Disable
            </Button>
            <Button size="sm" onClick={() => bulk('unsubscribe')}>
              Mark unsubscribed
            </Button>
            <Button size="sm" onClick={() => bulk('sms_opt_in')}>
              Agreed to texts
            </Button>
            <Button size="sm" onClick={() => bulk('sms_opt_out')}>
              No texts
            </Button>
            <Button size="sm" variant="danger" onClick={() => bulk('delete')}>
              Delete
            </Button>
          </div>
        )}

        {error ? (
          <div className="p-4">
            <ErrorNotice error={error} onRetry={load} />
          </div>
        ) : loading ? (
          <Spinner label="Loading customers" />
        ) : customers.length === 0 ? (
          <div className="p-4">
            <EmptyState
              title="No customers yet"
              message="Sync your Wave Accounting customers or import a CSV, and they will show up here."
              icon={<Users className="h-7 w-7" />}
              action={
                <Button variant="primary" onClick={() => (window.location.href = '/integrations')}>
                  Connect Wave
                </Button>
              }
            />
          </div>
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden overflow-x-auto lg:block">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-line text-xs text-muted">
                  <tr>
                    <th className="w-10 px-4 py-3">
                      <input
                        type="checkbox"
                        checked={selected.length === customers.length && customers.length > 0}
                        onChange={(e) =>
                          setSelected(e.target.checked ? customers.map((c) => c.id) : [])
                        }
                      />
                    </th>
                    <th className="px-3 py-3 font-medium">Customer</th>
                    <th className="px-3 py-3 font-medium">Company</th>
                    <th className="px-3 py-3 font-medium">Email</th>
                    <th className="px-3 py-3 font-medium">Phone</th>
                    <th className="px-3 py-3 font-medium">Status</th>
                    <th className="px-3 py-3 font-medium">Last email</th>
                    <th className="px-3 py-3 font-medium">Campaigns</th>
                    <th className="px-3 py-3 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {customers.map((c) => (
                    <tr key={c.id} className="border-b border-line/60 hover:bg-raised/50">
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          checked={selected.includes(c.id)}
                          onChange={(e) =>
                            setSelected((list) =>
                              e.target.checked ? [...list, c.id] : list.filter((id) => id !== c.id)
                            )
                          }
                        />
                      </td>
                      <td className="px-3 py-3">
                        <button onClick={() => openProfile(c.id)} className="font-medium text-white hover:text-accent">
                          {fullName(c)}
                        </button>
                      </td>
                      <td className="px-3 py-3 text-muted">{c.company_name || '—'}</td>
                      <td className="px-3 py-3 text-muted">{c.email}</td>
                      <td className="px-3 py-3 text-muted">{c.phone || '—'}</td>
                      <td className="px-3 py-3">
                        {c.marketing_opt_out ? (
                          <Badge tone="red">Unsubscribed</Badge>
                        ) : c.status === 'active' ? (
                          <Badge tone="green">Active</Badge>
                        ) : (
                          <Badge tone="grey">Disabled</Badge>
                        )}
                      </td>
                      <td className="px-3 py-3 text-muted">{formatDate(c.last_emailed_at)}</td>
                      <td className="px-3 py-3 text-muted">{c.campaigns_sent}</td>
                      <td className="px-3 py-3">
                        <div className="flex gap-2">
                          <Button size="sm" variant="ghost" onClick={() => setEditing(c)}>
                            Edit
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => openProfile(c.id)}>
                            View
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <div className="divide-y divide-line lg:hidden">
              {customers.map((c) => (
                <div key={c.id} className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <button onClick={() => openProfile(c.id)} className="text-left">
                      <p className="font-medium text-white">{fullName(c)}</p>
                      <p className="text-xs text-muted">{c.company_name}</p>
                    </button>
                    {c.marketing_opt_out ? (
                      <Badge tone="red">Unsubscribed</Badge>
                    ) : (
                      <Badge tone={c.status === 'active' ? 'green' : 'grey'}>{c.status}</Badge>
                    )}
                    {c.sms_opt_in && c.phone && <Badge tone="blue">Texts OK</Badge>}
                  </div>
                  <p className="mt-2 text-sm text-soft">{c.email}</p>
                  <p className="text-xs text-muted">
                    {c.phone || 'No phone'} · Last email {formatDate(c.last_emailed_at)}
                  </p>
                  <div className="mt-3 flex gap-2">
                    <Button size="sm" onClick={() => setEditing(c)}>
                      Edit
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => openProfile(c.id)}>
                      View
                    </Button>
                  </div>
                </div>
              ))}
            </div>

            <div className="flex items-center justify-between border-t border-line px-4 py-3 text-sm text-muted">
              <span>
                Page {page} of {pageCount}
              </span>
              <div className="flex gap-2">
                <Button size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                  Previous
                </Button>
                <Button size="sm" disabled={page >= pageCount} onClick={() => setPage((p) => p + 1)}>
                  Next
                </Button>
              </div>
            </div>
          </>
        )}
      </Card>

      <CustomerForm
        open={creating || !!editing}
        customer={editing}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
        onSaved={() => {
          setCreating(false);
          setEditing(null);
          load();
        }}
      />

      <Modal open={!!detail} onClose={() => setDetail(null)} title="Customer profile" wide>
        {detail?.loading ? (
          <Spinner />
        ) : detail ? (
          <div className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <Detail label="Name" value={fullName(detail.customer)} />
              <Detail label="Company" value={detail.customer.company_name || '—'} />
              <Detail label="Email" value={detail.customer.email} />
              <Detail label="Phone" value={detail.customer.phone || '—'} />
              <Detail
                label="Address"
                value={
                  [detail.customer.address, detail.customer.city, detail.customer.province, detail.customer.postal_code]
                    .filter(Boolean)
                    .join(', ') || '—'
                }
              />
              <Detail label="Wave customer ID" value={detail.customer.wave_customer_id || 'Not from Wave'} />
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="Emails sent" value={detail.stats?.sent ?? 0} />
              <Stat label="Opened" value={detail.stats?.opened ?? 0} />
              <Stat label="Clicked" value={detail.stats?.clicked ?? 0} />
              <Stat label="Bounced" value={detail.stats?.bounced ?? 0} />
            </div>

            {detail.customer.marketing_opt_out && (
              <Badge tone="red">Unsubscribed — marketing emails will never be sent to this address</Badge>
            )}

            <div>
              <h4 className="mb-2 text-sm font-semibold text-white">Campaign history</h4>
              {detail.history?.length ? (
                <ul className="divide-y divide-line rounded-lg border border-line">
                  {detail.history.map((h: any) => (
                    <li key={h.id} className="flex items-center justify-between px-3 py-2.5 text-sm">
                      <span className="text-soft">{h.campaign_name}</span>
                      <span className="flex items-center gap-3 text-xs text-muted">
                        {formatDate(h.sent_at)}
                        <Badge tone={h.status === 'sent' ? 'green' : h.status === 'failed' ? 'red' : 'grey'}>
                          {h.status}
                        </Badge>
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted">No campaigns sent to this customer yet.</p>
              )}
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-1 text-sm text-white">{value}</p>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-lg border border-line bg-ink p-3">
      <p className="text-xl font-bold text-white">{value}</p>
      <p className="text-xs text-muted">{label}</p>
    </div>
  );
}

function CustomerForm({
  open,
  customer,
  onClose,
  onSaved,
}: {
  open: boolean;
  customer: Customer | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<any>({});
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  useEffect(() => {
    setForm(customer ?? {});
  }, [customer, open]);

  const save = async () => {
    setSaving(true);
    try {
      if (customer) await api.put(`/api/customers/${customer.id}`, form);
      else await api.post('/api/customers', form);
      toast.push('success', 'Customer saved.');
      onSaved();
    } catch (err) {
      toast.push('error', errorText(err));
    } finally {
      setSaving(false);
    }
  };

  const set = (key: string) => (e: any) => setForm((f: any) => ({ ...f, [key]: e.target.value }));

  return (
    <Modal open={open} onClose={onClose} title={customer ? 'Edit customer' : 'Add customer'}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="First name">
          <Input value={form.first_name ?? ''} onChange={set('first_name')} />
        </Field>
        <Field label="Last name">
          <Input value={form.last_name ?? ''} onChange={set('last_name')} />
        </Field>
        <Field label="Company" className="sm:col-span-2">
          <Input value={form.company_name ?? ''} onChange={set('company_name')} />
        </Field>
        <Field label="Email" className="sm:col-span-2">
          <Input type="email" value={form.email ?? ''} onChange={set('email')} />
        </Field>
        <Field label="Phone">
          <Input value={form.phone ?? ''} onChange={set('phone')} />
        </Field>
        <Field label="Status">
          <Select value={form.status ?? 'active'} onChange={set('status')}>
            <option value="active">Active</option>
            <option value="disabled">Disabled</option>
          </Select>
        </Field>
        <Field
          label="Texting"
          hint="Only turn this on for customers who agreed to receive texts."
          className="sm:col-span-2"
        >
          <Toggle
            checked={!!form.sms_opt_in}
            onChange={(v) => setForm((f: any) => ({ ...f, sms_opt_in: v }))}
            label="Agreed to receive text messages"
          />
        </Field>
        <Field label="Address" className="sm:col-span-2">
          <Input value={form.address ?? ''} onChange={set('address')} />
        </Field>
      </div>
      <div className="mt-6 flex justify-end gap-2">
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" loading={saving} onClick={save}>
          Save customer
        </Button>
      </div>
    </Modal>
  );
}
