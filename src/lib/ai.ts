// ─────────────────────────────────────────────────────────────
// CIVICXON AI layer — provider abstraction.
//
// Providers (selectable in Admin → Settings):
//   • 'gemma-4'   — REAL Gemma 4 via Google AI Studio / Gemini API.
//                   Verified model ids: gemma-4-26b-a4b-it, gemma-4-31b-it
//                   Endpoint: generativelanguage.googleapis.com/v1beta
//                   Auth: x-goog-api-key header (key from aistudio.google.com)
//                   Multimodal: image input supported (text+image → text).
//   • 'heuristic' — Development-only deterministic baseline. NOT an AI model.
//                   Explicitly labelled; used when no key is configured so the
//                   workflow remains fully demonstrable offline.
//   • 'mock-dev'  — Development-only mock provider returning canned structured
//                   output. Never presented as real AI.
//
// AI CANNOT approve closures — every verification result is advisory; an admin
// decision is always required. Structured outputs are validated + sanitised.
// ─────────────────────────────────────────────────────────────

import type { AppSettings, IssueCategory, VerificationOutcome } from './types';

export interface IssueAnalysis {
  category: IssueCategory;
  severity: 'low' | 'moderate' | 'severe' | 'critical';
  description: string;
  riskIndicators: string[];
  confidence: number;
  departmentSuggestion: string;
  explanation: string;
  provider: 'gemma-4' | 'heuristic' | 'mock-dev';
  model?: string;
}

export interface VerificationAssessment {
  outcome: VerificationOutcome;
  explanation: string;
  limitations: string;
  confidence: number;
  provider: 'gemma-4' | 'heuristic' | 'mock-dev';
  model?: string;
}

export interface AIStatus {
  provider: string;
  model: string | null;
  configured: boolean;
  label: string;
}

const GEMMA_DEFAULT_MODEL = 'gemma-4-26b-a4b-it';
const GEMMA_DEFAULT_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta';

export function aiStatus(settings: AppSettings): AIStatus {
  if (settings.aiProvider === 'gemma-4') {
    const configured = Boolean(settings.gemmaApiKey && settings.gemmaApiKey.trim().length > 8);
    return {
      provider: 'gemma-4',
      model: settings.gemmaModel || GEMMA_DEFAULT_MODEL,
      configured,
      label: configured
        ? `Gemma 4 live — ${settings.gemmaModel || GEMMA_DEFAULT_MODEL} via Google AI Studio`
        : 'Gemma 4 selected but no API key configured — add one in Settings or reports use the dev baseline',
    };
  }
  if (settings.aiProvider === 'mock-dev') {
    return { provider: 'mock-dev', model: null, configured: true, label: 'Development-only mock provider (not real AI)' };
  }
  return { provider: 'heuristic', model: null, configured: true, label: 'Development-only heuristic baseline (not a model)' };
}

async function callGemma(settings: AppSettings, parts: unknown[], jsonOnly = true): Promise<string> {
  const model = settings.gemmaModel || GEMMA_DEFAULT_MODEL;
  const endpoint = (settings.gemmaEndpoint || GEMMA_DEFAULT_ENDPOINT).replace(/\/$/, '');
  const url = `${endpoint}/models/${model}:generateContent`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': settings.gemmaApiKey,
    },
    body: JSON.stringify({
      contents: [{ role: 'user', parts }],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 1024,
        ...(jsonOnly ? { responseMimeType: 'application/json' } : {}),
      },
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Gemma API ${res.status}: ${text.slice(0, 300)}`);
  }
  const data = await res.json();
  const out: string = data?.candidates?.[0]?.content?.parts?.map((p: any) => p?.text ?? '').join('') ?? '';
  if (!out.trim()) throw new Error('Gemma returned an empty completion');
  return out;
}

function clamp01(n: unknown, fallback = 0.5): number {
  const v = typeof n === 'number' ? n : Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.min(1, Math.max(0, v));
}

function extractJson<T>(raw: string): T {
  let text = raw.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1].trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) text = text.slice(start, end + 1);
  return JSON.parse(text) as T;
}

function imagePart(dataUrl: string) {
  const m = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!m) throw new Error('Unsupported image encoding for Gemma input');
  return { inlineData: { mimeType: m[1], data: m[2] } };
}

const ISSUE_CATEGORIES: IssueCategory[] = ['pothole', 'streetlight'];

export async function analyseIssue(input: {
  settings: AppSettings;
  description: string;
  imageDataUrl?: string | null;
}): Promise<IssueAnalysis> {
  const { settings, description, imageDataUrl } = input;
  const provider = settings.aiProvider;

  if (provider === 'gemma-4' && settings.gemmaApiKey?.trim()) {
    const prompt = `You are CIVICXON's civic-infrastructure triage assistant. Analyse this citizen report and respond with STRICT JSON only (no markdown), with keys:
{"category": "pothole" | "streetlight", "severity": "low" | "moderate" | "severe" | "critical", "description": string (one factual sentence), "riskIndicators": string[] (0-5 short items), "confidence": number 0..1, "departmentSuggestion": string (e.g. "Road Maintenance Department" or "Streetlight Maintenance Department"), "explanation": string (2-3 sentences on what you see and why this severity)}
Report description: """${description.slice(0, 1500)}"""
Focus on road surface damage (potholes, cracks, subsidence) vs streetlight faults (dark lamp, damaged pole, wiring). If uncertain, lower confidence and say so.`;
    try {
      const parts: unknown[] = [{ text: prompt }];
      if (imageDataUrl) parts.push(imagePart(imageDataUrl));
      const raw = await callGemma(settings, parts, true);
      const parsed = extractJson<Partial<IssueAnalysis>>(raw);
      const category = ISSUE_CATEGORIES.includes(parsed.category as IssueCategory) ? (parsed.category as IssueCategory) : inferCategory(description);
      const severity = ['low', 'moderate', 'severe', 'critical'].includes(parsed.severity as string)
        ? (parsed.severity as IssueAnalysis['severity'])
        : 'moderate';
      return {
        category,
        severity,
        description: String(parsed.description ?? description).slice(0, 400),
        riskIndicators: Array.isArray(parsed.riskIndicators) ? parsed.riskIndicators.map(String).slice(0, 5) : [],
        confidence: clamp01(parsed.confidence, 0.6),
        departmentSuggestion: String(parsed.departmentSuggestion ?? departmentFor(category)).slice(0, 120),
        explanation: String(parsed.explanation ?? 'Analysis returned by Gemma 4.').slice(0, 800),
        provider: 'gemma-4',
        model: settings.gemmaModel || GEMMA_DEFAULT_MODEL,
      };
    } catch (err) {
      // Fall back to the labelled dev baseline, clearly marked
      const fallback = heuristicAnalysis(description, imageDataUrl);
      return {
        ...fallback,
        explanation: `Gemma 4 call failed (${err instanceof Error ? err.message.slice(0, 160) : 'unknown error'}). ${fallback.explanation} [Development-only heuristic fallback — not a model]`,
      };
    }
  }

  if (provider === 'mock-dev') {
    const base = heuristicAnalysis(description, imageDataUrl);
    return { ...base, provider: 'mock-dev', explanation: `${base.explanation} [DEVELOPMENT-ONLY MOCK PROVIDER — not real AI]` };
  }

  return { ...heuristicAnalysis(description, imageDataUrl), provider: 'heuristic' };
}

export async function assessRepair(input: {
  settings: AppSettings;
  beforeDataUrl: string;
  afterDataUrl: string;
  category: IssueCategory;
  description: string;
}): Promise<VerificationAssessment> {
  const { settings, beforeDataUrl, afterDataUrl, category, description } = input;
  const provider = settings.aiProvider;

  if (provider === 'gemma-4' && settings.gemmaApiKey?.trim()) {
    const prompt = `You are CIVICXON's repair-verification assistant. You are given TWO photos: the FIRST image is the original citizen-reported ${category === 'pothole' ? 'road defect' : 'streetlight fault'}; the SECOND image is the worker's after-repair evidence. Respond with STRICT JSON only (no markdown) with keys:
{"outcome": "likely_resolved" | "not_resolved" | "uncertain", "explanation": string (2-3 sentences comparing the two images), "limitations": string (what you cannot determine from photos alone), "confidence": number 0..1}
Rules: similarity of images is NOT proof of resolution. If the "after" photo does not clearly show the same defect repaired, answer "uncertain" or "not_resolved". You may NOT close the ticket — an administrator makes the final decision.
Original report: """${description.slice(0, 800)}"""`;
    try {
      const parts = [{ text: prompt }, imagePart(beforeDataUrl), imagePart(afterDataUrl)];
      const raw = await callGemma(settings, parts, true);
      const parsed = extractJson<Partial<VerificationAssessment>>(raw);
      const outcome: VerificationOutcome = ['likely_resolved', 'not_resolved', 'uncertain'].includes(parsed.outcome as string)
        ? (parsed.outcome as VerificationOutcome)
        : 'uncertain';
      return {
        outcome,
        explanation: String(parsed.explanation ?? 'Gemma 4 compared the two images.').slice(0, 800),
        limitations: String(parsed.limitations ?? 'Photo comparison cannot verify structural quality or long-term durability.').slice(0, 400),
        confidence: clamp01(parsed.confidence, 0.55),
        provider: 'gemma-4',
        model: settings.gemmaModel || GEMMA_DEFAULT_MODEL,
      };
    } catch (err) {
      const fallback = heuristicVerification();
      return {
        ...fallback,
        explanation: `Gemma 4 call failed (${err instanceof Error ? err.message.slice(0, 160) : 'unknown error'}). ${fallback.explanation} [Development-only heuristic fallback — not a model]`,
      };
    }
  }

  if (provider === 'mock-dev') {
    return { ...heuristicVerification(), provider: 'mock-dev', explanation: 'After photo assessed by the development-only mock provider. Outcome "uncertain" returned so an admin always decides. [DEVELOPMENT-ONLY MOCK — not real AI]' };
  }

  return { ...heuristicVerification(), provider: 'heuristic' };
}

// ── Development-only deterministic baseline (NOT a machine-learning model) ──
const SEVERITY_WORDS: Record<IssueAnalysis['severity'], RegExp[]> = {
  critical: [/accident/i, /injur/i, /school/i, /highway/i, /emergency/i, /collapse/i, /fire/i, /electrocut/i, /sparking/i],
  severe: [/deep/i, /large/i, /huge/i, /big/i, /dangerous/i, /unsafe/i, /sinking/i, /crater/i, /dark\\s*street|no\\s*light|pitch\\s*dark/i],
  moderate: [/pothole/i, /crack/i, /broken/i, /damaged/i, /not\\s*working|flicker/i, /hole/i],
  low: [/small/i, /minor/i, /tiny/i, /slight/i, /dim/i],
};

const RISK_PATTERNS: [RegExp, string][] = [
  [/accident/i, 'Accident-prone location reported'],
  [/school|hospital|clinic/i, 'Near sensitive zone (school/hospital)'],
  [/night|dark|unsafe|safety/i, 'Night-time safety risk'],
  [/motorcycle|bike|two-?wheeler/i, 'Two-wheeler hazard (low visibility)'],
  [/rain|flood|water/i, 'Water accumulation worsens defect'],
  [/spark|wire|electrocut/i, 'Electrical hazard — immediate risk'],
  [/children|kids/i, 'Children in the vicinity'],
  [/traffic|busy/i, 'High-traffic corridor'],
];

export function inferCategory(text: string): IssueCategory {
  const street = /street\\s?light|lamp|light\\s?post|pole|bulb|lighting|lamppost|tubelight|fixture|dark road/i;
  if (street.test(text)) return 'streetlight';
  return 'pothole'; // roads are the default civic defect
}

export function departmentFor(category: IssueCategory): string {
  return category === 'pothole' ? 'Road Maintenance Department' : 'Streetlight Maintenance Department';
}

function heuristicAnalysis(description: string, imageDataUrl?: string | null): IssueAnalysis {
  const text = description || '';
  const category = inferCategory(text);
  let severity: IssueAnalysis['severity'] = 'moderate';
  if (SEVERITY_WORDS.critical.some(r => r.test(text))) severity = 'critical';
  else if (SEVERITY_WORDS.severe.some(r => r.test(text))) severity = 'severe';
  else if (SEVERITY_WORDS.low.some(r => r.test(text))) severity = 'low';
  const risks = RISK_PATTERNS.filter(([r]) => r.test(text)).map(([, label]) => label);
  if (risks.length >= 3 && severity !== 'critical') severity = 'severe';
  const conf = imageDataUrl ? 0.72 : 0.55;
  return {
    category,
    severity,
    description: text.slice(0, 140) || `${category === 'pothole' ? 'Road surface defect' : 'Streetlight fault'} reported`,
    riskIndicators: risks.slice(0, 5),
    confidence: conf,
    departmentSuggestion: departmentFor(category),
    explanation: `Deterministic dev baseline: categorised as ${category} from report text with ${severity} severity (${risks.length} risk indicator(s) found). ${imageDataUrl ? 'An image was attached; the dev baseline cannot see pixels — attach GEMMA_API_KEY for true multimodal analysis.' : 'No image attached.'} [Development-only heuristic — not a model]`,
    provider: 'heuristic',
  };
}

function heuristicVerification(): VerificationAssessment {
  return {
    outcome: 'uncertain',
    explanation: 'The development-only heuristic baseline cannot inspect pixels. It confirms an after-repair photo was submitted and returns "uncertain" — an administrator must visually compare the evidence and decide.',
    limitations: 'No pixel-level comparison was performed. Structural quality, depth of fill, and luminaire output cannot be judged from photos alone.',
    confidence: 0.4,
    provider: 'heuristic',
  };
}
