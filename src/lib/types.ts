// ─────────────────────────────────────────────────────────────
// CIVICXON — Domain model (source of truth for the in-browser engine
// and mirrored by the FastAPI + PostgreSQL backend in /backend)
// ─────────────────────────────────────────────────────────────

export type Role = 'citizen' | 'worker' | 'admin';

export type IssueStatus =
  | 'REPORTED'
  | 'UNDER_REVIEW'
  | 'ASSIGNED'
  | 'IN_PROGRESS'
  | 'PENDING_VERIFICATION'
  | 'VERIFIED'
  | 'REJECTED'
  | 'DUPLICATE'
  | 'REWORK_REQUIRED'
  | 'CANCELLED';

export type Priority = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type IssueCategory = 'pothole' | 'streetlight';
export type Availability = 'AVAILABLE' | 'BUSY' | 'OFFLINE' | 'ON_LEAVE';
export type Skill = 'road_maintenance' | 'streetlight_maintenance';
export type MediaType = 'BEFORE' | 'AFTER';
export type AssignmentSource = 'AUTO' | 'ADMIN';
export type AssignmentStatus = 'ACTIVE' | 'SUPERSEDED';
export type VerificationOutcome = 'likely_resolved' | 'not_resolved' | 'uncertain';
export type VerificationDecision = 'APPROVED' | 'REWORK_REQUESTED';

export interface User {
  id: string;
  name: string;
  email: string;
  phone: string;
  role: Role;
  passwordHash: string;
  salt: string;
  iterations: number;
  active: boolean;
  failedAttempts: number;
  lockedUntil: number | null;
  createdAt: number;
  lastLoginAt: number | null;
}

export interface WorkerProfile {
  id: string;
  userId: string;
  departmentId: string;
  skills: Skill[];
  zones: string[];
  availability: Availability;
  currentLoad: number;
  maxConcurrentJobs: number;
  rating: number;
  jobsCompleted: number;
  baseLat: number;
  baseLng: number;
  joinedAt: number;
}

export interface Department {
  id: string;
  code: string;
  name: string;
  handles: IssueCategory[];
  description: string;
  demoIntegration: boolean;
  contactEmail: string;
  head: string;
}

export interface Zone {
  id: string;
  name: string;
  lat: number;
  lng: number;
  radiusKm: number;
}

export interface AIAnalysis {
  provider: 'gemma-4' | 'heuristic' | 'mock-dev';
  model?: string;
  category: IssueCategory;
  severity: 'low' | 'moderate' | 'severe' | 'critical';
  description: string;
  riskIndicators: string[];
  confidence: number; // 0..1
  departmentSuggestion: string;
  explanation: string;
  analysedAt: number;
}

export interface IssueDuplicateHint {
  issueId: string;
  ticketNo: string;
  combined: number;
  distanceKm: number;
  reasons: string[];
}

export interface Issue {
  id: string;
  ticketNo: string;
  category: IssueCategory;
  description: string;
  voiceNote?: string;
  status: IssueStatus;
  priority: Priority;
  priorityReason: string | null;
  reporterId: string;
  reporterName: string;
  citizenPhone: string;
  address: string;
  lat: number;
  lng: number;
  zone: string;
  departmentId: string | null;
  assignedWorkerId: string | null;
  duplicateOfId: string | null;
  ai: AIAnalysis | null;
  createdAt: number;
  updatedAt: number;
  assignedAt: number | null;
  startedAt: number | null;
  resolvedAt: number | null;
  verifiedAt: number | null;
  rejectedReason: string | null;
  reworkCount: number;
  duplicateHints?: IssueDuplicateHint[];
}

export interface Media {
  id: string;
  issueId: string;
  type: MediaType;
  storageKey: string; // opaque object reference (data URL in local dev)
  caption: string;
  uploadedBy: string;
  uploadedAt: number;
  phash?: string | null; // perceptual hash (aHash) for image similarity
}

export interface IssueEvent {
  id: string;
  issueId: string;
  at: number;
  actorId: string | null;
  actorName: string;
  actorRole: Role | 'system' | 'ai';
  type:
    | 'CREATED' | 'AI_ANALYSIS' | 'STATUS_CHANGE' | 'PRIORITY_SET' | 'NOTE'
    | 'ASSIGNED' | 'REASSIGNED' | 'DUPLICATE_FLAGGED' | 'DUPLICATE_MERGED'
    | 'EVIDENCE_SUBMITTED' | 'VERIFICATION_REVIEW' | 'VERIFICATION_DECISION'
    | 'REJECTED' | 'CANCELLED' | 'REWORK_REQUESTED' | 'NO_WORKER_AVAILABLE'
    | 'WORK_STARTED' | 'SETTINGS_CHANGED';
  message: string;
  meta?: Record<string, unknown>;
}

export interface ScoreBreakdown {
  skill: number;
  distance: number;
  workload: number;
  availability: number;
  total: number;
  distanceKm: number;
}

export interface Assignment {
  id: string;
  issueId: string;
  workerId: string;
  workerName: string;
  score: number;
  breakdown: ScoreBreakdown;
  reason: string;
  source: AssignmentSource;
  createdById: string | null;
  createdByName: string;
  status: AssignmentStatus;
  createdAt: number;
}

export interface VerificationReview {
  id: string;
  issueId: string;
  provider: 'gemma-4' | 'heuristic' | 'mock-dev';
  model?: string;
  outcome: VerificationOutcome;
  explanation: string;
  limitations: string;
  confidence: number;
  comparedMediaIds: [string, string];
  reviewerName: string;
  createdAt: number;
  adminDecision: VerificationDecision | null;
  adminNote: string | null;
  decidedAt: number | null;
  decidedById: string | null;
  decidedByName: string | null;
}

export type NotificationType =
  | 'REPORT_RECEIVED' | 'STATUS_UPDATE' | 'ASSIGNED' | 'REWORK'
  | 'VERIFIED' | 'REJECTED' | 'ADMIN_ALERT' | 'WORKER_JOB' | 'GENERAL';

export interface AppNotification {
  id: string;
  userId: string;
  title: string;
  body: string;
  type: NotificationType;
  read: boolean;
  at: number;
  link?: string;
}

export interface AppSettings {
  weights: { skill: number; distance: number; workload: number; availability: number };
  autoAssign: boolean;
  aiProvider: 'gemma-4' | 'heuristic' | 'mock-dev';
  gemmaModel: string;
  gemmaApiKey: string; // entered by admin in browser Settings — never committed, never logged
  gemmaEndpoint: string;
  mockLabel: string;
}

export interface Database {
  version: number;
  seeded: boolean;
  users: User[];
  workers: WorkerProfile[];
  departments: Department[];
  zones: Zone[];
  issues: Issue[];
  media: Media[];
  events: IssueEvent[];
  assignments: Assignment[];
  verifications: VerificationReview[];
  notifications: AppNotification[];
  settings: AppSettings;
}

export interface Session {
  token: string;
  userId: string;
  role: Role;
  issuedAt: number;
  expiresAt: number;
}

export const ISSUE_STATUS_META: Record<IssueStatus, { label: string; tone: string; step: number }> = {
  REPORTED: { label: 'Reported', tone: 'slate', step: 1 },
  UNDER_REVIEW: { label: 'Under Review', tone: 'amber', step: 2 },
  ASSIGNED: { label: 'Assigned', tone: 'blue', step: 3 },
  IN_PROGRESS: { label: 'In Progress', tone: 'cyan', step: 4 },
  PENDING_VERIFICATION: { label: 'Pending Verification', tone: 'violet', step: 5 },
  VERIFIED: { label: 'Verified & Resolved', tone: 'emerald', step: 6 },
  REJECTED: { label: 'Rejected', tone: 'rose', step: 0 },
  DUPLICATE: { label: 'Duplicate', tone: 'gray', step: 0 },
  REWORK_REQUIRED: { label: 'Rework Required', tone: 'orange', step: 4 },
  CANCELLED: { label: 'Cancelled', tone: 'gray', step: 0 },
};

export const PRIORITY_META: Record<Priority, { label: string; tone: string }> = {
  LOW: { label: 'Low', tone: 'slate' },
  MEDIUM: { label: 'Medium', tone: 'amber' },
  HIGH: { label: 'High', tone: 'orange' },
  CRITICAL: { label: 'Critical', tone: 'rose' },
};

export const SKILL_LABEL: Record<Skill, string> = {
  road_maintenance: 'Road Maintenance',
  streetlight_maintenance: 'Streetlight Maintenance',
};

export const CATEGORY_META: Record<IssueCategory, { label: string; skill: Skill; departmentCode: string }> = {
  pothole: { label: 'Pothole / Road Damage', skill: 'road_maintenance', departmentCode: 'ROAD' },
  streetlight: { label: 'Streetlight Fault', skill: 'streetlight_maintenance', departmentCode: 'STREET' },
};

export const AVAILABILITY_META: Record<Availability, { label: string; tone: string }> = {
  AVAILABLE: { label: 'Available', tone: 'emerald' },
  BUSY: { label: 'Busy', tone: 'amber' },
  OFFLINE: { label: 'Offline', tone: 'gray' },
  ON_LEAVE: { label: 'On Leave', tone: 'rose' },
};
