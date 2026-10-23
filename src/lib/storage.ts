// Persistence layer.
//
// The browser build persists the database document to localStorage and keeps
// a versioned in-memory copy. The PostgreSQL + SQLAlchemy schema that the
// FastAPI backend uses (see /backend/migrations) is the production equivalent;
// table-per-entity, PostGIS geography columns, FK constraints, indexes.
//
// A storage-event style pub/sub keeps all tabs of the demo in sync.

import type { Database } from './types';

const DB_KEY = 'civicxon.db.v1';
const SESSION_KEY = 'civicxon.session.v1';

export function loadDatabase(): Database | null {
  try {
    const raw = localStorage.getItem(DB_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Database;
    if (parsed.version !== 1) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function persistDatabase(db: Database): void {
  try {
    localStorage.setItem(DB_KEY, JSON.stringify(db));
  } catch (err) {
    // Quota exceeded — surface a readable error rather than silent corruption
    console.error('CIVICXON persist failed', err);
    throw new Error('Browser storage is full. Export or clear old media, then retry.');
  }
}

export function wipeDatabase(): void {
  localStorage.removeItem(DB_KEY);
  localStorage.removeItem(SESSION_KEY);
}

export function loadSession<T>(): T | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function persistSession(session: unknown | null): void {
  if (session === null) localStorage.removeItem(SESSION_KEY);
  else localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export function resetSeedDatabase(): void {
  localStorage.removeItem(DB_KEY);
}
