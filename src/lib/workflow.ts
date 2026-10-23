// ─────────────────────────────────────────────────────────────
// Complaint workflow state machine — validated transitions, plus
// duplicate detection (proximity + category + text + image aHash).
// ─────────────────────────────────────────────────────────────

import type { Issue, IssueStatus, Media } from './types';
import { haversineKm } from './geo';
import { imageSimilarity } from './config';

export const VALID_TRANSITIONS: Record<IssueStatus, IssueStatus[]> = {
  REPORTED: ['UNDER_REVIEW', 'REJECTED', 'DUPLICATE', 'CANCELLED'],
  UNDER_REVIEW: ['ASSIGNED', 'REJECTED', 'DUPLICATE', 'CANCELLED'],
  ASSIGNED: ['IN_PROGRESS', 'ASSIGNED', 'UNDER_REVIEW', 'CANCELLED', 'REWORK_REQUIRED'],
  IN_PROGRESS: ['PENDING_VERIFICATION', 'REWORK_REQUIRED', 'CANCELLED', 'ASSIGNED'],
  PENDING_VERIFICATION: ['VERIFIED', 'REWORK_REQUIRED', 'ASSIGNED'],
  VERIFIED: [], // terminal — re-opened only by admin creating a new issue
  REJECTED: [],
  DUPLICATE: ['UNDER_REVIEW'], // un-merge returns to review queue
  REWORK_REQUIRED: ['IN_PROGRESS', 'ASSIGNED', 'PENDING_VERIFICATION'],
  CANCELLED: [],
};

export function canTransition(from: IssueStatus, to: IssueStatus): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

export function assertTransition(from: IssueStatus, to: IssueStatus) {
  if (!canTransition(from, to)) {
    throw new Error(`Invalid status transition ${from} → ${to}`);
  }
}

const STOPWORDS = new Set(['the','a','an','is','are','was','were','in','on','at','of','to','for','and','or','with','near','my','our','this','that','it','has','have','been','very','so','there','here']);

export function textSimilarity(a: string, b: string): number {
  const tokens = (s: string) =>
    (s.toLowerCase().match(/[a-z]+/g) ?? []).filter(t => !STOPWORDS.has(t) && t.length > 2);
  const A = tokens(a), B = tokens(b);
  if (A.length === 0 || B.length === 0) return 0;
  const setA = new Set(A), setB = new Set(B);
  let inter = 0;
  setA.forEach(t => { if (setB.has(t)) inter++; });
  const union = new Set([...setA, ...setB]).size;
  return union === 0 ? 0 : inter / union;
}

export interface DuplicateCandidate {
  issue: Issue;
  distanceKm: number;
  categoryMatch: boolean;
  textSim: number;
  imageSim: number;
  combined: number;
  reasons: string[];
}

/**
 * Find probable duplicates near a location/category. Similarity is evidence,
 * NOT proof — admins confirm merges. issues must include media already loaded
 * separately (mediaByIssue supplies aHash).
 */
export function findDuplicates(input: {
  candidate: { category: Issue['category']; description: string; lat: number; lng: number; imagePhash?: string | null };
  existing: Issue[];
  mediaByIssue: (issueId: string) => Media[];
  radiusKm?: number;
  excludeId?: string;
}): DuplicateCandidate[] {
  const { candidate, existing, mediaByIssue, excludeId } = input;
  const radiusKm = input.radiusKm ?? 0.35;
  const results: DuplicateCandidate[] = [];

  for (const issue of existing) {
    if (excludeId && issue.id === excludeId) continue;
    if (['DUPLICATE', 'CANCELLED', 'REJECTED'].includes(issue.status)) continue;
    const distanceKm = haversineKm(candidate.lat, candidate.lng, issue.lat, issue.lng);
    if (distanceKm > radiusKm) continue;

    const categoryMatch = issue.category === candidate.category;
    const textSim = textSimilarity(candidate.description, issue.description);
    let imageSim = 0;
    const candImg = candidate.imagePhash;
    if (candImg) {
      const imgs = mediaByIssue(issue.id).filter(m => m.type === 'BEFORE' && m.phash);
      for (const m of imgs) {
        imageSim = Math.max(imageSim, imageSimilarity(candImg, m.phash));
      }
    }

    const proximity = Math.max(0, 1 - distanceKm / radiusKm);
    const combined =
      (categoryMatch ? 0.34 : 0) +
      0.28 * proximity +
      0.24 * textSim +
      0.14 * imageSim;

    const reasons: string[] = [];
    reasons.push(`${distanceKm < 0.05 ? 'Same spot' : `${Math.round(distanceKm * 1000)} m away`}`);
    if (categoryMatch) reasons.push('same issue type');
    if (textSim >= 0.35) reasons.push(`${Math.round(textSim * 100)}% description match`);
    if (imageSim >= 0.6) reasons.push(`${Math.round(imageSim * 100)}% image similarity`);

    if (combined >= 0.34 || (categoryMatch && distanceKm < 0.12)) {
      results.push({ issue, distanceKm, categoryMatch, textSim, imageSim, combined: Math.round(combined * 100) / 100, reasons });
    }
  }

  return results.sort((a, b) => b.combined - a.combined).slice(0, 5);
}
