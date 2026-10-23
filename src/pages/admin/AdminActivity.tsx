import { useMemo, useState } from 'react';
import { History, Search, ShieldCheck, HardHat, User, Bot, Cpu } from 'lucide-react';
import { useStore } from '../../lib/store';
import { Card, CardHeader, EmptyState, timeAgo } from '../../components/ui';
import type { IssueEvent } from '../../lib/types';

const TYPE_FILTERS = ['ALL', 'CREATED', 'AI_ANALYSIS', 'STATUS_CHANGE', 'PRIORITY_SET', 'ASSIGNED', 'REASSIGNED', 'EVIDENCE_SUBMITTED', 'VERIFICATION_DECISION', 'REWORK_REQUESTED', 'DUPLICATE_MERGED', 'NOTE', 'CANCELLED', 'REJECTED'] as const;

export default function AdminActivity() {
  const { db } = useStore();
  const [query, setQuery] = useState('');
  const [type, setType] = useState<(typeof TYPE_FILTERS)[number]>('ALL');

  const events = useMemo(() => {
    let list = [...(db?.events ?? [])].sort((a, b) => b.at - a.at);
    if (type !== 'ALL') list = list.filter(e => e.type === type);
    const q = query.trim().toLowerCase();
    if (q) list = list.filter(e => [e.message, e.actorName, e.type].join(' ').toLowerCase().includes(q));
    return list.slice(0, 200);
  }, [db?.events, query, type]);

  const roleIcon = (role: IssueEvent['actorRole']) => role === 'admin' ? ShieldCheck : role === 'worker' ? HardHat : role === 'ai' ? Cpu : role === 'system' ? Bot : User;

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-extrabold tracking-tight text-navy-900">Activity & audit trail</h1>
          <p className="text-[11.5px] text-slate-500">Every decision, assignment, verification and status change — newest first · immutable log ({db?.events.length ?? 0} entries)</p>
        </div>
        <div className="relative">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search messages, people, tickets…" className="h-9 w-56 rounded-xl border-0 bg-white pl-8 pr-3 text-[12px] ring-1 ring-slate-200 outline-none placeholder:text-slate-400 focus:ring-2 focus:ring-navy-800" aria-label="Search activity" />
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">{TYPE_FILTERS.map(t => <button key={t} onClick={() => setType(t)} className={`rounded-full px-3 py-1.5 text-[9px] font-bold uppercase tracking-wider ring-1 transition ${type === t ? 'bg-navy-900 text-civic-gold ring-navy-900' : 'bg-white text-slate-500 ring-slate-200 hover:text-navy-900'}`}>{t.replace(/_/g, ' ')}</button>)}</div>

      <Card className="mt-3">
        <CardHeader icon={History} title="System events" subtitle="Bounded to the 200 most recent matching entries" />
        <div className="divide-y divide-slate-100">
          {events.map(e => {
            const issue = db?.issues.find(i => i.id === e.issueId);
            const Icon = roleIcon(e.actorRole);
            return (
              <div key={e.id} className="flex items-start gap-3 px-5 py-3 transition hover:bg-slate-50/60">
                <span className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${e.actorRole === 'admin' ? 'bg-violet-100 text-violet-700' : e.actorRole === 'worker' ? 'bg-amber-100 text-amber-700' : e.actorRole === 'ai' || e.actorRole === 'system' ? 'bg-navy-100 text-navy-800' : 'bg-emerald-100 text-emerald-700'}`}><Icon size={14} strokeWidth={1.8} /></span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span className="text-[10px] font-extrabold uppercase tracking-wide text-slate-500">{e.actorName}</span>
                    <span className="font-mono2 text-[8.5px] font-semibold text-slate-400">{e.type.replace(/_/g, ' ')}</span>
                    {issue && <span className="font-mono2 text-[8.5px] font-bold text-navy-800">{issue.ticketNo}</span>}
                    <span className="ml-auto font-mono2 text-[9px] text-slate-400">{timeAgo(e.at)}</span>
                  </div>
                  <p className="mt-0.5 text-[11.5px] leading-snug text-slate-700">{e.message}</p>
                </div>
              </div>
            );
          })}
          {events.length === 0 && <EmptyState title="No matching events" hint="Try clearing the search or switching the type filter." />}
        </div>
      </Card>
    </div>
  );
}
