import { describe, it, expect } from 'vitest';
import { canTransition, assertTransition, textSimilarity, findDuplicates } from '../src/lib/workflow';
import { rankWorkers, skillMatchScore, distanceScore, workloadScore, availabilityScore } from '../src/lib/scoring';
import { hammingDistance, imageSimilarity } from '../src/lib/config';
import { describePasswordPolicy } from '../src/lib/crypto';
import type { Issue, Media, WorkerProfile } from '../src/lib/types';

const weights = { skill: 45, distance: 25, workload: 20, availability: 10 };

function mkWorker(patch: Partial<WorkerProfile>): WorkerProfile {
  return {
    id: 'w1', userId: 'u1', departmentId: 'd1', skills: ['road_maintenance'], zones: ['Central'],
    availability: 'AVAILABLE', currentLoad: 1, maxConcurrentJobs: 3, rating: 4.5, jobsCompleted: 10,
    baseLat: 12.97, baseLng: 77.59, joinedAt: 0, ...patch,
  };
}
function mkIssue(patch: Partial<Issue> = {}): Issue {
  return {
    id: 'i_main', ticketNo: 'CX-1', category: 'pothole', description: 'Deep pothole near signal', status: 'UNDER_REVIEW',
    priority: 'HIGH', priorityReason: null, reporterId: 'r1', reporterName: 'Rep', citizenPhone: '123', address: 'addr',
    lat: 12.975, lng: 77.6, zone: 'Central', departmentId: null, assignedWorkerId: null, duplicateOfId: null,
    ai: null, createdAt: 0, updatedAt: 0, assignedAt: null, startedAt: null, resolvedAt: null, verifiedAt: null,
    rejectedReason: null, reworkCount: 0, ...patch,
  };
}

describe('Workflow state machine', () => {
  it('allows the happy path REPORTED → UNDER_REVIEW → ASSIGNED → IN_PROGRESS → PENDING_VERIFICATION → VERIFIED', () => {
    expect(canTransition('REPORTED', 'UNDER_REVIEW')).toBe(true);
    expect(canTransition('UNDER_REVIEW', 'ASSIGNED')).toBe(true);
    expect(canTransition('ASSIGNED', 'IN_PROGRESS')).toBe(true);
    expect(canTransition('IN_PROGRESS', 'PENDING_VERIFICATION')).toBe(true);
    expect(canTransition('PENDING_VERIFICATION', 'VERIFIED')).toBe(true);
  });
  it('blocks illegal jumps', () => {
    expect(canTransition('REPORTED', 'VERIFIED')).toBe(false);
    expect(canTransition('PENDING_VERIFICATION', 'IN_PROGRESS')).toBe(false);
    expect(canTransition('VERIFIED', 'ASSIGNED')).toBe(false);
    expect(canTransition('DUPLICATE', 'IN_PROGRESS')).toBe(false);
  });
  it('supports rework loop PENDING_VERIFICATION → REWORK_REQUIRED → IN_PROGRESS', () => {
    expect(canTransition('PENDING_VERIFICATION', 'REWORK_REQUIRED')).toBe(true);
    expect(canTransition('REWORK_REQUIRED', 'IN_PROGRESS')).toBe(true);
  });
  it('assertTransition throws with the from→to pair in the message', () => {
    expect(() => assertTransition('REPORTED', 'VERIFIED')).toThrow(/REPORTED → VERIFIED/);
  });
  it('DUPLICATE can return to UNDER_REVIEW (un-merge)', () => {
    expect(canTransition('DUPLICATE', 'UNDER_REVIEW')).toBe(true);
  });
});

describe('Smart allocation — eligibility rules', () => {
  const issue = mkIssue();
  const active = () => true;
  it('ranks the best eligible worker first (skill + proximity + capacity)', () => {
    const good = mkWorker({ id: 'good', baseLat: 12.975, baseLng: 77.6, currentLoad: 0, availability: 'AVAILABLE' });
    const far = mkWorker({ id: 'far', baseLat: 13.2, baseLng: 77.2, currentLoad: 0 });
    const { ranked, eligibleCount } = rankWorkers({ workers: [good, far], workerActive: active, issue, requiredSkill: 'road_maintenance', weights });
    expect(eligibleCount).toBe(2);
    expect(ranked[0].worker.id).toBe('good');
    expect(ranked[0].breakdown.total).toBeGreaterThan(ranked[1].breakdown.total);
    expect(ranked[0].rank).toBe(1);
  });
  it('filters out workers lacking the required skill', () => {
    const wrong = mkWorker({ id: 'x', skills: ['streetlight_maintenance'] });
    const { eligibleCount, ranked } = rankWorkers({ workers: [wrong], workerActive: active, issue, requiredSkill: 'road_maintenance', weights });
    expect(eligibleCount).toBe(0);
    expect(ranked[0].ineligibleReasons.join(' ')).toMatch(/skill/i);
  });
  it('filters out workers outside the issue zone', () => {
    const outOfZone = mkWorker({ id: 'x', zones: ['West'] });
    const { eligibleCount } = rankWorkers({ workers: [outOfZone], workerActive: active, issue, requiredSkill: 'road_maintenance', weights });
    expect(eligibleCount).toBe(0);
  });
  it('filters out workers at capacity', () => {
    const full = mkWorker({ id: 'x', currentLoad: 3, maxConcurrentJobs: 3 });
    const { eligibleCount } = rankWorkers({ workers: [full], workerActive: active, issue, requiredSkill: 'road_maintenance', weights });
    expect(eligibleCount).toBe(0);
  });
  it('filters out OFFLINE / ON_LEAVE workers', () => {
    const off = mkWorker({ id: 'x', availability: 'ON_LEAVE' });
    expect(rankWorkers({ workers: [off], workerActive: active, issue, requiredSkill: 'road_maintenance', weights }).eligibleCount).toBe(0);
  });
  it('filters out deactivated accounts (workerActive predicate)', () => {
    const w = mkWorker({ id: 'x' });
    expect(rankWorkers({ workers: [w], workerActive: () => false, issue, requiredSkill: 'road_maintenance', weights }).eligibleCount).toBe(0);
  });
  it('score components are bounded 0–100 and distance degrades with km', () => {
    expect(distanceScore(0.2)).toBe(1);
    expect(distanceScore(20)).toBeCloseTo(0.05, 2);
    expect(workloadScore(3, 3)).toBe(0);
    expect(workloadScore(0, 3)).toBe(1);
    expect(availabilityScore('BUSY')).toBeLessThan(availabilityScore('AVAILABLE'));
    expect(skillMatchScore(['road_maintenance'], 'road_maintenance')).toBe(1);
    expect(skillMatchScore(['streetlight_maintenance'], 'road_maintenance')).toBe(0);
  });
  it('reason string records why each candidate ranked where it did', () => {
    const w = mkWorker({});
    const { ranked } = rankWorkers({ workers: [w], workerActive: active, issue, requiredSkill: 'road_maintenance', weights });
    expect(ranked[0].reason).toMatch(/Skill match/);
    expect(ranked[0].reason).toMatch(/score/);
  });
});

describe('Duplicate detection', () => {
  const mediaByIssue = (): Media[] => [];
  it('flags the same category at the same spot', () => {
    const existing = [mkIssue({ id: 'dup', lat: 12.9751, lng: 77.6001, description: 'Deep pothole near signal junction' })];
    const res = findDuplicates({ candidate: { category: 'pothole', description: 'Deep pothole near the signal junction', lat: 12.975, lng: 77.6 }, existing, mediaByIssue });
    expect(res.length).toBe(1);
    expect(res[0].categoryMatch).toBe(true);
    expect(res[0].combined).toBeGreaterThan(0.5);
  });
  it('ignores far-away issues', () => {
    const existing = [mkIssue({ id: 'far', lat: 13.5, lng: 77.9, description: 'Deep pothole near signal junction' })];
    expect(findDuplicates({ candidate: { category: 'pothole', description: 'Deep pothole near signal junction', lat: 12.975, lng: 77.6 }, existing, mediaByIssue })).toHaveLength(0);
  });
  it('ignores closed/merged issues', () => {
    const existing = [mkIssue({ id: 'closed', status: 'DUPLICATE' }), mkIssue({ id: 'rej', status: 'REJECTED' })];
    expect(findDuplicates({ candidate: { category: 'pothole', description: 'Deep pothole near signal junction', lat: 12.975, lng: 77.6 }, existing, mediaByIssue })).toHaveLength(0);
  });
  it('text similarity is symmetric and stopword-robust', () => {
    expect(textSimilarity('deep pothole near the signal junction', 'signal junction deep pothole')).toBeGreaterThan(0.6);
    expect(textSimilarity('completely different words entirely', 'signal junction pothole')).toBe(0);
  });
});

describe('Image perceptual hashing (aHash)', () => {
  it('identical hashes have zero hamming distance and 100% similarity', () => {
    expect(hammingDistance('ff'.repeat(64), 'ff'.repeat(64))).toBe(0);
    expect(imageSimilarity('ff'.repeat(64), 'ff'.repeat(64))).toBe(1);
  });
  it('orthogonal hashes diverge', () => {
    expect(imageSimilarity('00'.repeat(64), 'ff'.repeat(64))).toBeLessThan(0.1);
  });
});

describe('Password policy', () => {
  it('rejects weak passwords with reasons', () => {
    const { ok, problems } = describePasswordPolicy('abc');
    expect(ok).toBe(false);
    expect(problems.length).toBeGreaterThan(1);
  });
  it('accepts a strong password', () => {
    expect(describePasswordPolicy('Civicxon@2026').ok).toBe(true);
  });
});
