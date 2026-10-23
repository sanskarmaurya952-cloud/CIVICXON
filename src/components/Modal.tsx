import { useEffect, type ReactNode } from 'react';
import { X } from 'lucide-react';

export default function Modal({ title, subtitle, onClose, children, wide }: { title: string; subtitle?: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = ''; };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-navy-950/70 backdrop-blur-[2px]" onClick={onClose} />
      <div className={`relative flex max-h-[94vh] w-full flex-col overflow-hidden rounded-t-3xl bg-white shadow-[var(--shadow-pop)] sm:rounded-3xl ${wide ? 'max-w-3xl' : 'max-w-lg'}`}>
        <div className="flex items-start justify-between border-b border-slate-100 px-6 py-4">
          <div>
            <h2 className="font-display text-[15px] font-extrabold tracking-tight text-navy-900">{title}</h2>
            {subtitle && <p className="mt-0.5 text-[11.5px] text-slate-500">{subtitle}</p>}
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700" aria-label="Close"><X size={18} /></button>
        </div>
        <div className="overflow-y-auto px-6 py-5 nice-scroll">{children}</div>
      </div>
    </div>
  );
}
