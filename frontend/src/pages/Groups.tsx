import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FolderPlus, Plus, Search, Trash2, UserPlus, Users, X } from 'lucide-react';
import { api, errorText } from '../lib/api';
import { formatNumber, fullName } from '../lib/format';
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
  useToast,
} from '../components/ui';

type Group = {
  id: number;
  name: string;
  description: string;
  color: string;
  member_count: string;
  emailable_count: string;
  textable_count: string;
};

type Person = {
  id: number;
  first_name: string;
  last_name: string;
  company_name: string;
  email: string;
  phone: string;
  status: string;
  marketing_opt_out: boolean;
  sms_opt_in: boolean;
};

const COLORS: { value: string; label: string; tone: 'green' | 'blue' | 'amber' | 'red' | 'grey' }[] = [
  { value: 'green', label: 'Green', tone: 'green' },
  { value: 'blue', label: 'Blue', tone: 'blue' },
  { value: 'amber', label: 'Amber', tone: 'amber' },
  { value: 'red', label: 'Red', tone: 'red' },
  { value: 'grey', label: 'Grey', tone: 'grey' },
];

function toneOf(color: string): 'green' | 'blue' | 'amber' | 'red' | 'grey' {
  return COLORS.find((c) => c.value === color)?.tone ?? 'green';
}

export default function Groups() {
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<Group | null>(null);
  const [creating, setCreating] = useState(false);
  const [managing, setManaging] = useState<Group | null>(null);
  const toast = useToast();
  const navigate = useNavigate();

  const load = () => {
    setLoading(true);
    setError('');
    api
      .get<{ groups: Group[] }>('/api/groups')
      .then((data) => setGroups(data.groups))
      .catch((err) => setError(errorText(err)))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const remove = async (group: Group) => {
    if (!confirm(`Delete "${group.name}"? The customers in it are not deleted.`)) return;
    try {
      await api.del(`/api/groups/${group.id}`);
      toast.push('success', 'Group deleted.');
      load();
    } catch (err) {
      toast.push('error', errorText(err));
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">Customer groups</h1>
          <p className="mt-1 text-sm text-muted">
            Lists you put together yourself, so a campaign can go to exactly the right people.
          </p>
        </div>
        <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>
          New group
        </Button>
      </div>

      {error ? (
        <ErrorNotice error={error} onRetry={load} />
      ) : loading ? (
        <Spinner label="Loading groups" />
      ) : groups.length === 0 ? (
        <EmptyState
          title="No groups yet"
          message="A group is a saved list — contract holders, commercial accounts, one town, last year's installs. Make one, put customers in it, and aim a campaign at it."
          icon={<FolderPlus className="h-7 w-7" />}
          action={
            <Button variant="primary" onClick={() => setCreating(true)}>
              Create your first group
            </Button>
          }
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {groups.map((group) => (
            <Card key={group.id}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-semibold text-white">{group.name}</p>
                  {group.description && <p className="mt-1 text-xs text-muted">{group.description}</p>}
                </div>
                <Badge tone={toneOf(group.color)}>{formatNumber(group.member_count)} in group</Badge>
              </div>

              <dl className="mt-4 grid grid-cols-2 gap-3">
                <div className="rounded-lg border border-line bg-ink p-3">
                  <dt className="text-xs text-muted">Can be emailed</dt>
                  <dd className="mt-0.5 text-lg font-bold text-white">
                    {formatNumber(group.emailable_count)}
                  </dd>
                </div>
                <div className="rounded-lg border border-line bg-ink p-3">
                  <dt className="text-xs text-muted">Can be texted</dt>
                  <dd className="mt-0.5 text-lg font-bold text-white">
                    {formatNumber(group.textable_count)}
                  </dd>
                </div>
              </dl>

              <div className="mt-4 flex flex-wrap gap-2 border-t border-line pt-4">
                <Button size="sm" icon={<UserPlus className="h-4 w-4" />} onClick={() => setManaging(group)}>
                  Members
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setEditing(group)}>
                  Rename
                </Button>
                <Button size="sm" variant="ghost" onClick={() => navigate('/campaigns/new')}>
                  Send to it
                </Button>
                <div className="flex-1" />
                <Button size="sm" variant="ghost" onClick={() => remove(group)} aria-label="Delete group">
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      <GroupForm
        open={creating || !!editing}
        group={editing}
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

      <MembersModal group={managing} onClose={() => setManaging(null)} onChanged={load} />
    </div>
  );
}

function GroupForm({
  open,
  group,
  onClose,
  onSaved,
}: {
  open: boolean;
  group: Group | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<{ name: string; description: string; color: string }>({
    name: '',
    description: '',
    color: 'green',
  });
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  useEffect(() => {
    setForm({
      name: group?.name ?? '',
      description: group?.description ?? '',
      color: group?.color ?? 'green',
    });
  }, [group, open]);

  const save = async () => {
    if (!form.name.trim()) {
      toast.push('error', 'Give the group a name.');
      return;
    }
    setSaving(true);
    try {
      if (group) await api.put(`/api/groups/${group.id}`, form);
      else await api.post('/api/groups', form);
      toast.push('success', 'Group saved.');
      onSaved();
    } catch (err) {
      toast.push('error', errorText(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={group ? 'Rename group' : 'New group'}>
      <div className="space-y-4">
        <Field label="Group name" hint="What you would call this set of customers.">
          <Input
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            placeholder="Maintenance contract holders"
            autoFocus
          />
        </Field>
        <Field label="Description" hint="Optional. A note about who belongs in here.">
          <Input
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            placeholder="Customers on an annual service agreement"
          />
        </Field>
        <Field label="Colour" className="max-w-[180px]">
          <Select value={form.color} onChange={(e) => setForm((f) => ({ ...f, color: e.target.value }))}>
            {COLORS.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <div className="mt-6 flex justify-end gap-2">
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" loading={saving} onClick={save}>
          Save group
        </Button>
      </div>
    </Modal>
  );
}

/** Who is in the group, and a search over everyone else to add more. */
function MembersModal({
  group,
  onClose,
  onChanged,
}: {
  group: Group | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [members, setMembers] = useState<Person[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<Person[]>([]);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const loadMembers = () => {
    if (!group) return;
    api
      .get<{ members: Person[]; total: number }>(`/api/groups/${group.id}/members`)
      .then((data) => {
        setMembers(data.members);
        setTotal(data.total);
      })
      .catch((err) => toast.push('error', errorText(err)));
  };

  useEffect(() => {
    setSearch('');
    setResults([]);
    loadMembers();
  }, [group?.id]);

  useEffect(() => {
    if (!group || !search.trim()) {
      setResults([]);
      return;
    }
    const timer = setTimeout(() => {
      api
        .get<{ customers: Person[] }>(`/api/customers?search=${encodeURIComponent(search)}&pageSize=20`)
        .then((data) => setResults(data.customers))
        .catch(() => undefined);
    }, 300);
    return () => clearTimeout(timer);
  }, [search, group?.id]);

  const change = async (path: string, ids: number[], message: string) => {
    if (!group) return;
    setBusy(true);
    try {
      await api.post(`/api/groups/${group.id}${path}`, { ids });
      toast.push('success', message);
      loadMembers();
      onChanged();
    } catch (err) {
      toast.push('error', errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const memberIds = new Set(members.map((m) => m.id));

  return (
    <Modal open={!!group} onClose={onClose} title={group ? `Members of ${group.name}` : 'Members'} wide>
      <div className="grid gap-5 lg:grid-cols-2">
        <div>
          <h4 className="mb-2 text-sm font-semibold text-white">
            In this group ({formatNumber(total)})
          </h4>
          {members.length === 0 ? (
            <p className="rounded-lg border border-dashed border-line p-4 text-sm text-muted">
              Nobody yet. Search on the right to add customers.
            </p>
          ) : (
            <ul className="max-h-[320px] divide-y divide-line overflow-y-auto rounded-lg border border-line">
              {members.map((m) => (
                <li key={m.id} className="flex items-center justify-between gap-2 px-3 py-2.5">
                  <span className="min-w-0">
                    <span className="block truncate text-sm text-white">{fullName(m)}</span>
                    <span className="block truncate text-xs text-muted">{m.email}</span>
                  </span>
                  <button
                    onClick={() => change('/members/remove', [m.id], 'Removed from the group.')}
                    disabled={busy}
                    className="rounded-lg p-1.5 text-muted hover:bg-raised hover:text-white disabled:opacity-50"
                    aria-label={`Remove ${fullName(m)}`}
                  >
                    <X className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          {total > members.length && (
            <p className="mt-2 text-xs text-muted">
              Showing the first {members.length}. Use the Customers page, filtered by this group, to work
              through the rest.
            </p>
          )}
        </div>

        <div>
          <h4 className="mb-2 text-sm font-semibold text-white">Add customers</h4>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, company or email"
              className="pl-9"
            />
          </div>
          {results.length > 0 && (
            <>
              <ul className="mt-3 max-h-[260px] divide-y divide-line overflow-y-auto rounded-lg border border-line">
                {results.map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-2 px-3 py-2.5">
                    <span className="min-w-0">
                      <span className="block truncate text-sm text-white">{fullName(r)}</span>
                      <span className="block truncate text-xs text-muted">{r.email}</span>
                    </span>
                    {memberIds.has(r.id) ? (
                      <Badge tone="green">Added</Badge>
                    ) : (
                      <Button
                        size="sm"
                        disabled={busy}
                        onClick={() => change('/members', [r.id], `${fullName(r)} added.`)}
                      >
                        Add
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
              <Button
                className="mt-3"
                disabled={busy || results.every((r) => memberIds.has(r.id))}
                icon={<Users className="h-4 w-4" />}
                onClick={() =>
                  change(
                    '/members',
                    results.map((r) => r.id),
                    'Everyone shown was added.'
                  )
                }
              >
                Add all {results.length} shown
              </Button>
            </>
          )}
          {search.trim() && results.length === 0 && (
            <p className="mt-3 text-sm text-muted">Nobody matched that search.</p>
          )}
        </div>
      </div>
    </Modal>
  );
}
