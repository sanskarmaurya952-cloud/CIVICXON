/**
 * CIVICXON Typed Frontend API Client.
 *
 * Connects the frontend UI directly to the FastAPI backend.
 * Reads VITE_API_BASE_URL from environment (default: http://localhost:8000).
 * Manages JWT tokens, handles error parsing, request timeouts, and multipart uploads.
 */

export const API_BASE = (
  import.meta.env.VITE_API_BASE_URL ||
  (import.meta.env.PROD ? 'https://civicxon-api.onrender.com' : 'http://localhost:8000')
).replace(/\/$/, '');

const TOKEN_STORAGE_KEY = 'civicxon_token';
const USER_STORAGE_KEY = 'civicxon_user';

export interface ApiUser {
  id: number;
  name: string;
  email: string;
  phone: string;
  role: 'citizen' | 'worker' | 'admin';
}

export interface AuthResponse {
  access_token: string;
  token_type: string;
  role: 'citizen' | 'worker' | 'admin';
  name: string;
  id: number;
}

export interface DuplicateHint {
  issue_id: number;
  ticket_no: string;
  distance_km: number;
  distance_m: number;
  category_match: boolean;
  text_similarity: number;
  image_similarity: number | null;
  combined: number;
  classification: 'SAME_ISSUE' | 'POSSIBLE_DUPLICATE' | 'DISTINCT_ISSUE';
  description: string;
}

export interface ApiIssueSummary {
  id: number;
  ticket_no: string;
  category: 'pothole' | 'streetlight';
  status: string;
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  priority_score: number;
  priority_band: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  priority_breakdown: Record<string, { value: number; weight: number; weighted: number; source: string }> | null;
  priority_override: Record<string, unknown> | null;
  priority_reason: string | null;
  description: string;
  address: string;
  lat: number;
  lng: number;
  zone: string;
  reporter_id: number;
  assigned_worker_id: number | null;
  duplicate_of_id: number | null;
  report_count: number;
  rework_count: number;
  ai_analysis: Record<string, unknown> | null;
  rejected_reason: string | null;
  created_at: string;
  updated_at: string;
  assigned_at: string | null;
  started_at: string | null;
  resolved_at: string | null;
  verified_at: string | null;
  media: Array<{ id: number; type: 'BEFORE' | 'AFTER'; storage_key: string; url: string; caption: string }>;
  citizen_reports: Array<{ id: number; ticket_no: string; reporter_id: number; description: string; address: string; lat: number; lng: number; media_url: string | null; created_at: string; status: string }>;
}

export class ApiError extends Error {
  status: number;
  detail: string;
  constructor(status: number, detail: string) {
    super(detail);
    this.name = 'ApiError';
    this.status = status;
    this.detail = detail;
  }
}

export function getStoredToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setStoredToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_STORAGE_KEY, token);
    else localStorage.removeItem(TOKEN_STORAGE_KEY);
  } catch {
    // Ignore localStorage unavailable
  }
}

export function getStoredUser(): ApiUser | null {
  try {
    const raw = localStorage.getItem(USER_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function setStoredUser(user: ApiUser | null): void {
  try {
    if (user) localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(user));
    else localStorage.removeItem(USER_STORAGE_KEY);
  } catch {
    // Ignore
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const url = `${API_BASE}${path}`;
  const headers = new Headers(options.headers || {});

  const token = getStoredToken();
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  // Set Content-Type only if not sending FormData
  if (!(options.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  let res: Response;
  try {
    res = await fetch(url, { ...options, headers });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new ApiError(0, `Cannot connect to CIVICXON server at ${API_BASE} (${msg}). Is the backend running?`);
  }

  if (res.status === 401) {
    // Expired or invalid token
    setStoredToken(null);
    setStoredUser(null);
  }

  if (!res.ok) {
    let detail = `Server responded with status ${res.status}`;
    try {
      const data = await res.json();
      if (typeof data.detail === 'string') detail = data.detail;
      else if (Array.isArray(data.detail)) detail = data.detail.map((e: { msg?: string }) => e.msg || JSON.stringify(e)).join(', ');
      else if (data.message) detail = data.message;
    } catch {
      // Body not JSON
    }
    throw new ApiError(res.status, detail);
  }

  return res.json() as Promise<T>;
}

export const api = {
  // Auth
  async login(email: string, password: string): Promise<AuthResponse> {
    const data = await request<AuthResponse>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
    });
    setStoredToken(data.access_token);
    setStoredUser({ id: data.id, name: data.name, email: email.trim().toLowerCase(), phone: '', role: data.role });
    return data;
  },

  async registerCitizen(name: string, email: string, phone: string, password: string): Promise<AuthResponse> {
    const data = await request<AuthResponse>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ name: name.trim(), email: email.trim().toLowerCase(), phone: phone.trim(), password }),
    });
    setStoredToken(data.access_token);
    setStoredUser({ id: data.id, name: data.name, email: email.trim().toLowerCase(), phone: phone.trim(), role: data.role });
    return data;
  },

  async bootstrapAdmin(name: string, email: string, phone: string, password: string): Promise<AuthResponse> {
    const data = await request<AuthResponse>('/api/auth/bootstrap-admin', {
      method: 'POST',
      body: JSON.stringify({ name: name.trim(), email: email.trim().toLowerCase(), phone: phone.trim(), password }),
    });
    setStoredToken(data.access_token);
    setStoredUser({ id: data.id, name: data.name, email: email.trim().toLowerCase(), phone: phone.trim(), role: data.role });
    return data;
  },

  async getMe(): Promise<ApiUser> {
    const user = await request<ApiUser>('/api/auth/me');
    setStoredUser(user);
    return user;
  },

  logout(): void {
    setStoredToken(null);
    setStoredUser(null);
  },

  // Health
  async getHealth(): Promise<{ status: string; service: string; storage: string; ai_provider: string }> {
    return request('/api/health');
  },

  // Issues & Citizen Reports
  async listIssues(filters: { status?: string; category?: string; priority?: string; zone?: string; q?: string; sort_by?: string; order?: string } = {}): Promise<ApiIssueSummary[]> {
    const params = new URLSearchParams();
    if (filters.status) params.set('status', filters.status);
    if (filters.category) params.set('category', filters.category);
    if (filters.priority) params.set('priority', filters.priority);
    if (filters.zone) params.set('zone', filters.zone);
    if (filters.q) params.set('q', filters.q);
    if (filters.sort_by) params.set('sort_by', filters.sort_by);
    if (filters.order) params.set('order', filters.order);

    const query = params.toString() ? `?${params.toString()}` : '';
    return request<ApiIssueSummary[]>(`/api/issues${query}`);
  },

  async getIssue(id: number): Promise<ApiIssueSummary> {
    return request<ApiIssueSummary>(`/api/issues/${id}`);
  },

  async getIssueEvents(id: number): Promise<Array<{ id: number; at: string; actor_name: string; actor_role: string; type: string; message: string; meta: Record<string, unknown> | null }>> {
    return request(`/api/issues/${id}/events`);
  },

  async createIssue(formData: FormData): Promise<{ id: number; ticket_no: string; priority_score: number; priority_band: string; duplicate_hints: DuplicateHint[]; linked_to_master?: boolean; master_ticket_no?: string }> {
    return request('/api/issues', {
      method: 'POST',
      body: formData,
    });
  },

  async addNote(issueId: number, note: string): Promise<{ ok: boolean }> {
    const body = new FormData();
    body.append('note', note);
    return request(`/api/issues/${issueId}/notes`, { method: 'POST', body });
  },

  async cancelIssue(issueId: number, reason = ''): Promise<{ ok: boolean; status: string }> {
    const body = new FormData();
    body.append('reason', reason);
    return request(`/api/issues/${issueId}/cancel`, { method: 'POST', body });
  },

  // Worker Portal
  async getWorkerJobs(): Promise<Array<{
    id: number;
    ticket_no: string;
    category: string;
    status: string;
    priority: string;
    priority_score: number;
    priority_band: string;
    description: string;
    address: string;
    lat: number;
    lng: number;
    zone: string;
    report_count: number;
    rework_count: number;
    assigned_at: string | null;
    started_at: string | null;
    before_photo: string | null;
    after_photo: string | null;
    media: Array<{ id: number; type: string; url: string; caption: string }>;
    latest_review: { outcome: string; confidence: number; explanation: string; limitations: string; admin_decision: string | null; admin_note: string | null } | null;
  }>> {
    return request('/api/worker/jobs');
  },

  async startWork(issueId: number): Promise<{ ok: boolean; status: string }> {
    return request(`/api/worker/jobs/${issueId}/start`, { method: 'POST' });
  },

  async submitEvidence(issueId: number, formData: FormData): Promise<{ ok: boolean; verification: { outcome: string; provider: string; confidence: number; explanation: string; limitations: string } }> {
    return request(`/api/worker/jobs/${issueId}/evidence`, {
      method: 'POST',
      body: formData,
    });
  },

  // Admin Portal
  async getAdminDashboard(): Promise<{
    total: number;
    by_status: Record<string, number>;
    by_priority: Record<string, number>;
    by_category: Record<string, number>;
    unassigned: number;
    critical_open: number;
    workers_active: number;
    workers_available: number;
    total_citizen_reports: number;
    verification_queue: number;
    rework_required: number;
    in_progress: number;
    avg_resolution_hours: number;
  }> {
    return request('/api/admin/dashboard');
  },

  async approveReview(issueId: number, payload: { priority: string; priority_reason: string; override_score?: number }): Promise<{ ok: boolean; status: string; priority_score: number; priority_band: string; auto_assigned: { worker_id: number; worker_name: string; score: number } | null }> {
    return request(`/api/admin/issues/${issueId}/approve-review`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async setPriorityOverride(issueId: number, score: number, reason: string): Promise<{ ok: boolean; score: number; band: string }> {
    return request(`/api/admin/issues/${issueId}/priority-override`, {
      method: 'POST',
      body: JSON.stringify({ score, reason }),
    });
  },

  async rejectReport(issueId: number, reason: string): Promise<{ ok: boolean }> {
    return request(`/api/admin/issues/${issueId}/reject?reason=${encodeURIComponent(reason)}`, {
      method: 'POST',
    });
  },

  async autoAssign(issueId: number): Promise<{ assigned: boolean; eligible_count: number; worker_id?: number; worker_name?: string; score?: number }> {
    return request(`/api/admin/issues/${issueId}/auto-assign`, { method: 'POST' });
  },

  async manualAssign(issueId: number, workerId: number, note = ''): Promise<{ ok: boolean; score: number }> {
    const query = note ? `?note=${encodeURIComponent(note)}` : '';
    return request(`/api/admin/issues/${issueId}/assign/${workerId}${query}`, { method: 'POST' });
  },

  async unassign(issueId: number, note = ''): Promise<{ ok: boolean }> {
    const query = note ? `?note=${encodeURIComponent(note)}` : '';
    return request(`/api/admin/issues/${issueId}/unassign${query}`, { method: 'POST' });
  },

  async mergeDuplicate(issueId: number, targetIssueId: number, reason = ''): Promise<{ ok: boolean; target_report_count: number; target_priority_score: number }> {
    const query = reason ? `?reason=${encodeURIComponent(reason)}` : '';
    return request(`/api/admin/issues/${issueId}/merge/${targetIssueId}${query}`, { method: 'POST' });
  },

  async unmergeDuplicate(issueId: number, reason = ''): Promise<{ ok: boolean; status: string }> {
    const query = reason ? `?reason=${encodeURIComponent(reason)}` : '';
    return request(`/api/admin/issues/${issueId}/unmerge${query}`, { method: 'POST' });
  },

  async getVerificationQueue(): Promise<Array<{
    id: number;
    ticket_no: string;
    category: string;
    description: string;
    address: string;
    zone: string;
    priority: string;
    priority_score: number;
    report_count: number;
    rework_count: number;
    worker_name: string;
    before_photo: string | null;
    after_photo: string | null;
    media: Array<{ id: number; type: string; url: string; caption: string }>;
    ai_review: { outcome: string; confidence: number; explanation: string; limitations: string; provider: string } | null;
    updated_at: string;
  }>> {
    return request('/api/admin/verification-queue');
  },

  async decideVerification(issueId: number, decision: 'APPROVED' | 'REWORK_REQUESTED', note = ''): Promise<{ ok: boolean; status: string }> {
    return request(`/api/admin/issues/${issueId}/verification`, {
      method: 'POST',
      body: JSON.stringify({ decision, note }),
    });
  },

  async listWorkers(): Promise<Array<{
    id: number;
    user_id: number;
    name: string;
    email: string;
    phone: string;
    active: boolean;
    department_id: number;
    skills: string[];
    zones: string[];
    availability: string;
    current_load: number;
    max_concurrent_jobs: number;
    rating: number;
    jobs_completed: number;
    base_lat: number;
    base_lng: number;
  }>> {
    return request('/api/workers');
  },

  async createWorker(worker: {
    name: string;
    email: string;
    phone: string;
    password: string;
    department_id: number;
    skills: string[];
    zones: string[];
    availability?: string;
    max_concurrent_jobs?: number;
    base_lat?: number;
    base_lng?: number;
  }): Promise<{ id: number; user_id: number }> {
    return request('/api/workers', {
      method: 'POST',
      body: JSON.stringify(worker),
    });
  },

  async updateWorker(workerId: number, patch: {
    name?: string;
    phone?: string;
    skills?: string[];
    zones?: string[];
    availability?: string;
    max_concurrent_jobs?: number;
    rating?: number;
    base_lat?: number;
    base_lng?: number;
    department_id?: number;
  }): Promise<{ ok: boolean }> {
    return request(`/api/workers/${workerId}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
  },

  async setWorkerActive(workerId: number, active: boolean): Promise<{ ok: boolean; active: boolean }> {
    return request(`/api/workers/${workerId}/active/${active}`, { method: 'POST' });
  },

  async importWorkersCsv(file: File): Promise<{ created: number; skipped: number; errors: Array<{ row: number; message: string }> }> {
    const formData = new FormData();
    formData.append('file', file);
    return request('/api/workers/import', { method: 'POST', body: formData });
  },

  exportWorkersCsvUrl(): string {
    const token = getStoredToken();
    return `${API_BASE}/api/workers/export${token ? `?token=${encodeURIComponent(token)}` : ''}`;
  },

  async getAdminAuditLogs(limit = 100): Promise<Array<{
    id: number;
    action: string;
    actor_name: string;
    actor_role: string;
    target_type: string;
    target_id: number | null;
    details: Record<string, unknown> | null;
    created_at: string;
  }>> {
    return request(`/api/admin/audit-logs?limit=${limit}`);
  },

  async getAdminAnalytics(): Promise<{
    by_day: Array<{ date: string; count: number }>;
    avg_resolution_hours: number;
    rework_rate_pct: number;
    duplicate_savings_count: number;
    total_master_issues: number;
    total_citizen_reports: number;
  }> {
    return request('/api/admin/analytics');
  },
};
