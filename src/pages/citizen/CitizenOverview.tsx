import { Link, useNavigate } from 'react-router-dom';
import { FileText, FolderOpen, Loader2, BadgeCheck, PlusCircle, ArrowRight, MapPin, Sparkles, Clock } from 'lucide-react';
import { useStore } from '../../lib/store';
import { Card, CardHeader, StatCard, StatusBadge, PriorityBadge, EmptyState, timeAgo } from '../../components/ui';
import LeafletMap, { issueToMarker } from '../../components/LeafletMap';
import { CATEGORY_META } from '../../lib/types';

export default function CitizenOverview() {
  const { db, currentUser } = useStore();
  const navigate = useNavigate();
  const me = currentUser!;
  const mine = (db?.issues ?? []).filter(i => i.reporterId === me.id).sort((a, b) => b.createdAt - a.createdAt);

  const total = mine.length;
  const open = mine.filter(i => ['REPORTED', 'UNDER_REVIEW'].includes(i.status)).length;
  const inProgress = mine.filter(i => ['ASSIGNED', 'IN_PROGRESS', 'REWORK_REQUIRED'].includes(i.status)).length;
  const awaiting = mine.filter(i => i.status === 'PENDING_VERIFICATION').length;
  const resolved = mine.filter(i => i.status === 'VERIFIED').length;

  const recentEvents = (db?.events ?? [])
    .filter(e => mine.some(i => i.id === e.issueId))
    .sort((a, b) => b.at - a.at)
    .slice(0, 6);
  const issueById = new Map(mine.map(i => [i.id, i]));

  return (
    <div className="space-y-4">
      {/* Greeting + CTA */}
      <div className="flex flex-col gap-4 overflow-hidden rounded-2xl bg-navy-900 p-5 text-white shadow-[var(--shadow-card)] sm:flex-row sm:items-center sm:justify-between sm:p-6">
        <div className="flex items-center gap-4">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-navy-800 font-display text-lg font-extrabold text-civic-gold ring-1 ring-civic-gold/30">{me.name.split(' ').map(w => w[0]).slice(0, 2).join('')}</div>
          <div>
            <p className="font-mono2 text-[9.5px] font-semibold uppercase tracking-[0.22em] text-civic-gold/80">Citizen Portal</p>
            <h1 className="font-display text-xl font-extrabold leading-tight sm:text-2xl">Hello, {me.name.split(' ')[0]}.</h1>
            <p className="mt-0.5 text-[11px] text-navy-100/70">Your civic service record is always one tap away.</p>
          </div>
        </div>
        <Link to="/citizen/report" className="group inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-civic-gold px-5 py-3.5 font-display text-[13px] font-extrabold uppercase tracking-wide text-navy-950 transition hover:bg-amber-300">
          <PlusCircle size={18} strokeWidth={2.2} /> Report an issue <ArrowRight size={15} strokeWidth={2.5} className="transition-transform group-hover:translate-x-1" />
        </Link>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <StatCard label="Total reports" value={total} icon={FileText} tone="navy" sub="all time" onClick={() => navigate('/citizen/reports')} />
        <StatCard label="Open" value={open} icon={FolderOpen} tone="amber" sub="awaiting review" onClick={() => navigate('/citizen/reports')} />
        <StatCard label="In progress" value={inProgress} icon={Loader2} tone="cyan" sub="crew assigned / repairing" onClick={() => navigate('/citizen/reports')} />
        <StatCard label="In verification" value={awaiting} icon={Clock} tone="violet" sub="evidence under review" onClick={() => navigate('/citizen/reports')} />
        <StatCard label="Resolved" value={resolved} icon={BadgeCheck} tone="emerald" sub="verified & closed" onClick={() => navigate('/citizen/reports')} />
      </div>

      <div className="grid gap-4 xl:grid-cols-5">
        {/* Map */}
        <Card className="overflow-hidden xl:col-span-3">
          <CardHeader icon={MapPin} title="Your reports on the map" subtitle="Live locations of every issue you filed" right={<Link to="/citizen/reports" className="text-[10.5px] font-bold uppercase tracking-wide text-navy-800 hover:underline">All reports →</Link>} />
          <div className="p-3">
            {mine.length > 0 ? (
              <LeafletMap height={330} zoom={12} markers={mine.map(i => issueToMarker(i, () => navigate('/citizen/reports', { state: { focus: i.id } })))} fitToMarkers />
            ) : (
              <EmptyState icon={MapPin} title="Nothing on the map yet" hint="Once you file your first report, its pin will appear here alongside live status colours." action={<Link to="/citizen/report" className="text-[12px] font-bold text-navy-800 underline underline-offset-4">File your first report</Link>} />
            )}
          </div>
        </Card>

        {/* Recent activity */}
        <Card className="xl:col-span-2">
          <CardHeader icon={Sparkles} title="Recent activity" subtitle="Latest updates on your reports" />
          <div className="max-h-[380px] divide-y divide-slate-100 overflow-y-auto nice-scroll">
            {recentEvents.length === 0 && <EmptyState title="No activity yet" hint="Status changes, AI notes and admin decisions on your reports will appear here." />}
            {recentEvents.map(e => {
              const issue = issueById.get(e.issueId);
              return (
                <div key={e.id} className="px-5 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono2 text-[9px] font-semibold uppercase text-slate-400">{issue?.ticketNo ?? ''} · {timeAgo(e.at)}</span>
                    {issue && <StatusBadge status={issue.status} />}
                  </div>
                  <p className="mt-1 text-[11.5px] font-medium leading-snug text-slate-700">{e.message}</p>
                </div>
              );
            })}
          </div>
        </Card>
      </div>

      {/* Latest reports table */}
      <Card>
        <CardHeader icon={FileText} title="Your latest reports" right={<Link to="/citizen/reports" className="text-[10.5px] font-bold uppercase tracking-wide text-navy-800 hover:underline">View all</Link>} />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-[12px]">
            <thead className="bg-slate-50 text-[9.5px] font-bold uppercase tracking-[0.14em] text-slate-400">
              <tr><th className="px-5 py-2.5">Ticket</th><th className="px-5 py-2.5">Type</th><th className="px-5 py-2.5">Priority</th><th className="px-5 py-2.5">Status</th><th className="px-5 py-2.5">Filed</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {mine.slice(0, 5).map(i => (
                <tr key={i.id} className="cursor-pointer transition hover:bg-navy-50/50" onClick={() => navigate('/citizen/reports', { state: { focus: i.id } })}>
                  <td className="px-5 py-3 font-mono2 text-[11px] font-semibold text-navy-900">{i.ticketNo}</td>
                  <td className="px-5 py-3 font-medium text-slate-600">{CATEGORY_META[i.category].label}</td>
                  <td className="px-5 py-3"><PriorityBadge priority={i.priority} /></td>
                  <td className="px-5 py-3"><StatusBadge status={i.status} /></td>
                  <td className="px-5 py-3 text-slate-500">{timeAgo(i.createdAt)}</td>
                </tr>
              ))}
              {mine.length === 0 && <tr><td colSpan={5} className="px-5 py-8 text-center text-slate-400">No reports yet — the city is waiting on you.</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
