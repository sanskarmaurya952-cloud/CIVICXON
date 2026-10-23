import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Camera, Crosshair, MapPin, Sparkles, X, CheckCircle2, AlertTriangle, Navigation, Wrench, Lightbulb, Wand2, Info } from 'lucide-react';
import { useStore } from '../../lib/store';
import { useToast } from '../../components/Toast';
import { Card, Button, Textarea, Spinner } from '../../components/ui';
import LeafletMap from '../../components/LeafletMap';
import { compressImage, MAX_UPLOAD_BYTES, ACCEPTED_IMAGE_TYPES } from '../../lib/config';
import { aiStatus } from '../../lib/ai';
import { CITY_CENTER } from '../../lib/geo';

export default function CitizenReport() {
  const { db, currentUser, reportIssue, ai } = useStore();
  const toast = useToast();
  const navigate = useNavigate();
  const me = currentUser!;

  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<'auto' | 'pothole' | 'streetlight'>('auto');
  const [address, setAddress] = useState('');
  const [lat, setLat] = useState<number | null>(null);
  const [lng, setLng] = useState<number | null>(null);
  const [gpsBusy, setGpsBusy] = useState(false);
  const [gpsError, setGpsError] = useState('');
  const [photo, setPhoto] = useState<string | null>(null);
  const [photoName, setPhotoName] = useState('');
  const [photoError, setPhotoError] = useState('');
  const [voiceNote, setVoiceNote] = useState('');
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ticketNo: string; duplicateHints: { ticketNo: string; combined: number; reasons: string[] }[] } | null>(null);
  const recognitionRef = useRef<{ stop: () => void } | null>(null);

  // auto-fetch GPS on mount
  useEffect(() => { void fetchGps(); }, []);

  const fetchGps = () => {
    if (!navigator.geolocation) { setGpsError('Geolocation not supported — tap the map to drop a pin.'); return; }
    setGpsBusy(true); setGpsError('');
    navigator.geolocation.getCurrentPosition(
      pos => { setLat(pos.coords.latitude); setLng(pos.coords.longitude); setGpsBusy(false); },
      err => { setGpsBusy(false); setGpsError(err.code === 1 ? 'Location permission denied — tap the map to pick the spot manually.' : 'Could not get GPS fix — tap the map to pick the location.'); },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 30000 },
    );
  };

  const onPhoto = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhotoError('');
    if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) { setPhotoError('Only JPEG, PNG, WebP or HEIC images are accepted.'); return; }
    if (file.size > MAX_UPLOAD_BYTES) { setPhotoError('Image too large — maximum 6 MB.'); return; }
    try {
      const compressed = await compressImage(file, 960, 0.82);
      setPhoto(compressed);
      setPhotoName(file.name);
    } catch {
      setPhotoError('Could not read that image. Try a different photo.');
    }
    e.target.value = '';
  };

  const toggleVoice = () => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) { toast('info', 'Voice not supported', 'Speech recognition is not available in this browser — type your note instead.'); return; }
    if (recording) { recognitionRef.current?.stop(); setRecording(false); return; }
    const rec = new SR();
    rec.lang = 'en-IN';
    rec.continuous = true;
    rec.interimResults = false;
    rec.onresult = (ev: any) => {
      let text = '';
      for (let i = ev.resultIndex; i < ev.results.length; i++) text += ev.results[i][0].transcript + ' ';
      setVoiceNote(v => (v + ' ' + text).trim().slice(0, 500));
    };
    rec.onend = () => setRecording(false);
    rec.onerror = () => setRecording(false);
    recognitionRef.current = rec;
    rec.start();
    setRecording(true);
    toast('info', 'Listening…', 'Speak clearly. Tap the mic again to stop.');
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (description.trim().length < 12) { toast('warning', 'Description too short', 'Describe the issue in at least 12 characters — it helps crews and the AI.'); return; }
    if (lat === null || lng === null) { toast('warning', 'No location', 'Allow GPS access or tap the map to pin the issue.'); return; }
    setBusy(true);
    try {
      const res = await reportIssue({
        description: voiceNote ? `${description.trim()} Voice note: ${voiceNote}` : description,
        category,
        lat, lng,
        address: address.trim(),
        photoDataUrl: photo,
        voiceNote: voiceNote || undefined,
      });
      setResult(res);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      toast('error', 'Could not file report', err instanceof Error ? err.message : 'Unexpected error');
    } finally {
      setBusy(false);
    }
  };

  if (result) {
    return (
      <div className="mx-auto max-w-2xl">
        <Card className="p-8 text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-100"><CheckCircle2 size={34} className="text-emerald-600" strokeWidth={1.8} /></div>
          <h1 className="mt-4 font-display text-2xl font-extrabold text-navy-900">Report received</h1>
          <p className="mt-1.5 text-[12.5px] text-slate-500">Ticket <span className="font-mono2 font-bold text-navy-900">{result.ticketNo}</span> is filed and queued for AI triage and admin review. You'll be notified at every step.</p>
          {result.duplicateHints.length > 0 && (
            <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-left">
              <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wide text-amber-800"><AlertTriangle size={14} /> Possible duplicate(s) detected</p>
              <ul className="mt-2 space-y-1.5">
                {result.duplicateHints.map(h => (
                  <li key={h.ticketNo} className="text-[11.5px] leading-snug text-amber-900"><span className="font-mono2 font-bold">{h.ticketNo}</span> — {Math.round(h.combined * 100)}% match · {h.reasons.join(' · ')}</li>
                ))}
              </ul>
              <p className="mt-2 text-[10.5px] text-amber-800/80">Similarity is not proof. An administrator will confirm or keep them separate — no action needed from you.</p>
            </div>
          )}
          <div className="mt-6 flex flex-wrap justify-center gap-2">
            <Button variant="gold" onClick={() => navigate('/citizen/reports')}>View my reports</Button>
            <Button variant="outline" onClick={() => { setResult(null); setDescription(''); setPhoto(null); setPhotoName(''); setVoiceNote(''); setCategory('auto'); setAddress(''); }}>File another</Button>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="grid items-start gap-4 xl:grid-cols-5">
      {/* ── Left: details ── */}
      <div className="space-y-4 xl:col-span-2">
        <Card className="p-5">
          <div className="flex items-center justify-between gap-3">
            <h1 className="font-display text-lg font-extrabold tracking-tight text-navy-900">Report a civic issue</h1>
            {ai && (
              <span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[8.5px] font-bold uppercase tracking-wider ${ai.label.startsWith('Gemma 4 live') ? 'bg-violet-100 text-violet-800' : 'bg-slate-100 text-slate-500'}`} title={ai.label}>
                <Sparkles size={10} /> {ai.label.startsWith('Gemma 4 live') ? 'Gemma 4 triage' : 'Dev AI baseline'}
              </span>
            )}
          </div>
          <p className="mt-1 text-[11.5px] text-slate-500">A photo and a precise pin let road & streetlight crews find the defect on the first visit.</p>

          {/* category */}
          <fieldset className="mt-4">
            <legend className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Issue type</legend>
            <div className="grid grid-cols-3 gap-2">
              {([
                { key: 'auto', label: 'Auto-detect', icon: Wand2, hint: 'AI decides' },
                { key: 'pothole', label: 'Pothole', icon: Wrench, hint: 'Road damage' },
                { key: 'streetlight', label: 'Streetlight', icon: Lightbulb, hint: 'Light fault' },
              ] as const).map(opt => (
                <button key={opt.key} type="button" onClick={() => setCategory(opt.key)}
                  className={`rounded-xl border-2 px-3 py-3 text-center transition ${category === opt.key ? 'border-navy-800 bg-navy-50 shadow-sm' : 'border-slate-200 bg-white hover:border-slate-300'}`}>
                  <opt.icon size={20} strokeWidth={1.8} className={`mx-auto ${category === opt.key ? 'text-navy-800' : 'text-slate-400'}`} />
                  <span className={`mt-1.5 block text-[11.5px] font-bold ${category === opt.key ? 'text-navy-900' : 'text-slate-600'}`}>{opt.label}</span>
                  <span className="block text-[8.5px] font-medium uppercase tracking-wide text-slate-400">{opt.hint}</span>
                </button>
              ))}
            </div>
          </fieldset>

          {/* photo */}
          <div className="mt-4">
            <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Photo evidence</span>
            {!photo ? (
              <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-slate-300 bg-slate-50 px-6 py-7 transition hover:border-navy-700 hover:bg-navy-50">
                <Camera size={26} className="text-slate-400" strokeWidth={1.6} />
                <span className="text-[12px] font-bold text-navy-900">Tap to photograph the issue</span>
                <span className="text-[10px] text-slate-400">JPEG · PNG · WebP · max 6 MB — auto-compressed</span>
                <input type="file" accept={ACCEPTED_IMAGE_TYPES.join(',')} className="hidden" onChange={onPhoto} aria-label="Upload photo" />
              </label>
            ) : (
              <div className="relative overflow-hidden rounded-2xl ring-1 ring-slate-200">
                <img src={photo} alt="Uploaded defect" className="h-48 w-full object-cover" />
                <button type="button" onClick={() => { setPhoto(null); setPhotoName(''); }} className="absolute right-2 top-2 rounded-full bg-navy-950/80 p-1.5 text-white transition hover:bg-navy-950" aria-label="Remove photo"><X size={15} /></button>
                <p className="absolute bottom-0 left-0 right-0 truncate bg-navy-950/75 px-3 py-1.5 font-mono2 text-[9.5px] text-white/90">{photoName}</p>
              </div>
            )}
            {photoError && <p className="mt-1.5 text-[11px] font-medium text-rose-600">{photoError}</p>}
          </div>

          {/* description */}
          <div className="mt-4">
            <Textarea label="Describe the problem" required rows={3} value={description} onChange={e => setDescription(e.target.value)} placeholder="e.g. Deep pothole in the bus lane near the signal — two-wheelers keep swerving into fast traffic…" hint={`${description.trim().length}/12 characters minimum`} />
          </div>

          {/* voice note */}
          <div className="mt-3">
            <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Voice note <span className="text-slate-400">(optional)</span></span>
            <div className="flex items-center gap-2">
              <button type="button" onClick={toggleVoice} className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition ${recording ? 'animate-pulse bg-rose-600 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`} aria-pressed={recording} aria-label={recording ? 'Stop recording' : 'Record voice note'}>
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0M12 19v3"/></svg>
              </button>
              <input value={voiceNote} onChange={e => setVoiceNote(e.target.value)} placeholder={recording ? 'Listening…' : '…or speak, and it transcribes here'} className="h-10 w-full rounded-xl border-0 bg-slate-50 px-3 text-[12px] ring-1 ring-inset ring-slate-200 outline-none placeholder:text-slate-400 focus:ring-2 focus:ring-navy-800" aria-label="Voice note text" />
            </div>
          </div>
        </Card>
      </div>

      {/* ── Right: location + submit ── */}
      <div className="space-y-4 xl:col-span-3">
        <Card className="p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Pin the exact spot</span>
              <p className="text-[10.5px] text-slate-400">GPS auto-detects — or tap anywhere on the map to override.</p>
            </div>
            <Button size="sm" variant={gpsBusy ? 'outline' : 'navy'} onClick={fetchGps} disabled={gpsBusy}>
              {gpsBusy ? <Spinner size={13} /> : <Crosshair size={13} />} Use my GPS
            </Button>
          </div>
          {gpsError && <p className="mt-2 flex items-start gap-1.5 rounded-lg bg-amber-50 px-3 py-2 text-[10.5px] font-medium text-amber-800 ring-1 ring-amber-200"><Info size={12} className="mt-0.5 shrink-0" />{gpsError}</p>}
          <div className="mt-3">
            <LeafletMap height={300} center={lat !== null && lng !== null ? [lat, lng] : CITY_CENTER} zoom={lat !== null ? 16 : 12} selectable selected={lat !== null && lng !== null ? [lat, lng] : null} onSelect={(la, ln) => { setLat(la); setLng(ln); }} markers={[]} />
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-[1fr_auto_auto]">
            <input value={address} onChange={e => setAddress(e.target.value)} placeholder="Nearest landmark / address (optional)" className="col-span-2 h-10 rounded-xl border-0 bg-slate-50 px-3 text-[12px] ring-1 ring-inset ring-slate-200 outline-none placeholder:text-slate-400 focus:ring-2 focus:ring-navy-800 sm:col-span-1" aria-label="Address or landmark" />
            <div className="flex h-10 items-center rounded-xl bg-navy-50 px-3 font-mono2 text-[10.5px] font-semibold text-navy-900 ring-1 ring-inset ring-navy-100">{lat !== null ? `${lat.toFixed(5)}, ${lng!.toFixed(5)}` : 'no pin yet'}</div>
            <div className="flex h-10 items-center gap-1 rounded-xl bg-navy-50 px-3 text-[10px] font-bold uppercase tracking-wide text-navy-900 ring-1 ring-inset ring-navy-100"><Navigation size={11} />{lat !== null ? 'Pinned' : 'Pending'}</div>
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
            <p className="max-w-[300px] text-[10.5px] leading-snug text-slate-500"><span className="font-bold text-navy-900">By filing you agree</span> this is a genuine public-infrastructure defect. False reports may be rejected by administrators.</p>
            <Button type="submit" variant="gold" size="md" disabled={busy} className="min-w-[210px]">
              {busy ? <><Spinner size={16} /> Analysing & filing…</> : <><Sparkles size={16} /> File report with AI triage</>}
            </Button>
          </div>
        </Card>

        <div className="flex items-start gap-2 rounded-2xl border border-dashed border-slate-300 bg-white/60 px-4 py-3">
          <MapPin size={15} className="mt-0.5 shrink-0 text-slate-400" />
          <p className="text-[10.5px] leading-relaxed text-slate-500"><span className="font-bold text-slate-600">How this works:</span> on submit, CIVICXON stores the report in the database, runs AI triage (category · severity · risks), scans for nearby duplicates, and alerts administrators. Allocation to a field crew is deterministic — skill match, distance, workload and availability.</p>
        </div>
      </div>
    </form>
  );
}
