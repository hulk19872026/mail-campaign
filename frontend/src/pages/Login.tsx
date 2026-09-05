import { useState } from 'react';
import { api, errorText } from '../lib/api';
import { Button, Field, Input } from '../components/ui';

export default function Login({ onSignedIn }: { onSignedIn: (user: any) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError('');
    try {
      const data = await api.post<{ user: any }>('/api/auth/login', { email, password });
      onSignedIn(data.user);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="grid min-h-screen place-items-center bg-ink px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-xl bg-accent text-xl font-extrabold text-accent-text">
            H
          </span>
          <span>
            <span className="block text-xl font-bold tracking-tight text-white">HULK Automation</span>
            <span className="block text-sm text-muted">Marketing Center</span>
          </span>
        </div>

        <form onSubmit={submit} className="space-y-4 rounded-xl2 border border-line bg-panel p-6 shadow-card">
          <Field label="Email">
            <Input
              type="email"
              value={email}
              autoComplete="username"
              onChange={(e) => setEmail(e.target.value)}
              placeholder="david@hulkautomation.com"
              required
            />
          </Field>
          <Field label="Password">
            <Input
              type="password"
              value={password}
              autoComplete="current-password"
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </Field>

          {error && (
            <p className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2.5 text-sm text-white">{error}</p>
          )}

          <Button type="submit" variant="primary" size="lg" loading={loading} className="w-full">
            Sign in
          </Button>
        </form>

        <p className="mt-4 text-center text-xs text-muted">
          Sessions end after 12 hours. Change your password under Settings.
        </p>
      </div>
    </div>
  );
}
