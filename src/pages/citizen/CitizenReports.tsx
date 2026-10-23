import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { X, AlertTriangle, Sparkles, MessageSquarePlus, Ban, BadgeCheck, Image as ImageIcon, MapPin, ChevronRight, History, Bot, User, HardHat, ShieldCheck, Wrench, Lightbulb, Send } from 'lucide-react';
import { useStore } from '../../lib/store';
import { useToast } from '../../components/Toast';
import { StatusBadge, PriorityBadge, Button, Card, EmptyState, timeAgo, ProgressTimeline } from '../../components/ui';
import { ISSUE_STATUS_META } from '../../lib/types';
import { WORKFLOW_STEPS } from '../../lib/catalog';

export default function CitizenReports() {
  const { db, currentUser, addNote, cancelIssue } = useStore();
  const location = useLocation();
  const toast = useToast();
  const me = currentUser!;
  const [focusId, setFocusId] = useState<string | null>((location.state as { focus?: string } | null)?.focus ?? null);
  const [filter, setFilter] = useState<'all' | 'open' | 'resolved'>('all');
  const mine = useMemo(() => (db?.issues ?? []).filter(i => i.reporterId === me.id).sort((a, b) => b.createdAt - a.createdAt), [db?.issues, me.id]);

  const visible = mine.filter(i => {
    if (filter === 'open') return !['VERIFIED', 'CANCELLED', 'REJECTED', 'DUPLICATE'].includes(i.status);
    if (filter === 'resolved') return ['VERIFIED', 'CANCELLED', 'REJECTED', 'DUPLICATE'].includes(i.status);
    return true;
  });
  const focused = mine.find(i => i.id === focusId) ?? null;

  const act = (fn: () => void, ok: string) => {
    try { fn(); toast('success', ok); } catch (err) { toast('error', 'Action failed', err instanceof Error ? err.message : ''); }
  };

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-extrabold tracking-tight text-navy-900">My Reports</h1>
          <p className="text-[11.5px] text-slate-500">{mine.length} total · tap a report to open its full file</p>
        </div>
        <div className="flex rounded-xl bg-slate-200/60 p-1">
          {([['all', 'All'], ['open', 'Open'], ['resolved', 'Closed']] as const).map(([k, l]) => (
            <button key={k} onClick={() => setFilter(k)} className={`rounded-lg px-4 py-1.5 text-[11px] font-bold uppercase tracking-wide transition ${filter === k ? 'bg-white text-navy-900 shadow-sm' : 'text-slate-500'}`}>{l}</button>
          ))}
        </div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        {visible.map(i => {
          const before = db?.media.find(m => m.issueId === i.id && m.type === 'BEFORE');
          const Icon = i.category === 'pothole' ? Wrench : Lightbulb;
          return (
            <button key={i.id} onClick={() => setFocusId(i.id)} className="group flex items-stretch gap-0 overflow-hidden rounded-2xl bg-white text-left ring-1 ring-slate-900/[0.06] shadow-[var(--shadow-card)] transition hover:-translate-y-0.5 hover:shadow-[var(--shadow-pop)]">
              <div className="relative w-32 shrink-0 sm:w-36">
                {before ? <img src={before.storageKey} alt="Report" className="absolute inset-0 h-full w-full object-cover" /> : <div className="absolute inset-0 flex items-center justify-center bg-slate-100"><Icon size={30} className="text-slate-300" /></div>}
              </div>
              <div className="flex min-w-0 flex-1 flex-col p-3.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono2 text-[10px] font-bold text-slate-400">{i.ticketNo}</span>
                  <ChevronRight size={14} className="text-slate-300 transition-transform group-hover:translate-x-0.5" />
                </div>
                <p className="mt-1 line-clamp-2 text-[12px] font-semibold leading-snug text-navy-900">{i.description}</p>
                <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-2.5">
                  <StatusBadge status={i.status} />
                  <PriorityBadge priority={i.priority} />
                  <span className="font-mono2 text-[9px] text-slate-400">{timeAgo(i.createdAt)}</span>
                </div>
              </div>
            </button>
          );
        })}
        {visible.length === 0 && <Card className="md:col-span-2"><EmptyState title="No reports in this view" hint="Switch the filter, or file a new report — it takes under a minute with a photo and GPS." /></Card>}
      </div>

      {/* ───── Detail drawer ───── */}
      <AnimatePresence>
        {focused && (
          <>
            <motion.div className="fixed inset-0 z-[80] bg-navy-950/60 backdrop-blur-[2px]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setFocusId(null)} />
            <motion.aside className="fixed inset-y-0 right-0 z-[90] flex w-full max-w-xl flex-col bg-paper shadow-2xl" initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }} transition={{ type: 'tween', duration: 0.28, ease: [0.32, 0.72, 0, 1] }} role="dialog" aria-label={`Report ${focused.ticketNo}`}>
              <div className="flex items-center justify-between border-b border-slate-200 bg-white px-5 py-3.5">
                <div className="flex items-center gap-2.5">
                  <span className="font-mono2 text-[12px] font-bold text-navy-900">{focused.ticketNo}</span>
                  <StatusBadge status={focused.status} />
                  <PriorityBadge priority={focused.priority} />
                </div>
                <button onClick={() => setFocusId(null)} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Close"><X size={18} /></button>
              </div>

              <div className="flex-1 overflow-y-auto p-5 nice-scroll">
                {/* workflow timeline */}
                {!['REJECTED', 'DUPLICATE', 'CANCELLED'].includes(focused.status) && (
                  <div className="rounded-2xl bg-white p-4 ring-1 ring-slate-900/[0.06]">
                    <p className="mb-2.5 text-[9.5px] font-bold uppercase tracking-[0.18em] text-slate-400">Repair progress</p>
                    <ProgressTimeline steps={WORKFLOW_STEPS} currentStep={ISSUE_STATUS_META[focused.status].step} />
                  </div>
                )}

                {/* AI analysis */}
                {focused.ai && (
                  <div className="mt-3 rounded-2xl border border-violet-200/70 bg-violet-50/60 p-4">
                    <div className="flex items-center justify-between gap-2">
                      <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.18em] text-violet-800"><Sparkles size={12} /> AI triage {focused.ai.provider === 'gemma-4' ? `· ${focused.ai.model}` : '· dev baseline (not a model)'}</p>
                      <span className="font-mono2 text-[9.5px] font-bold text-violet-800">{(focused.ai.confidence * 100).toFixed(0)}% conf</span>
                    </div>
                    <p className="mt-1.5 text-[11.5px] leading-relaxed text-violet-950">{focused.ai.explanation}</p>
                    {focused.ai.riskIndicators.length > 0 && <div className="mt-2 flex flex-wrap gap-1.5">{focused.ai.riskIndicators.map(r => <span key={r} className="rounded-full bg-violet-100 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-violet-800 ring-1 ring-violet-200">{r}</span>)}</div>}
                    <p className="mt-2 text-[9px] font-semibold uppercase tracking-wide text-violet-500">Suggested department: {focused.ai.departmentSuggestion}</p>
                  </div>
                )}

                {/* duplicate hints */}
                {focused.duplicateHints && focused.duplicateHints.length > 0 && focused.status !== 'DUPLICATE' && (
                  <div className="mt-3 flex items-start gap-2 rounded-2xl border border-amber-200 bg-amber-50 p-4">
                    <AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-600" />
                    <div>
                      <p className="text-[10.5px] font-bold uppercase tracking-wide text-amber-800">Similar nearby report(s)</p>
                      <ul className="mt-1 space-y-1">{focused.duplicateHints.map(h => <li key={h.ticketNo} className="text-[11px] text-amber-900">{h.ticketNo} — {Math.round(h.combined * 100)}% · {h.reasons.join(', ')}</li>)}</ul>
                      <p className="mt-1 text-[9.5px] text-amber-800/75">An admin will confirm merges. Similarity is not proof.</p>
                    </div>
                  </div>
                )}
                {focused.duplicateOfId && (
                  <div className="mt-3 rounded-2xl border border-slate-300 bg-slate-100 p-4 text-[11.5px] text-slate-600">This report was merged into <span className="font-mono2 font-bold">{db?.issues.find(i => i.id === focused.duplicateOfId)?.ticketNo ?? 'another ticket'}</span> as a confirmed duplicate. Progress is tracked there.</div>
                )}
                {focused.status === 'REJECTED' && focused.rejectedReason && (
                  <div className="mt-3 rounded-2xl border border-rose-200 bg-rose-50 p-4"><p className="text-[10px] font-bold uppercase tracking-wide text-rose-700">Rejected by administrator</p><p className="mt-1 text-[11.5px] text-rose-900">{focused.rejectedReason}</p></div>
                )}

                {/* description & media */}
                <Card className="mt-3 p-4">
                  <p className="text-[9.5px] font-bold uppercase tracking-[0.18em] text-slate-400">Your report</p>
                  <p className="mt-1.5 text-[12.5px] leading-relaxed text-slate-700">{focused.description}</p>
                  <div className="mt-2 flex items-center gap-1.5 font-mono2 text-[10px] text-slate-500"><MapPin size={11} />{focused.address} · zone {focused.zone}</div>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    {(db?.media ?? []).filter(m => m.issueId === focused.id).map(m => (
                      <figure key={m.id} className="overflow-hidden rounded-xl ring-1 ring-slate-200">
                        <img src={m.storageKey} alt={m.caption} className="h-36 w-full object-cover" />
                        <figcaption className="flex items-center gap-1 bg-slate-50 px-2 py-1.5 text-[9px] font-semibold uppercase tracking-wide text-slate-500"><ImageIcon size={10} />{m.caption}</figcaption>
                      </figure>
                    ))}
                  </div>
                </Card>

                {/* timeline of events */}
                <div className="mt-4">
                  <p className="flex items-center gap-1.5 text-[9.5px] font-bold uppercase tracking-[0.18em] text-slate-400"><History size={12} /> Full history & audit trail</p>
                  <ol className="mt-2 space-y-0 border-l-2 border-slate-200 pl-4">
                    {(db?.events ?? []).filter(e => e.issueId === focused.id).sort((a, b) => a.at - b.at).map(e => {
                      const Actor = e.actorRole === 'admin' ? ShieldCheck : e.actorRole === 'worker' ? HardHat : e.actorRole === 'system' ? User : e.actorRole === 'ai' ? Bot : User;
                      return (
                        <li key={e.id} className="relative pb-3">
                          <span className="absolute -left-[21.5px] top-1 flex h-3 w-3 items-center justify-center rounded-full border-2 border-paper bg-navy-700" />
                          <div className="flex flex-wrap items-baseline gap-x-2">
                            <span className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-wide text-slate-500"><Actor size={10} />{e.actorName} · {timeAgo(e.at)}</span>
                          </div>
                          <p className="mt-0.5 text-[11px] leading-snug text-slate-600">{e.message}</p>
                        </li>
                      );
                    })}
                  </ol>
                </div>

                {/* add note */}
                {!['VERIFIED', 'CANCELLED', 'REJECTED', 'DUPLICATE'].includes(focused.status) && (
                  <AddNoteRow ticketNo={focused.ticketNo} onAdd={note => addNote(focused.id, note)} />
                )}

                {/* cancel */}
                {['REPORTED', 'UNDER_REVIEW'].includes(focused.status) && (
                  <div className="mt-3">
                    <Button variant="ghost" size="sm" className="text-rose-600 hover:bg-rose-50" onClick={() => { const reason = window.prompt('Why are you cancelling this report?', 'Filed by mistake / issue resolved itself'); if (reason !== null) act(() => cancelIssue(focused.id, reason), 'Report cancelled'); }}>
                      <Ban size={13} /> Cancel this report
                    </Button>
                  </div>
                )}
                {focused.status === 'VERIFIED' && <p className="mt-4 flex items-center justify-center gap-2 rounded-2xl bg-emerald-50 py-3 text-[12px] font-bold text-emerald-800 ring-1 ring-emerald-200"><BadgeCheck size={16} /> Repair verified by the city — thank you!</p>}
              </div>
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

function AddNoteRow({ ticketNo, onAdd }: { ticketNo: string; onAdd: (note: string) => void }) {
  const [note, setNote] = useState('');
  const toast = useToast();
  const submit = () => {
    if (note.trim().length < 3) return;
    try { onAdd(note.trim()); setNote(''); toast('success', 'Note added', `Attached to ${ticketNo}`); } catch (err) { toast('error', 'Could not add note', err instanceof Error ? err.message : ''); }
  };
  return (
    <div className="mt-3 flex items-center gap-2 rounded-2xl border border-slate-200 bg-white p-2">
      <MessageSquarePlus size={16} className="ml-1 shrink-0 text-slate-400" />
      <input value={note} onChange={e => setNote(e.target.value)} onKeyDown={e => e.key === 'Enter' && submit()} placeholder="Add an update — e.g. ‘issue got worse overnight’…" className="h-9 w-full bg-transparent text-[12px] outline-none placeholder:text-slate-400" aria-label="Add note" />
      <button onClick={submit} className="rounded-xl bg-navy-900 p-2 text-civic-gold transition hover:bg-navy-800" aria-label="Send note"><Send size={15} /></button>
    </div>
  );
}
