import { useCallback, useEffect, useState } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import Layout from './components/Layout';
import { Spinner, ToastProvider } from './components/ui';
import { api } from './lib/api';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Customers from './pages/Customers';
import Campaigns from './pages/Campaigns';
import CampaignDetail from './pages/CampaignDetail';
import CampaignWizard from './pages/CampaignWizard';
import Templates from './pages/Templates';
import Schedule from './pages/Schedule';
import Analytics from './pages/Analytics';
import Leads from './pages/Leads';
import Integrations from './pages/Integrations';
import SettingsPage from './pages/Settings';
import Help from './pages/Help';

type User = { id: number; name: string; email: string; role: string };

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [checking, setChecking] = useState(true);

  const loadSession = useCallback(() => {
    api
      .get<{ user: User }>('/api/auth/me')
      .then((data) => setUser(data.user))
      .catch(() => setUser(null))
      .finally(() => setChecking(false));
  }, []);

  useEffect(() => {
    loadSession();
    const onSignedOut = () => setUser(null);
    window.addEventListener('hulk:signed-out', onSignedOut);
    return () => window.removeEventListener('hulk:signed-out', onSignedOut);
  }, [loadSession]);

  const signOut = async () => {
    await api.post('/api/auth/logout').catch(() => undefined);
    setUser(null);
  };

  if (checking) {
    return (
      <div className="grid min-h-screen place-items-center bg-ink">
        <Spinner label="Opening your marketing center" />
      </div>
    );
  }

  if (!user) {
    return (
      <ToastProvider>
        <Login onSignedIn={setUser} />
      </ToastProvider>
    );
  }

  return (
    <ToastProvider>
      <Layout user={user} onSignOut={signOut}>
        <Routes>
          <Route path="/" element={<Dashboard user={user} />} />
          <Route path="/customers" element={<Customers />} />
          <Route path="/campaigns" element={<Campaigns />} />
          <Route path="/campaigns/new" element={<CampaignWizard />} />
          <Route path="/campaigns/:id" element={<CampaignDetail />} />
          <Route path="/templates" element={<Templates />} />
          <Route path="/schedule" element={<Schedule />} />
          <Route path="/analytics" element={<Analytics />} />
          <Route path="/leads" element={<Leads />} />
          <Route path="/integrations" element={<Integrations />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/help" element={<Help />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Layout>
    </ToastProvider>
  );
}
