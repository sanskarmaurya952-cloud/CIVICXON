// Per-role portal navigation.
export interface NavEntry { to: string; label: string }

export const CITIZEN_NAV: NavEntry[] = [
  { to: '/citizen', label: 'Overview' },
  { to: '/citizen/report', label: 'Report Issue' },
  { to: '/citizen/reports', label: 'My Reports' },
];
export const WORKER_NAV: NavEntry[] = [
  { to: '/worker', label: 'Overview' },
  { to: '/worker/jobs', label: 'My Jobs' },
  { to: '/worker/rework', label: 'Rework' },
];
export const ADMIN_NAV: NavEntry[] = [
  { to: '/admin', label: 'Overview' },
  { to: '/admin/review', label: 'Review Queue' },
  { to: '/admin/verification', label: 'Verification' },
  { to: '/admin/complaints', label: 'All Complaints' },
  { to: '/admin/workers', label: 'Workers' },
  { to: '/admin/analytics', label: 'Analytics' },
];

export function navFor(role: 'citizen' | 'worker' | 'admin'): NavEntry[] {
  if (role === 'admin') return ADMIN_NAV;
  if (role === 'worker') return WORKER_NAV;
  return CITIZEN_NAV;
}

export function routeFor(role: 'citizen' | 'worker' | 'admin'): string {
  return role === 'admin' ? '/admin' : role === 'worker' ? '/worker' : '/citizen';
}

export const WORKFLOW_STEPS = [
  { label: 'Reported' },
  { label: 'Under Review' },
  { label: 'Assigned' },
  { label: 'In Progress' },
  { label: 'Verification' },
  { label: 'Verified' },
];

export const SAMPLE_CSV = `name,email,phone,department,skills,zones,availability,maxJobs,baseLat,baseLng,password
Ramesh Kumar,r.kumar@civicxon.gov.demo,+91 9845123001,ROAD,road_maintenance,"Central|North",AVAILABLE,3,12.9745,77.5998,Civicxon@2026
Sunita Devi,s.devi@civicxon.gov.demo,+91 9845123002,STREET,streetlight_maintenance,"South|Central",AVAILABLE,3,12.9301,77.5890,Civicxon@2026
Mahesh Gowda,m.gowda@civicxon.gov.demo,+91 9845123003,ROAD,road_maintenance,East,BUSY,2,12.9835,77.6500,Civicxon@2026`;
