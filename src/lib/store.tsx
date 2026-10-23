// ─────────────────────────────────────────────────────────────
// CIVICXON Store — application engine.
//
// Every mutation goes through mutate() (structuredClone → change → persist →
// setState), which serializes workflow actions and gives atomic semantics
// similar to the DB transactions used by the FastAPI backend (see
// /backend/app/services). Eligibility + state transitions are enforced here,
// server-side-equivalent — never by hiding frontend buttons.
// ─────────────────────────────────────────────────────────────

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type {
  AppNotification, AppSettings, Availability, Database, Department, Issue, IssueCategory, IssueEvent,
  IssueStatus, Media, NotificationType, Priority, Role, Session, Skill, User, VerificationReview,
  WorkerProfile, Zone,
} from './types';
import { CATEGORY_META, SKILL_LABEL } from './types';
import { loadDatabase, loadSession, persistDatabase, persistSession, resetSeedDatabase, wipeDatabase } from './storage';
import { buildSeedDatabase } from './seed';
import { hashPassword, verifyPassword, randomToken, describePasswordPolicy } from './crypto';
import { assetToDataUrl, compressImage, perceptualHash, uid, MAX_UPLOAD_BYTES, ACCEPTED_IMAGE_TYPES } from './config';
import { rankWorkers, buildAssignment, type RankedCandidate } from './scoring';
import { assertTransition, findDuplicates, textSimilarity } from './workflow';
import { analyseIssue, assessRepair, aiStatus, type AIStatus } from './ai';
import { resolveZone } from './geo';

export interface DuplicateHint {
  issueId: string;
  ticketNo: string;
  combined: number;
  distanceKm: number;
  reasons: string[];
}

export interface ReportIssueInput {
  description: string;
  category: 'auto' | IssueCategory;
  lat: number;
  lng: number;
  address: string;
  photoDataUrl: string | null;
  voiceNote?: string;
}

export interface ReportIssueResult {
  issueId: string;
  ticketNo: string;
  duplicateHints: DuplicateHint[];
}

export interface ImportResult {
  created: number;
  skipped: number;
  errors: { row: number; message: string }[];
}

interface StoreValue {
  db: Database | null;
  ready: boolean;
  session: Session | null;
  currentUser: User | null;
  ai: AIStatus | null;
  resetDemoData: () => Promise<void>;

  // Auth
  login: (email: string, password: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  registerCitizen: (name: string, email: string, phone: string, password: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  bootstrapAdmin: (name: string, email: string, phone: string, password: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  logout: () => void;

  // Citizen
  reportIssue: (input: ReportIssueInput) => Promise<ReportIssueResult>;
  cancelIssue: (issueId: string, reason: string) => void;
  addNote: (issueId: string, note: string) => void;

  // Worker
  startWork: (issueId: string) => void;
  submitEvidence: (issueId: string, afterDataUrl: string, caption: string) => Promise<{ outcome: string }>;

  // Admin — review & workflow
  approveReview: (issueId: string, priority: Priority, priorityReason: string) => void;
  rejectReport: (issueId: string, reason: string) => void;
  setPriority: (issueId: string, priority: Priority, reason: string) => void;
  autoAssign: (issueId: string) => { assigned: boolean; eligibleCount: number; top?: RankedCandidate };
  assignWorker: (issueId: string, workerId: string, note?: string) => void;
  unassign: (issueId: string, note?: string) => void;
  mergeDuplicate: (issueId: string, targetIssueId: string) => void;
  unmergeDuplicate: (issueId: string) => void;
  approveVerification: (issueId: string, note: string) => void;
  requestRework: (issueId: string, note: string) => void;

  // Admin — worker management
  createWorker: (input: { name: string; email: string; phone: string; password: string; departmentId: string; skills: Skill[]; zones: string[]; availability: Availability; maxConcurrentJobs: number; baseLat: number; baseLng: number }) => Promise<{ ok: true; workerId: string } | { ok: false; error: string }>;
  updateWorker: (workerId: string, patch: Partial<Pick<WorkerProfile, 'skills' | 'zones' | 'availability' | 'maxConcurrentJobs' | 'baseLat' | 'baseLng' | 'departmentId' | 'rating'>> & { name?: string; phone?: string }) => void;
  setWorkerActive: (workerId: string, active: boolean) => void;
  importWorkersCsv: (csvText: string) => Promise<ImportResult>;

  // Admin — settings
  updateSettings: (patch: Partial<AppSettings>) => void;
  testGemma: () => Promise<{ ok: boolean; message: string }>;

  // Notifications
  markNotificationRead: (id: string) => void;
  markAllNotificationsRead: () => void;
}

const StoreContext = createContext<StoreValue | null>(null);
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const LOCK_MS = 10 * 60 * 1000;

export function StoreProvider({ children }: { children: ReactNode }) {
  const [db, setDb] = useState<Database | null>(null);
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<Session | null>(() => loadSession<Session>());
  const dbRef = useRef<Database | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let existing = loadDatabase();
      if (!existing) {
        existing = await buildSeedDatabase();
        persistDatabase(existing);
      }
      if (cancelled) return;
      // Validate stored session against live DB (role, active flag, expiry)
      const sess = loadSession<Session>();
      if (sess) {
        const u = existing.users.find(u => u.id === sess.userId);
        const valid = u && u.active && u.role === sess.role && Date.now() < sess.expiresAt;
        if (!valid) { persistSession(null); setSession(null); }
      }
      dbRef.current = existing;
      setDb(existing);
      setReady(true);
    })().catch(err => {
      console.error('CIVICXON init failed', err);
      setReady(true); // render error state via db === null
    });
    return () => { cancelled = true; };
  }, []);

  const mutate = useCallback((fn: (draft: Database) => void): Database => {
    const cur = dbRef.current;
    if (!cur) throw new Error('Database not ready');
    const draft = structuredClone(cur);
    fn(draft);
    persistDatabase(draft);
    dbRef.current = draft;
    setDb(draft);
    return draft;
  }, []);

  // Keep every worker's currentLoad consistent with actual active assignments
  const recomputeLoads = (draft: Database) => {
    const counts = new Map<string, number>();
    for (const issue of draft.issues) {
      if (issue.assignedWorkerId && ['ASSIGNED', 'IN_PROGRESS', 'PENDING_VERIFICATION', 'REWORK_REQUIRED'].includes(issue.status)) {
        counts.set(issue.assignedWorkerId, (counts.get(issue.assignedWorkerId) ?? 0) + 1);
      }
    }
    for (const w of draft.workers) w.currentLoad = counts.get(w.id) ?? 0;
  };

  const pushEvent = (draft: Database, issueId: string, actor: { id: string | null; name: string; role: IssueEvent['actorRole'] } | null, type: IssueEvent['type'], message: string, meta?: Record<string, unknown>) => {
    draft.events.push({ id: uid('evt_'), issueId, at: Date.now(), actorId: actor?.id ?? null, actorName: actor?.name ?? 'CivicXon System', actorRole: actor?.role ?? 'system', type, message, meta });
  };

  const notify = (draft: Database, userId: string, title: string, body: string, type: NotificationType, link?: string) => {
    draft.notifications.push({ id: uid('nt_'), userId, title, body, type, read: false, at: Date.now(), link });
  };

  const notifyAdmins = (draft: Database, title: string, body: string, type: NotificationType = 'ADMIN_ALERT', link?: string) => {
    for (const u of draft.users) if (u.role === 'admin' && u.active) notify(draft, u.id, title, body, type, link);
  };

  const setIssueStatus = (draft: Database, issue: Issue, to: IssueStatus) => {
    const from = issue.status;
    assertTransition(from, to);
    issue.status = to;
    issue.updatedAt = Date.now();
    if (to === 'IN_PROGRESS' && !issue.startedAt) issue.startedAt = Date.now();
    if (to === 'ASSIGNED' && !issue.assignedAt) issue.assignedAt = Date.now();
    if (to === 'VERIFIED') { issue.verifiedAt = Date.now(); issue.resolvedAt = Date.now(); }
    return from;
  };

  const performAssignment = (draft: Database, issueId: string, workerId: string, source: 'AUTO' | 'ADMIN', admin: { id: string; name: string } | null, note?: string) => {
    const issue = draft.issues.find(i => i.id === issueId);
    if (!issue) throw new Error('Issue not found');
    const worker = draft.workers.find(w => w.id === workerId);
    if (!worker) throw new Error('Worker not found');
    const workerUser = draft.users.find(u => u.id === worker.userId);
    if (!workerUser?.active) throw new Error('Cannot assign a deactivated worker');
    if (!['UNDER_REVIEW', 'ASSIGNED', 'REWORK_REQUIRED', 'REPORTED'].includes(issue.status)) {
      throw new Error(`Issue cannot be assigned from status ${issue.status}`);
    }
    recomputeLoads(draft);
    const required = CATEGORY_META[issue.category].skill;
    if (!worker.skills.includes(required)) throw new Error(`Worker lacks required skill: ${SKILL_LABEL[required]}`);
    if (worker.availability === 'OFFLINE' || worker.availability === 'ON_LEAVE') throw new Error('Worker is not available');
    if (worker.currentLoad >= worker.maxConcurrentJobs) throw new Error('Worker is at maximum concurrent jobs');
    if (!worker.zones.includes(issue.zone)) throw new Error(`Worker does not cover zone "${issue.zone}"`);

    // Supersede any previous active assignment (history preserved)
    for (const a of draft.assignments) if (a.issueId === issueId && a.status === 'ACTIVE') a.status = 'SUPERSEDED';

    const weights = draft.settings.weights;
    const ranking = rankWorkers({ workers: [worker], workerActive: () => true, issue, requiredSkill: required, weights });
    const candidate = ranking.ranked[0];
    const assignment = buildAssignment({
      candidate,
      issueId,
      workerName: workerUser.name,
      source,
      createdById: admin?.id ?? null,
      createdByName: admin?.name ?? 'CivicXon Allocation Engine',
    });
    if (note) assignment.reason = `${assignment.reason} · Admin note: ${note}`;
    draft.assignments.push(assignment);

    const from = setIssueStatus(draft, issue, 'ASSIGNED');
    issue.assignedWorkerId = worker.id;
    issue.assignedAt = Date.now();
    issue.departmentId = worker.departmentId;

    const adminActor = admin ? { id: admin.id, name: admin.name, role: 'admin' as const } : null;
    pushEvent(draft, issueId, adminActor, issue.assignedWorkerId && from === 'ASSIGNED' ? 'REASSIGNED' : 'ASSIGNED',
      `${source === 'AUTO' ? 'Auto' : 'Manual'} assignment → ${workerUser.name} (score ${assignment.score.toFixed(1)}). ${assignment.reason}`,
      { assignmentId: assignment.id, score: assignment.score, breakdown: assignment.breakdown, source });
    if (from !== 'ASSIGNED') {
      pushEvent(draft, issueId, adminActor, 'STATUS_CHANGE', `Status: ${from} → ASSIGNED`, { from, to: 'ASSIGNED' });
    }
    notify(draft, workerUser.id, `New job assigned: ${issue.ticketNo}`, `${CATEGORY_META[issue.category].label} · Priority ${issue.priority} · ${issue.address}`, 'WORKER_JOB', '/worker/jobs');
    notify(draft, issue.reporterId, `Your report ${issue.ticketNo} was assigned`, `A ${CATEGORY_META[issue.category].label.toLowerCase()} crew has been dispatched. Expected workflow: review → repair → verification.`, 'STATUS_UPDATE', '/citizen/reports');
    recomputeLoads(draft);
    return assignment;
  };

  // ───────────────────────── AUTH ─────────────────────────
  const login: StoreValue['login'] = async (email, password) => {
    const cur = dbRef.current;
    if (!cur) return { ok: false, error: 'System still initialising — retry in a moment.' };
    const user = cur.users.find(u => u.email.toLowerCase() === email.trim().toLowerCase());
    if (!user) return { ok: false, error: 'No account found for that email.' };
    if (!user.active) return { ok: false, error: 'This account has been deactivated. Contact an administrator.' };
    if (user.lockedUntil && Date.now() < user.lockedUntil) {
      const mins = Math.ceil((user.lockedUntil - Date.now()) / 60000);
      return { ok: false, error: `Account locked after ${MAX_ATTEMPTS} failed attempts. Try again in ${mins} min.` };
    }
    const ok = await verifyPassword(password, user.salt, user.iterations, user.passwordHash);
    if (!ok) {
      mutate(draft => {
        const u = draft.users.find(x => x.id === user.id)!;
        u.failedAttempts += 1;
        if (u.failedAttempts >= MAX_ATTEMPTS) u.lockedUntil = Date.now() + LOCK_MS;
      });
      const remaining = MAX_ATTEMPTS - (user.failedAttempts + 1);
      return { ok: false, error: remaining > 0 ? `Incorrect password. ${remaining} attempt(s) remaining.` : 'Account locked for 10 minutes after too many failed attempts.' };
    }
    const sess: Session = { token: randomToken(), userId: user.id, role: user.role, issuedAt: Date.now(), expiresAt: Date.now() + SESSION_TTL_MS };
    mutate(draft => {
      const u = draft.users.find(x => x.id === user.id)!;
      u.failedAttempts = 0; u.lockedUntil = null; u.lastLoginAt = Date.now();
    });
    persistSession(sess);
    setSession(sess);
    return { ok: true };
  };

  const registerCitizen: StoreValue['registerCitizen'] = async (name, email, phone, password) => {
    const cur = dbRef.current;
    if (!cur) return { ok: false, error: 'System still initialising.' };
    if (cur.users.some(u => u.email.toLowerCase() === email.trim().toLowerCase())) return { ok: false, error: 'An account with this email already exists.' };
    const policy = describePasswordPolicy(password);
    if (!policy.ok) return { ok: false, error: `Password too weak: ${policy.problems.join(', ')}.` };
    if (name.trim().length < 3) return { ok: false, error: 'Enter your full name.' };
    if (!/^[+\d][\d\s-]{7,15}$/.test(phone.trim())) return { ok: false, error: 'Enter a valid phone number.' };
    const { hash, salt, iterations } = await hashPassword(password);
    const user: User = { id: uid('usr_'), name: name.trim(), email: email.trim().toLowerCase(), phone: phone.trim(), role: 'citizen', passwordHash: hash, salt, iterations, active: true, failedAttempts: 0, lockedUntil: null, createdAt: Date.now(), lastLoginAt: null };
    mutate(draft => { draft.users.push(user); });
    const sess: Session = { token: randomToken(), userId: user.id, role: 'citizen', issuedAt: Date.now(), expiresAt: Date.now() + SESSION_TTL_MS };
    persistSession(sess);
    setSession(sess);
    return { ok: true };
  };

  const bootstrapAdmin: StoreValue['bootstrapAdmin'] = async (name, email, phone, password) => {
    const cur = dbRef.current;
    if (!cur) return { ok: false, error: 'System still initialising.' };
    if (cur.users.some(u => u.role === 'admin')) return { ok: false, error: 'An administrator already exists. Ask them to create your account.' };
    const policy = describePasswordPolicy(password);
    if (!policy.ok) return { ok: false, error: `Password too weak: ${policy.problems.join(', ')}.` };
    const { hash, salt, iterations } = await hashPassword(password);
    const user: User = { id: uid('usr_'), name: name.trim(), email: email.trim().toLowerCase(), phone: phone.trim(), role: 'admin', passwordHash: hash, salt, iterations, active: true, failedAttempts: 0, lockedUntil: null, createdAt: Date.now(), lastLoginAt: null };
    mutate(draft => { draft.users.push(user); });
    const sess: Session = { token: randomToken(), userId: user.id, role: 'admin', issuedAt: Date.now(), expiresAt: Date.now() + SESSION_TTL_MS };
    persistSession(sess);
    setSession(sess);
    return { ok: true };
  };

  const logout = () => { persistSession(null); setSession(null); };

  const currentUser = useMemo(() => {
    if (!session || !db) return null;
    const u = db.users.find(u => u.id === session.userId);
    if (!u || !u.active) return null;
    if (Date.now() > session.expiresAt) return null;
    return u;
  }, [session, db]);

  // ─────────────────────── CITIZEN ───────────────────────
  const reportIssue: StoreValue['reportIssue'] = async input => {
    const cur = dbRef.current;
    if (!cur) throw new Error('Database not ready');
    const user = currentUser;
    if (!user || user.role !== 'citizen') throw new Error('Only citizens can report issues');
    if (input.description.trim().length < 12) throw new Error('Please describe the issue in at least 12 characters.');

    // Perceptual hash for image similarity / duplicate detection
    let phash: string | null = null;
    if (input.photoDataUrl) phash = (await perceptualHash(input.photoDataUrl).catch(() => null)) ?? null;

    // AI analysis (Gemma 4 when configured; labelled dev fallback otherwise)
    const ai = await analyseIssue({ settings: cur.settings, description: input.description, imageDataUrl: input.photoDataUrl });
    const category: IssueCategory = input.category === 'auto' ? ai.category : input.category;

    const ticketNo = `CX-2026-${String(cur.issues.length + 1).padStart(4, '0')}`;
    const now = Date.now();
    const zone = resolveZone(input.lat, input.lng, cur.zones);
    const aiPriority: Priority = ai.severity === 'critical' ? 'CRITICAL' : ai.severity === 'severe' ? 'HIGH' : ai.severity === 'low' ? 'LOW' : 'MEDIUM';
    const issue: Issue = {
      id: uid('iss_'), ticketNo, category, description: input.description.trim(), voiceNote: input.voiceNote,
      status: 'REPORTED', priority: aiPriority, priorityReason: null,
      reporterId: user.id, reporterName: user.name, citizenPhone: user.phone,
      address: input.address.trim() || 'Location pinned on map', lat: input.lat, lng: input.lng, zone,
      departmentId: null, assignedWorkerId: null, duplicateOfId: null,
      ai: { ...ai, category, analysedAt: now },
      createdAt: now, updatedAt: now, assignedAt: null, startedAt: null, resolvedAt: null, verifiedAt: null,
      rejectedReason: null, reworkCount: 0,
    };

    const hints = findDuplicates({
      candidate: { category, description: issue.description, lat: issue.lat, lng: issue.lng, imagePhash: phash },
      existing: cur.issues,
      mediaByIssue: id => cur.media.filter(m => m.issueId === id),
      excludeId: issue.id,
    });
    const hintsForIssue: DuplicateHint[] = hints.slice(0, 3).map(h => ({ issueId: h.issue.id, ticketNo: h.issue.ticketNo, combined: h.combined, distanceKm: h.distanceKm, reasons: h.reasons }));
    issue.duplicateHints = hintsForIssue;

    mutate(draft => {
      draft.issues.push(issue);
      if (input.photoDataUrl) {
        draft.media.push({ id: uid('med_'), issueId: issue.id, type: 'BEFORE', storageKey: input.photoDataUrl, caption: 'Citizen report photo', uploadedBy: user.id, uploadedAt: now, phash });
      }
      pushEvent(draft, issue.id, { id: user.id, name: user.name, role: 'citizen' }, 'CREATED', input.photoDataUrl ? 'Citizen reported the issue with photo evidence.' : 'Citizen reported the issue.');
      pushEvent(draft, issue.id, null, 'AI_ANALYSIS', `AI analysis (${ai.provider}${ai.model ? ' · ' + ai.model : ''}): ${category} · ${ai.severity} · confidence ${(ai.confidence * 100).toFixed(0)}%.`, { provider: ai.provider, severity: ai.severity, confidence: ai.confidence });
      if (hintsForIssue.length) {
        pushEvent(draft, issue.id, null, 'DUPLICATE_FLAGGED', `${hintsForIssue.length} possible duplicate(s) detected near this location: ${hintsForIssue.map(h => h.ticketNo).join(', ')}. Awaiting admin confirmation.`, { hints: hintsForIssue });
      }
      notify(draft, user.id, `Report ${ticketNo} received`, `Your report was triaged by AI as ${category} · ${ai.severity}. It is awaiting admin review.`, 'REPORT_RECEIVED', '/citizen/reports');
      notifyAdmins(draft, `New report ${ticketNo}`, `${CATEGORY_META[category].label} · ${ai.severity} · ${issue.address}`, 'ADMIN_ALERT', '/admin/review');
      if (hintsForIssue.length) notifyAdmins(draft, `Possible duplicate for ${ticketNo}`, `Similar to ${hintsForIssue.map(h => h.ticketNo).join(', ')} — review to merge.`, 'ADMIN_ALERT', '/admin/review');
    });

    return { issueId: issue.id, ticketNo, duplicateHints: hintsForIssue };
  };

  const cancelIssue: StoreValue['cancelIssue'] = (issueId, reason) => {
    mutate(draft => {
      const issue = draft.issues.find(i => i.id === issueId);
      if (!issue) throw new Error('Issue not found');
      const user = dbRef.current ? (currentUser as User | null) : null;
      const isAdmin = user?.role === 'admin';
      if (!isAdmin) {
        if (issue.reporterId !== user?.id) throw new Error('You can only cancel your own reports');
        if (!['REPORTED', 'UNDER_REVIEW'].includes(issue.status)) throw new Error('This report is already being worked on and can no longer be cancelled');
      }
      if (['VERIFIED', 'CANCELLED', 'REJECTED', 'DUPLICATE'].includes(issue.status)) throw new Error('This issue is already closed');
      const from = issue.status;
      issue.status = 'CANCELLED';
      issue.updatedAt = Date.now();
      pushEvent(draft, issueId, user ? { id: user.id, name: user.name, role: user.role } : null, 'CANCELLED', `Issue cancelled${reason ? `: ${reason}` : ''}.`, { from });
      recomputeLoads(draft);
      notify(draft, issue.reporterId, `Report ${issue.ticketNo} cancelled`, reason ? `Reason: ${reason}` : 'The report has been cancelled.', 'STATUS_UPDATE', '/citizen/reports');
    });
  };

  const addNote: StoreValue['addNote'] = (issueId, note) => {
    const text = note.trim();
    if (!text) throw new Error('Note cannot be empty');
    mutate(draft => {
      const issue = draft.issues.find(i => i.id === issueId);
      if (!issue) throw new Error('Issue not found');
      const user = currentUser!;
      if (user.role === 'worker') {
        const worker = draft.workers.find(w => w.userId === user.id);
        if (!worker || issue.assignedWorkerId !== worker.id) throw new Error('You can only add notes to jobs assigned to you');
      } else if (user.role === 'citizen' && issue.reporterId !== user.id) {
        throw new Error('You can only add notes to your own reports');
      }
      pushEvent(draft, issueId, { id: user.id, name: user.name, role: user.role }, 'NOTE', text);
    });
  };

  // ─────────────────────── WORKER ───────────────────────
  const startWork: StoreValue['startWork'] = issueId => {
    mutate(draft => {
      const issue = draft.issues.find(i => i.id === issueId);
      if (!issue) throw new Error('Issue not found');
      const user = currentUser!;
      const worker = draft.workers.find(w => w.userId === user.id);
      if (!worker) throw new Error('No worker profile');
      if (issue.assignedWorkerId !== worker.id) throw new Error('This job is not assigned to you');
      if (issue.status === 'IN_PROGRESS') return;
      const wasRework = issue.status === 'REWORK_REQUIRED';
      const from = setIssueStatus(draft, issue, 'IN_PROGRESS');
      pushEvent(draft, issueId, { id: user.id, name: user.name, role: 'worker' }, 'WORK_STARTED', wasRework ? 'Worker resumed work after rework request.' : 'Worker started repair work.');
      if (from !== 'IN_PROGRESS') pushEvent(draft, issueId, { id: user.id, name: user.name, role: 'worker' }, 'STATUS_CHANGE', `Status: ${from} → IN_PROGRESS`, { from, to: 'IN_PROGRESS' });
      notify(draft, issue.reporterId, `Work started on ${issue.ticketNo}`, 'A field crew has begun repairs on your reported issue.', 'STATUS_UPDATE', '/citizen/reports');
    });
  };

  const submitEvidence: StoreValue['submitEvidence'] = async (issueId, afterDataUrl, caption) => {
    const cur = dbRef.current;
    if (!cur) throw new Error('Database not ready');
    const user = currentUser!;
    const worker = cur.workers.find(w => w.userId === user.id);
    if (!worker) throw new Error('No worker profile');
    const issue = cur.issues.find(i => i.id === issueId);
    if (!issue) throw new Error('Issue not found');
    if (issue.assignedWorkerId !== worker.id) throw new Error('This job is not assigned to you');
    if (issue.status !== 'IN_PROGRESS') throw new Error(`Evidence can only be submitted from IN_PROGRESS (current: ${issue.status})`);
    if (!afterDataUrl) throw new Error('Attach an after-repair photo');

    const phash = (await perceptualHash(afterDataUrl).catch(() => null)) ?? null;
    const before = cur.media.filter(m => m.issueId === issueId && m.type === 'BEFORE').pop();
    const assessment = await assessRepair({ settings: cur.settings, beforeDataUrl: before?.storageKey ?? afterDataUrl, afterDataUrl, category: issue.category, description: issue.description });

    mutate(draft => {
      const issue = draft.issues.find(i => i.id === issueId)!;
      if (issue.status !== 'IN_PROGRESS') throw new Error('Issue status changed — refresh and retry');
      const afterMedia: Media = { id: uid('med_'), issueId, type: 'AFTER', storageKey: afterDataUrl, caption: caption.trim() || 'After-repair evidence', uploadedBy: user.id, uploadedAt: Date.now(), phash };
      draft.media.push(afterMedia);
      const review: VerificationReview = {
        id: uid('ver_'), issueId, provider: assessment.provider, model: assessment.model,
        outcome: assessment.outcome, explanation: assessment.explanation, limitations: assessment.limitations,
        confidence: assessment.confidence,
        comparedMediaIds: [before?.id ?? '', afterMedia.id],
        reviewerName: user.name, createdAt: Date.now(),
        adminDecision: null, adminNote: null, decidedAt: null, decidedById: null, decidedByName: null,
      };
      draft.verifications.push(review);
      const from = setIssueStatus(draft, issue, 'PENDING_VERIFICATION');
      pushEvent(draft, issueId, { id: user.id, name: user.name, role: 'worker' }, 'EVIDENCE_SUBMITTED', `Worker submitted repair evidence. AI pre-check (${assessment.provider}): ${assessment.outcome.replace('_', ' ')} · confidence ${(assessment.confidence * 100).toFixed(0)}%.`, { reviewId: review.id, outcome: assessment.outcome });
      pushEvent(draft, issueId, null, 'STATUS_CHANGE', `Status: ${from} → PENDING_VERIFICATION`, { from, to: 'PENDING_VERIFICATION' });
      notifyAdmins(draft, `Verification needed: ${issue.ticketNo}`, `${CATEGORY_META[issue.category].label} · AI pre-check: ${assessment.outcome.replace('_', ' ')}`, 'ADMIN_ALERT', '/admin/verification');
      notify(draft, issue.reporterId, `Repair submitted for ${issue.ticketNo}`, 'Evidence is awaiting admin verification. You will be notified when it is approved.', 'STATUS_UPDATE', '/citizen/reports');
    });

    return { outcome: assessment.outcome };
  };

  // ─────────────────────── ADMIN ───────────────────────
  const approveReview: StoreValue['approveReview'] = (issueId, priority, priorityReason) => {
    if (!priorityReason.trim()) throw new Error('A reason is required when setting priority');
    const cur = dbRef.current;
    const issue = cur?.issues.find(i => i.id === issueId);
    const wasAuto = cur?.settings.autoAssign;
    mutate(draft => {
      const issue = draft.issues.find(i => i.id === issueId);
      if (!issue) throw new Error('Issue not found');
      const admin = currentUser!;
      if (!['REPORTED', 'UNDER_REVIEW'].includes(issue.status)) throw new Error(`Cannot review from status ${issue.status}`);
      const from = setIssueStatus(draft, issue, 'UNDER_REVIEW');
      issue.priority = priority;
      issue.priorityReason = priorityReason.trim();
      pushEvent(draft, issueId, { id: admin.id, name: admin.name, role: 'admin' }, 'PRIORITY_SET', `Priority set to ${priority} — ${priorityReason.trim()}`, { priority, reason: priorityReason.trim() });
      if (from !== 'UNDER_REVIEW') pushEvent(draft, issueId, { id: admin.id, name: admin.name, role: 'admin' }, 'STATUS_CHANGE', `Status: ${from} → UNDER_REVIEW`, { from, to: 'UNDER_REVIEW' });
      notify(draft, issue.reporterId, `Report ${issue.ticketNo} is under review`, `Priority ${priority}. Our team is being assigned.`, 'STATUS_UPDATE', '/citizen/reports');
    });
    if (wasAuto) {
      try { autoAssign(issueId); } catch (err) { console.warn('Auto-assignment skipped', err); }
    }
  };

  const rejectReport: StoreValue['rejectReport'] = (issueId, reason) => {
    if (reason.trim().length < 6) throw new Error('Give a clear rejection reason (min 6 chars)');
    mutate(draft => {
      const issue = draft.issues.find(i => i.id === issueId);
      if (!issue) throw new Error('Issue not found');
      if (['VERIFIED', 'CANCELLED'].includes(issue.status)) throw new Error('Issue is already closed');
      const admin = currentUser!;
      const from = issue.status;
      issue.status = 'REJECTED';
      issue.rejectedReason = reason.trim();
      issue.updatedAt = Date.now();
      for (const a of draft.assignments) if (a.issueId === issueId && a.status === 'ACTIVE') a.status = 'SUPERSEDED';
      pushEvent(draft, issueId, { id: admin.id, name: admin.name, role: 'admin' }, 'REJECTED', `Report rejected: ${reason.trim()}`, { from });
      notify(draft, issue.reporterId, `Report ${issue.ticketNo} was rejected`, reason.trim(), 'REJECTED', '/citizen/reports');
      recomputeLoads(draft);
    });
  };

  const setPriority: StoreValue['setPriority'] = (issueId, priority, reason) => {
    if (!reason.trim()) throw new Error('A reason is required');
    mutate(draft => {
      const issue = draft.issues.find(i => i.id === issueId);
      if (!issue) throw new Error('Issue not found');
      if (issue.status === 'VERIFIED' || issue.status === 'CANCELLED') throw new Error('Closed issues cannot change priority');
      const admin = currentUser!;
      issue.priority = priority;
      issue.priorityReason = reason.trim();
      issue.updatedAt = Date.now();
      pushEvent(draft, issueId, { id: admin.id, name: admin.name, role: 'admin' }, 'PRIORITY_SET', `Priority set to ${priority} — ${reason.trim()}`, { priority });
    });
  };

  const autoAssign: StoreValue['autoAssign'] = issueId => {
    const cur = dbRef.current;
    if (!cur) throw new Error('Database not ready');
    const issue = cur.issues.find(i => i.id === issueId);
    if (!issue) throw new Error('Issue not found');
    const required = CATEGORY_META[issue.category].skill;
    const { ranked, eligibleCount } = rankWorkers({ workers: cur.workers, workerActive: w => {
      const u = cur.users.find(u => u.id === w.userId);
      return Boolean(u?.active);
    }, issue, requiredSkill: required, weights: cur.settings.weights });

    if (eligibleCount === 0) {
      mutate(draft => {
        const admin = currentUser!;
        pushEvent(draft, issueId, { id: admin.id, name: admin.name, role: 'admin' }, 'NO_WORKER_AVAILABLE', `Auto-assignment failed: no eligible worker for skill “${required.replace('_', ' ')}” in zone “${issue.zone}”. Manual assignment required.`, { ranked: ranked.map(r => ({ workerId: r.worker.id, reasons: r.ineligibleReasons })) });
        notifyAdmins(draft, `No worker available for ${issue.ticketNo}`, `Skill ${required.replace('_', ' ')} · zone ${issue.zone} — assign manually.`, 'ADMIN_ALERT', '/admin/review');
      });
      return { assigned: false, eligibleCount: 0 };
    }
    const top = ranked[0];
    mutate(draft => {
      const admin = currentUser!;
      performAssignment(draft, issueId, top.worker.id, 'AUTO', { id: admin.id, name: admin.name });
    });
    return { assigned: true, eligibleCount, top };
  };

  const assignWorker: StoreValue['assignWorker'] = (issueId, workerId, note) => {
    mutate(draft => {
      const admin = currentUser!;
      performAssignment(draft, issueId, workerId, 'ADMIN', { id: admin.id, name: admin.name }, note);
    });
  };

  const unassign: StoreValue['unassign'] = (issueId, note) => {
    mutate(draft => {
      const issue = draft.issues.find(i => i.id === issueId);
      if (!issue) throw new Error('Issue not found');
      const admin = currentUser!;
      if (!issue.assignedWorkerId) throw new Error('Issue has no assignee');
      for (const a of draft.assignments) if (a.issueId === issueId && a.status === 'ACTIVE') a.status = 'SUPERSEDED';
      issue.assignedWorkerId = null;
      issue.updatedAt = Date.now();
      const from = issue.status === 'IN_PROGRESS' ? setIssueStatus(draft, issue, 'UNDER_REVIEW') : issue.status;
      if (from !== issue.status) pushEvent(draft, issueId, { id: admin.id, name: admin.name, role: 'admin' }, 'STATUS_CHANGE', `Status: ${from} → UNDER_REVIEW`, { from, to: 'UNDER_REVIEW' });
      pushEvent(draft, issueId, { id: admin.id, name: admin.name, role: 'admin' }, 'NOTE', `Worker unassigned by admin.${note ? ` Reason: ${note}` : ''}`);
      recomputeLoads(draft);
    });
  };

  const mergeDuplicate: StoreValue['mergeDuplicate'] = (issueId, targetIssueId) => {
    if (issueId === targetIssueId) throw new Error('Cannot merge an issue into itself');
    mutate(draft => {
      const issue = draft.issues.find(i => i.id === issueId);
      const target = draft.issues.find(i => i.id === targetIssueId);
      if (!issue || !target) throw new Error('Issue not found');
      if (['VERIFIED', 'CANCELLED', 'DUPLICATE'].includes(issue.status)) throw new Error('Only open issues can be merged');
      if (['DUPLICATE', 'CANCELLED', 'REJECTED'].includes(target.status)) throw new Error('Target issue is closed');
      const admin = currentUser!;
      issue.status = 'DUPLICATE';
      issue.duplicateOfId = target.id;
      issue.updatedAt = Date.now();
      for (const a of draft.assignments) if (a.issueId === issueId && a.status === 'ACTIVE') a.status = 'SUPERSEDED';
      issue.assignedWorkerId = null;
      pushEvent(draft, issueId, { id: admin.id, name: admin.name, role: 'admin' }, 'DUPLICATE_MERGED', `Merged into ${target.ticketNo} as a confirmed duplicate.`, { targetIssueId, targetTicketNo: target.ticketNo });
      pushEvent(draft, target.id, { id: admin.id, name: admin.name, role: 'admin' }, 'DUPLICATE_MERGED', `${issue.ticketNo} merged into this report as a confirmed duplicate.`, { sourceIssueId: issueId, sourceTicketNo: issue.ticketNo });
      notify(draft, issue.reporterId, `Report ${issue.ticketNo} marked as duplicate`, `Your report matches existing case ${target.ticketNo}. Progress will be tracked there.`, 'STATUS_UPDATE', '/citizen/reports');
      recomputeLoads(draft);
    });
  };

  const unmergeDuplicate: StoreValue['unmergeDuplicate'] = issueId => {
    mutate(draft => {
      const issue = draft.issues.find(i => i.id === issueId);
      if (!issue || issue.status !== 'DUPLICATE') throw new Error('Not a duplicate-merged issue');
      const admin = currentUser!;
      const targetTicket = issue.duplicateOfId ? draft.issues.find(i => i.id === issue.duplicateOfId)?.ticketNo : null;
      issue.status = 'UNDER_REVIEW';
      issue.duplicateOfId = null;
      issue.updatedAt = Date.now();
      pushEvent(draft, issueId, { id: admin.id, name: admin.name, role: 'admin' }, 'STATUS_CHANGE', `Duplicate merge reverted (was merged into ${targetTicket ?? 'unknown'}). Returned to review queue.`, { to: 'UNDER_REVIEW' });
    });
  };

  const approveVerification: StoreValue['approveVerification'] = (issueId, note) => {
    mutate(draft => {
      const issue = draft.issues.find(i => i.id === issueId);
      if (!issue) throw new Error('Issue not found');
      if (issue.status !== 'PENDING_VERIFICATION') throw new Error(`Only PENDING_VERIFICATION issues can be approved (current: ${issue.status})`);
      const admin = currentUser!;
      const review = [...draft.verifications].reverse().find(v => v.issueId === issueId && v.adminDecision === null);
      if (review) { review.adminDecision = 'APPROVED'; review.adminNote = note.trim() || null; review.decidedAt = Date.now(); review.decidedById = admin.id; review.decidedByName = admin.name; }
      const from = setIssueStatus(draft, issue, 'VERIFIED');
      pushEvent(draft, issueId, { id: admin.id, name: admin.name, role: 'admin' }, 'VERIFICATION_DECISION', `Admin approved the repair.${note.trim() ? ` Note: ${note.trim()}` : ''} Ticket closed and marked VERIFIED.`, { decision: 'APPROVED' });
      pushEvent(draft, issueId, { id: admin.id, name: admin.name, role: 'admin' }, 'STATUS_CHANGE', `Status: ${from} → VERIFIED`, { from, to: 'VERIFIED' });
      notify(draft, issue.reporterId, `Report ${issue.ticketNo} resolved!`, 'The repair was verified and your ticket is closed. Thank you for improving the city.', 'VERIFIED', '/citizen/reports');
      if (issue.assignedWorkerId) {
        const worker = draft.workers.find(w => w.id === issue.assignedWorkerId);
        if (worker) {
          worker.jobsCompleted += 1;
          const workerUser = draft.users.find(u => u.id === worker.userId);
          if (workerUser) notify(draft, workerUser.id, `Job ${issue.ticketNo} verified`, 'Your repair was verified and the ticket is closed. Well done.', 'STATUS_UPDATE', '/worker/jobs');
        }
      }
      recomputeLoads(draft);
    });
  };

  const requestRework: StoreValue['requestRework'] = (issueId, note) => {
    if (note.trim().length < 6) throw new Error('Describe what needs rework (min 6 chars)');
    mutate(draft => {
      const issue = draft.issues.find(i => i.id === issueId);
      if (!issue) throw new Error('Issue not found');
      if (issue.status !== 'PENDING_VERIFICATION') throw new Error(`Only PENDING_VERIFICATION issues can be sent for rework (current: ${issue.status})`);
      const admin = currentUser!;
      const review = [...draft.verifications].reverse().find(v => v.issueId === issueId && v.adminDecision === null);
      if (review) { review.adminDecision = 'REWORK_REQUESTED'; review.adminNote = note.trim(); review.decidedAt = Date.now(); review.decidedById = admin.id; review.decidedByName = admin.name; }
      issue.reworkCount += 1;
      const from = setIssueStatus(draft, issue, 'REWORK_REQUIRED');
      pushEvent(draft, issueId, { id: admin.id, name: admin.name, role: 'admin' }, 'REWORK_REQUESTED', `Rework requested: ${note.trim()}`, { from });
      pushEvent(draft, issueId, { id: admin.id, name: admin.name, role: 'admin' }, 'STATUS_CHANGE', `Status: ${from} → REWORK_REQUIRED`, { from, to: 'REWORK_REQUIRED' });
      if (issue.assignedWorkerId) {
        const worker = draft.workers.find(w => w.id === issue.assignedWorkerId);
        const workerUser = worker ? draft.users.find(u => u.id === worker.userId) : null;
        if (workerUser) notify(draft, workerUser.id, `Rework requested: ${issue.ticketNo}`, note.trim(), 'REWORK', '/worker/rework');
      }
      notify(draft, issue.reporterId, `Rework requested on ${issue.ticketNo}`, 'The repair did not pass verification. Our crew will fix it and resubmit.', 'REWORK', '/citizen/reports');
    });
  };

  // ─────────────────── WORKER MANAGEMENT ───────────────────
  const createWorker: StoreValue['createWorker'] = async input => {
    const cur = dbRef.current;
    if (!cur) return { ok: false, error: 'Database not ready' };
    if (cur.users.some(u => u.email.toLowerCase() === input.email.trim().toLowerCase())) return { ok: false, error: 'Email already in use' };
    const policy = describePasswordPolicy(input.password);
    if (!policy.ok) return { ok: false, error: `Password too weak: ${policy.problems.join(', ')}` };
    const dept = cur.departments.find(d => d.id === input.departmentId);
    if (!dept) return { ok: false, error: 'Unknown department' };
    if (!input.skills.length) return { ok: false, error: 'Select at least one skill' };
    const zoneNames = new Set(cur.zones.map(z => z.name));
    if (!input.zones.length) return { ok: false, error: 'Assign at least one service zone' };
    for (const z of input.zones) if (!zoneNames.has(z)) return { ok: false, error: `Unknown zone: ${z}` };
    const { hash, salt, iterations } = await hashPassword(input.password);
    const userId = uid('usr_');
    const workerId = uid('wrk_');
    mutate(draft => {
      draft.users.push({ id: userId, name: input.name.trim(), email: input.email.trim().toLowerCase(), phone: input.phone.trim(), role: 'worker', passwordHash: hash, salt, iterations, active: true, failedAttempts: 0, lockedUntil: null, createdAt: Date.now(), lastLoginAt: null });
      draft.workers.push({ id: workerId, userId, departmentId: input.departmentId, skills: input.skills, zones: input.zones, availability: input.availability, currentLoad: 0, maxConcurrentJobs: input.maxConcurrentJobs, rating: 4.5, jobsCompleted: 0, baseLat: input.baseLat, baseLng: input.baseLng, joinedAt: Date.now() });
    });
    return { ok: true, workerId };
  };

  const updateWorker: StoreValue['updateWorker'] = (workerId, patch) => {
    mutate(draft => {
      const worker = draft.workers.find(w => w.id === workerId);
      if (!worker) throw new Error('Worker not found');
      const admin = currentUser!;
      const { name, phone, ...profilePatch } = patch;
      Object.assign(worker, profilePatch);
      if (name || phone) {
        const u = draft.users.find(u => u.id === worker.userId);
        if (u) { if (name) u.name = name; if (phone) u.phone = phone; }
      }
      void admin;
    });
  };

  const setWorkerActive: StoreValue['setWorkerActive'] = (workerId, active) => {
    mutate(draft => {
      const worker = draft.workers.find(w => w.id === workerId);
      if (!worker) throw new Error('Worker not found');
      const u = draft.users.find(u => u.id === worker.userId);
      if (u) u.active = active;
      if (!active) worker.availability = 'OFFLINE';
    });
  };

  const importWorkersCsv: StoreValue['importWorkersCsv'] = async csvText => {
    const cur = dbRef.current;
    if (!cur) return { created: 0, skipped: 0, errors: [{ row: 0, message: 'Database not ready' }] };
    const lines = csvText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const errors: ImportResult['errors'] = [];
    if (lines.length < 2) return { created: 0, skipped: 0, errors: [{ row: 1, message: 'CSV must include a header row and at least one data row' }] };
    const header = lines[0].split(',').map(h => h.trim().toLowerCase());
    const requiredCols = ['name', 'email', 'department', 'skills', 'zones'];
    for (const col of requiredCols) if (!header.includes(col)) errors.push({ row: 1, message: `Missing required column: ${col}` });
    if (errors.length) return { created: 0, skipped: 0, errors };
    const idx = (col: string) => header.indexOf(col);
    const deptByCode = new Map(cur.departments.map(d => [d.code.toLowerCase(), d]));
    const zoneNames = new Set(cur.zones.map(z => z.name));
    let created = 0, skipped = 0;
    const seen = new Set<string>();
    const newUsers: User[] = [];
    const newWorkers: WorkerProfile[] = [];
    for (let r = 1; r < lines.length; r++) {
      const cols = splitCsvLine(lines[r]).map(c => c.trim());
      const row = r + 1;
      try {
        const name = cols[idx('name')] ?? '';
        const email = (cols[idx('email')] ?? '').toLowerCase();
        const password = cols[idx('password')] || 'Civicxon@2026';
        const deptRaw = (cols[idx('department')] ?? '').toLowerCase();
        const skillsRaw = (cols[idx('skills')] ?? '').split('|').map(s => s.trim().toLowerCase()).filter(Boolean);
        const zones = (cols[idx('zones')] ?? '').split('|').map(s => s.trim()).filter(Boolean);
        const availability = (cols[idx('availability')] || 'AVAILABLE').toUpperCase() as Availability;
        const maxJobs = Number(cols[idx('maxjobs')] ?? idx('max_concurrent_jobs') >= 0 ? cols[idx('maxjobs')] ?? cols[idx('max_concurrent_jobs')] : '3');
        const baseLat = Number(cols[idx('baselat')] ?? '12.9716');
        const baseLng = Number(cols[idx('baselng')] ?? '77.5946');
        const phone = cols[idx('phone')] ?? '+91 90000 00000';

        if (name.length < 3) throw new Error('name too short');
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('invalid email');
        if (seen.has(email) || cur.users.some(u => u.email === email) || newUsers.some(u => u.email === email)) throw new Error('duplicate email');
        const dept = deptByCode.get(deptRaw) ?? cur.departments.find(d => d.id === deptRaw);
        if (!dept) throw new Error(`unknown department "${deptRaw}" (use ROAD or STREET)`);
        const validSkills = new Set(['road_maintenance', 'streetlight_maintenance']);
        const skillMap: Record<string, Skill> = { road: 'road_maintenance', road_maintenance: 'road_maintenance', streetlight: 'streetlight_maintenance', streetlight_maintenance: 'streetlight_maintenance', light: 'streetlight_maintenance' };
        const skills = skillsRaw.map(s => skillMap[s]).filter((s): s is Skill => Boolean(s) && validSkills.has(s));
        if (!skills.length) throw new Error('no valid skills (use road_maintenance|streetlight_maintenance)');
        if (!zones.length) throw new Error('at least one zone required');
        for (const z of zones) if (!zoneNames.has(z)) throw new Error(`unknown zone "${z}" (valid: ${[...zoneNames].join(', ')})`);
        if (!['AVAILABLE', 'BUSY', 'OFFLINE', 'ON_LEAVE'].includes(availability)) throw new Error('invalid availability');
        if (!Number.isFinite(maxJobs) || maxJobs < 1 || maxJobs > 20) throw new Error('maxJobs must be 1–20');
        if (!Number.isFinite(baseLat) || Math.abs(baseLat) > 90 || !Number.isFinite(baseLng) || Math.abs(baseLng) > 180) throw new Error('invalid coordinates');

        const { hash, salt, iterations } = await hashPassword(password);
        const userId = uid('usr_');
        newUsers.push({ id: userId, name, email, phone, role: 'worker', passwordHash: hash, salt, iterations, active: true, failedAttempts: 0, lockedUntil: null, createdAt: Date.now(), lastLoginAt: null });
        newWorkers.push({ id: uid('wrk_'), userId, departmentId: dept.id, skills, zones, availability, currentLoad: 0, maxConcurrentJobs: maxJobs, rating: 4.5, jobsCompleted: 0, baseLat, baseLng, joinedAt: Date.now() });
        seen.add(email);
        created++;
      } catch (err) {
        errors.push({ row, message: err instanceof Error ? err.message : 'invalid row' });
        skipped++;
      }
    }
    if (newUsers.length) {
      mutate(draft => { draft.users.push(...newUsers); draft.workers.push(...newWorkers); });
    }
    return { created, skipped, errors };
  };

  // ─────────────────────── SETTINGS ───────────────────────
  const updateSettings: StoreValue['updateSettings'] = patch => {
    mutate(draft => {
      Object.assign(draft.settings, patch);
      if (patch.weights) {
        const w = draft.settings.weights;
        const sum = w.skill + w.distance + w.workload + w.availability;
        if (sum <= 0) throw new Error('Weights must sum to more than zero');
      }
    });
  };

  const testGemma: StoreValue['testGemma'] = async () => {
    const cur = dbRef.current;
    if (!cur) return { ok: false, message: 'Database not ready' };
    if (!cur.settings.gemmaApiKey?.trim()) return { ok: false, message: 'No API key configured. Get a free key from Google AI Studio (aistudio.google.com) and paste it above.' };
    try {
      const result = await analyseIssue({ settings: { ...cur.settings, aiProvider: 'gemma-4' }, description: 'Test connection: large pothole on a busy two-lane road near a school crossing.' });
      if (result.provider !== 'gemma-4') return { ok: false, message: result.explanation };
      return { ok: true, message: `Connected to ${result.model}. Sample analysis — category: ${result.category}, severity: ${result.severity}, confidence: ${(result.confidence * 100).toFixed(0)}%. ${result.explanation}` };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : 'Unknown error' };
    }
  };

  const markNotificationRead: StoreValue['markNotificationRead'] = id => {
    mutate(draft => { const n = draft.notifications.find(n => n.id === id); if (n) n.read = true; });
  };

  const markAllNotificationsRead: StoreValue['markAllNotificationsRead'] = () => {
    mutate(draft => { const u = currentUser; if (!u) return; for (const n of draft.notifications) if (n.userId === u.id) n.read = true; });
  };

  const resetDemoData = async () => {
    resetSeedDatabase();
    const fresh = await buildSeedDatabase();
    mutate(draft => {
      Object.assign(draft, fresh);
      draft.users = fresh.users;
    });
    persistSession(null);
    setSession(null);
  };

  const ai = useMemo(() => (db ? aiStatus(db.settings) : null), [db]);

  const value: StoreValue = {
    db, ready, session, currentUser, ai, resetDemoData,
    login, registerCitizen, bootstrapAdmin, logout,
    reportIssue, cancelIssue, addNote,
    startWork, submitEvidence,
    approveReview, rejectReport, setPriority, autoAssign, assignWorker, unassign,
    mergeDuplicate, unmergeDuplicate, approveVerification, requestRework,
    createWorker,
    updateWorker, setWorkerActive, importWorkersCsv,
    updateSettings, testGemma,
    markNotificationRead, markAllNotificationsRead,
  };

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreValue {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore must be used within StoreProvider');
  return ctx;
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else inQuotes = false;
      } else cur += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}
