// ─────────────────────────────────────────────────────────────
// Smart worker allocation — DETERMINISTIC backend rules.
// Eligibility: active skill match + availability + capacity + zone.
// Ranking: configurable weights over skill/distance/workload/availability.
// AI never decides assignment — it may only explain a decision after the fact.
// ─────────────────────────────────────────────────────────────

import type { AppSettings, Assignment, Issue, ScoreBreakdown, Skill, WorkerProfile } from './types';
import { haversineKm } from './geo';
import { uid } from './config';

export interface RankedCandidate {
  worker: WorkerProfile;
  rank: number;
  eligible: boolean;
  ineligibleReasons: string[];
  breakdown: ScoreBreakdown;
  reason: string;
}

export interface RankingResult {
  ranked: RankedCandidate[];
  eligibleCount: number;
}

const SKILL_SCORE: Record<string, number> = { exact: 1.0, related: 0.55, none: 0 };

export function skillMatchScore(workerSkills: Skill[], required: Skill): number {
  if (workerSkills.includes(required)) return SKILL_SCORE.exact;
  // Road and streetlight crews occasionally cover minor electrical/surface work
  return 0;
}

export function distanceScore(distanceKm: number, maxKm = 15): number {
  if (distanceKm <= 0.5) return 1.0;
  if (distanceKm >= maxKm) return 0.05;
  return Math.max(0.05, 1 - distanceKm / maxKm);
}

export function workloadScore(currentLoad: number, maxConcurrentJobs: number): number {
  const cap = Math.max(1, maxConcurrentJobs);
  const ratio = currentLoad / cap;
  return Math.max(0, 1 - ratio);
}

export function availabilityScore(availability: WorkerProfile['availability']): number {
  switch (availability) {
    case 'AVAILABLE': return 1.0;
    case 'BUSY': return 0.35;
    case 'OFFLINE': return 0;
    case 'ON_LEAVE': return 0;
  }
}

/**
 * Filter eligible workers and rank them. Pure function — safe to run inside a
 * transaction. Eligibility is enforced by rules, never by a model.
 */
export function rankWorkers(input: {
  workers: WorkerProfile[];
  workerActive: (w: WorkerProfile) => boolean; // user.active check
  issue: Issue;
  requiredSkill: Skill;
  weights: AppSettings['weights'];
}): RankingResult {
  const { workers, workerActive, issue, requiredSkill, weights } = input;
  const weightSum = Math.max(0.0001, weights.skill + weights.distance + weights.workload + weights.availability);

  const candidates: RankedCandidate[] = workers.map(w => {
    const distanceKm = haversineKm(issue.lat, issue.lng, w.baseLat, w.baseLng);
    const breakdown: ScoreBreakdown = {
      skill: Math.round(skillMatchScore(w.skills, requiredSkill) * 1000) / 10,
      distance: Math.round(distanceScore(distanceKm) * 1000) / 10,
      workload: Math.round(workloadScore(w.currentLoad, w.maxConcurrentJobs) * 1000) / 10,
      availability: Math.round(availabilityScore(w.availability) * 1000) / 10,
      total: 0,
      distanceKm: Math.round(distanceKm * 100) / 100,
    };
    const ineligibleReasons: string[] = [];
    if (!workerActive(w)) ineligibleReasons.push('account is deactivated');
    if (!w.skills.includes(requiredSkill)) ineligibleReasons.push(`missing required skill (${requiredSkill.replace('_', ' ')})`);
    if (w.availability === 'OFFLINE' || w.availability === 'ON_LEAVE') ineligibleReasons.push('not available (offline/on leave)');
    if (w.currentLoad >= w.maxConcurrentJobs) ineligibleReasons.push('at maximum concurrent jobs');
    if (!w.zones.includes(issue.zone)) ineligibleReasons.push(`outside service zone (${issue.zone})`);

    if (ineligibleReasons.length === 0) {
      breakdown.total = Math.round(
        ((weights.skill / weightSum) * breakdown.skill +
          (weights.distance / weightSum) * breakdown.distance +
          (weights.workload / weightSum) * breakdown.workload +
          (weights.availability / weightSum) * breakdown.availability) * 10,
      ) / 10;
    }

    const reason = ineligibleReasons.length
      ? `Ineligible: ${ineligibleReasons.join('; ')}`
      : `Skill match ${breakdown.skill.toFixed(0)} · ${breakdown.distanceKm.toFixed(1)} km (${breakdown.distance.toFixed(0)}) · load ${w.currentLoad}/${w.maxConcurrentJobs} (${breakdown.workload.toFixed(0)}) · ${w.availability.toLowerCase()} (${breakdown.availability.toFixed(0)}) ⇒ score ${breakdown.total.toFixed(1)}`;

    return { worker: w, rank: 0, eligible: ineligibleReasons.length === 0, ineligibleReasons, breakdown, reason };
  });

  const eligible = candidates.filter(c => c.eligible).sort((a, b) => b.breakdown.total - a.breakdown.total);
  eligible.forEach((c, i) => (c.rank = i + 1));
  const ineligible = candidates.filter(c => !c.eligible);

  return { ranked: [...eligible, ...ineligible], eligibleCount: eligible.length };
}

/** Build an Assignment record from a ranked candidate. */
export function buildAssignment(input: {
  candidate: RankedCandidate;
  issueId: string;
  workerName: string;
  source: 'AUTO' | 'ADMIN';
  createdById: string | null;
  createdByName: string;
}): Assignment {
  return {
    id: uid('as_'),
    issueId: input.issueId,
    workerId: input.candidate.worker.id,
    workerName: input.workerName,
    score: input.candidate.breakdown.total,
    breakdown: input.candidate.breakdown,
    reason: input.candidate.reason,
    source: input.source,
    createdById: input.createdById,
    createdByName: input.createdByName,
    status: 'ACTIVE',
    createdAt: Date.now(),
  };
}
