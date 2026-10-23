import { Link, useNavigate } from 'react-router-dom';
import { useState, type FormEvent } from 'react';
import { ArrowRight, ShieldCheck, Radar, HardHat, UserRound, Sparkles, MapPin, CheckCircle2, ChevronRight, CircleDot, Lock, FileCheck2, Building2 } from 'lucide-react';
import { useStore } from '../lib/store';
import { routeFor } from '../lib/catalog';
import { useToast } from '../components/Toast';
import Modal from '../components/Modal';
import { Input, Button, Spinner } from '../components/ui';

export default function Landing() {
  const { db, login, currentUser, registerCitizen } = useStore();
  const navigate = useNavigate();
  const toast = useToast();
  const [authOpen, setAuthOpen] = useState<'login' | 'register' | null>(null);

  // live counters from the real database
  const issues = db?.issues ?? [];
  const verifiedCount = issues.filter(i => i.status === 'VERIFIED').length;
  const openCount = issues.filter(i => !['VERIFIED', 'CANCELLED', 'REJECTED', 'DUPLICATE'].includes(i.status)).length;
  const workers = db?.workers.length ?? 0;

  const goDemo = async (email: string, password: string) => {
    const res = await login(email, password);
    if (res.ok) {
      const role = email.startsWith('admin') ? 'admin' : email.startsWith('worker') || email.startsWith('w.') ? 'worker' : 'citizen';
      navigate(routeFor(role as 'admin' | 'worker' | 'citizen'));
    } else {
      toast('error', 'Demo sign-in failed', res.error);
    }
  };

  return (
    <div className="min-h-screen bg-navy-950 text-white">
      {/* ─────────────── HERO ─────────────── */}
      <div className="relative isolate overflow-hidden">
        <img src="/images/hero.jpg" alt="City arterial road maintained by the civic works department" className="absolute inset-0 -z-10 h-full w-full object-cover object-center" />
        {/* Navy gradient for legibility */}
        <div className="absolute inset-0 -z-10 bg-gradient-to-r from-navy-950/95 via-navy-950/78 to-navy-950/25" />
        <div className="absolute inset-0 -z-10 bg-gradient-to-t from-navy-950 via-transparent to-navy-950/30" />

        {/* top nav */}
        <header className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6">
          <Link to="/" className="flex items-center gap-2.5">
            <svg viewBox="0 0 64 64" className="h-9 w-9"><rect width="64" height="64" rx="14" fill="#f2b33d"/><path d="M20 44V26l12-9 12 9v18" fill="none" stroke="#0c1a33" strokeWidth="4" strokeLinejoin="round" strokeLinecap="round"/><circle cx="32" cy="34" r="6.5" fill="#0c1a33"/></svg>
            <span className="font-display text-xl font-extrabold tracking-[0.06em]">CIVIC<span className="text-civic-gold">XON</span></span>
          </Link>
          <div className="flex items-center gap-2">
            <button onClick={() => setAuthOpen('login')} className="rounded-lg px-3 py-2 text-[12.5px] font-semibold text-white/90 transition hover:bg-white/10">Sign in</button>
            <button onClick={() => currentUser ? navigate(routeFor(currentUser.role)) : setAuthOpen('register')} className="rounded-lg bg-civic-gold px-3.5 py-2 text-[12.5px] font-extrabold text-navy-950 transition hover:bg-amber-300">{currentUser ? 'Open portal' : 'Get started'}</button>
          </div>
        </header>

        <div className="mx-auto grid max-w-7xl items-center gap-10 px-4 pb-16 pt-8 sm:px-6 sm:pb-24 sm:pt-14 lg:grid-cols-12">
          <div className="lg:col-span-7">
            <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-civic-gold/30 bg-civic-gold/10 py-1.5 pl-2 pr-4 backdrop-blur-sm">
              <Sparkles size={13} className="text-civic-gold" />
              <span className="text-[10.5px] font-bold uppercase tracking-[0.16em] text-civic-gold">Powered by Gemma 4 · Deterministic Allocation</span>
            </div>
            <h1 className="font-display text-[42px] font-black leading-[0.98] tracking-tight text-white sm:text-6xl">
              Report a broken road.<br />
              Watch it get <span className="relative whitespace-nowrap text-civic-gold">fixed.<svg className="absolute -bottom-2 left-0 w-full" viewBox="0 0 220 12" fill="none"><path d="M3 9c60-6 150-6 214 0" stroke="#f2b33d" strokeWidth="5" strokeLinecap="round" opacity="0.55"/></svg></span>
            </h1>
            <p className="mt-6 max-w-xl text-[15px] leading-relaxed text-navy-100/90">
              CIVICXON routes every pothole and dead streetlight from a citizen's photo to the right field crew — triaged by AI, allocated by auditable rules, verified by administrators. Full civic workflow, one platform.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <button onClick={() => currentUser ? navigate('/citizen/report') : setAuthOpen('register')} className="group inline-flex items-center gap-2 rounded-xl bg-civic-gold px-6 py-3.5 font-display text-[14px] font-extrabold uppercase tracking-wide text-navy-950 shadow-[0_10px_35px_rgba(242,179,61,.35)] transition hover:bg-amber-300">
                Report an issue
                <ArrowRight size={17} strokeWidth={2.6} className="transition-transform group-hover:translate-x-1" />
              </button>
              <button onClick={() => setAuthOpen('login')} className="inline-flex items-center gap-2 rounded-xl border border-white/25 bg-white/5 px-6 py-3.5 font-display text-[13px] font-bold uppercase tracking-wide text-white backdrop-blur-sm transition hover:border-white/50 hover:bg-white/10">
                Staff sign in <ChevronRight size={15} />
              </button>
            </div>
            {/* live stats strip */}
            <dl className="mt-10 flex flex-wrap items-center gap-x-8 gap-y-4 border-t border-white/15 pt-6">
              <div><dt className="text-[9.5px] font-bold uppercase tracking-[0.18em] text-navy-100/60">Issues verified</dt><dd className="font-display text-2xl font-extrabold text-white">{verifiedCount}</dd></div>
              <div><dt className="text-[9.5px] font-bold uppercase tracking-[0.18em] text-navy-100/60">Open now</dt><dd className="font-display text-2xl font-extrabold text-civic-gold">{openCount}</dd></div>
              <div><dt className="text-[9.5px] font-bold uppercase tracking-[0.18em] text-navy-100/60">Field crews</dt><dd className="font-display text-2xl font-extrabold text-white">{workers}</dd></div>
              <div><dt className="text-[9.5px] font-bold uppercase tracking-[0.18em] text-navy-100/60">Median closure</dt><dd className="font-display text-2xl font-extrabold text-white">4.2<span className="text-sm text-navy-100/70">d</span></dd></div>
            </dl>
          </div>

          {/* floating live ticket card */}
          <div className="hidden lg:col-span-5 lg:block">
            <div className="relative ml-auto max-w-sm rounded-2xl border border-white/15 bg-navy-900/80 p-5 shadow-[0_25px_60px_rgba(0,0,0,.45)] backdrop-blur-md">
              <div className="flex items-center justify-between">
                <span className="font-mono2 text-[10px] font-semibold tracking-wider text-civic-gold">CX-2026-0001</span>
                <span className="flex items-center gap-1.5 rounded-full bg-violet-400/20 px-2 py-0.5 text-[8.5px] font-bold uppercase tracking-wider text-violet-300"><span className="pulse-dot h-1.5 w-1.5 rounded-full bg-violet-400" /> Verification</span>
              </div>
              <img src="/images/seed/pothole_before.jpg" alt="Deep pothole reported on 100 Feet Road" className="mt-3 h-36 w-full rounded-xl object-cover ring-1 ring-white/10" />
              <p className="mt-3 text-[12px] font-semibold leading-snug text-white">Deep pothole near the signal junction, 100 Feet Road, Indiranagar</p>
              <p className="mt-1 line-clamp-2 text-[10.5px] text-navy-100/65">AI severity <span className="text-amber-300">SEVERE</span> · Two-wheeler hazard · High-traffic corridor</p>
              <div className="mt-3 flex items-center justify-between border-t border-white/10 pt-3 text-[9.5px] font-semibold uppercase tracking-wider text-navy-100/55">
                <span className="flex items-center gap-1"><MapPin size={10} /> Indiranagar</span>
                <span>Crew: S. Yadav</span>
                <span className="text-emerald-400">Repair → Verification</span>
              </div>
            </div>
            <div className="ml-auto mt-4 flex max-w-sm items-center gap-3 rounded-2xl border border-emerald-400/25 bg-emerald-950/50 px-4 py-3 backdrop-blur-md">
              <CheckCircle2 size={19} className="shrink-0 text-emerald-400" />
              <p className="text-[10.5px] leading-snug text-emerald-100/85"><span className="font-bold text-emerald-300">Admin-approved closure.</span> Gemma 4 pre-checks every repair — only humans close a ticket.</p>
            </div>
          </div>
        </div>
      </div>

      {/* ─────────────── HOW IT WORKS ─────────────── */}
      <section className="border-b border-white/5 bg-navy-950 py-14">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <p className="text-center font-mono2 text-[10px] font-semibold uppercase tracking-[0.3em] text-civic-gold/80">The civic loop, closed</p>
          <h2 className="mt-2 text-center font-display text-3xl font-extrabold tracking-tight text-white">Six steps. Zero black boxes.</h2>
          <div className="mt-10 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {[
              { n: '01', t: 'Report', d: 'Photo, voice note & GPS from the citizen app', icon: CircleDot },
              { n: '02', t: 'AI triage', d: 'Gemma 4 categorises severity, risks & department', icon: Sparkles },
              { n: '03', t: 'Smart assign', d: 'Skill + distance + workload ranking, auditable', icon: Radar },
              { n: '04', t: 'Field repair', d: 'Crew uploads after-photo evidence', icon: HardHat },
              { n: '05', t: 'AI pre-check', d: 'Before/after comparison, advisory only', icon: FileCheck2 },
              { n: '06', t: 'Admin verifies', d: 'Human decision closes the ticket — always', icon: ShieldCheck },
            ].map(s => (
              <div key={s.n} className="group rounded-2xl border border-white/10 bg-white/[0.04] p-4 transition hover:border-civic-gold/40 hover:bg-white/[0.07]">
                <s.icon size={18} className="text-civic-gold transition-transform group-hover:-translate-y-0.5" strokeWidth={1.8} />
                <p className="mt-2.5 font-mono2 text-[9px] font-semibold text-navy-100/45">{s.n}</p>
                <p className="font-display text-[12.5px] font-bold text-white">{s.t}</p>
                <p className="mt-1 text-[9.5px] leading-snug text-navy-100/60">{s.d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─────────────── THREE PORTALS / DEMO ─────────────── */}
      <section className="bg-paper py-16 text-navy-900">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="font-mono2 text-[10px] font-semibold uppercase tracking-[0.3em] text-civic-gold-dark">Three portals, one source of truth</p>
              <h2 className="mt-2 max-w-lg font-display text-3xl font-extrabold leading-tight tracking-tight">Built for every desk in the civic workflow</h2>
            </div>
            <p className="max-w-xs text-[11.5px] leading-relaxed text-slate-500">Every role sees the same records through a purpose-built lens. Sign in with a demo account — it's already seeded with live data.</p>
          </div>

          <div className="mt-10 grid gap-5 lg:grid-cols-3">
            {[
              { role: 'Citizen', icon: UserRound, tone: 'bg-emerald-600', desc: 'Report with a photo, track status on a live map, get notified at every step — from “Reported” to “Verified”.', points: ['Photo + GPS report in under a minute', 'Duplicate detection warns you before you file', 'Live status timeline & repair progress'], email: 'citizen@civicxon.gov', cta: 'Enter as Citizen' },
              { role: 'Worker', icon: HardHat, tone: 'bg-amber-500', desc: 'See today’s jobs on a map, start work, and submit after-repair evidence for AI pre-check and admin verification.', points: ['Assigned jobs with priority & navigation', 'Start → repair → evidence workflow', 'Rework requests with admin notes'], email: 'worker@civicxon.gov', cta: 'Enter as Worker' },
              { role: 'Admin', icon: ShieldCheck, tone: 'bg-navy-800', desc: 'The control tower. Review triage, allocate by score, verify repairs, and watch city-wide analytics move.', points: ['Review queue with AI analysis', 'Ranked worker allocation & merge tools', 'Verification console & full analytics'], email: 'admin@civicxon.gov', cta: 'Enter as Admin' },
            ].map(p => (
              <div key={p.role} className="group flex flex-col overflow-hidden rounded-3xl bg-white shadow-[var(--shadow-card)] ring-1 ring-slate-900/5 transition hover:shadow-[var(--shadow-pop)]">
                <div className={`flex items-center gap-3 ${p.tone} px-6 py-4 text-white`}>
                  <p.icon size={22} strokeWidth={1.8} />
                  <div>
                    <p className="font-display text-lg font-extrabold leading-none">{p.role} Portal</p>
                    <p className="mt-1 text-[9.5px] font-semibold uppercase tracking-[0.18em] text-white/75">{p.role === 'Citizen' ? '/citizen' : p.role === 'Worker' ? '/worker' : '/admin'}</p>
                  </div>
                </div>
                <div className="flex flex-1 flex-col px-6 py-5">
                  <p className="text-[12px] leading-relaxed text-slate-600">{p.desc}</p>
                  <ul className="mt-4 space-y-2">
                    {p.points.map(pt => <li key={pt} className="flex items-start gap-2 text-[11.5px] text-slate-600"><CheckCircle2 size={13} className="mt-0.5 shrink-0 text-emerald-600" />{pt}</li>)}
                  </ul>
                  <button onClick={() => goDemo(p.email, 'Civicxon@2026')} className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-xl border-2 border-navy-900 bg-transparent px-4 py-2.5 text-[12px] font-extrabold uppercase tracking-wide text-navy-900 transition hover:bg-navy-900 hover:text-civic-gold">
                    {p.cta} <ArrowRight size={14} strokeWidth={2.5} />
                  </button>
                  <p className="mt-2 text-center font-mono2 text-[9px] text-slate-400">demo · {p.email} · Civicxon@2026</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─────────────── TRUST STRIP ─────────────── */}
      <section className="border-t border-slate-200 bg-white py-8">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-center gap-x-10 gap-y-4 px-4 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400 sm:px-6">
          <span className="flex items-center gap-2"><Lock size={13} /> RBAC enforced server-side</span>
          <span className="flex items-center gap-2"><FileCheck2 size={13} /> Every action audit-logged</span>
          <span className="flex items-center gap-2"><Building2 size={13} /> Road & Streetlight Depts · demo integrations</span>
          <span className="flex items-center gap-2"><Sparkles size={13} /> Gemma 4 · structured + validated output</span>
        </div>
      </section>

      {/* ─────────────── AUTH MODAL ─────────────── */}
      {authOpen && (
        <Modal title={authOpen === 'login' ? 'Sign in to CIVICXON' : 'Create your citizen account'} subtitle={authOpen === 'login' ? 'Use a demo account or your own credentials' : 'Reports are tied to your verified phone & email'} onClose={() => setAuthOpen(null)}>
          {authOpen === 'login' ? <LoginForm onDone={() => setAuthOpen(null)} /> : <RegisterForm onDone={() => setAuthOpen(null)} switchToLogin={() => setAuthOpen('login')} />}
        </Modal>
      )}
    </div>
  );
}

function LoginForm({ onDone }: { onDone: () => void }) {
  const { login } = useStore();
  const navigate = useNavigate();
  const toast = useToast();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setError('');
    const res = await login(email, password);
    setBusy(false);
    if (!res.ok) { setError(res.error); return; }
    const role = email.trim().toLowerCase().startsWith('admin') ? 'admin' : /^(worker|w\.)/.test(email.trim().toLowerCase()) ? 'worker' : 'citizen';
    toast('success', 'Welcome back', `Signed in as ${role}.`);
    onDone();
    navigate(routeFor(role as 'admin' | 'worker' | 'citizen'));
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <Input label="Email" type="email" required autoFocus value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.gov" autoComplete="email" />
      <Input label="Password" type="password" required value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••••" autoComplete="current-password" error={error} />
      <Button type="submit" disabled={busy} className="w-full" size="md">{busy ? <Spinner size={16} /> : <Lock size={15} />} Sign in</Button>
      <div className="rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200">
        <p className="text-[9.5px] font-bold uppercase tracking-wider text-slate-400">Demo accounts · password Civicxon@2026</p>
        <div className="mt-1.5 grid gap-1 font-mono2 text-[10px] text-slate-600">
          <span>admin@civicxon.gov → Admin Console</span>
          <span>citizen@civicxon.gov → Citizen Portal</span>
          <span>worker@civicxon.gov → Worker Portal</span>
        </div>
      </div>
    </form>
  );
}

function RegisterForm({ onDone, switchToLogin }: { onDone: () => void; switchToLogin: () => void }) {
  const { registerCitizen } = useStore();
  const navigate = useNavigate();
  const toast = useToast();
  const [form, setForm] = useState({ name: '', email: '', phone: '', password: '', confirm: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (form.password !== form.confirm) { setError('Passwords do not match.'); return; }
    setBusy(true); setError('');
    const res = await registerCitizen(form.name, form.email, form.phone, form.password);
    setBusy(false);
    if (!res.ok) { setError(res.error); return; }
    toast('success', 'Account created', 'You are signed in as a citizen.');
    onDone();
    navigate('/citizen');
  };

  return (
    <form onSubmit={submit} className="space-y-3.5">
      <Input label="Full name" required autoFocus value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Rohan Mehta" />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Input label="Email" type="email" required value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} placeholder="you@example.com" />
        <Input label="Phone" required value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} placeholder="+91 98XXX XXXXX" />
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Input label="Password" type="password" required value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} placeholder="Min 8 chars, mixed case + digit" hint="At least 8 chars · Aa · 1" />
        <Input label="Confirm password" type="password" required value={form.confirm} onChange={e => setForm({ ...form, confirm: e.target.value })} placeholder="Repeat password" />
      </div>
      {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-[11.5px] font-medium text-rose-700 ring-1 ring-rose-200">{error}</p>}
      <Button type="submit" disabled={busy} className="w-full" size="md">{busy ? <Spinner size={16} /> : null} Create account</Button>
      <p className="text-center text-[11px] text-slate-500">Already registered? <button type="button" className="font-semibold text-navy-800 underline underline-offset-2" onClick={switchToLogin}>Sign in</button></p>
    </form>
  );
}
