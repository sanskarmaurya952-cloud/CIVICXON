import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { CheckCircle2, AlertTriangle, Info, XCircle, X } from 'lucide-react';

type ToastKind = 'success' | 'error' | 'info' | 'warning';
interface Toast { id: number; kind: ToastKind; title: string; body?: string }

const ToastCtx = createContext<{ toast: (kind: ToastKind, title: string, body?: string) => void } | null>(null);
let counter = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toast = useCallback((kind: ToastKind, title: string, body?: string) => {
    const id = counter++;
    setToasts(t => [...t.slice(-2), { id, kind, title, body }]);
    window.setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 5200);
  }, []);
  const icons = { success: CheckCircle2, error: XCircle, info: Info, warning: AlertTriangle };
  const colors = {
    success: 'ring-emerald-300 text-emerald-700',
    error: 'ring-rose-300 text-rose-700',
    info: 'ring-blue-300 text-blue-800',
    warning: 'ring-amber-300 text-amber-800',
  };
  return (
    <ToastCtx.Provider value={{ toast }}>
      {children}
      <div className="pointer-events-none fixed bottom-5 right-5 z-[9999] flex w-[min(92vw,380px)] flex-col gap-2">
        {toasts.map(t => {
          const Icon = icons[t.kind];
          return (
            <div key={t.id} className={`toast-in pointer-events-auto flex items-start gap-2.5 rounded-xl bg-white px-3.5 py-3 shadow-[var(--shadow-pop)] ring-1 ${colors[t.kind]}`}>
              <Icon size={17} className="mt-0.5 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-[12px] font-bold text-navy-900">{t.title}</p>
                {t.body && <p className="mt-0.5 text-[11px] leading-snug text-slate-600">{t.body}</p>}
              </div>
              <button onClick={() => setToasts(x => x.filter(y => y.id !== t.id))} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600" aria-label="Dismiss"><X size={13} /></button>
            </div>
          );
        })}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastCtx);
  if (!ctx) throw new Error('useToast outside provider');
  return ctx.toast;
}
