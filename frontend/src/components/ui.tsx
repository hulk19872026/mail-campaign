import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, HelpCircle, Info, Loader2, X } from 'lucide-react';

/* ---------------------------------- card ---------------------------------- */

export function Card({
  children,
  className = '',
  padded = true,
}: {
  children: React.ReactNode;
  className?: string;
  padded?: boolean;
}) {
  return (
    <div
      className={`rounded-xl2 border border-line bg-panel shadow-card ${padded ? 'p-5' : ''} ${className}`}
    >
      {children}
    </div>
  );
}

export function SectionTitle({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 className="text-lg font-semibold tracking-tight text-white">{title}</h2>
        {subtitle && <p className="mt-1 max-w-2xl text-sm text-muted">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

/* --------------------------------- button --------------------------------- */

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  icon?: React.ReactNode;
};

export function Button({
  variant = 'secondary',
  size = 'md',
  loading,
  icon,
  className = '',
  children,
  disabled,
  ...rest
}: ButtonProps) {
  const base =
    'inline-flex items-center justify-center gap-2 rounded-lg font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50';
  const sizes = {
    sm: 'px-3 py-1.5 text-[13px]',
    md: 'px-4 py-2.5 text-sm',
    lg: 'px-5 py-3 text-[15px]',
  }[size];
  const variants = {
    primary: 'bg-accent text-accent-text hover:bg-[#1EB055]',
    secondary: 'bg-raised text-soft border border-line hover:border-[#33414F] hover:text-white',
    ghost: 'text-muted hover:text-white hover:bg-raised',
    danger: 'bg-danger/10 text-danger border border-danger/40 hover:bg-danger/20',
  }[variant];

  return (
    <button className={`${base} ${sizes} ${variants} ${className}`} disabled={disabled || loading} {...rest}>
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : icon}
      {children}
    </button>
  );
}

/* --------------------------------- badges --------------------------------- */

const TONES: Record<string, string> = {
  green: 'bg-accent/10 text-accent border-accent/30',
  amber: 'bg-warn/10 text-warn border-warn/30',
  red: 'bg-danger/10 text-danger border-danger/30',
  grey: 'bg-raised text-muted border-line',
  blue: 'bg-sky-500/10 text-sky-300 border-sky-500/30',
};

export function Badge({ tone = 'grey', children }: { tone?: keyof typeof TONES; children: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${TONES[tone]}`}>
      {children}
    </span>
  );
}

export function StatusDot({ ok, warn }: { ok: boolean; warn?: boolean }) {
  const color = ok ? 'bg-accent' : warn ? 'bg-warn' : 'bg-danger';
  return <span className={`inline-block h-2 w-2 rounded-full ${color}`} />;
}

export function statusTone(status: string): keyof typeof TONES {
  if (['sent', 'active', 'completed', 'won', 'delivered'].includes(status)) return 'green';
  if (['queued', 'paused', 'scheduled', 'new', 'contacted'].includes(status)) return 'amber';
  if (['failed', 'bounced', 'lost', 'cancelled'].includes(status)) return 'red';
  return 'grey';
}

/* --------------------------------- fields --------------------------------- */

export function Field({
  label,
  hint,
  children,
  className = '',
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1.5 block text-sm font-medium text-soft">{label}</span>
      {children}
      {hint && <span className="mt-1.5 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

const inputClass =
  'w-full rounded-lg border border-line bg-ink px-3.5 py-2.5 text-sm text-white placeholder:text-muted/70 focus:border-accent focus:outline-none';

export const Input = (props: React.InputHTMLAttributes<HTMLInputElement>) => (
  <input {...props} className={`${inputClass} ${props.className ?? ''}`} />
);

export const Textarea = (props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) => (
  <textarea {...props} className={`${inputClass} min-h-[110px] leading-relaxed ${props.className ?? ''}`} />
);

export const Select = (props: React.SelectHTMLAttributes<HTMLSelectElement>) => (
  <select {...props} className={`${inputClass} ${props.className ?? ''}`} />
);

export function Radio({
  checked,
  onChange,
  label,
  description,
}: {
  checked: boolean;
  onChange: () => void;
  label: string;
  description?: string;
}) {
  return (
    <button
      type="button"
      onClick={onChange}
      className={`flex w-full items-start gap-3 rounded-lg border p-3.5 text-left transition-colors ${
        checked ? 'border-accent bg-accent/5' : 'border-line bg-ink hover:border-[#33414F]'
      }`}
    >
      <span
        className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
          checked ? 'border-accent' : 'border-muted'
        }`}
      >
        {checked && <span className="h-2 w-2 rounded-full bg-accent" />}
      </span>
      <span>
        <span className="block text-sm font-medium text-white">{label}</span>
        {description && <span className="mt-0.5 block text-xs text-muted">{description}</span>}
      </span>
    </button>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="flex items-center gap-3 text-sm text-soft"
      aria-pressed={checked}
    >
      <span
        className={`relative h-6 w-11 rounded-full transition-colors ${checked ? 'bg-accent' : 'bg-line'}`}
      >
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${
            checked ? 'left-[22px]' : 'left-0.5'
          }`}
        />
      </span>
      {label}
    </button>
  );
}

/* --------------------------------- modal ---------------------------------- */

export function Modal({
  open,
  onClose,
  title,
  children,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  wide?: boolean;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-0 sm:items-center sm:p-6">
      <div
        className={`max-h-[92vh] w-full overflow-y-auto rounded-t-2xl border border-line bg-panel sm:rounded-xl2 ${
          wide ? 'sm:max-w-4xl' : 'sm:max-w-lg'
        }`}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-line bg-panel px-5 py-4">
          <h3 className="text-base font-semibold text-white">{title}</h3>
          <button onClick={onClose} className="rounded-lg p-1.5 text-muted hover:bg-raised hover:text-white">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

/* -------------------------------- feedback -------------------------------- */

export function EmptyState({
  title,
  message,
  action,
  icon,
}: {
  title: string;
  message: string;
  action?: React.ReactNode;
  icon?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl2 border border-dashed border-line px-6 py-14 text-center">
      <div className="mb-3 text-muted">{icon ?? <Info className="h-7 w-7" />}</div>
      <h3 className="text-base font-semibold text-white">{title}</h3>
      <p className="mt-1.5 max-w-sm text-sm text-muted">{message}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function ErrorNotice({ error, onRetry }: { error: string; details?: string; onRetry?: () => void }) {
  const [showDetails, setShowDetails] = useState(false);
  return (
    <div className="rounded-xl2 border border-danger/30 bg-danger/5 p-4">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-danger" />
        <div className="flex-1">
          <p className="text-sm text-white">{error}</p>
          <div className="mt-3 flex items-center gap-3">
            {onRetry && (
              <Button size="sm" onClick={onRetry}>
                Try again
              </Button>
            )}
            <button
              onClick={() => setShowDetails((v) => !v)}
              className="text-xs text-muted underline hover:text-soft"
            >
              {showDetails ? 'Hide technical details' : 'View technical details'}
            </button>
          </div>
          {showDetails && (
            <pre className="mt-3 overflow-x-auto rounded-lg bg-ink p-3 text-xs text-muted">{error}</pre>
          )}
        </div>
      </div>
    </div>
  );
}

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted">
      <Loader2 className="h-4 w-4 animate-spin" /> {label}
    </div>
  );
}

export function Progress({ value, max, tone = 'accent' }: { value: number; max: number; tone?: string }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div className="h-2.5 w-full overflow-hidden rounded-full bg-ink">
      <div
        className={`progress-bar h-full rounded-full ${tone === 'warn' ? 'bg-warn' : 'bg-accent'}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

/* ---------------------------------- help ---------------------------------- */

export function HelpTip({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-flex">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        onBlur={() => setOpen(false)}
        className="text-muted hover:text-accent"
        aria-label="What does this mean?"
      >
        <HelpCircle className="h-4 w-4" />
      </button>
      {open && (
        <span className="absolute left-1/2 top-6 z-30 w-64 -translate-x-1/2 rounded-lg border border-line bg-raised p-3 text-xs leading-relaxed text-soft shadow-card">
          {children}
        </span>
      )}
    </span>
  );
}

/* --------------------------------- toasts --------------------------------- */

type Toast = { id: number; tone: 'success' | 'error' | 'info'; message: string };
const ToastContext = createContext<{ push: (tone: Toast['tone'], message: string) => void }>({
  push: () => undefined,
});

export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const push = useCallback((tone: Toast['tone'], message: string) => {
    const id = Date.now() + Math.random();
    setToasts((list) => [...list, { id, tone, message }]);
    setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), 5000);
  }, []);

  const value = useMemo(() => ({ push }), [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[min(360px,calc(100vw-2rem))] flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto flex items-start gap-2.5 rounded-xl2 border p-3.5 text-sm shadow-card ${
              t.tone === 'success'
                ? 'border-accent/40 bg-accent/10 text-white'
                : t.tone === 'error'
                ? 'border-danger/40 bg-danger/10 text-white'
                : 'border-line bg-raised text-soft'
            }`}
          >
            {t.tone === 'success' ? (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
            ) : t.tone === 'error' ? (
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-danger" />
            ) : (
              <Info className="mt-0.5 h-4 w-4 shrink-0" />
            )}
            <span className="flex-1">{t.message}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
