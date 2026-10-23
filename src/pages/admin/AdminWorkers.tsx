import { useMemo, useState, type FormEvent, type ChangeEvent } from 'react';
import { Users, PlusCircle, Upload, Download, Star, Building2, Pencil, Power, MapPin, X, ClipboardList, CheckCircle2, AlertTriangle } from 'lucide-react';
import { useStore } from '../../lib/store';
import { useToast } from '../../components/Toast';
import { Card, CardHeader, Button, Input, Select, EmptyState, AvailabilityBadge, Spinner, timeAgo } from '../../components/ui';
import Modal from '../../components/Modal';
import { SKILL_LABEL } from '../../lib/types';
import type { Skill, Availability } from '../../lib/types';
import { SAMPLE_CSV } from '../../lib/catalog';

export default function AdminWorkers() {
  const { db, setWorkerActive } = useStore();
  const toast = useToast();
  const [createOpen, setCreateOpen] = useState(false);
  const [editWorker, setEditWorker] = useState<string | null>(null);
  const [csvOpen, setCsvOpen] = useState(false);
  const [filterDept, setFilterDept] = useState<'all' | string>('all');

  const rows = useMemo(() => {
    return (db?.workers ?? []).filter(w => filterDept === 'all' || w.departmentId === filterDept).map(w => ({ w, u: db!.users.find(u => u.id === w.userId)!, dept: db!.departments.find(d => d.id === w.departmentId) }));
  }, [db?.workers, db?.users, db?.departments, filterDept]);

  const exportCsv = () => {
    const header = 'name,email,phone,department,skills,zones,availability,maxJobs,baseLat,baseLng,rating,jobsCompleted\n';
    const body = rows.map(({ w, u, dept }) => [u.name, u.email, u.phone, dept?.code ?? '', w.skills.join('|'), w.zones.join('|'), w.availability, w.maxConcurrentJobs, w.baseLat, w.baseLng, w.rating, w.jobsCompleted].join(',')).join('\n');
    const blob = new Blob([header + body], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'civicxon-workers.csv'; a.click(); URL.revokeObjectURL(url);
    toast('success', 'Export ready', `${rows.length} worker rows exported.`);
  };

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-extrabold tracking-tight text-navy-900">Worker management</h1>
          <p className="text-[11.5px] text-slate-500">{rows.length} field crew(s) · skill-mapped · zone-based · capacity-capped</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Select value={filterDept} onChange={e => setFilterDept(e.target.value)} aria-label="Filter by department">
            <option value="all">All departments</option>
            {db?.departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
          </Select>
          <Button variant="outline" size="sm" onClick={() => setCsvOpen(true)}><Upload size={13} /> Import CSV</Button>
          <Button variant="outline" size="sm" onClick={exportCsv}><Download size={13} /> Export</Button>
          <Button variant="gold" size="sm" onClick={() => setCreateOpen(true)}><PlusCircle size={14} /> Add worker</Button>
        </div>
      </div>

      {/* Department banners */}
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        {db?.departments.map(d => {
          const deptWorkers = db.workers.filter(w => w.departmentId === d.id);
          const available = deptWorkers.filter(w => { const u = db.users.find(u => u.id === w.userId); return u?.active && w.availability === 'AVAILABLE'; }).length;
          return (
            <div key={d.id} className="rounded-2xl border border-slate-200 bg-white p-4 ring-1 ring-slate-100">
              <div className="flex items-center justify-between gap-2">
                <p className="flex items-center gap-2 text-[12px] font-extrabold text-navy-900"><Building2 size={15} className="text-navy-800" />{d.name}</p>
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[8px] font-extrabold uppercase tracking-wider text-amber-900 ring-1 ring-amber-300">Demo integration</span>
              </div>
              <p className="mt-1.5 text-[10.5px] leading-snug text-slate-500">{d.description}</p>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-mono2 text-[9.5px] font-semibold text-slate-500"><span>{deptWorkers.length} CREWS</span><span>{available} AVAILABLE</span><span>HEAD: {d.head.replace('Eng. ', '')}</span></div>
            </div>
          );
        })}
      </div>

      {/* Worker table */}
      <Card className="mt-4 overflow-hidden">
        <CardHeader icon={Users} title="Field force register" subtitle="Workload recomputed from live assignment counts" />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[880px] text-left text-[11px]">
            <thead className="bg-slate-50 text-[8.5px] font-bold uppercase tracking-[0.16em] text-slate-400">
              <tr><th className="px-4 py-2.5">Crew member</th><th className="px-4 py-2.5">Skills</th><th className="px-4 py-2.5">Zones</th><th className="px-4 py-2.5">Load</th><th className="px-4 py-2.5">Availability</th><th className="px-4 py-2.5">Rating</th><th className="px-4 py-2.5">Joined</th><th className="px-4 py-2.5 text-right">Actions</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {rows.map(({ w, u }) => (
                <tr key={w.id} className={!u.active ? 'opacity-55' : ''}>
                  <td className="px-4 py-3"><div className="flex items-center gap-2"><span className="flex h-8 w-8 items-center justify-center rounded-lg bg-navy-800 font-display text-[9px] font-extrabold text-civic-gold">{u.name.split(' ').map(s => s[0]).slice(0, 2).join('')}</span><span><span className="block font-bold text-navy-900">{u.name}{!u.active && <span className="ml-1.5 font-mono2 text-[8px] font-bold uppercase text-rose-500">inactive</span>}</span><span className="block font-mono2 text-[9px] text-slate-400">{u.email}</span></span></div></td>
                  <td className="px-4 py-3 text-slate-600">{w.skills.map(s => SKILL_LABEL[s]).join(' + ')}</td>
                  <td className="px-4 py-3"><div className="flex flex-wrap gap-1">{w.zones.map(z => <span key={z} className="rounded-full bg-navy-50 px-1.5 py-0.5 text-[8.5px] font-bold text-navy-800 ring-1 ring-navy-100">{z}</span>)}</div></td>
                  <td className="px-4 py-3"><div className="flex items-center gap-1.5"><div className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-200"><div className={`h-full rounded-full ${(w.currentLoad / w.maxConcurrentJobs) >= 1 ? 'bg-rose-500' : 'bg-navy-800'}`} style={{ width: `${Math.min(100, (w.currentLoad / w.maxConcurrentJobs) * 100)}%` }} /></div><span className="font-mono2 text-[9.5px] font-bold text-slate-500">{w.currentLoad}/{w.maxConcurrentJobs}</span></div></td>
                  <td className="px-4 py-3"><AvailabilityBadge value={w.availability} /></td>
                  <td className="px-4 py-3"><span className="flex items-center gap-1 font-mono2 text-[10px] font-bold text-amber-600"><Star size={10} fill="currentColor" />{w.rating.toFixed(1)} <span className="text-slate-400">· {w.jobsCompleted} jobs</span></span></td>
                  <td className="px-4 py-3 font-mono2 text-[9px] text-slate-400">{timeAgo(w.joinedAt)}</td>
                  <td className="px-4 py-3"><div className="flex justify-end gap-1"><button onClick={() => setEditWorker(w.id)} className="rounded-lg p-1.5 text-slate-400 transition hover:bg-navy-50 hover:text-navy-900" aria-label="Edit worker"><Pencil size={14} /></button><button onClick={() => { setWorkerActive(w.id, !u.active); toast('info', u.active ? 'Worker deactivated' : 'Worker reactivated', u.name); }} className={`rounded-lg p-1.5 transition ${u.active ? 'text-slate-400 hover:bg-rose-50 hover:text-rose-600' : 'text-emerald-600 hover:bg-emerald-50'}`} aria-label={u.active ? 'Deactivate' : 'Reactivate'}><Power size={14} /></button></div></td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={8} className="px-4 py-10 text-center text-slate-400">No workers in this department.</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>

      {/* ───── Create modal ───── */}
      {createOpen && <CreateWorkerModal onClose={() => setCreateOpen(false)} />}
      {/* ───── Edit modal ───── */}
      {editWorker && <EditWorkerModal workerId={editWorker} onClose={() => setEditWorker(null)} />}
      {/* ───── CSV modal ───── */}
      {csvOpen && <CsvImportModal onClose={() => setCsvOpen(false)} />}
    </div>
  );
}

function CreateWorkerModal({ onClose }: { onClose: () => void }) {
  const { db, createWorker } = useStore();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({ name: '', email: '', phone: '+91 ', password: '', departmentId: db?.departments[0]?.id ?? '', skills: ['road_maintenance'] as Skill[], zones: ['Central'], availability: 'AVAILABLE' as Availability, maxConcurrentJobs: 3, baseLat: 12.9716, baseLng: 77.5946 });
  const zones = db?.zones ?? [];

  const toggle = <T,>(arr: T[], v: T) => arr.includes(v) ? arr.filter(x => x !== v) : [...arr, v];

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setError('');
    const res = await createWorker(form);
    setBusy(false);
    if (!res.ok) { setError(res.error); return; }
    toast('success', 'Crew member created', `${form.name} can now sign in and receive assignments.`);
    onClose();
  };

  return (
    <Modal title="Add field crew member" subtitle="New workers are eligible for allocation immediately" onClose={onClose} wide>
      <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
        <Input label="Full name" required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Ramesh Kumar" />
        <Input label="Work email" type="email" required value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} placeholder="r.kumar@civicxon.gov" />
        <Input label="Phone" required value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} placeholder="+91 98XXX XXXXX" />
        <Input label="Temporary password" type="text" required value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} placeholder="Civicxon@2026" hint="Share securely — they can change it later" />
        <Select label="Department" value={form.departmentId} onChange={e => setForm({ ...form, departmentId: e.target.value })}>{db?.departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</Select>
        <Select label="Availability" value={form.availability} onChange={e => setForm({ ...form, availability: e.target.value as Availability })}><option value="AVAILABLE">Available</option><option value="BUSY">Busy</option><option value="OFFLINE">Offline</option><option value="ON_LEAVE">On Leave</option></Select>
        <div className="sm:col-span-2">
          <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Skills</span>
          <div className="flex gap-2">{(Object.keys(SKILL_LABEL) as Skill[]).map(s => <button key={s} type="button" onClick={() => setForm({ ...form, skills: toggle(form.skills, s) })} className={`rounded-xl border-2 px-3 py-2 text-[11px] font-bold transition ${form.skills.includes(s) ? 'border-navy-800 bg-navy-800 text-civic-gold' : 'border-slate-200 text-slate-500'}`}>{SKILL_LABEL[s]}</button>)}</div>
        </div>
        <div className="sm:col-span-2">
          <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Service zones</span>
          <div className="flex flex-wrap gap-2">{zones.map(z => <button key={z.id} type="button" onClick={() => setForm({ ...form, zones: toggle(form.zones, z.name) })} className={`rounded-xl border-2 px-3 py-2 text-[11px] font-bold transition ${form.zones.includes(z.name) ? 'border-civic-gold-dark bg-amber-50 text-amber-900' : 'border-slate-200 text-slate-500'}`}>{z.name}</button>)}</div>
        </div>
        <Input label="Max concurrent jobs" type="number" min={1} max={20} value={form.maxConcurrentJobs} onChange={e => setForm({ ...form, maxConcurrentJobs: Number(e.target.value) })} />
        <div className="grid grid-cols-2 gap-2">
          <Input label="Base latitude" type="number" step="0.0001" value={form.baseLat} onChange={e => setForm({ ...form, baseLat: Number(e.target.value) })} />
          <Input label="Base longitude" type="number" step="0.0001" value={form.baseLng} onChange={e => setForm({ ...form, baseLng: Number(e.target.value) })} />
        </div>
        {error && <p className="sm:col-span-2 rounded-lg bg-rose-50 px-3 py-2 text-[11.5px] font-medium text-rose-700 ring-1 ring-rose-200">{error}</p>}
        <div className="sm:col-span-2 flex justify-end gap-2"><Button type="button" variant="ghost" onClick={onClose}>Cancel</Button><Button type="submit" disabled={busy}>{busy ? <Spinner size={15} /> : null} Create crew member</Button></div>
      </form>
    </Modal>
  );
}

function EditWorkerModal({ workerId, onClose }: { workerId: string; onClose: () => void }) {
  const { db, updateWorker } = useStore();
  const toast = useToast();
  const w = db?.workers.find(w => w.id === workerId);
  const u = db?.users.find(u => u.id === w?.userId);
  const [form, setForm] = useState(() => w ? { skills: [...w.skills], zones: [...w.zones], availability: w.availability, maxConcurrentJobs: w.maxConcurrentJobs, baseLat: w.baseLat, baseLng: w.baseLng, rating: w.rating, departmentId: w.departmentId, name: u?.name ?? '', phone: u?.phone ?? '' } : null);
  if (!w || !form || !db) return <Modal title="Worker not found" onClose={onClose}><p className="text-sm text-slate-500">This worker record no longer exists.</p></Modal>;
  const toggle = <T,>(arr: T[], v: T) => arr.includes(v) ? arr.filter(x => x !== v) : [...arr, v];

  const save = () => {
    updateWorker(workerId, form);
    toast('success', 'Worker updated', `${form.name} — changes apply to future allocations.`);
    onClose();
  };

  return (
    <Modal title={`Edit — ${u?.name}`} subtitle="Skills, zones, capacity and base location" onClose={onClose} wide>
      <div className="grid gap-3 sm:grid-cols-2">
        <Input label="Full name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
        <Input label="Phone" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} />
        <Select label="Department" value={form.departmentId} onChange={e => setForm({ ...form, departmentId: e.target.value })}>{db.departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</Select>
        <Select label="Availability" value={form.availability} onChange={e => setForm({ ...form, availability: e.target.value as Availability })}><option value="AVAILABLE">Available</option><option value="BUSY">Busy</option><option value="OFFLINE">Offline</option><option value="ON_LEAVE">On Leave</option></Select>
        <div className="sm:col-span-2"><span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Skills</span><div className="flex gap-2">{(Object.keys(SKILL_LABEL) as Skill[]).map(s => <button key={s} onClick={() => setForm({ ...form, skills: toggle(form.skills, s) })} className={`rounded-xl border-2 px-3 py-2 text-[11px] font-bold transition ${form.skills.includes(s) ? 'border-navy-800 bg-navy-800 text-civic-gold' : 'border-slate-200 text-slate-500'}`}>{SKILL_LABEL[s]}</button>)}</div></div>
        <div className="sm:col-span-2"><span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Service zones</span><div className="flex flex-wrap gap-2">{db.zones.map(z => <button key={z.id} onClick={() => setForm({ ...form, zones: toggle(form.zones, z.name) })} className={`rounded-xl border-2 px-3 py-2 text-[11px] font-bold transition ${form.zones.includes(z.name) ? 'border-civic-gold-dark bg-amber-50 text-amber-900' : 'border-slate-200 text-slate-500'}`}>{z.name}</button>)}</div></div>
        <Input label="Max concurrent jobs" type="number" min={1} max={20} value={form.maxConcurrentJobs} onChange={e => setForm({ ...form, maxConcurrentJobs: Number(e.target.value) })} />
        <Input label="Rating (0–5)" type="number" min={0} max={5} step={0.1} value={form.rating} onChange={e => setForm({ ...form, rating: Number(e.target.value) })} />
        <div className="grid grid-cols-2 gap-2 sm:col-span-2"><Input label="Base latitude" type="number" step="0.0001" value={form.baseLat} onChange={e => setForm({ ...form, baseLat: Number(e.target.value) })} /><Input label="Base longitude" type="number" step="0.0001" value={form.baseLng} onChange={e => setForm({ ...form, baseLng: Number(e.target.value) })} /></div>
        <div className="sm:col-span-2 flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={save}>Save changes</Button></div>
      </div>
    </Modal>
  );
}

function CsvImportModal({ onClose }: { onClose: () => void }) {
  const { importWorkersCsv } = useStore();
  const toast = useToast();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ created: number; skipped: number; errors: { row: number; message: string }[] } | null>(null);

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setText(await f.text());
    setResult(null);
  };

  const run = async () => {
    if (!text.trim()) { toast('warning', 'Nothing to import', 'Paste CSV or choose a file.'); return; }
    setBusy(true);
    const res = await importWorkersCsv(text);
    setBusy(false);
    setResult(res);
    if (res.created > 0) toast('success', `Imported ${res.created} worker(s)`, res.skipped ? `${res.skipped} row(s) skipped — see details below.` : 'All rows valid.');
    else if (res.errors.length) toast('error', 'Import failed', 'Every row was rejected — fix the errors below.');
  };

  const downloadSample = () => {
    const blob = new Blob([SAMPLE_CSV], { type: 'text/csv' });
    const url = URL.createObjectURL(blob); const a = document.createElement('a');
    a.href = url; a.download = 'civicxon-workers-template.csv'; a.click(); URL.revokeObjectURL(url);
  };

  return (
    <Modal title="Bulk import crews" subtitle="Validated row-by-row — bad rows are reported, good rows still import" onClose={onClose} wide>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-slate-50 px-4 py-2.5 ring-1 ring-slate-200">
        <p className="text-[10px] font-semibold text-slate-500">Required columns: <span className="font-mono2 text-navy-800">name, email, department, skills, zones</span> · optional: phone, availability, maxJobs, baseLat, baseLng, password · skills pipe-separated (e.g. <span className="font-mono2">road_maintenance|streetlight_maintenance</span>) · department: <span className="font-mono2">ROAD</span> / <span className="font-mono2">STREET</span></p>
        <button onClick={downloadSample} className="flex shrink-0 items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-navy-800 underline underline-offset-2 hover:text-navy-950"><Download size={11} /> Template</button>
      </div>
      <div className="flex items-center gap-2">
        <label className="flex h-9 shrink-0 cursor-pointer items-center gap-2 rounded-xl border-2 border-dashed border-slate-300 px-4 text-[11px] font-bold text-slate-500 transition hover:border-navy-700 hover:text-navy-900"><Upload size={14} /> Choose .csv<input type="file" accept=".csv,text/csv" className="hidden" onChange={onFile} /></label>
        <span className="text-[10.5px] text-slate-400">or paste below</span>
      </div>
      <textarea value={text} onChange={e => { setText(e.target.value); setResult(null); }} rows={9} spellCheck={false} placeholder={'name,email,department,skills,zones,availability\nRamesh Kumar,r.kumar@demo.gov,ROAD,road_maintenance,Central,AVAILABLE'} className="mt-2 w-full rounded-xl border-0 bg-navy-950 p-4 font-mono2 text-[10.5px] leading-relaxed text-emerald-200 ring-1 ring-slate-800 outline-none placeholder:text-slate-600 focus:ring-2 focus:ring-civic-gold" aria-label="CSV content" />
      <div className="mt-3 flex items-center justify-between">
        <p className="text-[9.5px] font-semibold uppercase tracking-wide text-slate-400">Passwords default to the demo password if column omitted</p>
        <Button onClick={run} disabled={busy}>{busy ? <Spinner size={15} /> : <CheckCircle2 size={15} />} Validate & import</Button>
      </div>
      {result && (
        <div className={`mt-4 rounded-2xl border p-4 ${result.created > 0 ? 'border-emerald-200 bg-emerald-50/60' : 'border-rose-200 bg-rose-50/60'}`}>
          <p className="text-[11px] font-extrabold uppercase tracking-wide text-navy-900">{result.created} created · {result.skipped} skipped</p>
          {result.errors.length > 0 && <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto nice-scroll">{result.errors.map(e => <li key={e.row} className="flex items-start gap-1.5 text-[10.5px] text-rose-800"><AlertTriangle size={11} className="mt-0.5 shrink-0" /><span><span className="font-mono2 font-bold">Row {e.row}:</span> {e.message}</span></li>)}</ul>}
        </div>
      )}
    </Modal>
  );
}
