import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ShieldCheck, ArrowLeft, KeyRound } from 'lucide-react';
import { useStore } from '../lib/store';
import { useToast } from '../components/Toast';
import { Input, Button, Card, Spinner } from '../components/ui';

export default function BootstrapAdmin() {
  const { db, bootstrapAdmin } = useStore();
  const toast = useToast();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({ name: '', email: '', phone: '', password: '', confirm: '' });

  const adminExists = db?.users.some(u => u.role === 'admin') ?? false;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (form.password !== form.confirm) { setError('Passwords do not match.'); return; }
    setBusy(true); setError('');
    const res = await bootstrapAdmin(form.name, form.email, form.phone, form.password);
    setBusy(false);
    if (!res.ok) { setError(res.error); return; }
    toast('success', 'First administrator created', 'You are signed in as the city administrator.');
    navigate('/admin');
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-navy-950 px-4 py-10">
      <div className="w-full max-w-md">
        <Link to="/" className="mb-6 inline-flex items-center gap-1.5 text-[11px] font-semibold text-navy-100/60 transition hover:text-white"><ArrowLeft size={13} /> Back to CIVICXON</Link>
        <Card className="p-7">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-navy-900"><ShieldCheck size={24} className="text-civic-gold" /></div>
          <h1 className="mt-4 font-display text-2xl font-extrabold tracking-tight text-navy-900">First-admin setup</h1>
          <p className="mt-1.5 text-[12px] leading-relaxed text-slate-500">CIVICXON ships with no default administrator passwords. This page works once — it is disabled the moment an admin account exists. After that, admins create accounts from the console.</p>

          {adminExists ? (
            <div className="mt-5 rounded-xl bg-emerald-50 p-4 ring-1 ring-emerald-200">
              <p className="flex items-center gap-2 text-[12.5px] font-bold text-emerald-800"><KeyRound size={15} /> An administrator already exists</p>
              <p className="mt-1.5 text-[11.5px] leading-relaxed text-emerald-800/85">Bootstrap is locked by design. Sign in with an existing admin account, or ask an admin to create yours from Admin Console → Workers.</p>
              <button onClick={() => navigate('/')} className="mt-3 w-full rounded-xl bg-emerald-700 py-2.5 text-[12px] font-bold text-white transition hover:bg-emerald-800">Go to sign in</button>
            </div>
          ) : (
            <form onSubmit={submit} className="mt-5 space-y-3.5">
              <Input label="Full name" required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Priya Sharma" />
              <Input label="Work email" type="email" required value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} placeholder="priya@civicxon.gov" />
              <Input label="Phone" required value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} placeholder="+91 98XXX XXXXX" />
              <div className="grid grid-cols-2 gap-3">
                <Input label="Password" type="password" required value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} hint="Min 8 · Aa · 0-9" placeholder="••••••••" />
                <Input label="Confirm" type="password" required value={form.confirm} onChange={e => setForm({ ...form, confirm: e.target.value })} placeholder="••••••••" />
              </div>
              {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-[11.5px] font-medium text-rose-700 ring-1 ring-rose-200">{error}</p>}
              <Button type="submit" disabled={busy} className="w-full">{busy ? <Spinner size={16} /> : <ShieldCheck size={15} />} Create first administrator</Button>
            </form>
          )}
        </Card>
      </div>
    </div>
  );
}
