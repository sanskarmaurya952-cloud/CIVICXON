import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Inbox, AlertTriangle, Wrench, BadgeCheck, Users, Sparkles, MapPin, ArrowRight, ChevronRight, Siren, ShieldAlert, UserX, Loader } from 'lucide-react';
import { useStore } from '../../lib/store';
import { Card, CardHeader, StatCard, StatusBadge, PriorityBadge, EmptyState, timeAgo } from '../../components/ui';
import LeafletMap, { type MapMarker } from '../../components/LeafletMap';
import { CATEGORY_META } from '../../lib/types';

export default function AdminOverview() {
  const { db, currentUser, ai } = useStore();
  const navigate = useNavigate();
  const me = currentUser!;
  const issues = useMemo(() => db?.issues ?? [], [db?.issues]);

  const c = useMemo(() => ({
    total: issues.length,
    underReview: issues.filter(i => ['REPORTED', 'UNDER_REVIEW'].includes(i.status)).length,
    unassigned: issues.filter(i => i.status === 'UNDER_REVIEW' && !i.assignedWorkerId).length,
    active: issues.filter(i => ['ASSIGNED', 'IN_PROGRESS'].includes(i.status)).length,
    verification: issues.filter(i => i.status === 'PENDING_VERIFICATION').length,
    rework: issues.filter(i => i.status === 'REWORK_REQUIRED').length,
    critical: issues.filter(i => i.priority === 'CRITICAL' && !['VERIFIED', 'CANCELLED', 'REJECTED', 'DUPLICATE'].includes(i.status)).length,
    verified: issues.filter(i => i.status === 'VERIFIED').length,
    duplicates: issues.filter(i => i.status === 'DUPLICATE').length,
    workersAvailable: (db?.workers ?? []).filter(w => { const u = (db?.users ?? []).find(u => u.id === w.userId); return u?.active && w.availability === 'AVAILABLE'; }).length,
  }), [issues, db?.workers, db?.users]);

  const openIssues = issues.filter(i => !['VERIFIED', 'CANCELLED', 'REJECTED', 'DUPLICATE'].includes(i.status));
  const markers: MapMarker[] = openIssues.slice(0, 60).map(i => ({
    id: i.id, lat: i.lat, lng: i.lng, kind: i.category, status: i.status,
    label: i.ticketNo, sublabel: `${CATEGORY_META[i.category].label} · ${i.priority}`,
    onClick: () => navigate('/admin/complaints', { state: { focus: i.id } }),
  }));
  const recentEvents = (db?.events ?? []).slice().sort((a, b) => b.at - a.at).slice(0, 7);
  const priorityQueue = openIssues.filter(i => ['CRITICAL', 'HIGH'].includes(i.priority)).sort((a, b) => (a.priority === 'CRITICAL' ? 0 : 1) - (b.priority === 'CRITICAL' ? 0 : 1) || b.createdAt - a.createdAt).slice(0, 4);

  return (
    <div className="space-y-4">
      {/* Command bar */}
      <div className="flex flex-col gap-3 rounded-2xl bg-navy-900 p-5 text-white sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-navy-800 ring-1 ring-civic-gold/30"><ShieldAlert size={22} className="text-civic-gold" /></div>
          <div>
            <p className="font-mono2 text-[9.5px] font-semibold uppercase tracking-[0.22em] text-civic-gold/85">Admin Console · Operations</p>
            <h1 className="font-display text-xl font-extrabold">Good day, {me.name.split(' ')[0]}.</h1>
            <p className="text-[10.5px] text-navy-100/65">City of Bengaluru — Road & Streetlight Maintenance (demo integrations)</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {ai && <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[9px] font-bold uppercase tracking-wider ${ai.label.startsWith('Gemma 4 live') ? 'bg-violet-400/15 text-violet-300 ring-1 ring-violet-400/30' : 'bg-slate-400/15 text-slate-300 ring-1 ring-slate-400/25'}`} title={ai.label}><Sparkles size={11} />{ai.label.startsWith('Gemma 4 live') ? `Gemma 4 · ${ai.model}` : 'Dev AI mode — add key in Settings'}</span>}
          <button onClick={() => navigate('/admin/review')} className="inline-flex items-center gap-1.5 rounded-xl bg-civic-gold px-4 py-2.5 text-[11px] font-extrabold uppercase tracking-wide text-navy-950 transition hover:bg-amber-300">Review queue <ArrowRight size={13} strokeWidth={2.5} /></button>
        </div>
      </div>

      {/* KPI grid */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-7">
        <StatCard label="Total" value={c.total} icon={Inbox} tone="navy" />
        <StatCard label="In review" value={c.underReview} icon={ChevronRight} tone="amber" onClick={() => navigate('/admin/review')} />
        <StatCard label="Unassigned" value={c.unassigned} icon={UserX} tone={c.unassigned ? 'rose' : 'slate'} onClick={() => navigate('/admin/review')} />
        <StatCard label="Active repairs" value={c.active} icon={Wrench} tone="cyan" onClick={() => navigate('/admin/complaints')} />
        <StatCard label="Verification" value={c.verification} icon={Loader} tone="violet" sub="queue" onClick={() => navigate('/admin/verification')} />
        <StatCard label="Rework" value={c.rework} icon={AlertTriangle} tone="rose" onClick={() => navigate('/admin/verification')} />
        <StatCard label="Verified" value={c.verified} icon={BadgeCheck} tone="emerald" onClick={() => navigate('/admin/analytics')} />
      </div>

      <div className="grid items-start gap-4 xl:grid-cols-5">
        {/* Live city map */}
        <Card className="overflow-hidden xl:col-span-3">
          <CardHeader icon={MapPin} title="Live issue map" subtitle={`${openIssues.length} open issues across service zones`} right={<span className="flex items-center gap-2 font-mono2 text-[9px] font-semibold text-slate-400"><span className="h-2 w-2 rounded-full bg-orange-600" />pothole<span className="h-2 w-2 rounded-full bg-blue-700" />streetlight</span>} />
          <div className="p-3"><LeafletMap height={330} markers={markers} fitToMarkers zoom={12} /></div>
        </Card>

        {/* Critical queue */}
        <Card className="xl:col-span-2">
          <CardHeader icon={Siren} title="Critical & high priority" subtitle="Escalating first — by SLA risk" right={<button className="text-[10.5px] font-bold uppercase tracking-wide text-navy-800 hover:underline" onClick={() => navigate('/admin/complaints')}>All →</button>} />
          <div className="divide-y divide-slate-100">
            {priorityQueue.map(i => (
              <button key={i.id} onClick={() => navigate('/admin/complaints', { state: { focus: i.id } })} className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-navy-50">
                <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg font-display text-[8.5px] font-extrabold text-white ${i.priority === 'CRITICAL' ? 'bg-rose-600' : 'bg-orange-500'}`}>{i.priority.slice(0, 4)}</span>
                <span className="min-w-0 flex-1"><span className="font-mono2 text-[9.5px] font-bold text-slate-400">{i.ticketNo} · {timeAgo(i.createdAt)}</span><p className="truncate text-[11.5px] font-semibold text-navy-900">{i.description}</p></span>
                <StatusBadge status={i.status} />
              </button>
            ))}
            {priorityQueue.length === 0 && <EmptyState title="No critical items" hint="The city is quiet — nothing above MEDIUM priority is open." />}
          </div>
        </Card>
      </div>

      <div className="grid items-start gap-4 xl:grid-cols-5">
        {/* Workforce snapshot */}
        <Card className="xl:col-span-2">
          <CardHeader icon={Users} title="Field workforce" subtitle="Load across all active crews" right={<button className="text-[10.5px] font-bold uppercase tracking-wide text-navy-800 hover:underline" onClick={() => navigate('/admin/workers')}>Manage →</button>} />
          <div className="divide-y divide-slate-100">
            {(db?.workers ?? []).map(w => {
              const u = db?.users.find(u => u.id === w.userId);
              const load = w.currentLoad, max = w.maxConcurrentJobs;
              const pct = Math.min(100, (load / max) * 100);
              return (
                <div key={w.id} className="flex items-center gap-3 px-4 py-2.5">
                  <span className={`h-2 w-2 shrink-0 rounded-full ${u?.active ? (w.availability === 'AVAILABLE' ? 'bg-emerald-500' : w.availability === 'BUSY' ? 'bg-amber-500' : 'bg-slate-300') : 'bg-rose-400'}`} title={u?.active ? w.availability : 'Deactivated'} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[11.5px] font-semibold text-navy-900">{u?.name}{!u?.active && <span className="ml-1.5 font-mono2 text-[8.5px] font-bold uppercase text-rose-500">deactivated</span>}</p>
                    <div className="mt-1 flex items-center gap-1.5"><div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-200"><div className={`h-full rounded-full ${pct >= 100 ? 'bg-rose-500' : pct >= 66 ? 'bg-amber-500' : 'bg-emerald-500'}`} style={{ width: `${pct}%` }} /></div><span className="font-mono2 text-[9px] font-bold text-slate-500">{load}/{max}</span></div>
                  </div>
                  <span className="shrink-0 font-mono2 text-[9.5px] font-bold text-slate-400">★{w.rating.toFixed(1)}</span>
                </div>
              );
            })}
          </div>
          <div className="border-t border-slate-100 px-4 py-2.5 text-center text-[10px] font-bold uppercase tracking-wide text-slate-500">{c.workersAvailable} of {db?.workers.length ?? 0} crews available right now</div>
        </Card>

        {/* Activity pulse */}
        <Card className="xl:col-span-3">
          <CardHeader icon={Sparkles} title="Live operations feed" subtitle="Every consequential action, as it happens" right={<button className="text-[10.5px] font-bold uppercase tracking-wide text-navy-800 hover:underline" onClick={() => navigate('/admin/activity')}>Full log →</button>} />
          <div className="divide-y divide-slate-100">
            {recentEvents.map(e => {
              const issue = db?.issues.find(i => i.id === e.issueId);
              return (
                <div key={e.id} className="flex items-start gap-3 px-4 py-2.5">
                  <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-civic-gold-dark" />
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] leading-snug text-slate-700"><span className="font-mono2 text-[9px] font-bold text-slate-400">{issue?.ticketNo ?? 'SYS'} · {timeAgo(e.at)}</span><br />{e.message}</p>
                  </div>
                </div>
              );
            })}
            {recentEvents.length === 0 && <EmptyState title="Quiet system" hint="Actions will stream here as the city reports, assigns, repairs and verifies." />}
          </div>
        </Card>
      </div>
    </div>
  );
}
