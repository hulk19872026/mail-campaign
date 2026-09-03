import { useEffect, useState } from 'react';
import { FileText, Plus } from 'lucide-react';
import { api, errorText } from '../lib/api';
import EmailEditor, { Block } from '../components/EmailEditor';
import { Button, Card, EmptyState, ErrorNotice, Field, Input, Modal, Spinner, useToast } from '../components/ui';

type Template = {
  id: number;
  name: string;
  description: string;
  subject: string;
  blocks: Block[];
  is_system: boolean;
};

export default function Templates() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [editing, setEditing] = useState<Template | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const toast = useToast();

  const load = () => {
    setError('');
    api
      .get<{ templates: Template[] }>('/api/templates')
      .then((data) => setTemplates(data.templates))
      .catch((err) => setError(errorText(err)))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const create = async () => {
    try {
      const result = await api.post<{ template: Template }>('/api/templates', {
        name: 'New template',
        description: '',
        subject: '',
        blocks: [{ id: 'l1', type: 'logo' }],
      });
      setEditing(result.template);
      load();
    } catch (err) {
      toast.push('error', errorText(err));
    }
  };

  const save = async () => {
    if (!editing) return;
    try {
      await api.put(`/api/templates/${editing.id}`, editing);
      toast.push('success', 'Template saved.');
      setEditing(null);
      load();
    } catch (err) {
      toast.push('error', errorText(err));
    }
  };

  const remove = async (template: Template) => {
    if (!confirm(`Delete "${template.name}"?`)) return;
    await api.del(`/api/templates/${template.id}`).catch(() => undefined);
    load();
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">Email templates</h1>
          <p className="mt-1 text-sm text-muted">Reusable emails you can pick when creating a campaign.</p>
        </div>
        <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={create}>
          New template
        </Button>
      </div>

      {error ? (
        <ErrorNotice error={error} onRetry={load} />
      ) : loading ? (
        <Spinner label="Loading templates" />
      ) : templates.length === 0 ? (
        <EmptyState
          title="No templates yet"
          message="Templates save you from rebuilding the same email every month."
          icon={<FileText className="h-7 w-7" />}
          action={<Button variant="primary" onClick={create}>Create a template</Button>}
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {templates.map((t) => (
            <Card key={t.id} className="flex h-full flex-col">
              <p className="font-semibold text-white">{t.name}</p>
              <p className="mt-1 flex-1 text-sm text-muted">{t.description || 'No description'}</p>
              <p className="mt-3 text-xs text-soft">Subject: {t.subject || '—'}</p>
              <div className="mt-4 flex gap-2">
                <Button size="sm" onClick={() => setEditing(t)}>
                  Edit
                </Button>
                <Button size="sm" variant="ghost" onClick={() => remove(t)}>
                  Delete
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Modal open={!!editing} onClose={() => setEditing(null)} title="Edit template" wide>
        {editing && (
          <div className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Template name">
                <Input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
              </Field>
              <Field label="Default subject line">
                <Input value={editing.subject} onChange={(e) => setEditing({ ...editing, subject: e.target.value })} />
              </Field>
              <Field label="Description" className="sm:col-span-2">
                <Input
                  value={editing.description}
                  onChange={(e) => setEditing({ ...editing, description: e.target.value })}
                />
              </Field>
            </div>

            <EmailEditor blocks={editing.blocks ?? []} onChange={(blocks) => setEditing({ ...editing, blocks })} />

            <div className="flex justify-end gap-2 border-t border-line pt-4">
              <Button onClick={() => setEditing(null)}>Cancel</Button>
              <Button variant="primary" onClick={save}>
                Save template
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
