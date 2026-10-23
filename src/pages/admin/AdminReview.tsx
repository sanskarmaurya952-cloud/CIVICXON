import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Sparkles, Wand2, CheckCircle2, XCircle, GitMerge, MapPin, Image as ImageIcon, AlertTriangle, ChevronDown, ChevronUp, ShieldCheck, Phone, Gauge, CircleAlert, Search } from 'lucide-react';
import { useStore } from '../../lib/store';
import { useToast } from '../../components/Toast';
import { Card, CardHeader, StatusBadge, PriorityBadge, Button, EmptyState, Input, Textarea, Select, Spinner, timeAgo } from '../../components/ui';
import { CATEGORY_META, SKILL_LABEL } from '../../lib/types';
import { rankWorkers } from '../../lib/scoring';
import { findDuplicates } from '../../lib/workflow';
import type { Priority } from '../../lib/types';

export default function AdminReview() {
  const { db } = useStore();
  const [query, setQuery] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);

  const issues = useMemo(() => {
    const all = (db?.issues ?? []).filter(i => ['REPORTED', 'UNDER_REVIEW'].includes(i.status)).sort((a, b) => b.createdAt - a.createdAt);
    const q = query.trim().toLowerCase();
    const filtered = q ? all.filter(i => [i.ticketNo, i.description, i.address, i.reporterName, i.zone].join(' ').toLowerCase().includes(q)) : all;
    return filtered;
  }, [db?.issues, query]);

  return (
    <div className="grid items-start gap-4 xl:grid-cols-5">
      <div className="xl:col-span-2">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="font-display text-2xl font-extrabold tracking-tight text-navy-900">Review queue</h1>
            <p className="text-[11.5px] text-slate-500">{issues.length} report(s) awaiting triage or assignment</p>
          </div>
          <div className="relative">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search ticket, place, citizen…" className="h-9 w-48 rounded-xl border-0 bg-white pl-8 pr-3 text-[11.5px] ring-1 ring-slate-200 outline-none placeholder:text-slate-400 focus:ring-2 focus:ring-navy-800" aria-label="Search reports" />
          </div>
        </div>
        <div className="space-y-3">
          {issues.map(i => {
            const before = db?.media.find(m => m.issueId === i.id && m.type === 'BEFORE');
            const isNew = i.status === 'REPORTED';
            return (
              <button key={i.id} onClick={() => setOpenId(i.id)} className={`flex w-full items-stretch overflow-hidden rounded-2xl bg-white text-left ring-1 transition hover:-translate-y-0.5 hover:shadow-[var(--shadow-pop)] ${openId === i.id ? 'ring-2 ring-navy-800 shadow-[var(--shadow-pop)]' : 'ring-slate-900/[0.06] shadow-[var(--shadow-card)]'}`}>
                <div className="relative w-24 shrink-0">{before ? <img src={before.storageKey} alt="Report" className="absolute inset-0 h-full w-full object-cover" /> : <div className="absolute inset-0 flex items-center justify-center bg-slate-100 text-slate-300">?</div>}{isNew && <span className="absolute left-1 top-1 rounded-full bg-amber-400 px-1.5 py-0.5 text-[8px] font-extrabold uppercase text-navy-950">New</span>}</div>
                <div className="min-w-0 flex-1 p-3">
                  <div className="flex items-center justify-between gap-2"><span className="font-mono2 text-[9.5px] font-bold text-slate-400">{i.ticketNo} · {timeAgo(i.createdAt)}</span><PriorityBadge priority={i.priority} /></div>
                  <p className="mt-1 line-clamp-2 text-[11px] font-semibold leading-snug text-navy-900">{i.description}</p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5"><StatusBadge status={i.status} /><span className="text-[9px] text-slate-400">{CATEGORY_META[i.category].label} · {i.zone}</span></div>
                </div>
              </button>
            );
          })}
          {issues.length === 0 && <Card><EmptyState title="Queue zero" hint="Every report has been reviewed, triaged and routed. New citizen reports land here automatically." /></Card>}
        </div>
      </div>

      <div className="xl:col-span-3">
        {openId ? <ReviewPanel issueId={openId} onDone={() => setOpenId(null)} /> : <Card className="hidden xl:block"><EmptyState icon={ShieldCheck} title="Select a report" hint="Open any ticket to review AI analysis, set priority with a reason, approve or reject, merge duplicates, and assign the right crew." /></Card>}
      </div>
    </div>
  );
}

function ReviewPanel({ issueId, onDone }: { issueId: string; onDone: () => void }) {
  const { db, currentUser, approveReview, rejectReport, autoAssign, assignWorker, mergeDuplicate } = useStore();
  const toast = useToast();
  const navigate = useNavigate();
  const me = currentUser!;
  const issue = db?.issues.find(i => i.id === issueId);
  const [priority, setPriorityState] = useState<Priority>('MEDIUM');
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [showRanking, setShowRanking] = useState(false);
  const [mergeTarget, setMergeTarget] = useState('');
  const [assignNote, setAssignNote] = useState('');

  // re-seed local form state per issue
  useEffect(() => {
    setPriorityState(issue?.priority ?? 'MEDIUM');
    setReason(issue?.priorityReason ?? '');
    setMergeTarget('');
    setAssignNote('');
    setShowRanking(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [issueId]);

  const workers = db?.workers ?? [];
  const ranking = useMemo(() => {
    if (!issue || !db) return null;
    return rankWorkers({
      workers,
      workerActive: w => { const u = db.users.find(u => u.id === w.userId); return Boolean(u?.active); },
      issue,
      requiredSkill: CATEGORY_META[issue.category].skill,
      weights: db.settings.weights,
    });
  }, [issue, workers, db]);

  const dupCandidates = useMemo(() => {
    if (!issue || !db) return [];
    const hintIds = new Set((issue.duplicateHints ?? []).map(h => h.issueId));
    const hinted = db.issues.filter(i => hintIds.has(i.id));
    const geo = findDuplicates({ candidate: { category: issue.category, description: issue.description, lat: issue.lat, lng: issue.lng }, existing: db.issues, mediaByIssue: () => [], excludeId: issue.id }).map(d => d.issue);
    const merged = [...hinted, ...geo].filter((v, i, arr) => arr.findIndex(x => x.id === v.id) === i);
    return merged;
  }, [issue, db]);

  if (!issue || !db) return <Card className="p-6">Report not found.</Card>;
  const before = db.media.filter(m => m.issueId === issue.id && m.type === 'BEFORE');
  const isReported = issue.status === 'REPORTED';

  const act = async (fn: () => void, ok: string) => {
    setBusy(true);
    try { fn(); toast('success', ok); } catch (err) { toast('error', 'Action failed', err instanceof Error ? err.message : ''); } finally { setBusy(false); }
  };

  const handleApprove = () => act(() => {
    approveReview(issue.id, priority, reason || `Admin review — ${priority} priority`);
    toast('info', 'Under review + assignment', db.settings.autoAssign ? 'Auto-allocation will dispatch the best-ranked eligible crew.' : 'Auto-assign is off — use Manual Assign.');
  }, 'Report approved — moving to under review');

  const handleAutoAssign = () => act(() => {
    const res = autoAssign(issue.id);
    if (res.assigned && res.top) toast('success', `Auto-assigned #1: ${res.top.worker ? 'crew dispatched' : ''}`, `Score ${res.top.breakdown.total.toFixed(1)} — see ranking for the full breakdown.`);
    else toast('warning', 'No eligible worker', 'Every crew was filtered out — assign manually above.');
  }, 'Allocation engine ran');

  const handleReject = () => {
    if (!note.trim() || note.trim().length < 6) { toast('warning', 'Reason required', 'Give a clear rejection reason (min 6 characters).'); return; }
    act(() => rejectReport(issue.id, note.trim()), 'Report rejected');
  };

  const handleMerge = () => {
    if (!mergeTarget) { toast('warning', 'Pick a merge target'); return; }
    act(() => mergeDuplicate(issue.id, mergeTarget), 'Merged as confirmed duplicate');
    onDone();
  };

  return (
    <div className="space-y-4">
      {/* header */}
      <div className="flex items-center justify-between gap-3 rounded-2xl bg-navy-900 px-5 py-3.5 text-white">
        <div>
          <p className="font-mono2 text-[9px] font-semibold uppercase tracking-[0.22em] text-civic-gold/85">Review · {CATEGORY_META[issue.category].label}</p>
          <p className="font-mono2 text-[13px] font-bold">{issue.ticketNo} · <span className="text-white/60">reported {timeAgo(issue.createdAt)}</span></p>
        </div>
        <StatusBadge status={issue.status} />
      </div>

      {/* AI panel */}
      {issue.ai ? (
        <div className="rounded-2xl border border-violet-200 bg-violet-50/70 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.18em] text-violet-800"><Sparkles size={12} /> AI analysis · {issue.ai.provider === 'gemma-4' ? issue.ai.model : 'dev baseline (not a model)'}</p>
            <span className="font-mono2 text-[10px] font-bold text-violet-900">{(issue.ai.confidence * 100).toFixed(0)}% confidence</span>
          </div>
          <div className="mt-2 grid gap-2 sm:grid-cols-4">
            <Kv k="Category" v={CATEGORY_META[issue.ai.category].label.split(' /')[0]} />
            <Kv k="Severity" v={issue.ai.severity.toUpperCase()} />
            <Kv k="Department" v={issue.ai.departmentSuggestion.replace(' Maintenance Department', '')} />
            <Kv k="Analyzed" v={new Date(issue.ai.analysedAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })} />
          </div>
          <p className="mt-2 text-[11.5px] leading-relaxed text-violet-950/90">{issue.ai.explanation}</p>
          {issue.ai.riskIndicators.length > 0 && <div className="mt-2 flex flex-wrap gap-1.5">{issue.ai.riskIndicators.map(r => <span key={r} className="rounded-full bg-violet-100 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-violet-900 ring-1 ring-violet-200">{r}</span>)}</div>}
          <p className="mt-1.5 flex items-center gap-1 text-[9px] font-semibold uppercase tracking-wide text-violet-500"><CircleAlert size={9} /> AI advice only — admin decision required to close</p>
        </div>
      ) : <div className="rounded-2xl border border-slate-200 bg-white p-4 text-[11px] text-slate-500">No AI analysis stored for this report (filed before AI was enabled).</div>}

      {/* evidence + description */}
      <div className="grid gap-4 lg:grid-cols-5">
        {before[0] && (
          <figure className="overflow-hidden rounded-2xl ring-1 ring-slate-200 lg:col-span-2">
            <img src={before[0].storageKey} alt="Citizen evidence" className="h-48 w-full object-cover" />
            <figcaption className="bg-navy-950 px-3 py-1.5 text-[8.5px] font-bold uppercase tracking-wider text-white/85"><span className="flex items-center gap-1"><ImageIcon size={9} /> Citizen photo · {before[0].caption}</span></figcaption>
          </figure>
        )}
        <div className="lg:col-span-3">
          <p className="text-[9.5px] font-bold uppercase tracking-[0.18em] text-slate-400">Report</p>
          <p className="mt-1 text-[12.5px] leading-relaxed text-slate-700">{issue.description}</p>
          <p className="mt-2 flex items-start gap-1.5 text-[10.5px] text-slate-500"><MapPin size={11} className="mt-0.5 shrink-0" /><span>{issue.address} · <span className="font-mono2">{issue.lat.toFixed(5)}, {issue.lng.toFixed(5)}</span> · Zone {issue.zone}</span></p>
          <p className="mt-1 flex items-center gap-1.5 text-[10.5px] text-slate-500"><Phone size={11} />{issue.reporterName} · {issue.citizenPhone}</p>
        </div>
      </div>

      {/* decision: approve & set priority, or reject */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card className="p-4">
          <p className="flex items-center gap-1.5 text-[10px] font-extrabold uppercase tracking-[0.18em] text-slate-500"><Gauge size={12} /> Approve & set priority</p>
          <div className="mt-2 flex gap-1.5">{(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as Priority[]).map(p => (
            <button key={p} onClick={() => setPriorityState(p)} className={`flex-1 rounded-lg border-2 py-2 text-[10.5px] font-extrabold uppercase tracking-wide transition ${priority === p ? (p === 'CRITICAL' ? 'border-rose-600 bg-rose-600 text-white' : p === 'HIGH' ? 'border-orange-500 bg-orange-500 text-white' : p === 'MEDIUM' ? 'border-amber-400 bg-amber-400 text-navy-950' : 'border-slate-400 bg-slate-400 text-white') : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300'}`}>{p}</button>
          ))}</div>
          <Input className="mt-2" placeholder="Why this priority? (required — e.g. ‘two-wheeler hazard, monsoon’)" value={reason} onChange={e => setReason(e.target.value)} aria-label="Priority reason" />
          <Button variant="success" className="mt-2 w-full" disabled={busy} onClick={handleApprove}><CheckCircle2 size={15} />{isReported ? 'Approve → Under Review' : 'Set priority & keep reviewing'}</Button>
        </Card>

        <Card className="p-4">
          <p className="flex items-center gap-1.5 text-[10px] font-extrabold uppercase tracking-[0.18em] text-slate-500"><XCircle size={12} /> Reject report</p>
          <Textarea className="mt-2" rows={3} placeholder="Reason — e.g. ‘duplicate of private property, not public infrastructure’ / ‘photo unrelated to any defect’" value={note} onChange={e => setNote(e.target.value)} aria-label="Rejection reason" />
          <Button variant="danger" className="mt-2 w-full" disabled={busy} onClick={handleReject}><XCircle size={15} /> Reject report</Button>
        </Card>
      </div>

      {/* duplicate merge */}
      <Card className="p-4">
        <p className="flex items-center gap-1.5 text-[10px] font-extrabold uppercase tracking-[0.18em] text-slate-500"><GitMerge size={12} /> Duplicate control {dupCandidates.length > 0 && <span className="rounded-full bg-amber-100 px-1.5 py-0.5 font-mono2 text-[9px] text-amber-800">{dupCandidates.length} nearby match(es)</span>}</p>
        {dupCandidates.length > 0 ? (
          <div className="mt-2 space-y-2">
            {dupCandidates.map(d => {
              const hint = (issue.duplicateHints ?? []).find(h => h.issueId === d.id);
              return (
                <label key={d.id} className={`flex cursor-pointer items-center gap-3 rounded-xl border-2 p-2.5 transition ${mergeTarget === d.id ? 'border-navy-800 bg-navy-50' : 'border-slate-200 hover:border-slate-300'}`}>
                  <input type="radio" name="merge-target" className="accent-navy-900" checked={mergeTarget === d.id} onChange={() => setMergeTarget(d.id)} />
                  <span className="min-w-0 flex-1"><span className="font-mono2 text-[10px] font-bold text-slate-500">{d.ticketNo}</span><span className="line-clamp-1 text-[11.5px] font-semibold text-navy-900">{d.description}</span><span className="text-[9.5px] text-slate-500">{hint ? `${Math.round(hint.combined * 100)}% · ${hint.reasons.join(' · ')}` : 'Same area — same category'}</span></span>
                </label>
              );
            })}
            <Button variant="navy" size="sm" onClick={handleMerge} disabled={busy || !mergeTarget}><GitMerge size={13} /> Merge into selected (admin-confirmed)</Button>
          </div>
        ) : <p className="mt-1.5 text-[11px] text-slate-500">No similar open reports within 350 m. This report will flow through triage → assignment.</p>}
      </Card>

      {/* assignment engine */}
      <Card className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="flex items-center gap-1.5 text-[10px] font-extrabold uppercase tracking-[0.18em] text-slate-500"><Wand2 size={12} /> Smart allocation · skill {SKILL_LABEL[CATEGORY_META[issue.category].skill]} · zone {issue.zone}</p>
          <button onClick={() => setShowRanking(v => !v)} className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-navy-800 hover:underline">{showRanking ? 'Hide' : 'Show'} ranking {showRanking ? <ChevronUp size={12} /> : <ChevronDown size={12} />}</button>
        </div>

        {issue.assignedWorkerId ? (
          <div className="mt-2 flex items-center justify-between gap-3 rounded-xl bg-emerald-50 px-4 py-2.5 ring-1 ring-emerald-200">
            <p className="text-[12px] font-bold text-emerald-900">Assigned → {db.users.find(u => u.id === db.workers.find(w => w.id === issue.assignedWorkerId)?.userId)?.name ?? 'Worker'}</p>
            <p className="font-mono2 text-[9px] font-bold uppercase text-emerald-700">{issue.status === 'IN_PROGRESS' ? 'repairing' : issue.status}</p>
          </div>
        ) : (
          <>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button variant="gold" onClick={handleAutoAssign} disabled={busy}><Wand2 size={15} /> Auto-assign best eligible</Button>
              <span className="inline-flex items-center px-2 text-[10.5px] font-semibold text-slate-400">or assign manually:</span>
              <div className="flex flex-1 gap-2">
                <Select value="" onChange={e => { if (e.target.value) act(() => assignWorker(issue.id, e.target.value, assignNote), 'Worker assigned'); }} aria-label="Manual assignment">
                  <option value="">Select crew…</option>
                  {ranking?.ranked.filter(r => r.eligible).map(r => { const u = db.users.find(u => u.id === r.worker.userId)!; return <option key={r.worker.id} value={r.worker.id}>#{r.rank} {u.name} — {r.breakdown.total.toFixed(1)} pts · {r.breakdown.distanceKm.toFixed(1)} km · load {r.worker.currentLoad}/{r.worker.maxConcurrentJobs}</option>; })}
                </Select>
              </div>
            </div>
            <Input className="mt-2" placeholder="Optional note for the assigned crew (recorded in audit trail)…" value={assignNote} onChange={e => setAssignNote(e.target.value)} />
            {ranking && ranking.eligibleCount === 0 && <p className="mt-2 flex items-center gap-1.5 rounded-lg bg-rose-50 px-3 py-2 text-[10.5px] font-semibold text-rose-800 ring-1 ring-rose-200"><AlertTriangle size={12} /> No eligible crew: every candidate failed skill / zone / availability / capacity. This report stays unassigned and admins were notified.</p>}
          </>
        )}

        {/* ranking table */}
        {showRanking && ranking && (
          <div className="mt-3 overflow-x-auto rounded-xl ring-1 ring-slate-200">
            <table className="w-full min-w-[560px] text-left text-[10.5px]">
              <thead className="bg-navy-900 text-[8.5px] font-bold uppercase tracking-[0.14em] text-civic-gold">
                <tr><th className="px-3 py-2">#</th><th className="px-3 py-2">Crew</th><th className="px-3 py-2">Skill</th><th className="px-3 py-2">Distance</th><th className="px-3 py-2">Load</th><th className="px-3 py-2">Availability</th><th className="px-3 py-2 text-right">Score</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {ranking.ranked.map(r => {
                  const u = db.users.find(u => u.id === r.worker.userId)!;
                  const best = r.rank === 1;
                  return (
                    <tr key={r.worker.id} className={r.eligible ? (best ? 'bg-emerald-50/60' : '') : 'opacity-55'}>
                      <td className="px-3 py-2 font-mono2 font-bold text-slate-500">{r.eligible ? `#${r.rank}` : '—'}</td>
                      <td className="px-3 py-2"><span className="font-bold text-navy-900">{u.name}</span><br /><span className="text-[8.5px] text-slate-400">{r.eligible ? r.worker.zones.join(', ') : r.ineligibleReasons.join('; ')}</span></td>
                      <td className="px-3 py-2 font-mono2">{r.breakdown.skill.toFixed(0)}</td>
                      <td className="px-3 py-2 font-mono2">{r.breakdown.distanceKm.toFixed(1)} km<br /><span className="text-[8.5px] text-slate-400">{r.breakdown.distance.toFixed(0)} pts</span></td>
                      <td className="px-3 py-2 font-mono2">{r.worker.currentLoad}/{r.worker.maxConcurrentJobs}<br /><span className="text-[8.5px] text-slate-400">{r.breakdown.workload.toFixed(0)} pts</span></td>
                      <td className="px-3 py-2 font-mono2">{r.worker.availability}<br /><span className="text-[8.5px] text-slate-400">{r.breakdown.availability.toFixed(0)} pts</span></td>
                      <td className={`px-3 py-2 text-right font-mono2 text-[12px] font-extrabold ${r.eligible ? (best ? 'text-emerald-700' : 'text-navy-900') : 'text-slate-400'}`}>{r.eligible ? r.breakdown.total.toFixed(1) : '0'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="border-t border-slate-100 bg-slate-50 px-3 py-1.5 text-[9px] font-medium text-slate-500">Deterministic ranking: skill {db.settings.weights.skill} · distance {db.settings.weights.distance} · workload {db.settings.weights.workload} · availability {db.settings.weights.availability} (weights in Settings). Eligibility is enforced by rules — never by AI.</p>
          </div>
        )}
      </Card>
    </div>
  );
}

function Kv({ k, v }: { k: string; v: string }) {
  return <div className="rounded-xl bg-white/70 px-2.5 py-1.5 ring-1 ring-violet-100"><p className="text-[8px] font-bold uppercase tracking-wider text-violet-500">{k}</p><p className="truncate text-[11px] font-bold text-violet-950">{v}</p></div>;
}
