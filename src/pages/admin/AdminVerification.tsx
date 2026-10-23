import { useMemo, useState } from 'react';
import { Sparkles, CheckCircle2, RotateCcw, X, Image as ImageIcon, ShieldCheck, History } from 'lucide-react';
import { useStore } from '../../lib/store';
import { useToast } from '../../components/Toast';
import { Card, CardHeader, Button, EmptyState, Textarea, PriorityBadge, timeAgo } from '../../components/ui';
import { CATEGORY_META, ISSUE_STATUS_META } from '../../lib/types';

export default function AdminVerification() {
  const { db, approveVerification, requestRework } = useStore();
  const toast = useToast();
  const [openId, setOpenId] = useState<string | null>(null);
  const queue = useMemo(() => (db?.issues ?? []).filter(i => i.status === 'PENDING_VERIFICATION').sort((a, b) => a.updatedAt - b.updatedAt), [db?.issues]);
  const reworkHistory = useMemo(() => (db?.verifications ?? []).filter(v => v.adminDecision === 'REWORK_REQUESTED').slice().reverse().slice(0, 5), [db?.verifications]);
  const open = queue.find(i => i.id === openId) ?? null;

  return (
    <div className="grid items-start gap-4 xl:grid-cols-5">
      {/* Queue list */}
      <div className="xl:col-span-2">
        <div className="mb-3">
          <h1 className="font-display text-2xl font-extrabold tracking-tight text-navy-900">Verification queue</h1>
          <p className="text-[11.5px] text-slate-500">{queue.length} repair(s) awaiting your decision · AI pre-check shown, admin decides</p>
        </div>
        <div className="space-y-3">
          {queue.map(i => {
            const review = [...(db?.verifications ?? [])].reverse().find(v => v.issueId === i.id && v.adminDecision === null);
            const workerUser = i.assignedWorkerId ? db?.users.find(u => u.id === db?.workers.find(w => w.id === i.assignedWorkerId)?.userId) : null;
            return (
              <button key={i.id} onClick={() => setOpenId(i.id)} className={`flex w-full items-stretch gap-0 overflow-hidden rounded-2xl bg-white text-left ring-1 transition hover:-translate-y-0.5 hover:shadow-[var(--shadow-pop)] ${openId === i.id ? 'ring-2 ring-navy-800' : 'ring-slate-900/[0.06] shadow-[var(--shadow-card)]'}`}>
                <div className="relative w-24 shrink-0">
                  {db?.media.find(m => m.issueId === i.id && m.type === 'AFTER') ? <img src={db.media.find(m => m.issueId === i.id && m.type === 'AFTER')!.storageKey} alt="After" className="absolute inset-0 h-full w-full object-cover" /> : <div className="absolute inset-0 bg-slate-100" />}
                </div>
                <div className="min-w-0 flex-1 p-3">
                  <div className="flex items-center justify-between gap-2"><span className="font-mono2 text-[9.5px] font-bold text-slate-400">{i.ticketNo}</span><span className="font-mono2 text-[9px] font-bold uppercase text-violet-700">attempt {afterCount(db, i.id)}</span></div>
                  <p className="mt-1 line-clamp-2 text-[11px] font-semibold leading-snug text-navy-900">{i.description}</p>
                  <p className="mt-1.5 text-[9.5px] font-semibold text-slate-500">{workerUser?.name ?? 'Crew'} · AI: <span className="font-bold uppercase text-violet-800">{review?.outcome.replace(/_/g, ' ') ?? 'pending'}</span></p>
                </div>
              </button>
            );
          })}
          {queue.length === 0 && <Card><EmptyState icon={ShieldCheck} title="Nothing to verify" hint="When a crew submits after-repair evidence, the ticket lands here for your decision." /></Card>}
        </div>
        {reworkHistory.length > 0 && (
          <Card className="mt-4 p-4">
            <p className="flex items-center gap-1.5 text-[9.5px] font-bold uppercase tracking-[0.18em] text-slate-400"><History size={12} /> Recent rework decisions</p>
            <ul className="mt-2 space-y-1.5">{reworkHistory.map(v => { const i = db?.issues.find(x => x.id === v.issueId); return <li key={v.id} className="text-[10.5px] leading-snug text-slate-600"><span className="font-mono2 font-bold text-slate-500">{i?.ticketNo}</span> — {v.adminNote ?? 'rework'} <span className="text-slate-400">· {timeAgo(v.decidedAt ?? v.createdAt)}</span></li>; })}</ul>
          </Card>
        )}
      </div>

      {/* Decision panel */}
      <div className="xl:col-span-3">
        {open ? <DecisionPanel issueId={open.id} onDone={() => setOpenId(null)} /> : <Card className="hidden xl:block"><EmptyState icon={ShieldCheck} title="Select a repair" hint="Compare citizen evidence against after-repair evidence, read the AI pre-check, then approve or send back for rework." /></Card>}
      </div>
    </div>
  );
}

function afterCount(db: ReturnType<typeof useStore>['db'], issueId: string) {
  return (db?.media ?? []).filter(m => m.issueId === issueId && m.type === 'AFTER').length;
}

function DecisionPanel({ issueId, onDone }: { issueId: string; onDone: () => void }) {
  const { db, approveVerification, requestRework } = useStore();
  const toast = useToast();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const issue = db?.issues.find(i => i.id === issueId);
  if (!issue || !db) return <Card className="p-6">Not found.</Card>;

  const before = db.media.find(m => m.issueId === issueId && m.type === 'BEFORE');
  const after = [...db.media].reverse().find(m => m.issueId === issueId && m.type === 'AFTER');
  const review = [...db.verifications].reverse().find(v => v.issueId === issueId && v.adminDecision === null);
  const workerUser = issue.assignedWorkerId ? db.users.find(u => u.id === db.workers.find(w => w.id === issue.assignedWorkerId)?.userId) : null;

  const act = async (fn: () => void, ok: string) => {
    setBusy(true);
    try { fn(); toast('success', ok); onDone(); } catch (err) { toast('error', 'Action failed', err instanceof Error ? err.message : ''); } finally { setBusy(false); }
  };

  const approve = () => act(() => approveVerification(issueId, note), 'Repair approved — ticket VERIFIED & closed');
  const rework = () => {
    if (note.trim().length < 6) { toast('warning', 'Describe the rework', 'Give the crew a specific fix — min 6 characters.'); return; }
    act(() => requestRework(issueId, note.trim()), 'Sent back for rework');
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 rounded-2xl bg-navy-900 px-5 py-3.5 text-white">
        <div>
          <p className="font-mono2 text-[9px] font-semibold uppercase tracking-[0.22em] text-civic-gold/85">Verification · {CATEGORY_META[issue.category].label}</p>
          <p className="font-mono2 text-[13px] font-bold">{issue.ticketNo}<span className="text-white/55"> · crew: {workerUser?.name ?? 'unassigned'}</span></p>
        </div>
        <PriorityBadge priority={issue.priority} />
      </div>

      {/* before / after comparison */}
      <div className="grid grid-cols-2 gap-3">
        <figure className="overflow-hidden rounded-2xl ring-1 ring-slate-200">
          {before ? <img src={before.storageKey} alt="Before" className="h-52 w-full object-cover" /> : <div className="flex h-52 items-center justify-center bg-slate-100 text-slate-300"><ImageIcon size={30} /></div>}
          <figcaption className="bg-rose-950 px-3 py-1.5 text-[9px] font-bold uppercase tracking-wider text-rose-100/90">Before · citizen report</figcaption>
        </figure>
        <figure className="overflow-hidden rounded-2xl ring-2 ring-emerald-400">
          {after ? <img src={after.storageKey} alt="After" className="h-52 w-full object-cover" /> : <div className="flex h-52 items-center justify-center bg-slate-100 text-slate-300"><ImageIcon size={30} /></div>}
          <figcaption className="bg-emerald-950 px-3 py-1.5 text-[9px] font-bold uppercase tracking-wider text-emerald-100/90">After · repair evidence</figcaption>
        </figure>
      </div>

      {/* AI readout */}
      {review ? (
        <div className="rounded-2xl border border-violet-200 bg-violet-50/70 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.18em] text-violet-800"><Sparkles size={12} /> AI pre-check · {review.provider === 'gemma-4' ? review.model : 'dev baseline (not a model)'}</p>
            <span className="font-mono2 text-[10px] font-bold text-violet-900">{(review.confidence * 100).toFixed(0)}% confidence</span>
          </div>
          <p className="mt-2 text-[13px] font-extrabold uppercase tracking-wide text-violet-950">Recommendation: {review.outcome.replace(/_/g, ' ')}</p>
          <p className="mt-1 text-[11.5px] leading-relaxed text-violet-950/90">{review.explanation}</p>
          <p className="mt-1.5 text-[10px] italic text-violet-700/85"><span className="font-bold not-italic">Limitations:</span> {review.limitations}</p>
          <p className="mt-2 text-[9px] font-semibold uppercase tracking-wide text-violet-500">Advisory only — this tool cannot close tickets. Your decision is final and audit-logged.</p>
        </div>
      ) : <div className="rounded-2xl border border-slate-200 bg-white p-4 text-[11px] text-slate-500">No AI pre-check stored. Review the photos and decide manually.</div>}

      {/* decision */}
      <div className="grid gap-3 md:grid-cols-5">
        <Textarea className="md:col-span-3" rows={4} label="Decision note (audit-logged)" placeholder="Approve: ‘Patch is flush, lane marking redone — verified.’ Rework: ‘Lamp face still dark, cable tie missing — redo and resubmit.’" value={note} onChange={e => setNote(e.target.value)} />
        <div className="flex flex-col gap-2 md:col-span-2">
          <Button variant="success" size="md" className="flex-1" disabled={busy} onClick={approve}><CheckCircle2 size={16} /> Approve — close ticket</Button>
          <Button variant="danger" size="md" className="flex-1" disabled={busy} onClick={rework}><RotateCcw size={15} /> Request rework</Button>
          <p className="text-center text-[9px] leading-snug text-slate-400">Approved tickets become VERIFIED & cannot be edited.<br />Rework sends the ticket back to the crew with your note.</p>
        </div>
      </div>
    </div>
  );
}
