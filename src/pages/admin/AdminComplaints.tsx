import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, SlidersHorizontal, X, MapPin, History, Image as ImageIcon, Download, ChevronUp, ChevronDown, Bot, User, HardHat, ShieldCheck, Ban, Undo2 } from 'lucide-react';
import { useStore } from '../../lib/store';
import { useToast } from '../../components/Toast';
import { Card, StatusBadge, PriorityBadge, EmptyState, Button, timeAgo, Textarea } from '../../components/ui';
import { CATEGORY_META, ISSUE_STATUS_META } from '../../lib/types';
import type { IssueStatus, Priority, IssueCategory } from '../../lib/types';

type SortKey = 'createdAt' | 'priority' | 'status' | 'ticketNo';

export default function AdminComplaints() {
  const { db, cancelIssue, unmergeDuplicate } = useStore();
  const location = useLocation();
  const toast = useToast();
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<IssueStatus | 'all'>('all');
  const [category, setCategory] = useState<IssueCategory | 'all'>('all');
  const [priority, setPriority] = useState<Priority | 'all'>('all');
  const [sort, setSort] = useState<SortKey>('createdAt');
  const [dir, setDir] = useState<1 | -1>(-1);
  const [focusId, setFocusId] = useState<string | null>((location.state as any)?.focus ?? null);

  const issues = useMemo(() => {
    let list = [...(db?.issues ?? [])];
    const q = query.trim().toLowerCase();
    if (q) list = list.filter(i => [i.ticketNo, i.description, i.address, i.reporterName, i.zone, i.citizenPhone].join(' ').toLowerCase().includes(q));
    if (status !== 'all') list = list.filter(i => i.status === status);
    if (category !== 'all') list = list.filter(i => i.category === category);
    if (priority !== 'all') list = list.filter(i => i.priority === priority);
    const prioRank: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
    const statusRank = (s: string) => ISSUE_STATUS_META[s as IssueStatus]?.step ?? 0;
    list.sort((a, b) => {
      let d = 0;
      if (sort === 'createdAt') d = a.createdAt - b.createdAt;
      else if (sort === 'priority') d = prioRank[a.priority] - prioRank[b.priority];
      else if (sort === 'status') d = statusRank(a.status) - statusRank(b.status);
      else d = a.ticketNo.localeCompare(b.ticketNo);
      return d * dir;
    });
    return list;
  }, [db?.issues, query, status, category, priority, sort, dir]);

  const focus = issues.find(i => i.id === focusId) ?? db?.issues.find(i => i.id === focusId) ?? null;
  const mediaOf = (id: string) => db?.media.filter(m => m.issueId === id) ?? [];
  const eventsOf = (id: string) => (db?.events ?? []).filter(e => e.issueId === id).sort((a, b) => a.at - b.at);
  const assignmentsOf = (id: string) => (db?.assignments ?? []).filter(a => a.issueId === id).sort((a, b) => b.createdAt - a.createdAt);

  const exportCsv = () => {
    const header = 'ticket,category,priority,status,zone,address,reporter,phone,created,description\n';
    const rows = issues.map(i => [i.ticketNo, i.category, i.priority, i.status, i.zone, `"${i.address.replace(/"/g, '""')}"`, i.reporterName, i.citizenPhone, new Date(i.createdAt).toISOString(), `"${i.description.replace(/"/g, '""')}"`].join(',')).join('\n');
    const blob = new Blob([header + rows], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'civicxon-complaints.csv'; a.click();
    URL.revokeObjectURL(url);
    toast('success', 'Export ready', `${issues.length} rows written to civicxon-complaints.csv`);
  };

  const toggleSort = (k: SortKey) => { if (sort === k) setDir(d => (d === 1 ? -1 : 1)); else { setSort(k); setDir(-1); } };
  const SortIcon = ({ k }: { k: SortKey }) => sort === k ? (dir === -1 ? <ChevronDown size={11} /> : <ChevronUp size={11} />) : <span className="opacity-30"><ChevronDown size={11} /></span>;

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-extrabold tracking-tight text-navy-900">All complaints</h1>
          <p className="text-[11.5px] text-slate-500">{issues.length} of {db?.issues.length ?? 0} records · full-text search, filters, audit trail</p>
        </div>
        <Button variant="outline" size="sm" onClick={exportCsv}><Download size={13} /> Export CSV</Button>
      </div>

      {/* filter bar */}
      <div className="mt-3 flex flex-wrap items-center gap-2 rounded-2xl bg-white p-3 ring-1 ring-slate-200">
        <div className="relative min-w-[220px] flex-1">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search ticket, description, address, citizen, phone…" className="h-9 w-full rounded-xl border-0 bg-slate-50 pl-8 pr-3 text-[12px] ring-1 ring-slate-200 outline-none placeholder:text-slate-400 focus:bg-white focus:ring-2 focus:ring-navy-800" aria-label="Search complaints" />
        </div>
        <SlidersHorizontal size={14} className="hidden text-slate-400 sm:block" />
        <select value={status} onChange={e => setStatus(e.target.value as any)} className="h-9 rounded-xl border-0 bg-slate-50 px-3 text-[11.5px] font-semibold ring-1 ring-slate-200 outline-none focus:ring-2 focus:ring-navy-800" aria-label="Filter by status">
          <option value="all">All statuses</option>
          {Object.entries(ISSUE_STATUS_META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <select value={category} onChange={e => setCategory(e.target.value as any)} className="h-9 rounded-xl border-0 bg-slate-50 px-3 text-[11.5px] font-semibold ring-1 ring-slate-200 outline-none focus:ring-2 focus:ring-navy-800" aria-label="Filter by type">
          <option value="all">All types</option><option value="pothole">Pothole</option><option value="streetlight">Streetlight</option>
        </select>
        <select value={priority} onChange={e => setPriority(e.target.value as any)} className="h-9 rounded-xl border-0 bg-slate-50 px-3 text-[11.5px] font-semibold ring-1 ring-slate-200 outline-none focus:ring-2 focus:ring-navy-800" aria-label="Filter by priority">
          <option value="all">All priorities</option><option value="CRITICAL">Critical</option><option value="HIGH">High</option><option value="MEDIUM">Medium</option><option value="LOW">Low</option>
        </select>
      </div>

      {/* table */}
      <Card className="mt-3 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-[11.5px]">
            <thead className="bg-navy-900 text-[9px] font-bold uppercase tracking-[0.15em] text-civic-gold">
              <tr>
                <th className="px-4 py-3"><button className="flex items-center gap-1" onClick={() => toggleSort('ticketNo')}>Ticket <SortIcon k="ticketNo" /></button></th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3"><button className="flex items-center gap-1" onClick={() => toggleSort('priority')}>Priority <SortIcon k="priority" /></button></th>
                <th className="px-4 py-3"><button className="flex items-center gap-1" onClick={() => toggleSort('status')}>Status <SortIcon k="status" /></button></th>
                <th className="px-4 py-3">Zone</th>
                <th className="px-4 py-3"><button className="flex items-center gap-1" onClick={() => toggleSort('createdAt')}>Filed <SortIcon k="createdAt" /></button></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {issues.map(i => (
                <tr key={i.id} onClick={() => setFocusId(i.id)} className="cursor-pointer transition hover:bg-navy-50/60">
                  <td className="px-4 py-2.5 font-mono2 text-[10.5px] font-bold text-navy-900">{i.ticketNo}</td>
                  <td className="px-4 py-2.5 text-slate-600">{i.category === 'pothole' ? 'Pothole' : 'Streetlight'}</td>
                  <td className="px-4 py-2.5"><PriorityBadge priority={i.priority} /></td>
                  <td className="px-4 py-2.5"><StatusBadge status={i.status} /></td>
                  <td className="px-4 py-2.5 text-slate-500">{i.zone}</td>
                  <td className="px-4 py-2.5 font-mono2 text-[10px] text-slate-400">{timeAgo(i.createdAt)}</td>
                </tr>
              ))}
              {issues.length === 0 && <tr><td colSpan={6} className="px-4 py-10 text-center text-slate-400">No complaints match these filters.</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>

      {/* ───── Detail drawer ───── */}
      <AnimatePresence>
        {focus && (
          <>
            <motion.div className="fixed inset-0 z-[80] bg-navy-950/60 backdrop-blur-[2px]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setFocusId(null)} />
            <motion.aside className="fixed inset-y-0 right-0 z-[90] flex w-full max-w-xl flex-col bg-paper shadow-2xl" initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }} transition={{ type: 'tween', duration: 0.28 }} role="dialog" aria-label={`Complaint ${focus.ticketNo}`}>
              <div className="flex items-center justify-between gap-2 border-b border-slate-200 bg-white px-5 py-3.5">
                <div className="flex flex-wrap items-center gap-2"><span className="font-mono2 text-[12px] font-bold">{focus.ticketNo}</span><StatusBadge status={focus.status} /><PriorityBadge priority={focus.priority} /></div>
                <button onClick={() => setFocusId(null)} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100" aria-label="Close"><X size={18} /></button>
              </div>
              <div className="flex-1 overflow-y-auto p-5 nice-scroll">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[12px] leading-relaxed text-slate-700">{focus.description}</p>
                </div>
                <p className="mt-2 flex items-start gap-1.5 text-[10.5px] text-slate-500"><MapPin size={11} className="mt-0.5 shrink-0" />{focus.address} · <span className="font-mono2">{focus.lat.toFixed(5)},{focus.lng.toFixed(5)}</span> · {focus.zone}</p>
                <p className="mt-1 text-[10.5px] text-slate-500">{focus.reporterName} · {focus.citizenPhone}</p>
                {focus.priorityReason && <p className="mt-2 rounded-lg bg-slate-100 px-3 py-1.5 text-[10px] text-slate-600"><span className="font-bold">Priority reason:</span> {focus.priorityReason}</p>}
                {focus.rejectedReason && <p className="mt-2 rounded-lg bg-rose-50 px-3 py-1.5 text-[10px] text-rose-800 ring-1 ring-rose-200"><span className="font-bold">Rejected:</span> {focus.rejectedReason}</p>}

                <div className="mt-3 grid grid-cols-2 gap-2">
                  {mediaOf(focus.id).map(m => (
                    <figure key={m.id} className="overflow-hidden rounded-xl ring-1 ring-slate-200">
                      <img src={m.storageKey} alt={m.caption} className="h-32 w-full object-cover" />
                      <figcaption className="bg-slate-50 px-2 py-1 text-[8.5px] font-semibold uppercase tracking-wide text-slate-500"><span className="flex items-center gap-1"><ImageIcon size={9} />{m.type} · {m.caption}</span></figcaption>
                    </figure>
                  ))}
                </div>

                {/* assignment history */}
                {assignmentsOf(focus.id).length > 0 && (
                  <div className="mt-4">
                    <p className="text-[9.5px] font-bold uppercase tracking-[0.18em] text-slate-400">Assignment history</p>
                    <ul className="mt-1.5 space-y-1.5">
                      {assignmentsOf(focus.id).map(a => (
                        <li key={a.id} className={`rounded-xl border px-3 py-2 text-[10.5px] ${a.status === 'ACTIVE' ? 'border-emerald-200 bg-emerald-50/50' : 'border-slate-200 bg-slate-50 opacity-70'}`}>
                          <div className="flex items-center justify-between gap-2"><span className="font-bold text-navy-900">{a.workerName} <span className="font-mono2 text-[9px] font-bold text-slate-400">· {a.source} · score {a.score.toFixed(1)}</span></span><span className="font-mono2 text-[8.5px] uppercase text-slate-400">{a.status} · {timeAgo(a.createdAt)}</span></div>
                          <p className="mt-0.5 text-[9.5px] leading-snug text-slate-500">{a.reason}</p>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* events */}
                <div className="mt-4">
                  <p className="flex items-center gap-1.5 text-[9.5px] font-bold uppercase tracking-[0.18em] text-slate-400"><History size={12} /> Event history</p>
                  <ol className="mt-1.5 space-y-0 border-l-2 border-slate-200 pl-4">
                    {eventsOf(focus.id).map(e => {
                      const Actor = e.actorRole === 'admin' ? ShieldCheck : e.actorRole === 'worker' ? HardHat : e.actorRole === 'system' ? Bot : User;
                      return <li key={e.id} className="relative pb-2.5"><span className="absolute -left-[21px] top-1 h-3 w-3 rounded-full border-2 border-paper bg-navy-700" /><p className="text-[9px] font-bold uppercase tracking-wide text-slate-400"><span className="inline-flex items-center gap-1"><Actor size={9} />{e.actorName} · {timeAgo(e.at)}</span></p><p className="mt-0.5 text-[10.5px] leading-snug text-slate-600">{e.message}</p></li>;
                    })}
                  </ol>
                </div>

                {/* admin actions */}
                <div className="mt-4 flex flex-wrap gap-2 border-t border-slate-200 pt-4">
                  {focus.status === 'DUPLICATE' && <Button variant="outline" size="sm" onClick={() => { try { unmergeDuplicate(focus.id); toast('success', 'Merge reverted', 'Returned to the review queue'); } catch (err) { toast('error', 'Failed', (err as Error).message); } }}><Undo2 size={13} /> Revert duplicate merge</Button>}
                  {!['VERIFIED', 'CANCELLED', 'REJECTED', 'DUPLICATE'].includes(focus.status) && <Button variant="ghost" size="sm" className="text-rose-600 hover:bg-rose-50" onClick={() => { const reason = window.prompt('Cancellation reason:', 'Withdrawn by administrator'); if (reason !== null) { try { cancelIssue(focus.id, reason); toast('success', 'Issue cancelled'); } catch (err) { toast('error', 'Failed', (err as Error).message); } } }}><Ban size={13} /> Cancel issue</Button>}
                </div>
              </div>
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
