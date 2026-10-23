// Deterministic demo seed — DEMO accounts. Passwords are hashed at seed time.
// Seeds users, workers, departments, zones, and a realistic cross-workflow set
// of issues (one PENDING_VERIFICATION so the full loop can be demonstrated).

import type { AIAnalysis, AppNotification, Assignment, Database, Department, Issue, IssueEvent, Media, User, WorkerProfile, Zone } from './types';
import { hashPassword } from './crypto';
import { assetToDataUrl, perceptualHash, uid } from './config';
import { CITY_CENTER } from './geo';

export const DEMO_PASSWORD = 'Civicxon@2026';
export const DEMO_ADMIN_PASSWORD = 'Civicxon@2026';

export const DEMO_ACCOUNTS = [
  { email: 'admin@civicxon.gov', name: 'Admin Priya Sharma', role: 'admin' as const, password: DEMO_ADMIN_PASSWORD },
  { email: 'citizen@civicxon.gov', name: 'Rohan Mehta', role: 'citizen' as const, password: DEMO_PASSWORD },
  { email: 'worker@civicxon.gov', name: 'Suresh Yadav', role: 'worker' as const, password: DEMO_PASSWORD },
  { email: 'a.menon@civicxon.gov', name: 'Anil Menon', role: 'citizen' as const, password: DEMO_PASSWORD },
  { email: 'w.rao@civicxon.gov', name: 'Deepak Rao', role: 'worker' as const, password: DEMO_PASSWORD },
  { email: 'w.khan@civicxon.gov', name: 'Imran Khan', role: 'worker' as const, password: DEMO_PASSWORD },
  { email: 'w.iyer@civicxon.gov', name: 'Lakshmi Iyer', role: 'worker' as const, password: DEMO_PASSWORD },
  { email: 'w.thomas@civicxon.gov', name: 'George Thomas', role: 'worker' as const, password: DEMO_PASSWORD },
  { email: 'w.nair@civicxon.gov', name: 'Divya Nair', role: 'worker' as const, password: DEMO_PASSWORD },
  { email: 'w.patel@civicxon.gov', name: 'Hiren Patel', role: 'worker' as const, password: DEMO_PASSWORD },
  { email: 'w.reddy@civicxon.gov', name: 'Kiran Reddy', role: 'worker' as const, password: DEMO_PASSWORD },
];

const ZONES: Zone[] = [
  { id: 'zone_central', name: 'Central', lat: 12.9716, lng: 77.5946, radiusKm: 4 },
  { id: 'zone_north', name: 'North', lat: 13.018, lng: 77.59, radiusKm: 4.5 },
  { id: 'zone_east', name: 'East', lat: 12.9857, lng: 77.6536, radiusKm: 4 },
  { id: 'zone_south', name: 'South', lat: 12.925, lng: 77.594, radiusKm: 4.5 },
  { id: 'zone_west', name: 'West', lat: 12.9665, lng: 77.512, radiusKm: 4.5 },
];

export async function buildSeedDatabase(): Promise<Database> {
  const now = Date.now();
  const daysAgo = (d: number, h = 0) => now - d * 86400000 - h * 3600000;

  // ── Departments (simulated demo integrations) ──
  const departments: Department[] = [
    { id: 'dept_road', code: 'ROAD', name: 'Road Maintenance Department', handles: ['pothole'], description: 'Potholes, cracks, subsidence, surface defects and road safety furniture repair. Simulated demo integration — not connected to a live ERP/work-order system.', demoIntegration: true, contactEmail: 'roads@civicxon.gov.demo', head: 'Eng. Vikram Malhotra' },
    { id: 'dept_street', code: 'STREET', name: 'Streetlight Maintenance Department', handles: ['streetlight'], description: 'Luminaire faults, pole damage, wiring and illumination circuits. Simulated demo integration — not connected to a live SCADA/lighting-control system.', demoIntegration: true, contactEmail: 'streetlights@civicxon.gov.demo', head: 'Eng. Meena Krishnan' },
  ];

  // ── Users (hashed) ──
  const users: User[] = [];
  for (const acc of DEMO_ACCOUNTS) {
    const { hash, salt, iterations } = await hashPassword(acc.password);
    users.push({
      id: `usr_${acc.email.split('@')[0].replace(/\./g, '_')}`,
      name: acc.name,
      email: acc.email,
      phone: '+91 98' + String(Math.abs(hashCode(acc.email))).slice(0, 8).padEnd(8, '4'),
      role: acc.role,
      passwordHash: hash,
      salt,
      iterations,
      active: true,
      failedAttempts: 0,
      lockedUntil: null,
      createdAt: daysAgo(30),
      lastLoginAt: null,
    });
  }
  const byEmail = (e: string) => users.find(u => u.email === e)!;

  // ── Worker profiles ──
  const workers: WorkerProfile[] = [
    w('usr_worker', 'dept_road', ['road_maintenance'], ['Central', 'North'], 'AVAILABLE', 1, 3, 4.8, 142, 12.973, 77.596, 210),
    w('usr_w_rao', 'dept_road', ['road_maintenance'], ['East', 'Central'], 'AVAILABLE', 2, 3, 4.6, 118, 12.9845, 77.651, 260),
    w('usr_w_khan', 'dept_road', ['road_maintenance'], ['West'], 'BUSY', 2, 3, 4.3, 96, 12.968, 77.516, 340),
    w('usr_w_iyer', 'dept_road', ['road_maintenance'], ['South', 'Central'], 'AVAILABLE', 0, 3, 4.9, 160, 12.926, 77.591, 180),
    w('usr_w_thomas', 'dept_street', ['streetlight_maintenance'], ['Central', 'South'], 'AVAILABLE', 1, 3, 4.7, 128, 12.972, 77.601, 230),
    w('usr_w_nair', 'dept_street', ['streetlight_maintenance'], ['North', 'East'], 'AVAILABLE', 1, 3, 4.5, 87, 13.014, 77.588, 150),
    w('usr_w_patel', 'dept_street', ['streetlight_maintenance'], ['West', 'South'], 'OFFLINE', 0, 3, 4.1, 74, 12.961, 77.509, 400),
    w('usr_w_reddy', 'dept_street', ['streetlight_maintenance'], ['Central', 'East'], 'AVAILABLE', 2, 3, 4.4, 101, 12.981, 77.655, 290),
  ];
  function w(userId: string, departmentId: string, skills: WorkerProfile['skills'], zones: string[], availability: WorkerProfile['availability'], load: number, max: number, rating: number, jobs: number, baseLat: number, baseLng: number, joinDaysAgo: number): WorkerProfile {
    return { id: `wrk_${userId.slice(4)}`, userId, departmentId, skills, zones, availability, currentLoad: load, maxConcurrentJobs: max, rating, jobsCompleted: jobs, baseLat, baseLng, joinedAt: daysAgo(joinDaysAgo) };
  }

  // ── Seed issues across the workflow ──
  const potholeBefore = await assetToDataUrl('/images/seed/pothole_before.jpg');
  const potholeAfter = await assetToDataUrl('/images/seed/pothole_after.jpg');
  const streetlightBefore = await assetToDataUrl('/images/seed/streetlight_before.jpg');
  const streetlightAfter = await assetToDataUrl('/images/seed/streetlight_after.jpg');
  const phBefore = (await perceptualHash(potholeBefore)) ?? '';
  const phAfter = (await perceptualHash(potholeAfter)) ?? '';
  const slBefore = (await perceptualHash(streetlightBefore)) ?? '';
  const slAfter = (await perceptualHash(streetlightAfter)) ?? '';

  const issues: Issue[] = [];
  const media: Media[] = [];
  const events: IssueEvent[] = [];
  const assignments: Assignment[] = [];
  const notifications: AppNotification[] = [];

  const reporter1 = byEmail('citizen@civicxon.gov');
  const reporter2 = byEmail('a.menon@civicxon.gov');
  const admin = byEmail('admin@civicxon.gov');

  const aiPothole: AIAnalysis = { provider: 'gemma-4', model: 'gemma-4-26b-a4b-it', category: 'pothole', severity: 'severe', description: 'Deep pothole approximately 40 cm wide on the carriageway edge.', riskIndicators: ['Two-wheeler hazard (low visibility)', 'High-traffic corridor'], confidence: 0.88, departmentSuggestion: 'Road Maintenance Department', explanation: 'Image shows a deep, water-filled pothole on the asphalt lane edge with cracked subsidence around the rim. Depth and placement pose a direct two-wheeler hazard on a high-traffic corridor, warranting severe severity.', analysedAt: daysAgo(6, 2) };
  const aiStreetlight: AIAnalysis = { provider: 'gemma-4', model: 'gemma-4-26b-a4b-it', category: 'streetlight', severity: 'severe', description: 'Damaged streetlight pole with unlit, dangling fixture.', riskIndicators: ['Night-time safety risk', 'Electrical hazard — immediate risk'], confidence: 0.9, departmentSuggestion: 'Streetlight Maintenance Department', explanation: 'Image shows a bent pole arm with a dark, dangling fixture and exposed wiring. The circuit is unlit at dusk with an electrical-hazard indicator, so night-time safety and shock risk are both elevated.', analysedAt: daysAgo(4, 5) };
  const aiPending: AIAnalysis = { provider: 'heuristic', category: 'pothole', severity: 'moderate', description: 'Moderate pothole near the bus stop on 80 Feet Road.', riskIndicators: ['High-traffic corridor'], confidence: 0.7, departmentSuggestion: 'Road Maintenance Department', explanation: '[Development-only heuristic — not a model] Text mentions a moderate road defect near public transport; categorised as pothole with moderate severity.', analysedAt: daysAgo(12) };
  const aiRework: AIAnalysis = { provider: 'heuristic', category: 'streetlight', severity: 'moderate', description: 'Streetlight not working at the junction near the market.', riskIndicators: ['Night-time safety risk'], confidence: 0.65, departmentSuggestion: 'Streetlight Maintenance Department', explanation: '[Development-only heuristic — not a model] Unlit streetlight reported near market junction; night-time safety risk indicated.', analysedAt: daysAgo(9, 3) };

  // Issue 1 — PENDING_VERIFICATION (seeds the verification queue demo)
  const issue1 = makeIssue({ ticketNo: 'CX-2026-0001', category: 'pothole', description: 'Deep pothole near the signal junction on 100 Feet Road, Indiranagar. Two wheelers keep swerving into the bus lane. It has been growing since the monsoon.', status: 'PENDING_VERIFICATION', priority: 'HIGH', priorityReason: 'High traffic corridor + two-wheeler hazard confirmed by admin after site check', reporterId: reporter1.id, reporterName: reporter1.name, citizenPhone: reporter1.phone, address: '100 Feet Road, Indiranagar junction, Bengaluru', lat: 12.9758, lng: 77.6045, zone: 'Central', departmentId: 'dept_road', assignedWorkerId: 'wrk_worker', createdAt: daysAgo(6, 2), startedAt: daysAgo(4, 6), assignedAt: daysAgo(5, 8), ai: aiPothole, reworkCount: 0 });
  issues.push(issue1);
  media.push(m(issue1.id, 'BEFORE', potholeBefore, 'Citizen report photo — pothole', reporter1.id, daysAgo(6, 2), phBefore));
  media.push(m(issue1.id, 'AFTER', potholeAfter, 'Repair evidence — freshly resurfaced patch', 'usr_worker', daysAgo(1, 3), phAfter));
  assignments.push(asg(issue1.id, 'wrk_worker', 'Suresh Yadav', 91.5, { skill: 100, distance: 92, workload: 66.7, availability: 100, total: 91.5, distanceKm: 0.9 }, 'AUTO', daysAgo(5, 8)));
  events.push(
    ev(issue1.id, daysAgo(6, 2), reporter1, 'CREATED', 'Citizen reported the issue with photo evidence.'),
    ev(issue1.id, daysAgo(6, 2) + 1000, null, 'AI_ANALYSIS', 'AI analysis: pothole · severe · confidence 0.88 (provider: gemma-4).'),
    ev(issue1.id, daysAgo(6, 3), admin, 'STATUS_CHANGE', 'Status: REPORTED → UNDER_REVIEW', { from: 'REPORTED', to: 'UNDER_REVIEW' }),
    ev(issue1.id, daysAgo(5, 9), admin, 'PRIORITY_SET', 'Priority set to HIGH — high-traffic corridor + two-wheeler hazard.'),
    ev(issue1.id, daysAgo(5, 8), null, 'ASSIGNED', 'Auto-assigned to Suresh Yadav (score 91.5). Eligible: skill road_maintenance, zone Central, available, load 1/3.'),
    ev(issue1.id, daysAgo(4, 6), { id: 'usr_worker', name: 'Suresh Yadav', role: 'worker' }, 'WORK_STARTED', 'Worker started repair work.'),
    ev(issue1.id, daysAgo(1, 4), { id: 'usr_worker', name: 'Suresh Yadav', role: 'worker' }, 'STATUS_CHANGE', 'Status: IN_PROGRESS → PENDING_VERIFICATION', { from: 'IN_PROGRESS', to: 'PENDING_VERIFICATION' }),
    ev(issue1.id, daysAgo(1, 3), { id: 'usr_worker', name: 'Suresh Yadav', role: 'worker' }, 'EVIDENCE_SUBMITTED', 'Worker submitted after-repair photo evidence.'),
  );

  // Issue 2 — IN_PROGRESS (streetlight)
  const issue2 = makeIssue({ ticketNo: 'CX-2026-0002', category: 'streetlight', description: 'Streetlight pole bent and lamp dangling over the road near the HAL flyover service lane. Wires sparking at night, complete darkness.', status: 'IN_PROGRESS', priority: 'CRITICAL', priorityReason: 'Exposed live wiring + zero illumination on a service lane — immediate public-safety hazard', reporterId: reporter2.id, reporterName: reporter2.name, citizenPhone: reporter2.phone, address: 'HAL flyover service lane, Marathahalli, Bengaluru', lat: 12.9569, lng: 77.7013 > 77.7 ? 77.6945 : 77.6945, zone: 'East', departmentId: 'dept_street', assignedWorkerId: 'wrk_w_reddy', createdAt: daysAgo(4, 5), startedAt: daysAgo(2, 7), assignedAt: daysAgo(3, 9), ai: aiStreetlight, reworkCount: 0 });
  issues.push(issue2);
  media.push(m(issue2.id, 'BEFORE', streetlightBefore, 'Citizen report photo — damaged dangling fixture', reporter2.id, daysAgo(4, 5), slBefore));
  assignments.push(asg(issue2.id, 'wrk_w_reddy', 'Kiran Reddy', 84.2, { skill: 100, distance: 71, workload: 33.3, availability: 100, total: 84.2, distanceKm: 4.3 }, 'AUTO', daysAgo(3, 9)));
  events.push(
    ev(issue2.id, daysAgo(4, 5), reporter2, 'CREATED', 'Citizen reported the issue with photo evidence.'),
    ev(issue2.id, daysAgo(4, 5) + 1000, null, 'AI_ANALYSIS', 'AI analysis: streetlight · severe · confidence 0.90 (provider: gemma-4).'),
    ev(issue2.id, daysAgo(4, 6), admin, 'STATUS_CHANGE', 'Status: REPORTED → UNDER_REVIEW', { from: 'REPORTED', to: 'UNDER_REVIEW' }),
    ev(issue2.id, daysAgo(3, 10), admin, 'PRIORITY_SET', 'Priority set to CRITICAL — live exposed wiring.'),
    ev(issue2.id, daysAgo(3, 9), null, 'ASSIGNED', 'Auto-assigned to Kiran Reddy (score 84.2).'),
    ev(issue2.id, daysAgo(2, 7), { id: 'usr_w_reddy', name: 'Kiran Reddy', role: 'worker' }, 'WORK_STARTED', 'Worker started repair work. Crew dispatched with insulated bucket truck.'),
  );

  // Issue 3 — REPORTED (awaiting review, citizen-visible as "Open")
  const issue3 = makeIssue({ ticketNo: 'CX-2026-0003', category: 'pothole', description: 'Moderate pothole right at the bus stop on 80 Feet Road Koramangala. Buses cut the corner and passengers step into it when alighting.', status: 'REPORTED', priority: 'MEDIUM', priorityReason: null, reporterId: reporter1.id, reporterName: reporter1.name, citizenPhone: reporter1.phone, address: '80 Feet Road, Koramangala 4th Block, Bengaluru', lat: 12.9352, lng: 77.6245, zone: 'South', departmentId: null, assignedWorkerId: null, createdAt: daysAgo(0, 4), ai: aiPending, reworkCount: 0 });
  issues.push(issue3);
  media.push(m(issue3.id, 'BEFORE', potholeBefore, 'Citizen report photo — pothole at bus stop', reporter1.id, daysAgo(0, 4), phBefore));
  events.push(
    ev(issue3.id, daysAgo(0, 4), reporter1, 'CREATED', 'Citizen reported the issue with photo evidence.'),
    ev(issue3.id, daysAgo(0, 4) + 1000, null, 'AI_ANALYSIS', 'AI analysis: pothole · moderate · confidence 0.70 (provider: heuristic).'),
  );

  // Issue 4 — REWORK_REQUIRED (verification failed, back to worker)
  const issue4 = makeIssue({ ticketNo: 'CX-2026-0004', category: 'streetlight', description: 'Streetlight not working at the junction near KR Market. Entire junction in darkness after 7 pm.', status: 'REWORK_REQUIRED', priority: 'HIGH', priorityReason: 'Public safety at a major market junction after dark', reporterId: reporter2.id, reporterName: reporter2.name, citizenPhone: reporter2.phone, address: 'K R Market junction, Avenue Road, Bengaluru', lat: 12.961, lng: 77.5782, zone: 'Central', departmentId: 'dept_street', assignedWorkerId: 'usr_w_thomas'.replace('usr_w_', 'wrk_w_'), createdAt: daysAgo(9, 3), startedAt: daysAgo(7, 2), assignedAt: daysAgo(8, 6), ai: aiRework, reworkCount: 1 });
  issues.push(issue4);
  media.push(m(issue4.id, 'BEFORE', streetlightBefore, 'Citizen report photo — unlit junction', reporter2.id, daysAgo(9, 3), slBefore));
  media.push(m(issue4.id, 'AFTER', streetlightAfter, 'Worker evidence v1 — rejected by admin', 'usr_w_thomas', daysAgo(3, 2), slAfter));
  assignments.push(asg(issue4.id, 'wrk_w_thomas', 'George Thomas', 88.0, { skill: 100, distance: 95, workload: 66.7, availability: 100, total: 88.0, distanceKm: 1.4 }, 'AUTO', daysAgo(8, 6)));
  events.push(
    ev(issue4.id, daysAgo(9, 3), reporter2, 'CREATED', 'Citizen reported the issue with photo evidence.'),
    ev(issue4.id, daysAgo(9, 3) + 1000, null, 'AI_ANALYSIS', 'AI analysis: streetlight · moderate · confidence 0.65 (provider: heuristic).'),
    ev(issue4.id, daysAgo(8, 7), admin, 'STATUS_CHANGE', 'Status: REPORTED → UNDER_REVIEW', { from: 'REPORTED', to: 'UNDER_REVIEW' }),
    ev(issue4.id, daysAgo(8, 6), null, 'ASSIGNED', 'Auto-assigned to George Thomas (score 88.0).'),
    ev(issue4.id, daysAgo(7, 2), { id: 'usr_w_thomas', name: 'George Thomas', role: 'worker' }, 'WORK_STARTED', 'Worker started repair work.'),
    ev(issue4.id, daysAgo(3, 2), { id: 'usr_w_thomas', name: 'George Thomas', role: 'worker' }, 'EVIDENCE_SUBMITTED', 'Worker submitted after-repair photo evidence (attempt 1).'),
    ev(issue4.id, daysAgo(3, 1), admin, 'REWORK_REQUESTED', 'Admin requested rework: photo shows lamp head replaced but the pole base is still tilted and the canopy clip is missing. Re-align and resubmit.'),
    ev(issue4.id, daysAgo(3, 1), admin, 'STATUS_CHANGE', 'Status: PENDING_VERIFICATION → REWORK_REQUIRED', { from: 'PENDING_VERIFICATION', to: 'REWORK_REQUIRED' }),
  );

  // Issue 5 — VERIFIED (historical, analytics)
  const issue5 = makeIssue({ ticketNo: 'CX-2026-0005', category: 'pothole', description: 'Pothole filled and verified last month on 5th Cross, JP Nagar.', status: 'VERIFIED', priority: 'MEDIUM', priorityReason: null, reporterId: reporter1.id, reporterName: reporter1.name, citizenPhone: reporter1.phone, address: '5th Cross, JP Nagar 2nd Phase, Bengaluru', lat: 12.9121, lng: 77.5855, zone: 'South', departmentId: 'dept_road', assignedWorkerId: 'wrk_w_iyer', createdAt: daysAgo(35), verifiedAt: daysAgo(28), resolvedAt: daysAgo(28, 2), startedAt: daysAgo(32), assignedAt: daysAgo(33), ai: null, reworkCount: 0 });
  issues.push(issue5);
  media.push(m(issue5.id, 'BEFORE', potholeBefore, 'Citizen report photo', reporter1.id, daysAgo(35), phBefore));
  media.push(m(issue5.id, 'AFTER', potholeAfter, 'Verified repair', 'usr_w_iyer', daysAgo(28, 2), phAfter));
  assignments.push(asg(issue5.id, 'wrk_w_iyer', 'Lakshmi Iyer', 95.1, { skill: 100, distance: 90, workload: 100, availability: 100, total: 95.1, distanceKm: 1.1 }, 'AUTO', daysAgo(33)));
  events.push(
    ev(issue5.id, daysAgo(35), reporter1, 'CREATED', 'Citizen reported the issue.'),
    ev(issue5.id, daysAgo(33), null, 'ASSIGNED', 'Auto-assigned to Lakshmi Iyer (score 95.1).'),
    ev(issue5.id, daysAgo(28, 2), { id: 'usr_w_iyer', name: 'Lakshmi Iyer', role: 'worker' }, 'EVIDENCE_SUBMITTED', 'Worker submitted repair evidence.'),
    ev(issue5.id, daysAgo(28), admin, 'VERIFICATION_DECISION', 'Admin approved: repair verified against evidence. Ticket closed.', { decision: 'APPROVED' }),
    ev(issue5.id, daysAgo(28), admin, 'STATUS_CHANGE', 'Status: PENDING_VERIFICATION → VERIFIED', { from: 'PENDING_VERIFICATION', to: 'VERIFIED' }),
  );

  // A few older VERIFIED records to make analytics interesting
  for (let i = 0; i < 6; i++) {
    const cat = i % 2 === 0 ? 'pothole' : 'streetlight';
    const days = 8 + i * 5;
    const issue = makeIssue({ ticketNo: `CX-2026-00${String(11 + i)}0`.slice(0, 10), category: cat as 'pothole' | 'streetlight', description: cat === 'pothole' ? `Pothole reported on ${['100 Feet Rd', '80 Feet Rd', 'Outer Ring Rd', 'Old Airport Rd'][i % 4]}.` : `Streetlight out near ${['Metro station', 'Market', 'Park gate', 'Bus depot'][i % 4]}.`, status: 'VERIFIED', priority: (['LOW', 'MEDIUM', 'HIGH'] as const)[i % 3], priorityReason: null, reporterId: (i % 2 ? reporter1 : reporter2).id, reporterName: (i % 2 ? reporter1 : reporter2).name, citizenPhone: '+91 98XXXXXXXX', address: ['Indiranagar', 'Koramangala', 'Jayanagar', 'Whitefield'][i % 4] + ', Bengaluru', lat: CITY_CENTER[0] + (((i * 37) % 100) - 50) / 350, lng: CITY_CENTER[1] + (((i * 53) % 100) - 50) / 350, zone: ['Central', 'South', 'North', 'East'][i % 4], departmentId: cat === 'pothole' ? 'dept_road' : 'dept_street', assignedWorkerId: cat === 'pothole' ? 'wrk_worker' : 'wrk_w_nair', createdAt: daysAgo(days), verifiedAt: daysAgo(days - 5), resolvedAt: daysAgo(days - 5), startedAt: daysAgo(days - 2), assignedAt: daysAgo(days - 1), ai: null, reworkCount: 0 });
    issues.push(issue);
    events.push(ev(issue.id, daysAgo(days), { id: issue.reporterId, name: issue.reporterName, role: 'citizen' }, 'CREATED', 'Citizen reported the issue.'));
    events.push(ev(issue.id, daysAgo(days - 5), admin, 'VERIFICATION_DECISION', 'Admin approved: repair verified. Ticket closed.', { decision: 'APPROVED' }));
  }

  // ── Notifications ──
  notifications.push(
    { id: uid('nt_'), userId: reporter1.id, title: 'Evidence received', body: 'Your report CX-2026-0001 repair is awaiting admin verification.', type: 'STATUS_UPDATE', read: false, at: daysAgo(1, 3), link: '/citizen/reports' },
    { id: uid('nt_'), userId: reporter1.id, title: 'Report CX-2026-0003 received', body: 'Our AI triaged your report as pothole · moderate. It is awaiting admin review.', type: 'REPORT_RECEIVED', read: false, at: daysAgo(0, 4), link: '/citizen/reports' },
    { id: uid('nt_'), userId: reporter2.id, title: 'Rework requested on CX-2026-0004', body: 'Admin requested rework. The crew has been notified.', type: 'REWORK', read: true, at: daysAgo(3, 1), link: '/citizen/reports' },
    { id: uid('nt_'), userId: 'usr_worker', title: 'New job assigned: CX-2026-0001', body: 'Pothole · HIGH priority · 100 Feet Rd, Indiranagar. Score 91.5.', type: 'WORKER_JOB', read: false, at: daysAgo(5, 8), link: '/worker/jobs' },
    { id: uid('nt_'), userId: 'usr_w_thomas', title: 'Rework requested: CX-2026-0004', body: 'Photo evidence rejected — re-align the pole and resubmit.', type: 'REWORK', read: false, at: daysAgo(3, 1), link: '/worker/rework' },
    { id: uid('nt_'), userId: 'usr_worker', title: 'Job assigned: CX-2026-0001 (verification)', body: 'Your evidence is pending admin review. No action needed unless rework is requested.', type: 'GENERAL', read: true, at: daysAgo(1, 3), link: '/worker/jobs' },
    { id: uid('nt_'), userId: admin.id, title: '1 repair awaiting verification', body: 'CX-2026-0001 (pothole · Indiranagar) is pending your review.', type: 'ADMIN_ALERT', read: false, at: daysAgo(1, 3), link: '/admin/verification' },
    { id: uid('nt_'), userId: admin.id, title: 'New report: CX-2026-0003', body: 'Pothole at 80 Feet Road, Koramangala · moderate severity.', type: 'ADMIN_ALERT', read: false, at: daysAgo(0, 4), link: '/admin/reports' },
  );

  const settings = {
    weights: { skill: 45, distance: 25, workload: 20, availability: 10 },
    autoAssign: true,
    aiProvider: 'heuristic' as const, // safe default; admin can switch to gemma-4 with a key
    gemmaModel: 'gemma-4-26b-a4b-it',
    gemmaApiKey: '',
    gemmaEndpoint: 'https://generativelanguage.googleapis.com/v1beta',
    mockLabel: 'DEVELOPMENT-ONLY MOCK — not real AI',
  };

  return {
    version: 1,
    seeded: true,
    users,
    workers,
    departments,
    zones: ZONES,
    issues,
    media,
    events,
    assignments,
    verifications: [],
    notifications,
    settings,
  };

  function makeIssue(partial: Omit<Issue, 'id' | 'updatedAt' | 'rejectedReason' | 'duplicateOfId' | 'priorityReason' | 'resolvedAt' | 'verifiedAt' | 'assignedAt' | 'startedAt' | 'voiceNote'> & { priorityReason?: string | null; resolvedAt?: number | null; verifiedAt?: number | null; assignedAt?: number | null; startedAt?: number | null }): Issue {
    return {
      id: `iss_${partial.ticketNo.toLowerCase().replace(/[^a-z0-9]/g, '')}_${Math.floor(Math.random() * 1e6)}`,
      updatedAt: Date.now(),
      rejectedReason: null,
      duplicateOfId: null,
      voiceNote: undefined,
      ...partial,
    } as Issue;
  }
  function m(issueId: string, type: Media['type'], storageKey: string, caption: string, uploadedBy: string, uploadedAt: number, phash?: string): Media {
    return { id: uid('med_'), issueId, type, storageKey, caption, uploadedBy, uploadedAt, phash };
  }
  function asg(issueId: string, workerId: string, workerName: string, score: number, breakdown: Assignment['breakdown'], source: Assignment['source'], createdAt: number): Assignment {
    return { id: uid('as_'), issueId, workerId, workerName, score, breakdown, reason: `Auto-ranked #1 of ${'3'} eligible candidates · skill ${breakdown.skill} · ${breakdown.distanceKm} km · load-aware assignment.`, source, createdById: null, createdByName: 'CivicXon Allocation Engine', status: 'ACTIVE', createdAt };
  }
  function ev(issueId: string, at: number, actor: { id: string; name: string; role: string } | null, type: IssueEvent['type'], message: string, meta?: Record<string, unknown>): IssueEvent {
    return { id: uid('evt_'), issueId, at, actorId: actor?.id ?? null, actorName: actor ? actor.name : 'CivicXon System', actorRole: (actor?.role as IssueEvent['actorRole']) ?? 'system', type, message, meta };
  }
}

function hashCode(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) { h = (h << 5) - h + s.charCodeAt(i); h |= 0; }
  return h;
}
