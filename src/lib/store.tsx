// ─────────────────────────────────────────────────────────────
// CIVICXON Store — authoritative application engine.
//
// Dual-mode operation:
// 1. Full-Stack Mode (Default when FastAPI backend is running):
//    All mutations are executed server-side with RBAC, ownership checks,
//    dynamic priority scoring (PRD Page 16), deterministic allocation (Page 6),
//    duplicate matching (Page 5), and mandatory admin verification (Page 7).
//    State is synchronized from PostgreSQL/SQLite backend.
// 2. Offline / Local-Development Fallback Mode:
//    When backend is not running, seamlessly uses in-browser engine (localStorage)
//    without crashing tests or breaking the existing UI.
// ─────────────────────────────────────────────────────────────

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type {
  AppNotification, AppSettings, Availability, Database, Department, Issue, IssueCategory, IssueEvent,
  IssueStatus, Media, NotificationType, Priority, Role, Session, Skill, User, VerificationReview,
  WorkerProfile, Zone, Assignment,
} from './types';
import { CATEGORY_META, SKILL_LABEL } from './types';
import { loadDatabase, loadSession, persistDatabase, persistSession, resetSeedDatabase } from './storage';
import { buildSeedDatabase } from './seed';
import { hashPassword, verifyPassword, randomToken, describePasswordPolicy } from './crypto';
import { compressImage, perceptualHash, uid } from './config';
import { rankWorkers, buildAssignment, type RankedCandidate } from './scoring';
import { assertTransition, findDuplicates } from './workflow';
import { analyseIssue, assessRepair, aiStatus, type AIStatus } from './ai';
import { resolveZone } from './geo';
import { api, API_BASE, getStoredToken, setStoredToken, type ApiIssueSummary } from './api';

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

function dataUrlToFile(dataUrl: string, filename: string): File {
  if (!dataUrl || !dataUrl.startsWith('data:')) {
    return new File([new Uint8Array(0)], filename, { type: 'image/jpeg' });
  }
  const parts = dataUrl.split(',');
  const mimeMatch = parts[0].match(/:(.*?);/);
  const mime = mimeMatch ? mimeMatch[1] : 'image/jpeg';
  const bstr = atob(parts[1]);
  let n = bstr.length;
  const u8arr = new Uint8Array(n);
  while (n--) {
    u8arr[n] = bstr.charCodeAt(n);
  }
  return new File([u8arr], filename, { type: mime });
}

function apiIssueToIssue(apiIssue: ApiIssueSummary): Issue {
  const cat = (apiIssue.category || 'pothole') as IssueCategory;
  const stat = (apiIssue.status || 'REPORTED') as IssueStatus;
  const prio = (apiIssue.priority_band || apiIssue.priority || 'MEDIUM') as Priority;
  const createdAtMs = apiIssue.created_at ? new Date(apiIssue.created_at).getTime() : Date.now();
  const updatedAtMs = apiIssue.updated_at ? new Date(apiIssue.updated_at).getTime() : createdAtMs;
  const assignedAtMs = apiIssue.assigned_at ? new Date(apiIssue.assigned_at).getTime() : null;
  const startedAtMs = apiIssue.started_at ? new Date(apiIssue.started_at).getTime() : null;
  const resolvedAtMs = apiIssue.resolved_at ? new Date(apiIssue.resolved_at).getTime() : null;
  const verifiedAtMs = apiIssue.verified_at ? new Date(apiIssue.verified_at).getTime() : null;

  return {
    id: String(apiIssue.id),
    ticketNo: apiIssue.ticket_no,
    category: cat,
    description: apiIssue.description,
    status: stat,
    priority: prio,
    priorityReason: apiIssue.priority_reason,
    reporterId: String(apiIssue.reporter_id),
    reporterName: `Citizen #${apiIssue.reporter_id}`,
    citizenPhone: '+91 90000 00000',
    address: apiIssue.address || 'Location pinned on map',
    lat: apiIssue.lat,
    lng: apiIssue.lng,
    zone: apiIssue.zone || 'Central',
    departmentId: cat === 'pothole' ? 'dept_road' : 'dept_street',
    assignedWorkerId: apiIssue.assigned_worker_id ? String(apiIssue.assigned_worker_id) : null,
    duplicateOfId: apiIssue.duplicate_of_id ? String(apiIssue.duplicate_of_id) : null,
    ai: apiIssue.ai_analysis ? {
      provider: (apiIssue.ai_analysis.provider as any) || 'heuristic',
      model: apiIssue.ai_analysis.model as string | undefined,
      category: (apiIssue.ai_analysis.category as IssueCategory) || cat,
      severity: (apiIssue.ai_analysis.severity as any) || 'moderate',
      description: apiIssue.description,
      riskIndicators: [],
      confidence: (apiIssue.ai_analysis.confidence as number) || 0.8,
      departmentSuggestion: cat === 'pothole' ? 'ROAD' : 'STREET',
      explanation: (apiIssue.ai_analysis.explanation as string) || 'AI analysis',
      analysedAt: createdAtMs,
    } : null,
    createdAt: createdAtMs,
    updatedAt: updatedAtMs,
    assignedAt: assignedAtMs,
    startedAt: startedAtMs,
    resolvedAt: resolvedAtMs,
    verifiedAt: verifiedAtMs,
    rejectedReason: apiIssue.rejected_reason,
    reworkCount: apiIssue.rework_count || 0,
  };
}

function apiIssueToMedia(apiIssue: ApiIssueSummary): Media[] {
  return (apiIssue.media || []).map(m => {
    const rawUrl = m.url || '';
    const fullUrl = rawUrl.startsWith('http') ? rawUrl : `${API_BASE}${rawUrl.startsWith('/') ? '' : '/'}${rawUrl}`;
    return {
      id: String(m.id),
      issueId: String(apiIssue.id),
      type: m.type,
      storageKey: fullUrl,
      caption: m.caption || (m.type === 'BEFORE' ? 'Citizen report photo' : 'After-repair evidence'),
      uploadedBy: String(apiIssue.reporter_id),
      uploadedAt: new Date(apiIssue.updated_at || apiIssue.created_at).getTime(),
    };
  });
}

function apiWorkerToProfile(w: any): WorkerProfile {
  return {
    id: String(w.id),
    userId: String(w.user_id),
    departmentId: String(w.department_id) === '2' ? 'dept_street' : 'dept_road',
    skills: (w.skills || []) as Skill[],
    zones: w.zones || [],
    availability: (w.availability || 'AVAILABLE') as Availability,
    currentLoad: w.current_load || 0,
    maxConcurrentJobs: w.max_concurrent_jobs || 3,
    rating: w.rating || 4.5,
    jobsCompleted: w.jobs_completed || 0,
    baseLat: w.base_lat || 12.9716,
    baseLng: w.base_lng || 77.5946,
    joinedAt: Date.now() - 30 * 86400000,
  };
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [db, setDb] = useState<Database | null>(null);
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<Session | null>(() => loadSession<Session>());
  const [backendOnline, setBackendOnline] = useState(false);
  const [backendUser, setBackendUser] = useState<User | null>(null);
  const dbRef = useRef<Database | null>(null);
  const currentUserRef = useRef<User | null>(null);

  // Synchronize state from FastAPI backend
  const syncBackendData = useCallback(async (meUser?: User | null): Promise<Database> => {
    const activeUser = meUser ?? currentUserRef.current;
    let issuesRes: ApiIssueSummary[] = [];
    let workersRes: any[] = [];
    let verificationsRes: any[] = [];
    let auditLogsRes: any[] = [];

    try {
      issuesRes = await api.listIssues().catch(() => []);
    } catch {
      issuesRes = [];
    }

    if (activeUser?.role === 'admin') {
      [workersRes, verificationsRes, auditLogsRes] = await Promise.all([
        api.listWorkers().catch(() => []),
        api.getVerificationQueue().catch(() => []),
        api.getAdminAuditLogs(100).catch(() => []),
      ]);
    } else if (activeUser?.role === 'worker') {
      workersRes = await api.listWorkers().catch(() => []);
    }

    const issues: Issue[] = issuesRes.map(apiIssueToIssue);
    const media: Media[] = issuesRes.flatMap(apiIssueToMedia);
    const workers: WorkerProfile[] = workersRes.map(apiWorkerToProfile);

    const workerUsers: User[] = workersRes.map(w => ({
      id: String(w.user_id),
      name: w.name,
      email: w.email,
      phone: w.phone || '',
      role: 'worker' as const,
      passwordHash: '',
      salt: '',
      iterations: 0,
      active: Boolean(w.active),
      failedAttempts: 0,
      lockedUntil: null,
      createdAt: Date.now() - 30 * 86400000,
      lastLoginAt: null,
    }));

    const allUsers = [...workerUsers];
    if (activeUser && !allUsers.some(u => u.id === activeUser.id)) {
      allUsers.push(activeUser);
    }

    const events: IssueEvent[] = auditLogsRes.map(l => ({
      id: `evt_${l.id}`,
      issueId: l.target_id ? String(l.target_id) : '',
      at: l.created_at ? new Date(l.created_at).getTime() : Date.now(),
      actorId: null,
      actorName: l.actor_name || 'System',
      actorRole: (l.actor_role as Role) || 'system',
      type: (l.action as any) || 'NOTE',
      message: `${l.actor_name} (${l.actor_role}): ${l.action}`,
      meta: l.details || undefined,
    }));

    const verifications: VerificationReview[] = verificationsRes.map(v => ({
      id: `ver_${v.id}`,
      issueId: String(v.id),
      provider: (v.ai_review?.provider as any) || 'heuristic',
      model: undefined,
      outcome: (v.ai_review?.outcome as any) || 'likely_resolved',
      explanation: v.ai_review?.explanation || 'AI pre-check',
      limitations: v.ai_review?.limitations || '',
      confidence: v.ai_review?.confidence || 0.85,
      comparedMediaIds: ['', ''],
      reviewerName: v.worker_name || 'Field Crew',
      createdAt: v.updated_at ? new Date(v.updated_at).getTime() : Date.now(),
      adminDecision: null,
      adminNote: null,
      decidedAt: null,
      decidedById: null,
      decidedByName: null,
    }));

    const cur = dbRef.current;
    const departments: Department[] = cur?.departments && cur.departments.length > 0 ? cur.departments : [
      { id: 'dept_road', code: 'ROAD', name: 'Road Infrastructure & Maintenance', handles: ['pothole'], description: 'Asphalt paving, road repair, surface leveling', demoIntegration: true, contactEmail: 'roads@civicxon.gov', head: 'R. K. Sharma' },
      { id: 'dept_street', code: 'STREET', name: 'Street Lighting & Electrical', handles: ['streetlight'], description: 'Luminaires, cabling, timer switches, pole maintenance', demoIntegration: true, contactEmail: 'lighting@civicxon.gov', head: 'Ananya Deshmukh' },
    ];

    const zones: Zone[] = cur?.zones && cur.zones.length > 0 ? cur.zones : [
      { id: 'zone_central', name: 'Central', lat: 12.9716, lng: 77.5946, radiusKm: 6.5 },
      { id: 'zone_north', name: 'North', lat: 13.0358, lng: 77.5970, radiusKm: 8.0 },
      { id: 'zone_south', name: 'South', lat: 12.9081, lng: 77.5855, radiusKm: 8.0 },
      { id: 'zone_east', name: 'East', lat: 12.9784, lng: 77.6408, radiusKm: 7.5 },
      { id: 'zone_west', name: 'West', lat: 12.9698, lng: 77.5350, radiusKm: 7.5 },
    ];

    const settings: AppSettings = cur?.settings ?? {
      weights: { skill: 0.35, distance: 0.30, workload: 0.20, availability: 0.15 },
      autoAssign: true,
      aiProvider: 'gemma-4',
      gemmaModel: 'gemma-4-27b-it',
      gemmaApiKey: '',
      gemmaEndpoint: 'https://generativelanguage.googleapis.com/v1beta',
      mockLabel: 'Simulated Gemma 4 response (configure key in Settings)',
    };

    const updatedDb: Database = {
      version: cur?.version ?? 1,
      seeded: true,
      users: allUsers.length > 0 ? allUsers : (cur?.users ?? []),
      workers: workers.length > 0 ? workers : (cur?.workers ?? []),
      departments,
      zones,
      issues,
      media,
      events: events.length > 0 ? events : (cur?.events ?? []),
      assignments: cur?.assignments ?? [],
      verifications: verifications.length > 0 ? verifications : (cur?.verifications ?? []),
      notifications: cur?.notifications ?? [],
      settings,
    };

    dbRef.current = updatedDb;
    setDb(updatedDb);
    return updatedDb;
  }, []);

  // System Initialization
  useEffect(() => {
    let cancelled = false;
    (async () => {
      // 1. Check if backend is reachable
      let isBackendAlive = false;
      try {
        const health = await api.getHealth();
        if (health.status === 'ok') isBackendAlive = true;
      } catch {
        isBackendAlive = false;
      }

      if (cancelled) return;
      setBackendOnline(isBackendAlive);

      if (isBackendAlive) {
        // Backend online: check JWT session
        const storedToken = getStoredToken();
        let meUser: User | null = null;
        if (storedToken) {
          try {
            const me = await api.getMe();
            meUser = {
              id: String(me.id),
              name: me.name,
              email: me.email,
              phone: me.phone || '',
              role: me.role,
              passwordHash: '',
              salt: '',
              iterations: 0,
              active: true,
              failedAttempts: 0,
              lockedUntil: null,
              createdAt: Date.now(),
              lastLoginAt: Date.now(),
            };
            setBackendUser(meUser);
            const sess: Session = {
              token: storedToken,
              userId: String(me.id),
              role: me.role,
              issuedAt: Date.now(),
              expiresAt: Date.now() + SESSION_TTL_MS,
            };
            persistSession(sess);
            setSession(sess);
          } catch {
            setStoredToken(null);
            persistSession(null);
            setSession(null);
          }
        }
        await syncBackendData(meUser);
        setReady(true);
      } else {
        // Offline mode: load from localStorage
        let existing = loadDatabase();
        if (!existing) {
          existing = await buildSeedDatabase();
          persistDatabase(existing);
        }
        const sess = loadSession<Session>();
        if (sess) {
          const u = existing.users.find(u => u.id === sess.userId);
          const valid = u && u.active && u.role === sess.role && Date.now() < sess.expiresAt;
          if (!valid) { persistSession(null); setSession(null); }
        }
        dbRef.current = existing;
        setDb(existing);
        setReady(true);
      }
    })().catch(err => {
      console.error('CIVICXON init failed', err);
      setReady(true);
    });
    return () => { cancelled = true; };
  }, [syncBackendData]);

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

  // Worker load recomputation for offline mode
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

  const currentUser = useMemo(() => {
    if (!session) return null;
    if (backendUser && session.userId === backendUser.id) return backendUser;
    if (!db) return null;
    const u = db.users.find(u => u.id === session.userId);
    if (!u || !u.active) return null;
    if (Date.now() > session.expiresAt) return null;
    return u;
  }, [session, db, backendUser]);

  useEffect(() => {
    currentUserRef.current = currentUser;
  }, [currentUser]);

  // ───────────────────────── AUTH ─────────────────────────
  const login: StoreValue['login'] = async (email, password) => {
    if (backendOnline) {
      try {
        const authRes = await api.login(email, password);
        const me = await api.getMe();
        const user: User = {
          id: String(me.id),
          name: me.name,
          email: me.email,
          phone: me.phone || '',
          role: me.role,
          passwordHash: '',
          salt: '',
          iterations: 0,
          active: true,
          failedAttempts: 0,
          lockedUntil: null,
          createdAt: Date.now(),
          lastLoginAt: Date.now(),
        };
        setBackendUser(user);
        const sess: Session = {
          token: authRes.access_token,
          userId: String(me.id),
          role: me.role,
          issuedAt: Date.now(),
          expiresAt: Date.now() + SESSION_TTL_MS,
        };
        persistSession(sess);
        setSession(sess);
        await syncBackendData(user);
        return { ok: true };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Login failed';
        return { ok: false, error: msg };
      }
    }

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
    if (backendOnline) {
      try {
        const authRes = await api.registerCitizen(name, email, phone, password);
        const me = await api.getMe();
        const user: User = {
          id: String(me.id),
          name: me.name,
          email: me.email,
          phone: me.phone || phone.trim(),
          role: 'citizen',
          passwordHash: '',
          salt: '',
          iterations: 0,
          active: true,
          failedAttempts: 0,
          lockedUntil: null,
          createdAt: Date.now(),
          lastLoginAt: Date.now(),
        };
        setBackendUser(user);
        const sess: Session = {
          token: authRes.access_token,
          userId: String(me.id),
          role: 'citizen',
          issuedAt: Date.now(),
          expiresAt: Date.now() + SESSION_TTL_MS,
        };
        persistSession(sess);
        setSession(sess);
        await syncBackendData(user);
        return { ok: true };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Registration failed';
        return { ok: false, error: msg };
      }
    }

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
    if (backendOnline) {
      try {
        const authRes = await api.bootstrapAdmin(name, email, phone, password);
        const me = await api.getMe();
        const user: User = {
          id: String(me.id),
          name: me.name,
          email: me.email,
          phone: me.phone || phone.trim(),
          role: 'admin',
          passwordHash: '',
          salt: '',
          iterations: 0,
          active: true,
          failedAttempts: 0,
          lockedUntil: null,
          createdAt: Date.now(),
          lastLoginAt: Date.now(),
        };
        setBackendUser(user);
        const sess: Session = {
          token: authRes.access_token,
          userId: String(me.id),
          role: 'admin',
          issuedAt: Date.now(),
          expiresAt: Date.now() + SESSION_TTL_MS,
        };
        persistSession(sess);
        setSession(sess);
        await syncBackendData(user);
        return { ok: true };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Admin bootstrap failed';
        return { ok: false, error: msg };
      }
    }

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

  const logout = () => {
    api.logout();
    setBackendUser(null);
    persistSession(null);
    setSession(null);
  };

  // ─────────────────────── CITIZEN ───────────────────────
  const reportIssue: StoreValue['reportIssue'] = async input => {
    if (backendOnline) {
      const formData = new FormData();
      formData.append('description', input.voiceNote ? `${input.description.trim()} Voice note: ${input.voiceNote}` : input.description.trim());
      formData.append('category', input.category);
      formData.append('lat', String(input.lat));
      formData.append('lng', String(input.lng));
      formData.append('address', input.address.trim() || 'Location pinned on map');
      if (input.photoDataUrl) {
        formData.append('photo', dataUrlToFile(input.photoDataUrl, 'report_photo.jpg'));
      }

      const res = await api.createIssue(formData);
      await syncBackendData();

      const hints: DuplicateHint[] = (res.duplicate_hints || []).map(h => ({
        issueId: String(h.issue_id),
        ticketNo: h.ticket_no,
        combined: h.combined,
        distanceKm: h.distance_km,
        reasons: [
          h.classification === 'SAME_ISSUE' ? 'Confirmed physical defect match' : 'Possible nearby defect match',
          `${h.distance_m.toFixed(0)}m away`,
          h.category_match ? 'Same category' : 'Different category',
          `Description similarity ${(h.text_similarity * 100).toFixed(0)}%`,
          h.image_similarity !== null ? `Visual match ${(h.image_similarity * 100).toFixed(0)}%` : '',
        ].filter(Boolean),
      }));

      return {
        issueId: String(res.id),
        ticketNo: res.ticket_no,
        duplicateHints: hints,
      };
    }

    const cur = dbRef.current;
    if (!cur) throw new Error('Database not ready');
    const user = currentUser;
    if (!user || user.role !== 'citizen') throw new Error('Only citizens can report issues');
    if (input.description.trim().length < 12) throw new Error('Please describe the issue in at least 12 characters.');

    let phash: string | null = null;
    if (input.photoDataUrl) phash = (await perceptualHash(input.photoDataUrl).catch(() => null)) ?? null;

    const aiRes = await analyseIssue({ settings: cur.settings, description: input.description, imageDataUrl: input.photoDataUrl });
    const category: IssueCategory = input.category === 'auto' ? aiRes.category : input.category;

    const ticketNo = `CX-2026-${String(cur.issues.length + 1).padStart(4, '0')}`;
    const now = Date.now();
    const zone = resolveZone(input.lat, input.lng, cur.zones);
    const aiPriority: Priority = aiRes.severity === 'critical' ? 'CRITICAL' : aiRes.severity === 'severe' ? 'HIGH' : aiRes.severity === 'low' ? 'LOW' : 'MEDIUM';
    const issue: Issue = {
      id: uid('iss_'), ticketNo, category, description: input.description.trim(), voiceNote: input.voiceNote,
      status: 'REPORTED', priority: aiPriority, priorityReason: null,
      reporterId: user.id, reporterName: user.name, citizenPhone: user.phone,
      address: input.address.trim() || 'Location pinned on map', lat: input.lat, lng: input.lng, zone,
      departmentId: null, assignedWorkerId: null, duplicateOfId: null,
      ai: { ...aiRes, category, analysedAt: now },
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
      pushEvent(draft, issue.id, null, 'AI_ANALYSIS', `AI analysis (${aiRes.provider}${aiRes.model ? ' · ' + aiRes.model : ''}): ${category} · ${aiRes.severity} · confidence ${(aiRes.confidence * 100).toFixed(0)}%.`, { provider: aiRes.provider, severity: aiRes.severity, confidence: aiRes.confidence });
      if (hintsForIssue.length) {
        pushEvent(draft, issue.id, null, 'DUPLICATE_FLAGGED', `${hintsForIssue.length} possible duplicate(s) detected near this location: ${hintsForIssue.map(h => h.ticketNo).join(', ')}. Awaiting admin confirmation.`, { hints: hintsForIssue });
      }
      notify(draft, user.id, `Report ${ticketNo} received`, `Your report was triaged by AI as ${category} · ${aiRes.severity}. It is awaiting admin review.`, 'REPORT_RECEIVED', '/citizen/reports');
      notifyAdmins(draft, `New report ${ticketNo}`, `${CATEGORY_META[category].label} · ${aiRes.severity} · ${issue.address}`, 'ADMIN_ALERT', '/admin/review');
      if (hintsForIssue.length) notifyAdmins(draft, `Possible duplicate for ${ticketNo}`, `Similar to ${hintsForIssue.map(h => h.ticketNo).join(', ')} — review to merge.`, 'ADMIN_ALERT', '/admin/review');
    });

    return { issueId: issue.id, ticketNo, duplicateHints: hintsForIssue };
  };

  const cancelIssue: StoreValue['cancelIssue'] = async (issueId, reason) => {
    if (backendOnline) {
      await api.cancelIssue(Number(issueId), reason);
      await syncBackendData();
      return;
    }

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

  const addNote: StoreValue['addNote'] = async (issueId, note) => {
    const text = note.trim();
    if (!text) throw new Error('Note cannot be empty');
    if (backendOnline) {
      await api.addNote(Number(issueId), text);
      await syncBackendData();
      return;
    }

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
  const startWork: StoreValue['startWork'] = async issueId => {
    if (backendOnline) {
      await api.startWork(Number(issueId));
      await syncBackendData();
      return;
    }

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
    if (backendOnline) {
      const formData = new FormData();
      formData.append('caption', caption.trim() || 'After-repair evidence');
      formData.append('photo', dataUrlToFile(afterDataUrl, 'after_evidence.jpg'));
      const res = await api.submitEvidence(Number(issueId), formData);
      await syncBackendData();
      return { outcome: res.verification.outcome };
    }

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
      const iss = draft.issues.find(i => i.id === issueId)!;
      if (iss.status !== 'IN_PROGRESS') throw new Error('Issue status changed — refresh and retry');
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
      const from = setIssueStatus(draft, iss, 'PENDING_VERIFICATION');
      pushEvent(draft, issueId, { id: user.id, name: user.name, role: 'worker' }, 'EVIDENCE_SUBMITTED', `Worker submitted repair evidence. AI pre-check (${assessment.provider}): ${assessment.outcome.replace('_', ' ')} · confidence ${(assessment.confidence * 100).toFixed(0)}%.`, { reviewId: review.id, outcome: assessment.outcome });
      pushEvent(draft, issueId, null, 'STATUS_CHANGE', `Status: ${from} → PENDING_VERIFICATION`, { from, to: 'PENDING_VERIFICATION' });
      notifyAdmins(draft, `Verification needed: ${iss.ticketNo}`, `${CATEGORY_META[iss.category].label} · AI pre-check: ${assessment.outcome.replace('_', ' ')}`, 'ADMIN_ALERT', '/admin/verification');
      notify(draft, iss.reporterId, `Repair submitted for ${iss.ticketNo}`, 'Evidence is awaiting admin verification. You will be notified when it is approved.', 'STATUS_UPDATE', '/citizen/reports');
    });

    return { outcome: assessment.outcome };
  };

  // ─────────────────────── ADMIN ───────────────────────
  const approveReview: StoreValue['approveReview'] = async (issueId, priority, priorityReason) => {
    if (!priorityReason.trim()) throw new Error('A reason is required when setting priority');
    if (backendOnline) {
      await api.approveReview(Number(issueId), { priority, priority_reason: priorityReason.trim() });
      await syncBackendData();
      return;
    }

    const cur = dbRef.current;
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

  const rejectReport: StoreValue['rejectReport'] = async (issueId, reason) => {
    if (reason.trim().length < 6) throw new Error('Give a clear rejection reason (min 6 chars)');
    if (backendOnline) {
      await api.rejectReport(Number(issueId), reason.trim());
      await syncBackendData();
      return;
    }

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

  const setPriority: StoreValue['setPriority'] = async (issueId, priority, reason) => {
    if (!reason.trim()) throw new Error('A reason is required');
    if (backendOnline) {
      const score = priority === 'CRITICAL' ? 88.0 : priority === 'HIGH' ? 68.0 : priority === 'MEDIUM' ? 50.0 : 30.0;
      await api.setPriorityOverride(Number(issueId), score, reason.trim());
      await syncBackendData();
      return;
    }

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
    if (backendOnline) {
      void api.autoAssign(Number(issueId)).then(() => syncBackendData()).catch(e => console.warn('autoAssign backend error', e));
    }

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

  const assignWorker: StoreValue['assignWorker'] = async (issueId, workerId, note) => {
    if (backendOnline) {
      await api.manualAssign(Number(issueId), Number(workerId), note || '');
      await syncBackendData();
      return;
    }

    mutate(draft => {
      const admin = currentUser!;
      performAssignment(draft, issueId, workerId, 'ADMIN', { id: admin.id, name: admin.name }, note);
    });
  };

  const unassign: StoreValue['unassign'] = async (issueId, note) => {
    if (backendOnline) {
      await api.unassign(Number(issueId), note || '');
      await syncBackendData();
      return;
    }

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

  const mergeDuplicate: StoreValue['mergeDuplicate'] = async (issueId, targetIssueId) => {
    if (issueId === targetIssueId) throw new Error('Cannot merge an issue into itself');
    if (backendOnline) {
      await api.mergeDuplicate(Number(issueId), Number(targetIssueId));
      await syncBackendData();
      return;
    }

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

  const unmergeDuplicate: StoreValue['unmergeDuplicate'] = async issueId => {
    if (backendOnline) {
      await api.unmergeDuplicate(Number(issueId));
      await syncBackendData();
      return;
    }

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

  const approveVerification: StoreValue['approveVerification'] = async (issueId, note) => {
    if (backendOnline) {
      await api.decideVerification(Number(issueId), 'APPROVED', note);
      await syncBackendData();
      return;
    }

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

  const requestRework: StoreValue['requestRework'] = async (issueId, note) => {
    if (note.trim().length < 6) throw new Error('Describe what needs rework (min 6 chars)');
    if (backendOnline) {
      await api.decideVerification(Number(issueId), 'REWORK_REQUESTED', note.trim());
      await syncBackendData();
      return;
    }

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
    if (backendOnline) {
      try {
        const deptId = input.departmentId === 'dept_street' ? 2 : 1;
        const res = await api.createWorker({
          name: input.name,
          email: input.email,
          phone: input.phone,
          password: input.password,
          department_id: deptId,
          skills: input.skills,
          zones: input.zones,
          availability: input.availability,
          max_concurrent_jobs: input.maxConcurrentJobs,
          base_lat: input.baseLat,
          base_lng: input.baseLng,
        });
        await syncBackendData();
        return { ok: true, workerId: String(res.id) };
      } catch (err: unknown) {
        return { ok: false, error: err instanceof Error ? err.message : 'Failed to create worker' };
      }
    }

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

  const updateWorker: StoreValue['updateWorker'] = async (workerId, patch) => {
    if (backendOnline) {
      await api.updateWorker(Number(workerId), patch as any);
      await syncBackendData();
      return;
    }

    mutate(draft => {
      const worker = draft.workers.find(w => w.id === workerId);
      if (!worker) throw new Error('Worker not found');
      const { name, phone, ...profilePatch } = patch;
      Object.assign(worker, profilePatch);
      if (name || phone) {
        const u = draft.users.find(u => u.id === worker.userId);
        if (u) { if (name) u.name = name; if (phone) u.phone = phone; }
      }
    });
  };

  const setWorkerActive: StoreValue['setWorkerActive'] = async (workerId, active) => {
    if (backendOnline) {
      await api.setWorkerActive(Number(workerId), active);
      await syncBackendData();
      return;
    }

    mutate(draft => {
      const worker = draft.workers.find(w => w.id === workerId);
      if (!worker) throw new Error('Worker not found');
      const u = draft.users.find(u => u.id === worker.userId);
      if (u) u.active = active;
      if (!active) worker.availability = 'OFFLINE';
    });
  };

  const importWorkersCsv: StoreValue['importWorkersCsv'] = async csvText => {
    if (backendOnline) {
      const blob = new Blob([csvText], { type: 'text/csv' });
      const file = new File([blob], 'workers.csv', { type: 'text/csv' });
      const res = await api.importWorkersCsv(file);
      await syncBackendData();
      return res;
    }

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

        if (name.length < 2) throw new Error('name too short');
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
