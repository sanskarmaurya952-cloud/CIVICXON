import { Link, useNavigate } from 'react-router-dom';
import { ClipboardList, Wrench, Clock, BadgeCheck, MapPin, Navigation, ChevronRight, HardHat, AlertTriangle, Phone, Building2 } from 'lucide-react';
import { useStore } from '../../lib/store';
import { Card, CardHeader, StatCard, StatusBadge, PriorityBadge, EmptyState, AvailabilityBadge, timeAgo } from '../../components/ui';
import LeafletMap, { type MapMarker } from '../../components/LeafletMap';
import { CATEGORY_META, SKILL_LABEL } from '../../lib/types';

export default function WorkerOverview() {
  const { db, currentUser } = useStore();
  const navigate = useNavigate();
  const me = currentUser!;
  const profile = db?.workers.find(w => w.userId === me.id);
  const dept = db?.departments.find(d => d.id === profile?.departmentId);
  const myIssues = (db?.issues ?? []).filter(i => profile && i.assignedWorkerId === profile.id).sort((a, b) => b.createdAt - a.createdAt);

  const active = myIssues.filter(i => ['ASSIGNED', 'IN_PROGRESS', 'REWORK_REQUIRED'].includes(i.status));
  const assigned = myIssues.filter(i => i.status === 'ASSIGNED');
  const awaiting = myIssues.filter(i => i.status === 'PENDING_VERIFICATION');
  const rework = myIssues.filter(i => i.status === 'REWORK_REQUIRED');
  const verifiedCount = myIssues.filter(i => i.status === 'VERIFIED').length;

  const markers: MapMarker[] = active.map(i => ({
    id: i.id, lat: i.lat, lng: i.lng, kind: 'pin' as const, status: i.status,
    label: i.ticketNo, sublabel: CATEGORY_META[i.category].label,
    onClick: () => navigate('/worker/jobs'),
  }));

  return (
    <div className="space-y-4">
      {/* Identity bar */}
      <div className="flex flex-col gap-4 rounded-2xl bg-navy-900 p-5 text-white sm:flex-row sm:items-center sm:justify-between sm:p-6">
        <div className="flex items-center gap-4">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-amber-400 font-display text-lg font-extrabold text-navy-950">{me.name.split(' ').map(w => w[0]).slice(0, 2).join('')}</div>
          <div>
            <p className="font-mono2 text-[9.5px] font-semibold uppercase tracking-[0.22em] text-civic-gold/85">Field Crew · {dept?.name ?? 'Maintenance'}</p>
            <h1 className="font-display text-xl font-extrabold leading-tight sm:text-2xl">{me.name}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-[9.5px] font-semibold text-navy-100/70">
              <span className="flex items-center gap-1"><Building2 size={10} />{dept?.code ?? '—'} dept</span>
              <span>·</span>
              <span>{(profile?.skills ?? []).map(s => SKILL_LABEL[s]).join(' + ')}</span>
              <span>·</span>
              <span>Rating {profile?.rating.toFixed(1)} ★ · {profile?.jobsCompleted} jobs closed</span>
            </div>
          </div>
        </div>
        {profile && <AvailabilityBadge value={profile.availability} />}
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Assigned" value={assigned.length} icon={ClipboardList} tone="navy" sub="not yet started" onClick={() => navigate('/worker/jobs')} />
        <StatCard label="Active work" value={active.length - assigned.length} icon={Wrench} tone="cyan" sub="in the field now" onClick={() => navigate('/worker/jobs')} />
        <StatCard label="Awaiting check" value={awaiting.length} icon={Clock} tone="violet" sub="evidence with admin" onClick={() => navigate('/worker/jobs')} />
        <StatCard label="Rework" value={rework.length} icon={AlertTriangle} tone="rose" sub="needs another pass" onClick={() => navigate('/worker/rework')} />
      </div>

      <div className="grid items-start gap-4 xl:grid-cols-5">
        <Card className="overflow-hidden xl:col-span-3">
          <CardHeader icon={MapPin} title="Your job map" subtitle="Assigned sites awaiting your action" right={<Link to="/worker/jobs" className="text-[10.5px] font-bold uppercase tracking-wide text-navy-800 hover:underline">Open jobs →</Link>} />
          <div className="p-3">
            {markers.length > 0 ? <LeafletMap height={300} markers={markers} fitToMarkers /> : <EmptyState icon={MapPin} title="No active sites" hint="When the allocation engine assigns you a job in your zone, the pin drops here." />}
          </div>
        </Card>

        <Card className="xl:col-span-2">
          <CardHeader icon={HardHat} title="Today's queue" subtitle="Worked top-down: rework first, then by priority" right={<span className="font-mono2 text-[10px] font-bold text-slate-400">{active.length} OPEN</span>} />
          <div className="max-h-[360px] divide-y divide-slate-100 overflow-y-auto nice-scroll">
            {[...rework, ...active.filter(i => i.status === 'ASSIGNED'), ...active.filter(i => i.status === 'IN_PROGRESS')].map(i => (
              <button key={i.id} onClick={() => navigate(`/worker/jobs`)} className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-navy-50">
                <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl font-display text-[10px] font-extrabold text-white ${i.status === 'REWORK_REQUIRED' ? 'bg-orange-500' : i.priority === 'CRITICAL' ? 'bg-rose-600' : i.priority === 'HIGH' ? 'bg-orange-500' : 'bg-navy-800'}`}>{i.priority.slice(0, 4)}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2"><span className="font-mono2 text-[9.5px] font-bold text-slate-400">{i.ticketNo}</span><StatusBadge status={i.status} /></div>
                  <p className="mt-0.5 truncate text-[11.5px] font-semibold text-navy-900">{i.description}</p>
                  <p className="mt-0.5 flex items-center gap-1 text-[9.5px] text-slate-500"><MapPin size={9} />{i.zone} · {timeAgo(i.createdAt)}</p>
                </div>
                <ChevronRight size={15} className="shrink-0 text-slate-300" />
              </button>
            ))}
            {active.length === 0 && <EmptyState title="All clear" hint="New assignments appear here automatically." />}
          </div>
          {verifiedCount > 0 && <div className="border-t border-slate-100 px-4 py-2.5 text-center text-[10.5px] font-bold uppercase tracking-wide text-emerald-700"><span className="inline-flex items-center gap-1"><BadgeCheck size={13} /> {verifiedCount} repair{verifiedCount > 1 ? 's' : ''} verified</span></div>}
        </Card>
      </div>

      {/* Quick nav */}
      <div className="grid gap-3 sm:grid-cols-2">
        <Link to="/worker/jobs" className="group flex items-center justify-between rounded-2xl border border-slate-200 bg-white p-4 transition hover:border-navy-800 hover:shadow-md">
          <div><p className="font-display text-[13px] font-extrabold text-navy-900">My assigned jobs</p><p className="text-[10.5px] text-slate-500">Start work · upload evidence · submit for verification</p></div>
          <ChevronRight className="text-slate-400 transition-transform group-hover:translate-x-1" size={20} />
        </Link>
        <Link to="/worker/rework" className="group flex items-center justify-between rounded-2xl border border-orange-200 bg-orange-50/50 p-4 transition hover:border-orange-400 hover:shadow-md">
          <div><p className="font-display text-[13px] font-extrabold text-orange-900">Rework requests <span className="ml-1 rounded-full bg-orange-600 px-1.5 py-0.5 text-[9px] text-white">{rework.length}</span></p><p className="text-[10.5px] text-orange-800/70">Fix what failed verification — fastest path to close</p></div>
          <ChevronRight className="text-orange-400 transition-transform group-hover:translate-x-1" size={20} />
        </Link>
      </div>
    </div>
  );
}
