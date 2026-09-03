import React, { useEffect, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  BarChart3,
  Bell,
  CalendarClock,
  ChevronLeft,
  FileText,
  LayoutDashboard,
  LifeBuoy,
  LogOut,
  Mail,
  Menu,
  Plug,
  Settings as SettingsIcon,
  Users,
  Wrench,
} from 'lucide-react';
import { api } from '../lib/api';
import { formatDateTime, initials } from '../lib/format';
import { Badge, Button } from './ui';

const NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/customers', label: 'Customers', icon: Users },
  { to: '/campaigns', label: 'Campaigns', icon: Mail },
  { to: '/templates', label: 'Email templates', icon: FileText },
  { to: '/schedule', label: 'Schedule', icon: CalendarClock },
  { to: '/analytics', label: 'Analytics', icon: BarChart3 },
  { to: '/leads', label: 'Maintenance leads', icon: Wrench },
  { to: '/integrations', label: 'Integrations', icon: Plug },
  { to: '/settings', label: 'Settings', icon: SettingsIcon },
  { to: '/help', label: 'Help', icon: LifeBuoy },
];

type Notification = { id: number; level: string; title: string; message: string; created_at: string };

export default function Layout({
  user,
  onSignOut,
  children,
}: {
  user: { name: string; email: string };
  onSignOut: () => void;
  children: React.ReactNode;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [bellOpen, setBellOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(0);
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => setMobileOpen(false), [location.pathname]);

  useEffect(() => {
    let alive = true;
    const load = () =>
      api
        .get<{ notifications: Notification[]; unread: number }>('/api/notifications')
        .then((data) => {
          if (!alive) return;
          setNotifications(data.notifications);
          setUnread(data.unread);
        })
        .catch(() => undefined);
    load();
    const timer = setInterval(load, 60_000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  const openBell = async () => {
    setBellOpen((v) => !v);
    if (!bellOpen && unread > 0) {
      await api.post('/api/notifications/read').catch(() => undefined);
      setUnread(0);
    }
  };

  const sidebar = (
    <nav className="flex h-full flex-col">
      <div className="flex items-center gap-2.5 px-5 py-5">
        <span className="grid h-9 w-9 place-items-center rounded-lg bg-accent font-extrabold text-accent-text">
          H
        </span>
        {!collapsed && (
          <span className="leading-tight">
            <span className="block text-sm font-bold tracking-tight text-white">HULK Automation</span>
            <span className="block text-xs text-muted">Marketing Center</span>
          </span>
        )}
      </div>

      <div className="flex-1 space-y-1 px-3">
        {NAV.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                isActive ? 'bg-accent/10 text-accent' : 'text-muted hover:bg-raised hover:text-white'
              }`
            }
            title={label}
          >
            <Icon className="h-[18px] w-[18px] shrink-0" />
            {!collapsed && label}
          </NavLink>
        ))}
      </div>

      <div className="border-t border-line p-3">
        <div className="flex items-center gap-3 rounded-lg px-2 py-2">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-raised text-xs font-semibold text-soft">
            {initials(user.name || user.email)}
          </span>
          {!collapsed && (
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-white">{user.name || 'Signed in'}</span>
              <span className="block truncate text-xs text-muted">{user.email}</span>
            </span>
          )}
          <button
            onClick={onSignOut}
            className="rounded-lg p-1.5 text-muted hover:bg-raised hover:text-white"
            title="Sign out"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
        <button
          onClick={() => setCollapsed((v) => !v)}
          className="mt-1 hidden w-full items-center gap-3 rounded-lg px-3 py-2 text-xs text-muted hover:bg-raised hover:text-white lg:flex"
        >
          <ChevronLeft className={`h-4 w-4 transition-transform ${collapsed ? 'rotate-180' : ''}`} />
          {!collapsed && 'Collapse menu'}
        </button>
      </div>
    </nav>
  );

  return (
    <div className="flex min-h-screen bg-ink">
      <aside
        className={`hidden shrink-0 border-r border-line bg-panel lg:block ${collapsed ? 'w-[76px]' : 'w-[248px]'}`}
      >
        {sidebar}
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/70" onClick={() => setMobileOpen(false)} />
          <aside className="absolute left-0 top-0 h-full w-[264px] border-r border-line bg-panel">{sidebar}</aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-40 flex items-center gap-3 border-b border-line bg-ink/95 px-4 py-3 backdrop-blur lg:px-8">
          <button
            onClick={() => setMobileOpen(true)}
            className="rounded-lg p-2 text-muted hover:bg-raised hover:text-white lg:hidden"
            aria-label="Open menu"
          >
            <Menu className="h-5 w-5" />
          </button>

          <div className="flex-1" />

          <Button size="sm" variant="primary" onClick={() => navigate('/campaigns/new')}>
            Create campaign
          </Button>

          <div className="relative">
            <button
              onClick={openBell}
              className="relative rounded-lg p-2 text-muted hover:bg-raised hover:text-white"
              aria-label="Notifications"
            >
              <Bell className="h-5 w-5" />
              {unread > 0 && (
                <span className="absolute right-1 top-1 grid h-4 min-w-4 place-items-center rounded-full bg-accent px-1 text-[10px] font-bold text-accent-text">
                  {unread}
                </span>
              )}
            </button>
            {bellOpen && (
              <div className="absolute right-0 top-11 z-50 w-[min(360px,calc(100vw-2rem))] overflow-hidden rounded-xl2 border border-line bg-panel shadow-card">
                <div className="border-b border-line px-4 py-3 text-sm font-semibold text-white">Notifications</div>
                <div className="max-h-80 overflow-y-auto">
                  {notifications.length === 0 && (
                    <p className="px-4 py-6 text-center text-sm text-muted">Nothing yet. Activity shows up here.</p>
                  )}
                  {notifications.map((n) => (
                    <div key={n.id} className="border-b border-line/60 px-4 py-3 last:border-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium text-white">{n.title}</span>
                        <Badge
                          tone={
                            n.level === 'success'
                              ? 'green'
                              : n.level === 'warning'
                              ? 'amber'
                              : n.level === 'error'
                              ? 'red'
                              : 'grey'
                          }
                        >
                          {n.level}
                        </Badge>
                      </div>
                      {n.message && <p className="mt-1 text-xs text-muted">{n.message}</p>}
                      <p className="mt-1 text-[11px] text-muted/70">{formatDateTime(n.created_at)}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </header>

        <main className="flex-1 px-4 py-6 lg:px-8 lg:py-8">{children}</main>
      </div>
    </div>
  );
}
