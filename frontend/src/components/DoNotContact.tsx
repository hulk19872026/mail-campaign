import { useEffect, useState } from 'react';
import { Ban, Trash2 } from 'lucide-react';
import { api, errorText } from '../lib/api';
import { formatDate } from '../lib/format';
import { Badge, Button, Card, EmptyState, Field, Input, Spinner, useToast } from './ui';

type Entry = { id: number; value: string; reason: string; added_by: string; created_at: string; prospects: number };

/** Addresses and domains that never get cold email, whatever else happens. */
export function DoNotContact({ onChanged }: { onChanged: () => void }) {
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [value, setValue] = useState('');
  const [reason, setReason] = useState('');
  const [filter, setFilter] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const load = () =>
    api
      .get<{ entries: Entry[] }>('/api/prospects/dnd')
      .then((d) => setEntries(d.entries))
      .catch((err) => toast.push('error', errorText(err)));

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const add = async () => {
    setBusy(true);
    try {
      const r = await api.post<{ kind: string; prospectsUpdated: number; alreadyListed: boolean }>('/api/prospects/dnd', {
        value,
        reason,
      });
      toast.push(
        'success',
        r.alreadyListed
          ? 'That is already on the list.'
          : `Blocked${r.kind === 'domain' ? ' everyone at that domain' : ''}.${
              r.prospectsUpdated ? ` ${r.prospectsUpdated} prospect${r.prospectsUpdated === 1 ? '' : 's'} set to Do not contact.` : ''
            }`
      );
      setValue('');
      setReason('');
      load();
      onChanged();
    } catch (err) {
      toast.push('error', errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (e: Entry) => {
    if (!confirm(`Take ${e.value} off the Do not contact list? Prospects already marked Do not contact stay that way until you change them.`)) return;
    try {
      await api.del(`/api/prospects/dnd/${e.id}`);
      toast.push('success', `${e.value} removed.`);
      load();
    } catch (err) {
      toast.push('error', errorText(err));
    }
  };

  if (!entries) return <Spinner label="Loading" />;
  const shown = entries.filter((e) => !filter.trim() || `${e.value} ${e.reason}`.toLowerCase().includes(filter.trim().toLowerCase()));

  return (
    <div className="space-y-5">
      <Card className="border-danger/30">
        <div className="flex gap-3">
          <Ban className="mt-0.5 h-5 w-5 shrink-0 text-danger" />
          <p className="text-sm text-soft">
            <span className="font-semibold text-white">Nobody here is ever emailed</span> — not by automatic emails, not in
            the CSV export, and the lead finder can't add them back. Anyone set to <em>Do not contact</em>, every bounced
            address, and anything you add below lands here. Block a whole company by entering its domain.
          </p>
        </div>
      </Card>

      <Card>
        <div className="grid gap-3 sm:grid-cols-[2fr_2fr_auto] sm:items-end">
          <Field label="Email or domain" hint="jane@acme.com blocks one person; acme.com blocks the whole company">
            <Input value={value} onChange={(e) => setValue(e.target.value)} placeholder="name@business.com or business.com" />
          </Field>
          <Field label="Reason (optional)" hint="e.g. Asked not to be contacted">
            <Input value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <div className="sm:pb-6">
            <Button variant="primary" loading={busy} disabled={!value.trim()} onClick={add}>
              Block
            </Button>
          </div>
        </div>
      </Card>

      {entries.length === 0 ? (
        <EmptyState
          title="Nobody blocked yet"
          message="People set to Do not contact and bounced addresses will appear here automatically."
          icon={<Ban className="h-7 w-7" />}
        />
      ) : (
        <>
          <Input placeholder={`Search ${entries.length} blocked`} value={filter} onChange={(e) => setFilter(e.target.value)} className="sm:max-w-xs" />
          <Card padded={false}>
            <div className="divide-y divide-line">
              {shown.map((e) => (
                <div key={e.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate font-medium text-white">{e.value}</p>
                      <Badge tone={e.value.includes('@') ? 'grey' : 'amber'}>{e.value.includes('@') ? 'Address' : 'Whole domain'}</Badge>
                      {e.prospects > 0 && (
                        <Badge tone="grey">
                          {e.prospects} prospect{e.prospects === 1 ? '' : 's'}
                        </Badge>
                      )}
                    </div>
                    <p className="mt-0.5 text-xs text-muted">
                      {e.reason || 'No reason given'} · {formatDate(e.created_at)}
                      {e.added_by && e.added_by !== 'system' ? ` · by ${e.added_by}` : ''}
                    </p>
                  </div>
                  <Button size="sm" variant="ghost" icon={<Trash2 className="h-4 w-4" />} onClick={() => remove(e)} title="Remove from list" />
                </div>
              ))}
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
