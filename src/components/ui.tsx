import type { ReactNode } from 'react';
import { Loader2, Inbox, type LucideIcon } from 'lucide-react';
import type { IssueStatus, Priority, Availability } from '../lib/types';
import { ISSUE_STATUS_META, PRIORITY_META, AVAILABILITY_META } from '../lib/types';

const TONE: Record<string, string> = {
  slate: 'bg-slate-100 text-slate-700 ring-slate-300',
  amber: 'bg-amber-50 text-amber-800 ring-amber-300',
  blue: 'bg-blue-50 text-blue-800 ring-blue-300',
  cyan: 'bg-cyan-50 text-cyan-800 ring-cyan-300',
  violet: 'bg-violet-50 text-violet-800 ring-violet-300',
  emerald: 'bg-emerald-50 text-emerald-800 ring-emerald-300',
  rose: 'bg-rose-50 text-rose-800 ring-rose-300',
  gray: 'bg-gray-100 text-gray-600 ring-gray-300',
  orange: 'bg-orange-50 text-orange-800 ring-orange-300',
};

export function Badge({ tone, children, className = '' }: { tone: string; children: ReactNode; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide ring-1 ${TONE[tone] ?? TONE.slate} ${className}`}>
      {children}
    </span>
  );
}

export function StatusBadge({ status }: { status: IssueStatus }) {
  const meta = ISSUE_STATUS_META[status];
  return <Badge tone={meta.tone}>{meta.label}</Badge>;
}

export function PriorityBadge({ priority }: { priority: Priority }) {
  const meta = PRIORITY_META[priority];
  return <Badge tone={meta.tone}>{meta.label}</Badge>;
}

export function AvailabilityBadge({ value }: { value: Availability }) {
  const meta = AVAILABILITY_META[value];
  return <Badge tone={meta.tone}>{meta.label}</Badge>;
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-2xl bg-white ring-1 ring-slate-900/[0.06] shadow-[var(--shadow-card)] ${className}`}>{children}</div>;
}

export function CardHeader({ icon: Icon, title, subtitle, right }: { icon?: LucideIcon; title: string; subtitle?: string; right?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
      <div className="flex items-start gap-3">
        {Icon && <div className="mt-0.5 rounded-lg bg-navy-900/[0.05] p-2 text-navy-800"><Icon size={17} strokeWidth={1.8} /></div>}
        <div>
          <h3 className="font-display text-[13.5px] font-bold tracking-tight text-navy-900">{title}</h3>
          {subtitle && <p className="mt-0.5 text-[11.5px] text-slate-500">{subtitle}</p>}
        </div>
      </div>
      {right && <div className="shrink-0">{right}</div>}
    </div>
  );
}

export function EmptyState({ icon: Icon = Inbox, title, hint, action }: { icon?: LucideIcon; title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
      <div className="rounded-2xl bg-slate-100 p-4 text-slate-400"><Icon size={26} strokeWidth={1.6} /></div>
      <p className="font-display text-sm font-bold text-navy-900">{title}</p>
      {hint && <p className="max-w-sm text-xs leading-relaxed text-slate-500">{hint}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function Spinner({ size = 18, className = '' }: { size?: number; className?: string }) {
  return <Loader2 size={size} className={`animate-spin ${className}`} aria-label="Loading" />;
}

export function Button({ variant = 'primary', size = 'md', children, onClick, type = 'button', disabled, className = '', title }: {
  variant?: 'primary' | 'navy' | 'outline' | 'ghost' | 'danger' | 'gold' | 'success';
  size?: 'sm' | 'md';
  children: ReactNode;
  onClick?: () => void;
  type?: 'button' | 'submit';
  disabled?: boolean;
  className?: string;
  title?: string;
}) {
  const base = 'inline-flex items-center justify-center gap-2 font-semibold rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed select-none';
  const sizes = { sm: 'text-[11.5px] px-3 py-1.5', md: 'text-[12.5px] px-4 py-2.5' };
  const variants = {
    primary: 'bg-navy-900 text-white hover:bg-navy-800 shadow-sm active:scale-[.98]',
    navy: 'bg-navy-900 text-white hover:bg-navy-800',
    outline: 'bg-white text-navy-900 ring-1 ring-slate-300 hover:ring-navy-800 hover:bg-navy-50',
    ghost: 'text-slate-600 hover:bg-slate-100 hover:text-navy-900',
    danger: 'bg-rose-600 text-white hover:bg-rose-700 active:scale-[.98]',
    gold: 'bg-civic-gold text-navy-950 hover:bg-civic-gold-dark hover:text-white active:scale-[.98]',
    success: 'bg-emerald-600 text-white hover:bg-emerald-700 active:scale-[.98]',
  };
  return <button type={type} title={title} disabled={disabled} onClick={onClick} className={`${base} ${sizes[size]} ${variants[variant]} ${className}`}>{children}</button>;
}

export function Input({ label, error, hint, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { label?: string; error?: string; hint?: string }) {
  return (
    <label className="block">
      {label && <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</span>}
      <input {...props} className={`w-full rounded-xl border-0 bg-slate-50 px-3 py-2.5 text-[13px] text-navy-900 ring-1 ring-inset placeholder:text-slate-400 outline-none transition focus:bg-white focus:ring-2 focus:ring-navy-800 ${error ? 'ring-2 ring-rose-400' : 'ring-slate-200'} ${props.className ?? ''}`} />
      {error ? <span className="mt-1 block text-[11px] font-medium text-rose-600">{error}</span> : hint ? <span className="mt-1 block text-[11px] text-slate-500">{hint}</span> : null}
    </label>
  );
}

export function Textarea({ label, error, hint, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { label?: string; error?: string; hint?: string }) {
  return (
    <label className="block">
      {label && <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</span>}
      <textarea {...props} className={`w-full rounded-xl border-0 bg-slate-50 px-3 py-2.5 text-[13px] leading-relaxed text-navy-900 ring-1 ring-inset placeholder:text-slate-400 outline-none transition focus:bg-white focus:ring-2 focus:ring-navy-800 ${error ? 'ring-2 ring-rose-400' : 'ring-slate-200'} ${props.className ?? ''}`} />
      {error ? <span className="mt-1 block text-[11px] font-medium text-rose-600">{error}</span> : hint ? <span className="mt-1 block text-[11px] text-slate-500">{hint}</span> : null}
    </label>
  );
}

export function Select({ label, error, hint, children, ...props }: React.SelectHTMLAttributes<HTMLSelectElement> & { label?: string; error?: string; hint?: string }) {
  return (
    <label className="block">
      {label && <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</span>}
      <select {...props} className={`w-full appearance-none rounded-xl border-0 bg-slate-50 px-3 py-2.5 text-[13px] text-navy-900 ring-1 ring-inset outline-none transition focus:bg-white focus:ring-2 focus:ring-navy-800 ${error ? 'ring-2 ring-rose-400' : 'ring-slate-200'}`}>{children}</select>
      {error ? <span className="mt-1 block text-[11px] font-medium text-rose-600">{error}</span> : hint ? <span className="mt-1 block text-[11px] text-slate-500">{hint}</span> : null}
    </label>
  );
}

export function StatCard({ label, value, sub, icon: Icon, tone = 'navy', onClick }: { label: string; value: ReactNode; sub?: string; icon: LucideIcon; tone?: 'navy' | 'gold' | 'emerald' | 'amber' | 'rose' | 'violet' | 'cyan' | 'slate'; onClick?: () => void }) {
  const tones: Record<string, string> = {
    navy: 'bg-navy-900 text-civic-gold',
    gold: 'bg-amber-100 text-amber-700',
    emerald: 'bg-emerald-100 text-emerald-700',
    amber: 'bg-amber-100 text-amber-700',
    rose: 'bg-rose-100 text-rose-700',
    violet: 'bg-violet-100 text-violet-700',
    cyan: 'bg-cyan-100 text-cyan-700',
    slate: 'bg-slate-100 text-slate-600',
  };
  const body = (
    <div className={`group flex items-center gap-4 ${onClick ? 'cursor-pointer transition-transform hover:-translate-y-0.5' : ''}`}>
      <div className={`rounded-2xl p-3 ${tones[tone]}`}><Icon size={22} strokeWidth={1.8} /></div>
      <div className="min-w-0">
        <p className="text-[10.5px] font-bold uppercase tracking-[0.08em] text-slate-500">{label}</p>
        <p className="font-display text-[22px] font-extrabold leading-tight tracking-tight text-navy-900">{value}</p>
        {sub && <p className="text-[10.5px] font-medium text-slate-400">{sub}</p>}
      </div>
    </div>
  );
  const inner = <Card className="px-5 py-4">{body}</Card>;
  return onClick ? <button onClick={onClick} className="w-full text-left">{inner}</button> : inner;
}

export function ProgressTimeline({ steps, currentStep }: { steps: { label: string }[]; currentStep: number }) {
  return (
    <ol className="flex w-full items-center">
      {steps.map((step, i) => {
        const n = i + 1;
        const done = n < currentStep;
        const active = n === currentStep;
        return (
          <li key={i} className="flex flex-1 items-center last:flex-none">
            <div className="flex flex-col items-center gap-1.5">
              <div className={`flex h-6 w-6 items-center justify-center rounded-full text-[9px] font-bold transition-all ${done ? 'bg-emerald-500 text-white' : active ? 'bg-navy-900 text-civic-gold ring-4 ring-navy-900/10' : 'bg-slate-200 text-slate-400'}`}>
                {done ? '✓' : n}
              </div>
              <span className={`whitespace-nowrap text-[9px] font-semibold uppercase tracking-wide ${active ? 'text-navy-900' : 'text-slate-400'}`}>{step.label}</span>
            </div>
            {i < steps.length - 1 && <div className={`mx-1 mb-4 h-[3px] flex-1 rounded-full ${done ? 'bg-emerald-500' : 'bg-slate-200'}`} />}
          </li>
        );
      })}
    </ol>
  );
}

export function formatDateTime(ts: number): string {
  return new Date(ts).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(ts).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}
