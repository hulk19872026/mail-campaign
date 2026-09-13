import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Mail, Plus, UsersRound } from 'lucide-react';
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
  Spinner,
  Textarea,
  useToast,
} from '../components/ui';

export type Group = {
  id: number;
  name: string;
  description: string;
  member_count: string;
  emailable_count: string;
  created_at: string;
};

type Member = {
  id: number;
  first_name: string;
  last_name: string;
  company_name: string;
  email: string;
  status: string;
  marketing_opt_out: boolean;
  last_emailed_at: string | null;
};

export default function Groups() {
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<Group | null>(null);
  const [creating, setCreating] = useState(false);
  const [viewing, setViewing] = useState<{ group: Group; members: Member[] } | null>(null);
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

  const openMembers = async (group: Group) => {
    try {
      const data = await api.get<{ group: Group; members: Member[] }>(`/api/groups/${group.id}`);
      setViewing(data);
    } catch (err) {
      toast.push('error', errorText(err));
    }
  };

  const removeMember = async (group: Group, customerId: number) => {
    try {
      await api.post(`/api/groups/${group.id}/members`, { ids: [customerId], action: 'remove' });
      toast.push('success', 'Taken out of the group.');
      await openMembers(group);
      load();
    } catch (err) {
      toast.push('error', errorText(err));
    }
  };

  const remove = async (group: Group) => {
    if (
      !confirm(
        `Delete the group "${group.name}"?\n\n` +
          'The customers in it are not deleted — only the group itself goes, and campaigns already ' +
          'sent to it keep their history.'
      )
    )
      return;
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
          <h1 className="text-2xl font-bold tracking-tight text-white">Groups</h1>
          <p className="mt-1 text-sm text-muted">
            A named list of customers, so a campaign can go to just them instead of everyone.
          </p>
        </div>
        <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>
          Create group
        </Button>
      </div>

      {error ? (
        <ErrorNotice error={error} onRetry={load} />
      ) : loading ? (
        <Spinner label="Loading groups" />
      ) : groups.length === 0 ? (
        <EmptyState
          title="No groups yet"
          message="Create a group, then open Customers, tick the people who belong in it and press “Add to group”. After that the campaign wizard can send to just that group."
          icon={<UsersRound className="h-7 w-7" />}
          action={
            <Button variant="primary" onClick={() => setCreating(true)}>
              Create your first group
            </Button>
          }
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {groups.map((group) => {
            const members = Number(group.member_count);
            const emailable = Number(group.emailable_count);
            return (
              <Card key={group.id}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-base font-semibold text-white">{group.name}</h2>
                    {group.description && <p className="mt-1 text-sm text-muted">{group.description}</p>}
                  </div>
                  <span className="shrink-0">
                    <Badge tone={emailable > 0 ? 'green' : 'grey'}>
                      {formatNumber(emailable)} can be emailed
                    </Badge>
                  </span>
                </div>

                <p className="mt-3 text-sm text-soft">
                  {formatNumber(members)} {members === 1 ? 'person' : 'people'} in this group
                  {members !== emailable && (
                    <span className="text-muted">
                      {' '}
                      · {formatNumber(members - emailable)} disabled, unsubscribed or without an address
                    </span>
                  )}
                </p>

                <div className="mt-4 flex flex-wrap gap-2">
                  <Button
                    variant="primary"
                    size="sm"
                    icon={<Mail className="h-4 w-4" />}
                    disabled={emailable === 0}
                    onClick={() => navigate(`/campaigns/new?group=${group.id}`)}
                  >
                    Email this group
                  </Button>
                  <Button size="sm" onClick={() => openMembers(group)}>
                    Members
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditing(group)}>
                    Rename
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => remove(group)}>
                    Delete
                  </Button>
                </div>
              </Card>
            );
          })}
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

      <Modal open={!!viewing} onClose={() => setViewing(null)} title={viewing?.group.name ?? 'Group'} wide>
        {viewing && (
          <div className="space-y-4">
            <p className="text-sm text-muted">
              To add people, open Customers, tick them and press “Add to group”.
            </p>
            {viewing.members.length === 0 ? (
              <EmptyState
                title="Nobody in this group yet"
                message="Open Customers, tick the people who belong here and press “Add to group”."
                icon={<UsersRound className="h-7 w-7" />}
                action={
                  <Button variant="primary" onClick={() => navigate('/customers')}>
                    Go to Customers
                  </Button>
                }
              />
            ) : (
              <ul className="divide-y divide-line rounded-lg border border-line">
                {viewing.members.map((m) => (
                  <li key={m.id} className="flex flex-wrap items-center justify-between gap-3 px-3 py-2.5">
                    <div>
                      <p className="text-sm font-medium text-white">{fullName(m)}</p>
                      <p className="text-xs text-muted">
                        {m.email}
                        {m.company_name ? ` · ${m.company_name}` : ''} · Last email{' '}
                        {formatDate(m.last_emailed_at)}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      {m.marketing_opt_out ? (
                        <Badge tone="red">Unsubscribed</Badge>
                      ) : m.status === 'active' ? (
                        <Badge tone="green">Active</Badge>
                      ) : (
                        <Badge tone="grey">Disabled</Badge>
                      )}
                      <Button size="sm" variant="ghost" onClick={() => removeMember(viewing.group, m.id)}>
                        Remove
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </Modal>
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
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  useEffect(() => {
    setName(group?.name ?? '');
    setDescription(group?.description ?? '');
  }, [group, open]);

  const save = async () => {
    setSaving(true);
    try {
      if (group) await api.put(`/api/groups/${group.id}`, { name, description });
      else await api.post('/api/groups', { name, description });
      toast.push('success', group ? 'Group saved.' : 'Group created. Add people to it from Customers.');
      onSaved();
    } catch (err) {
      toast.push('error', errorText(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={group ? 'Rename group' : 'Create group'}>
      <div className="space-y-4">
        <Field label="Group name" hint="This is what you pick from in the campaign wizard.">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Service contract holders"
            autoFocus
          />
        </Field>
        <Field label="Description" hint="Optional — a note to yourself about who belongs in here.">
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Commercial customers on an annual maintenance contract."
          />
        </Field>
      </div>
      <div className="mt-6 flex justify-end gap-2">
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" loading={saving} disabled={!name.trim()} onClick={save}>
          {group ? 'Save group' : 'Create group'}
        </Button>
      </div>
    </Modal>
  );
}
