import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Bell, LogOut, Menu, X, ShieldCheck, HardHat, UserRound, ChevronDown, Sparkles } from 'lucide-react';
import { useStore } from '../lib/store';
import { navFor, routeFor } from '../lib/catalog';
import { timeAgo } from './ui';
import type { Role } from '../lib/types';

const ROLE_META: Record<Role, { label: string; icon: typeof UserRound; chip: string; tag: string }> = {
  citizen: { label: 'Citizen Portal', icon: UserRound, chip: 'bg-emerald-400/15 text-emerald-300', tag: 'CI' },
  worker: { label: 'Worker Portal', icon: HardHat, chip: 'bg-amber-400/15 text-amber-300', tag: 'WK' },
  admin: { label: 'Admin Console', icon: ShieldCheck, chip: 'bg-violet-400/15 text-violet-300', tag: 'AD' },
};

export default function Shell() {
  const { db, currentUser, logout, markNotificationRead, markAllNotificationsRead, ai } = useStore();
  const navigate = useNavigate();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [bellOpen, setBellOpen] = useState(false);
  const bellRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setMenuOpen(false); setBellOpen(false); }, [location.pathname]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => { if (bellRef.current && !bellRef.current.contains(e.target as Node)) setBellOpen(false); };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  if (!currentUser) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-paper">
        <p className="font-mono2 text-xs text-slate-400">Session expired. <button className="underline" onClick={() => navigate('/')}>Sign in</button></p>
      </div>
    );
  }

  const role = currentUser.role;
  const meta = ROLE_META[role];
  const RoleIcon = meta.icon;
  const nav = navFor(role);
  const notifications = (db?.notifications ?? []).filter(n => n.userId === currentUser.id).sort((a, b) => b.at - a.at);
  const unread = notifications.filter(n => !n.read).length;

  return (
    <div className="min-h-screen bg-paper">
      {/* ── Top command bar ─────────────────────────── */}
      <header className="sticky top-0 z-40 border-b border-navy-950/60 bg-navy-900 text-white shadow-[0_2px_18px_rgba(6,13,31,.35)]">
        <div className="mx-auto flex h-14 max-w-[1720px] items-center gap-2 px-3 sm:gap-4 sm:px-5">
          <Link to={routeFor(role)} className="flex shrink-0 items-center gap-2.5" aria-label="CIVICXON home">
            <svg viewBox="0 0 64 64" className="h-8 w-8"><rect width="64" height="64" rx="14" fill="#f2b33d"/><path d="M20 44V26l12-9 12 9v18" fill="none" stroke="#0c1a33" strokeWidth="4" strokeLinejoin="round" strokeLinecap="round"/><circle cx="32" cy="34" r="6.5" fill="#0c1a33"/></svg>
            <div className="leading-none">
              <span className="font-display text-[16px] font-extrabold tracking-[0.06em] text-white">CIVIC<span className="text-civic-gold">XON</span></span>
              <p className="mt-0.5 hidden text-[8.5px] font-semibold uppercase tracking-[0.18em] text-navy-100/60 sm:block">AI Civic Issue Resolution</p>
            </div>
          </Link>

          <div className={`hidden items-center gap-1.5 rounded-full px-3 py-1 text-[9.5px] font-bold uppercase tracking-[0.14em] md:flex ${meta.chip}`}>
            <RoleIcon size={11} strokeWidth={2.5} /> {meta.label}
          </div>

          {/* desktop nav */}
          <nav className="ml-2 hidden items-center gap-0.5 lg:flex" aria-label="Portal navigation">
            {nav.map(entry => (
              <NavLink
                key={entry.to}
                to={entry.to}
                end={entry.to === routeFor(role)}
                className={({ isActive }) =>
                  `rounded-lg px-3 py-1.5 text-[12px] font-semibold transition-colors ${isActive ? 'bg-white/10 text-civic-gold' : 'text-navy-100/80 hover:bg-white/5 hover:text-white'}`
                }
              >
                {entry.label}
              </NavLink>
            ))}
            {role === 'admin' && (
              <>
                <NavLink to="/admin/settings" className={({ isActive }) => `rounded-lg px-3 py-1.5 text-[12px] font-semibold transition-colors ${isActive ? 'bg-white/10 text-civic-gold' : 'text-navy-100/80 hover:bg-white/5 hover:text-white'}`}>Settings</NavLink>
                <NavLink to="/admin/activity" className={({ isActive }) => `rounded-lg px-3 py-1.5 text-[12px] font-semibold transition-colors ${isActive ? 'bg-white/10 text-civic-gold' : 'text-navy-100/80 hover:bg-white/5 hover:text-white'}`}>Activity</NavLink>
              </>
            )}
          </nav>

          <div className="ml-auto flex items-center gap-1 sm:gap-2">
            {/* AI status pill */}
            {ai && role === 'admin' && (
              <div className="hidden items-center gap-1.5 rounded-full border border-white/10 bg-navy-850 px-2.5 py-1 xl:flex" title={ai.label}>
                <Sparkles size={11} className={ai.label.startsWith('Gemma 4 live') ? 'text-civic-gold' : 'text-slate-400'} />
                <span className="max-w-[220px] truncate text-[9.5px] font-medium text-navy-100/80">{ai.label.startsWith('Gemma 4 live') ? `Gemma 4 · ${ai.model}` : 'Dev AI mode — configure key'}</span>
              </div>
            )}

            {/* Notifications */}
            <div className="relative" ref={bellRef}>
              <button onClick={() => setBellOpen(v => !v)} className="relative rounded-lg p-2 text-navy-100/85 transition hover:bg-white/10 hover:text-white" aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`}>
                <Bell size={18} strokeWidth={1.8} />
                {unread > 0 && <span className="absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded-full bg-civic-gold text-[8.5px] font-extrabold text-navy-950">{unread > 9 ? '9+' : unread}</span>}
              </button>
              {bellOpen && (
                <div className="absolute right-0 z-50 mt-2 w-[min(92vw,360px)] overflow-hidden rounded-2xl bg-white text-navy-900 shadow-[var(--shadow-pop)] ring-1 ring-black/10">
                  <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50 px-4 py-2.5">
                    <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Notifications</p>
                    {unread > 0 && <button className="text-[10.5px] font-semibold text-navy-800 underline underline-offset-2 hover:text-navy-950" onClick={() => markAllNotificationsRead()}>Mark all read</button>}
                  </div>
                  <div className="max-h-96 overflow-y-auto nice-scroll">
                    {notifications.length === 0 && <p className="px-4 py-6 text-center text-[12px] text-slate-400">You're all caught up.</p>}
                    {notifications.slice(0, 12).map(n => (
                      <button key={n.id} onClick={() => { markNotificationRead(n.id); if (n.link) navigate(n.link); setBellOpen(false); }}
                        className={`block w-full border-b border-slate-50 px-4 py-2.5 text-left transition hover:bg-navy-50 ${n.read ? 'opacity-70' : ''}`}>
                        <div className="flex items-start gap-2">
                          {!n.read && <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-civic-gold-dark" />}
                          <div className="min-w-0">
                            <p className="text-[11.5px] font-semibold leading-snug text-navy-900">{n.title}</p>
                            <p className="mt-0.5 line-clamp-2 text-[10.5px] leading-snug text-slate-500">{n.body}</p>
                            <p className="mt-1 font-mono2 text-[9px] uppercase text-slate-400">{timeAgo(n.at)}</p>
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* User menu */}
            <div className="group relative">
              <button className="flex items-center gap-1.5 rounded-lg py-1.5 pl-1.5 pr-1.5 text-navy-100/90 transition hover:bg-white/10">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-navy-700 font-display text-[10px] font-extrabold text-civic-gold">{currentUser.name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()}</span>
                <span className="hidden max-w-[110px] truncate text-[11px] font-semibold md:block">{currentUser.name.split(' ')[0]}</span>
                <ChevronDown size={13} className="hidden text-navy-100/60 md:block" />
              </button>
              <div className="invisible absolute right-0 z-50 mt-1 w-56 overflow-hidden rounded-2xl bg-white text-navy-900 opacity-0 shadow-[var(--shadow-pop)] ring-1 ring-black/10 transition-all group-hover:visible group-hover:opacity-100">
                <div className="border-b border-slate-100 bg-slate-50 px-4 py-3">
                  <p className="truncate text-[12px] font-bold">{currentUser.name}</p>
                  <p className="truncate font-mono2 text-[9.5px] text-slate-500">{currentUser.email}</p>
                  <span className="mt-1.5 inline-block rounded-full bg-navy-900 px-2 py-0.5 text-[8.5px] font-bold uppercase tracking-wider text-civic-gold">{currentUser.role}</span>
                </div>
                <button onClick={() => { logout(); navigate('/'); }} className="flex w-full items-center gap-2 px-4 py-2.5 text-[12px] font-semibold text-rose-700 transition hover:bg-rose-50">
                  <LogOut size={14} /> Sign out
                </button>
              </div>
            </div>

            <button className="rounded-lg p-2 text-navy-100 hover:bg-white/10 lg:hidden" onClick={() => setMenuOpen(v => !v)} aria-label="Toggle menu">
              {menuOpen ? <X size={20} /> : <Menu size={20} />}
            </button>
          </div>
        </div>

        {/* mobile nav */}
        {menuOpen && (
          <div className="border-t border-white/10 bg-navy-900 px-3 pb-4 pt-2 lg:hidden">
            {nav.map(entry => (
              <NavLink key={entry.to} to={entry.to} end={entry.to === routeFor(role)}
                className={({ isActive }) => `block rounded-lg px-4 py-2.5 text-[13px] font-semibold ${isActive ? 'bg-white/10 text-civic-gold' : 'text-navy-100/85'}`}>
                {entry.label}
              </NavLink>
            ))}
            {role === 'admin' && (
              <>
                <NavLink to="/admin/settings" className={({ isActive }) => `block rounded-lg px-4 py-2.5 text-[13px] font-semibold ${isActive ? 'bg-white/10 text-civic-gold' : 'text-navy-100/85'}`}>Settings & AI</NavLink>
                <NavLink to="/admin/activity" className={({ isActive }) => `block rounded-lg px-4 py-2.5 text-[13px] font-semibold ${isActive ? 'bg-white/10 text-civic-gold' : 'text-navy-100/85'}`}>Activity Log</NavLink>
              </>
            )}
          </div>
        )}
      </header>

      {/* ── Portal content ─────────────────────────── */}
      <main className="mx-auto max-w-[1720px] px-3 py-4 sm:px-5 sm:py-6">
        <Outlet />
      </main>

      {/* ── Footer ─────────────────────────── */}
      <footer className="border-t border-slate-200 bg-navy-950 py-4 text-center">
        <p className="text-[9.5px] font-semibold uppercase tracking-[0.2em] text-navy-100/40">CIVICXON · AI-Assisted Civic Resolution · Road & Streetlight Maintenance Departments (Demo Integrations)</p>
      </footer>
    </div>
  );
}
