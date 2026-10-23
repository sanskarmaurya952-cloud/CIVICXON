import { useMemo, useState, type ChangeEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { MapPin, Camera, X, Wrench, PlayCircle, Upload, AlertTriangle, Navigation, Phone, ShieldCheck, Image as ImageIcon, ClipboardCheck, Sparkles, CircleCheck } from 'lucide-react';
import { useStore } from '../../lib/store';
import { useToast } from '../../components/Toast';
import { Card, CardHeader, StatusBadge, PriorityBadge, Button, EmptyState, ProgressTimeline, timeAgo, Spinner } from '../../components/ui';
import { CATEGORY_META } from '../../lib/types';
import { ISSUE_STATUS_META } from '../../lib/types';
import { WORKFLOW_STEPS } from '../../lib/catalog';
import { compressImage, ACCEPTED_IMAGE_TYPES, MAX_UPLOAD_BYTES } from '../../lib/config';

export default function WorkerJobs({ view }: { view: 'active' | 'rework' }) {
  const { db, currentUser, startWork, submitEvidence, addNote } = useStore();
  const toast = useToast();
  const navigate = useNavigate();
  const me = currentUser!;
  const profile = db?.workers.find(w => w.userId === me.id);
  const [openId, setOpenId] = useState<string | null>(null);

  const jobs = useMemo(() => {
    const all = (db?.issues ?? []).filter(i => profile && i.assignedWorkerId === profile.id);
    if (view === 'rework') return all.filter(i => i.status === 'REWORK_REQUIRED').sort((a, b) => b.updatedAt - a.updatedAt);
    return all.filter(i => ['ASSIGNED', 'IN_PROGRESS', 'PENDING_VERIFICATION', 'REWORK_REQUIRED'].includes(i.status)).sort((a, b) => {
      const rank = (s: string) => s === 'REWORK_REQUIRED' ? 0 : s === 'ASSIGNED' ? 1 : s === 'IN_PROGRESS' ? 2 : 3;
      const pr = (p: string) => ({ CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 }[p] ?? 4);
      return rank(a.status) - rank(b.status) || pr(a.priority) - pr(b.priority);
    });
  }, [db?.issues, profile, view]);

  const open = jobs.find(i => i.id === openId) ?? null;

  return (
    <div className="grid items-start gap-4 xl:grid-cols-5">
      {/* ── Job list ── */}
      <div className="xl:col-span-2">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h1 className="font-display text-2xl font-extrabold tracking-tight text-navy-900">{view === 'rework' ? 'Rework requests' : 'My jobs'}</h1>
            <p className="text-[11.5px] text-slate-500">{jobs.length} {view === 'rework' ? 'rework order(s)' : 'job(s) in your queue'} · ownership enforced, not just hidden buttons</p>
          </div>
        </div>
        <div className="space-y-3">
          {jobs.map(i => {
            const before = db?.media.find(m => m.issueId === i.id && m.type === 'BEFORE');
            const isRework = i.status === 'REWORK_REQUIRED';
            return (
              <button key={i.id} onClick={() => setOpenId(i.id)} className={`flex w-full items-stretch gap-0 overflow-hidden rounded-2xl bg-white text-left ring-1 transition hover:-translate-y-0.5 hover:shadow-[var(--shadow-pop)] ${openId === i.id ? 'ring-2 ring-navy-800' : 'ring-slate-900/[0.06] shadow-[var(--shadow-card)]'} ${isRework ? 'outline outline-1 outline-orange-300' : ''}`}>
                <div className="relative w-24 shrink-0">
                  {before ? <img src={before.storageKey} alt="Defect" className="absolute inset-0 h-full w-full object-cover" /> : <div className="absolute inset-0 bg-slate-100" />}
                  {isRework && <span className="absolute left-1.5 top-1.5 rounded-full bg-orange-600 px-1.5 py-0.5 text-[8px] font-extrabold uppercase text-white">Rework</span>}
                </div>
                <div className="min-w-0 flex-1 p-3">
                  <div className="flex items-center justify-between gap-2"><span className="font-mono2 text-[9.5px] font-bold text-slate-400">{i.ticketNo} · {timeAgo(i.createdAt)}</span><PriorityBadge priority={i.priority} /></div>
                  <p className="mt-1 line-clamp-2 text-[11.5px] font-semibold leading-snug text-navy-900">{i.description}</p>
                  <div className="mt-1.5 flex items-center gap-2"><StatusBadge status={i.status} /><span className="flex items-center gap-0.5 text-[9.5px] text-slate-400"><MapPin size={9} />{i.zone}</span></div>
                </div>
              </button>
            );
          })}
          {jobs.length === 0 && <Card><EmptyState icon={view === 'rework' ? CircleCheck : ClipboardCheck} title={view === 'rework' ? 'No rework pending' : 'Queue is clear'} hint={view === 'rework' ? 'Everything you submitted passed admin verification. Outstanding work.' : 'New assignments appear here the moment the allocation engine dispatches them.'} action={<Button variant="outline" size="sm" onClick={() => navigate('/worker')}>Back to overview</Button>} /></Card>}
        </div>
      </div>

      {/* ── Job detail ── */}
      <div className="xl:col-span-3">
        {!open ? (
          <Card className="hidden xl:block"><EmptyState icon={Wrench} title="Pick a job" hint="Select any job from the queue to see full details, the original photo, map, and evidence upload." /></Card>
        ) : (
          <JobDetail issueId={open.id} onClose={() => setOpenId(null)} />
        )}
      </div>
    </div>
  );
}

function JobDetail({ issueId, onClose }: { issueId: string; onClose: () => void }) {
  const { db, currentUser, startWork, submitEvidence, addNote } = useStore();
  const toast = useToast();
  const me = currentUser!;
  const issue = db?.issues.find(i => i.id === issueId);
  const profile = db?.workers.find(w => w.userId === me.id);
  const [after, setAfter] = useState<string | null>(null);
  const [afterName, setAfterName] = useState('');
  const [caption, setCaption] = useState('');
  const [uploading, setUploading] = useState(false);
  const [note, setNote] = useState('');

  if (!issue || !profile) return <Card className="p-6 text-center text-slate-400">Job not found.</Card>;
  const mine = issue.assignedWorkerId === profile.id;
  const before = db?.media.filter(m => m.issueId === issue.id && m.type === 'BEFORE') ?? [];
  const afters = db?.media.filter(m => m.issueId === issue.id && m.type === 'AFTER') ?? [];
  const events = (db?.events ?? []).filter(e => e.issueId === issue.id).sort((a, b) => b.at - a.at).slice(0, 30);
  const latestReview = [...(db?.verifications ?? [])].reverse().find(v => v.issueId === issue.id);
  const isRework = issue.status === 'REWORK_REQUIRED';
  const adminReworkNote = [...events].find(e => e.type === 'REWORK_REQUESTED');

  const act = (fn: () => void, ok: string) => { try { fn(); toast('success', ok); } catch (err) { toast('error', 'Action failed', err instanceof Error ? err.message : ''); } };

  const onAfter = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) { toast('error', 'Unsupported file', 'JPEG, PNG, WebP or HEIC only.'); return; }
    if (file.size > MAX_UPLOAD_BYTES) { toast('error', 'Too large', 'Maximum 6 MB before compression.'); return; }
    try { setAfter(await compressImage(file, 960, 0.82)); setAfterName(file.name); } catch { toast('error', 'Unreadable image'); }
    e.target.value = '';
  };

  const submit = async () => {
    if (!after) { toast('warning', 'Photo required', 'Attach an after-repair photo — admins cannot verify from words alone.'); return; }
    setUploading(true);
    try {
      const { outcome } = await submitEvidence(issue.id, after, caption);
      toast('success', 'Evidence submitted', `AI pre-check: ${outcome.replace('_', ' ')}. An administrator makes the final call.`);
      setAfter(null); setCaption('');
    } catch (err) {
      toast('error', 'Submission failed', err instanceof Error ? err.message : '');
    } finally { setUploading(false); }
  };

  return (
    <Card className="overflow-hidden">
      {/* header strip */}
      <div className={`flex items-center justify-between gap-3 px-5 py-3.5 ${isRework ? 'bg-orange-600' : 'bg-navy-900'} text-white`}>
        <div>
          <p className="font-mono2 text-[9px] font-semibold uppercase tracking-[0.22em] text-white/60">Work order · {CATEGORY_META[issue.category].label}</p>
          <p className="font-mono2 text-[13px] font-bold">{issue.ticketNo}</p>
        </div>
        <div className="flex items-center gap-2">
          <PriorityBadge priority={issue.priority} />
          <button onClick={onClose} className="rounded-lg p-1.5 text-white/80 hover:bg-white/10" aria-label="Close detail"><X size={17} /></button>
        </div>
      </div>

      <div className="max-h-[78vh] overflow-y-auto p-5 nice-scroll">
        {/* progress */}
        {!['REWORK_REQUIRED'].includes(issue.status) && <div className="rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-200"><ProgressTimeline steps={WORKFLOW_STEPS} currentStep={ISSUE_STATUS_META[issue.status].step} /></div>}

        {/* rework banner */}
        {isRework && (
          <div className="rounded-2xl border-2 border-orange-400 bg-orange-50 p-4">
            <p className="flex items-center gap-2 text-[11px] font-extrabold uppercase tracking-wide text-orange-800"><AlertTriangle size={15} /> Rework requested by administrator</p>
            <p className="mt-1.5 text-[12px] leading-relaxed text-orange-950">{adminReworkNote?.message.replace(/^Rework requested:\s*/, '') ?? 'Repair did not pass verification.'}</p>
            <p className="mt-2 text-[10px] font-semibold uppercase tracking-wide text-orange-700/80">Rework attempt {issue.reworkCount} — fix, then submit fresh evidence below.</p>
          </div>
        )}

        {/* issue body */}
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <figure className="overflow-hidden rounded-2xl ring-1 ring-slate-200">
            {before[0] ? <img src={before[0].storageKey} alt="Original defect" className="h-44 w-full object-cover" /> : <div className="flex h-44 items-center justify-center bg-slate-100 text-slate-300"><Camera size={30} /></div>}
            <figcaption className="flex items-center gap-1.5 bg-navy-950 px-3 py-1.5 text-[9px] font-bold uppercase tracking-wider text-white/85"><ImageIcon size={10} /> Before — citizen evidence</figcaption>
          </figure>
          <div>
            <p className="text-[9.5px] font-bold uppercase tracking-[0.18em] text-slate-400">The problem</p>
            <p className="mt-1 text-[12.5px] leading-relaxed text-slate-700">{issue.description}</p>
            <div className="mt-3 space-y-1.5 text-[10.5px] text-slate-500">
              <p className="flex items-start gap-1.5"><MapPin size={12} className="mt-0.5 shrink-0" /><span>{issue.address}<br /><span className="font-mono2">{issue.lat.toFixed(5)}, {issue.lng.toFixed(5)}</span> · Zone {issue.zone}</span></p>
              <p className="flex items-center gap-1.5"><Phone size={12} className="shrink-0" />Citizen: {issue.reporterName} · {issue.citizenPhone}</p>
              <p className="flex items-center gap-1.5"><ShieldCheck size={12} className="shrink-0" />Reporter trust: citizen-verified profile</p>
            </div>
            <a className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-emerald-50 px-2.5 py-1.5 text-[10px] font-bold text-emerald-800 ring-1 ring-emerald-200 transition hover:bg-emerald-100" href={`https://www.google.com/maps/dir/?api=1&destination=${issue.lat},${issue.lng}`} target="_blank" rel="noreferrer"><Navigation size={11} /> Navigate (Google Maps)</a>
          </div>
        </div>

        {/* actions */}
        {mine && (
          <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4 ring-1 ring-slate-100">
            <p className="text-[9.5px] font-bold uppercase tracking-[0.18em] text-slate-400">Field actions</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {issue.status === 'ASSIGNED' && <Button variant="navy" onClick={() => act(() => startWork(issue.id), 'Work started — site timer running')}><PlayCircle size={15} /> Start work</Button>}
              {issue.status === 'REWORK_REQUIRED' && <Button variant="gold" onClick={() => act(() => startWork(issue.id), 'Rework started')}><PlayCircle size={15} /> Start rework</Button>}
              {issue.status === 'PENDING_VERIFICATION' && <span className="inline-flex items-center gap-2 rounded-xl bg-violet-50 px-4 py-2 text-[11.5px] font-bold text-violet-800 ring-1 ring-violet-200"><Sparkles size={14} /> Awaiting admin verification — no action needed</span>}
            </div>

            {/* evidence upload — from IN_PROGRESS */}
            {issue.status === 'IN_PROGRESS' && (
              <div className="mt-3 border-t border-slate-100 pt-3">
                <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">After-repair evidence <span className="font-normal normal-case text-slate-400">— required for verification</span></p>
                {!after ? (
                  <label className="mt-2 flex cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 py-4 text-[11.5px] font-semibold text-slate-500 transition hover:border-navy-700 hover:text-navy-900">
                    <Camera size={17} /> Capture / upload after photo
                    <input type="file" accept={ACCEPTED_IMAGE_TYPES.join(',')} className="hidden" onChange={onAfter} aria-label="Upload after-repair photo" />
                  </label>
                ) : (
                  <div className="relative mt-2 overflow-hidden rounded-xl ring-1 ring-emerald-300">
                    <img src={after} alt="After repair" className="h-40 w-full object-cover" />
                    <button onClick={() => { setAfter(null); setAfterName(''); }} className="absolute right-2 top-2 rounded-full bg-navy-950/75 p-1.5 text-white" aria-label="Remove"><X size={13} /></button>
                    <p className="absolute bottom-0 inset-x-0 truncate bg-emerald-950/80 px-2 py-1 font-mono2 text-[8.5px] text-emerald-100">{afterName}</p>
                  </div>
                )}
                <input value={caption} onChange={e => setCaption(e.target.value)} placeholder="Caption — e.g. ‘Fresh Bituminous patch, lane paint redone’" className="mt-2 h-9 w-full rounded-xl border-0 bg-slate-50 px-3 text-[12px] ring-1 ring-inset ring-slate-200 outline-none placeholder:text-slate-400 focus:bg-white focus:ring-2 focus:ring-navy-800" aria-label="Evidence caption" />
                <Button variant="success" className="mt-2 w-full" onClick={submit} disabled={uploading || !after}>
                  {uploading ? <><Spinner size={15} /> Uploading & running AI pre-check…</> : <><Upload size={15} /> Submit evidence for verification</>}
                </Button>
              </div>
            )}

            {/* note */}
            <div className="mt-3 flex items-center gap-2">
              <input value={note} onChange={e => setNote(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && note.trim()) { try { addNote(issue.id, note.trim()); setNote(''); toast('success', 'Note added'); } catch (err) { toast('error', 'Failed', (err as Error).message); } } }} placeholder="Add a field note — weather, access issues, materials…" className="h-9 w-full rounded-xl border-0 bg-slate-50 px-3 text-[11.5px] ring-1 ring-inset ring-slate-200 outline-none placeholder:text-slate-400 focus:ring-2 focus:ring-navy-800" aria-label="Add note" />
              <button className="rounded-xl bg-navy-900 p-2 text-civic-gold" aria-label="Add note" onClick={() => { if (!note.trim()) return; try { addNote(issue.id, note.trim()); setNote(''); toast('success', 'Note added'); } catch (err) { toast('error', 'Failed', (err as Error).message); } }}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></svg></button>
            </div>
          </div>
        )}

        {/* previous after-photos */}
        {afters.length > 0 && (
          <div className="mt-4">
            <p className="text-[9.5px] font-bold uppercase tracking-[0.18em] text-slate-400">Evidence on file ({afters.length})</p>
            <div className="mt-1.5 grid grid-cols-2 gap-2">{afters.map(m => <figure key={m.id} className="overflow-hidden rounded-xl ring-1 ring-slate-200"><img src={m.storageKey} alt={m.caption} className="h-28 w-full object-cover" /><figcaption className="bg-slate-50 px-2 py-1 text-[8.5px] font-semibold text-slate-500">{m.caption} · {timeAgo(m.uploadedAt)}</figcaption></figure>)}</div>
          </div>
        )}

        {/* AI verification readout */}
        {latestReview && (
          <div className="mt-4 rounded-2xl border border-violet-200 bg-violet-50/60 p-4">
            <p className="flex items-center justify-between gap-2 text-[10px] font-bold uppercase tracking-[0.18em] text-violet-800"><span className="flex items-center gap-1.5"><Sparkles size={11} /> AI verification pre-check {latestReview.provider === 'gemma-4' ? `· ${latestReview.model}` : '· dev baseline (not a model)'}</span><span className="font-mono2">{(latestReview.confidence * 100).toFixed(0)}%</span></p>
            <p className="mt-1.5 text-[12px] font-bold text-violet-950">Recommendation: {latestReview.outcome.replace(/_/g, ' ').toUpperCase()}</p>
            <p className="mt-1 text-[11.5px] leading-relaxed text-violet-950/90">{latestReview.explanation}</p>
            <p className="mt-1.5 text-[10px] italic text-violet-700/80"><span className="font-bold not-italic">Limitations:</span> {latestReview.limitations}</p>
            {latestReview.adminDecision && <p className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-2 py-0.5 text-[9px] font-extrabold uppercase tracking-wide text-emerald-800">Admin decided: {latestReview.adminDecision.replace('_', ' ')}</p>}
          </div>
        )}

        {/* audit trail */}
        <div className="mt-4">
          <p className="text-[9.5px] font-bold uppercase tracking-[0.18em] text-slate-400">History</p>
          <ul className="mt-1.5 space-y-1.5">
            {events.map(e => <li key={e.id} className="flex items-baseline gap-2 text-[10.5px] leading-snug text-slate-600"><span className="shrink-0 font-mono2 text-[9px] text-slate-400">{new Date(e.at).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>{e.message}</li>)}
          </ul>
        </div>
      </div>
    </Card>
  );
}
