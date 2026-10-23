import { useState } from 'react';
import { Sparkles, KeyRound, SlidersHorizontal, Save, PlugZap, Info, EyeOff, Eye, CheckCircle2, XCircle, ChevronDown, ChevronUp, Building2 } from 'lucide-react';
import { useStore } from '../../lib/store';
import { useToast } from '../../components/Toast';
import { Card, CardHeader, Button, Input, Select, Spinner } from '../../components/ui';

export default function AdminSettings() {
  const { db, updateSettings, testGemma, ai } = useStore();
  const toast = useToast();
  const [showKey, setShowKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);

  if (!db) return null;
  const s = db.settings;
  const w = s.weights;
  const weightSum = w.skill + w.distance + w.workload + w.availability;

  const setWeight = (key: keyof typeof w, value: number) => updateSettings({ weights: { ...w, [key]: Math.max(0, Math.min(100, value)) } });

  const runTest = async () => {
    setTesting(true); setTestResult(null);
    const res = await testGemma();
    setTestResult(res);
    setTesting(false);
    toast(res.ok ? 'success' : 'warning', res.ok ? 'Gemma 4 connection verified' : 'Gemma 4 test failed', res.message.slice(0, 140));
  };

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div>
        <h1 className="font-display text-2xl font-extrabold tracking-tight text-navy-900">Settings & AI configuration</h1>
        <p className="text-[11.5px] text-slate-500">Allocation weights, provider selection, and Gemma 4 credentials · stored locally in your browser, never in code or logs</p>
      </div>

      {/* ── AI provider ─────────────────────────────── */}
      <Card>
        <CardHeader icon={Sparkles} title="AI provider — Gemma 4" subtitle="Multimodal analysis of report photos + repair verification" right={<ProviderBadge active={s.aiProvider} />} />
        <div className="space-y-4 p-5">
          <Select label="Active provider" value={s.aiProvider} onChange={e => { updateSettings({ aiProvider: e.target.value as any }); setTestResult(null); }}>
            <option value="gemma-4">Gemma 4 — live (Google AI Studio / Gemini API)</option>
            <option value="heuristic">Development-only heuristic baseline (no key needed)</option>
            <option value="mock-dev">Development-only mock provider (canned output)</option>
          </Select>

          {s.aiProvider === 'gemma-4' && (
            <div className="rounded-2xl border border-violet-200 bg-violet-50/50 p-4">
              <div className="flex items-center gap-2"><KeyRound size={15} className="text-violet-700" /><p className="text-[11px] font-extrabold uppercase tracking-wide text-violet-900">Gemma 4 credentials</p></div>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <Select label="Model variant" value={s.gemmaModel} onChange={e => updateSettings({ gemmaModel: e.target.value })}>
                  <option value="gemma-4-26b-a4b-it">gemma-4-26b-a4b-it — 26B MoE, 4B active (fast, recommended)</option>
                  <option value="gemma-4-31b-it">gemma-4-31b-it — 31B dense (max quality)</option>
                </Select>
                <Input label="Endpoint base" value={s.gemmaEndpoint} onChange={e => updateSettings({ gemmaEndpoint: e.target.value })} hint="generativelanguage.googleapis.com/v1beta · x-goog-api-key auth" />
              </div>
              <div className="relative mt-3">
                <Input
                  label="Google AI Studio API key"
                  type={showKey ? 'text' : 'password'}
                  value={s.gemmaApiKey}
                  onChange={e => updateSettings({ gemmaApiKey: e.target.value })}
                  placeholder="AIza… (paste your key — it stays in this browser)"
                  autoComplete="off" spellCheck={false}
                  hint="Never committed to Git · stored only in this browser's local database · never logged"
                  className="pr-11 font-mono2"
                />
                <button type="button" onClick={() => setShowKey(v => !v)} className="absolute right-3 top-[26px] rounded p-1 text-slate-400 hover:text-navy-900" aria-label={showKey ? 'Hide key' : 'Show key'}>{showKey ? <EyeOff size={16} /> : <Eye size={16} />}</button>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Button variant="navy" size="sm" onClick={runTest} disabled={testing}>{testing ? <Spinner size={13} /> : <PlugZap size={13} />} Test Gemma 4 connection</Button>
                <button onClick={() => setHelpOpen(v => !v)} className="flex items-center gap-1 text-[10.5px] font-bold text-violet-800 underline underline-offset-2">{helpOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />} Where do I get a key?</button>
              </div>
              {helpOpen && (
                <ol className="mt-3 list-decimal space-y-1 rounded-xl bg-white/70 p-4 pl-8 text-[10.5px] leading-relaxed text-violet-950 ring-1 ring-violet-100">
                  <li>Open <a className="font-bold underline" href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">aistudio.google.com/apikey</a> and sign in with a Google account.</li>
                  <li>Click <span className="font-mono2 font-bold">Create API key</span> (free tier is sufficient — Gemma 4 is in the free quota for AI Studio).</li>
                  <li>Copy the key starting with <span className="font-mono2">AIza</span> and paste it above.</li>
                  <li>Keep <span className="font-mono2 font-bold">gemma-4-26b-a4b-it</span> unless you want the dense 31B variant. Both accept image input for multimodal triage and before/after comparison.</li>
                  <li>In production, set <span className="font-mono2">GEMMA_API_KEY</span> in the backend environment instead of pasting keys into the browser.</li>
                </ol>
              )}
              {testResult && (
                <div className={`mt-3 flex items-start gap-2 rounded-xl px-4 py-3 text-[11px] leading-relaxed ring-1 ${testResult.ok ? 'bg-emerald-50 text-emerald-900 ring-emerald-200' : 'bg-rose-50 text-rose-900 ring-rose-200'}`}>
                  {testResult.ok ? <CheckCircle2 size={15} className="mt-0.5 shrink-0" /> : <XCircle size={15} className="mt-0.5 shrink-0" />}
                  <span>{testResult.message}</span>
                </div>
              )}
            </div>
          )}
          {s.aiProvider === 'heuristic' && <p className="flex items-start gap-2 rounded-xl bg-amber-50 px-4 py-3 text-[11px] leading-relaxed text-amber-900 ring-1 ring-amber-200"><Info size={14} className="mt-0.5 shrink-0" />Development-only deterministic keyword baseline — <span className="font-bold">not a machine-learning model</span>. It keeps the full workflow demonstrable without credentials. Switch to Gemma 4 for real multimodal vision.</p>}
          {s.aiProvider === 'mock-dev' && <p className="flex items-start gap-2 rounded-xl bg-slate-100 px-4 py-3 text-[11px] leading-relaxed text-slate-600 ring-1 ring-slate-200"><Info size={14} className="mt-0.5 shrink-0" />{s.mockLabel} — canned structured output for demos. Never represents model output.</p>}
        </div>
      </Card>

      {/* ── Allocation weights ─────────────────────────── */}
      <Card>
        <CardHeader icon={SlidersHorizontal} title="Smart allocation weights" subtitle="Deterministic ranking for eligible crews — eligibility is rules-based, weights tune ranking" right={<span className={`font-mono2 text-[10px] font-bold ${Math.abs(weightSum - 100) <= 1 ? 'text-emerald-600' : 'text-amber-600'}`}>Σ {weightSum}</span>} />
        <div className="p-5">
          {([
            { key: 'skill', label: 'Skill match', hint: 'Exact required-skill match for the issue type' },
            { key: 'distance', label: 'Geographic distance', hint: 'Haversine from worker base to issue pin (closer scores higher)' },
            { key: 'workload', label: 'Current workload', hint: 'Fewer open jobs = higher score (capacity-aware)' },
            { key: 'availability', label: 'Availability', hint: 'AVAILABLE = 100 · BUSY = 35 · OFFLINE/LEAVE = 0 (also an eligibility gate)' },
          ] as const).map(row => (
            <div key={row.key} className="flex items-center gap-4 border-b border-slate-100 py-3 last:border-0">
              <div className="w-36 shrink-0"><p className="text-[11.5px] font-bold text-navy-900">{row.label}</p><p className="text-[9px] leading-tight text-slate-400">{row.hint}</p></div>
              <input type="range" min={0} max={100} step={5} value={w[row.key]} onChange={e => setWeight(row.key, Number(e.target.value))} className="h-1.5 flex-1 cursor-pointer accent-navy-800" aria-label={row.label} />
              <span className="w-10 text-right font-mono2 text-[12px] font-bold text-navy-900">{w[row.key]}</span>
            </div>
          ))}
          <label className="mt-4 flex cursor-pointer items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <span><span className="text-[12px] font-bold text-navy-900">Automatic assignment on approval</span><br /><span className="text-[10px] text-slate-500">When an admin approves a report, the engine immediately dispatches the #1 ranked eligible crew. Off = admin assigns manually.</span></span>
            <button role="switch" aria-checked={s.autoAssign} onClick={() => updateSettings({ autoAssign: !s.autoAssign })} className={`relative h-6 w-11 shrink-0 rounded-full transition ${s.autoAssign ? 'bg-emerald-600' : 'bg-slate-300'}`} aria-label="Toggle auto assignment"><span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${s.autoAssign ? 'left-[22px]' : 'left-0.5'}`} /></button>
          </label>
          <div className="mt-4 flex items-center justify-between gap-3 rounded-xl bg-navy-950 px-4 py-3 text-white">
            <p className="text-[10px] font-semibold text-navy-100/75"><Save size={11} className="mr-1 inline" />All changes persist instantly and apply to the next allocation.</p>
            <Button size="sm" variant="gold" onClick={() => toast('success', 'Settings saved', 'Allocation will use the new weights immediately.')}>Saved ✓</Button>
          </div>
        </div>
      </Card>

      {/* ── Departments ─────────────────────────── */}
      <Card>
        <CardHeader icon={Building2} title="Departments" subtitle="Simulated demo integrations — not connected to live ERP/SCADA" />
        <div className="grid gap-3 p-5 sm:grid-cols-2">
          {db.departments.map(d => (
            <div key={d.id} className="rounded-2xl border border-slate-200 p-4 ring-1 ring-slate-100">
              <div className="flex items-center justify-between"><p className="font-mono2 text-[10px] font-extrabold uppercase tracking-wider text-navy-800">{d.code}</p><span className="rounded-full bg-amber-100 px-2 py-0.5 text-[7.5px] font-extrabold uppercase tracking-wider text-amber-900">Demo integration</span></div>
              <p className="mt-1 text-[12px] font-bold text-navy-900">{d.name}</p>
              <p className="mt-1 text-[9.5px] leading-snug text-slate-500">{d.description}</p>
              <p className="mt-2 font-mono2 text-[9px] text-slate-400">{d.contactEmail} · Head: {d.head}</p>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

function ProviderBadge({ active }: { active: string }) {
  if (active === 'gemma-4') return <span className="rounded-full bg-violet-100 px-3 py-1 text-[9px] font-extrabold uppercase tracking-wider text-violet-800 ring-1 ring-violet-200">Gemma 4</span>;
  return <span className="rounded-full bg-slate-100 px-3 py-1 text-[9px] font-extrabold uppercase tracking-wider text-slate-500 ring-1 ring-slate-200">{active === 'mock-dev' ? 'Mock · dev only' : 'Heuristic · dev'}</span>;
}
