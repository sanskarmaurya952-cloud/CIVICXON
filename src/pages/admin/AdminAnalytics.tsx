import { useMemo } from 'react';
import { BarChart as BarChartIcon, TrendingUp, Timer, Wrench, Award, PieChart as PieIcon, Gauge } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, CartesianGrid, LineChart, Line, Legend } from 'recharts';
import { useStore } from '../../lib/store';
import { Card, CardHeader, StatCard, EmptyState } from '../../components/ui';
import { ISSUE_STATUS_META } from '../../lib/types';

const STATUS_COLORS: Record<string, string> = { REPORTED: '#64748b', UNDER_REVIEW: '#d97706', ASSIGNED: '#2563eb', IN_PROGRESS: '#0891b2', PENDING_VERIFICATION: '#7c3aed', VERIFIED: '#059669', REWORK_REQUIRED: '#ea580c', REJECTED: '#e11d48', DUPLICATE: '#9ca3af', CANCELLED: '#6b7280' };
const PIE_COLORS = ['#f59e0b', '#3b82f6', '#10b981', '#8b5cf6', '#ec4899', '#14b8a6'];

export default function AdminAnalytics() {
  const { db } = useStore();
  const issues = db?.issues ?? [];

  const data = useMemo(() => {
    const byCategory = [
      { name: 'Pothole', count: issues.filter(i => i.category === 'pothole').length },
      { name: 'Streetlight', count: issues.filter(i => i.category === 'streetlight').length },
    ];
    const byStatus = Object.entries(ISSUE_STATUS_META).map(([k, v]) => ({ name: v.label, key: k, count: issues.filter(i => i.status === (k as any)).length })).filter(x => x.count > 0);
    const byPriority = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].map(p => ({ name: p, count: issues.filter(i => i.priority === p).length }));
    // last 14 days reported vs verified
    const days: { day: string; reported: number; verified: number }[] = [];
    for (let d = 13; d >= 0; d--) {
      const start = new Date(); start.setHours(0, 0, 0, 0); start.setDate(start.getDate() - d);
      const end = start.getTime() + 86400000;
      days.push({
        day: start.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }),
        reported: issues.filter(i => i.createdAt >= start.getTime() && i.createdAt < end).length,
        verified: issues.filter(i => i.verifiedAt && i.verifiedAt >= start.getTime() && i.verifiedAt < end).length,
      });
    }
    // avg resolution hours
    const resolvedTimes = issues.filter(i => i.verifiedAt).map(i => (i.verifiedAt! - i.createdAt) / 3600000);
    const avgResolutionH = resolvedTimes.length ? resolvedTimes.reduce((a, b) => a + b, 0) / resolvedTimes.length : 0;
    const avgRework = issues.length ? issues.reduce((a, b) => a + b.reworkCount, 0) / issues.length : 0;
    const verificationRate = issues.filter(i => ['VERIFIED'].includes(i.status)).length;
    const workerStats = (db?.workers ?? []).map(w => {
      const user = db?.users.find(u => u.id === w.userId);
      const assigned = issues.filter(i => i.assignedWorkerId === w.id).length;
      const done = w.jobsCompleted;
      return { name: user?.name.split(' ')[0] ?? 'Worker', assigned, done, rating: w.rating };
    });
    return { byCategory, byStatus, byPriority, days, avgResolutionH, avgRework, verificationRate, workerStats };
  }, [issues, db?.workers, db?.users]);

  if (!db) return <Card><EmptyState title="Loading analytics…" /></Card>;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-display text-2xl font-extrabold tracking-tight text-navy-900">City operations analytics</h1>
        <p className="text-[11.5px] text-slate-500">Computed live from the database — every chart reflects real records</p>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Total issues" value={issues.length} icon={Gauge} tone="navy" />
        <StatCard label="Verified closed" value={data.verificationRate} icon={Award} tone="emerald" sub={`${issues.length ? Math.round((data.verificationRate / issues.length) * 100) : 0}% of all reports`} />
        <StatCard label="Avg. closure time" value={`${data.avgResolutionH.toFixed(1)}h`} icon={Timer} tone="cyan" sub="report → verified" />
        <StatCard label="Avg. reworks" value={data.avgRework.toFixed(2)} icon={Wrench} tone="amber" sub="per ticket" />
      </div>

      <div className="grid gap-4 xl:grid-cols-5">
        <Card className="xl:col-span-3">
          <CardHeader icon={TrendingUp} title="Reported vs verified — last 14 days" subtitle="Daily intake vs closures across both departments" />
          <div className="h-64 px-2 pb-4 pt-2">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data.days} margin={{ top: 8, right: 12, left: -8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                <XAxis dataKey="day" tick={{ fontSize: 9, fill: '#64748b' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 9, fill: '#64748b' }} axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 11 }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line type="monotone" dataKey="reported" name="Reported" stroke="#f2b33d" strokeWidth={2.5} dot={{ r: 2.5 }} />
                <Line type="monotone" dataKey="verified" name="Verified" stroke="#059669" strokeWidth={2.5} dot={{ r: 2.5 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card className="xl:col-span-2">
          <CardHeader icon={BarChartIcon} title="By issue type & priority" subtitle="Where the work is concentrated" />
          <div className="h-56 px-2 pt-2">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.byCategory} margin={{ top: 8, right: 12, left: -12, bottom: 0 }} barSize={44}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#475569' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 9, fill: '#64748b' }} axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip cursor={{ fill: 'rgba(12,26,51,.05)' }} contentStyle={{ borderRadius: 12, fontSize: 11 }} />
                <Bar dataKey="count" name="Issues" radius={[8, 8, 0, 0]}>{data.byCategory.map((entry, i) => <Cell key={i} fill={i === 0 ? '#b4530a' : '#1d4ed8'} />)}</Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="px-5 pb-4">
            <p className="mb-1.5 text-[9px] font-bold uppercase tracking-[0.18em] text-slate-400">Priority distribution</p>
            <div className="flex h-5 w-full overflow-hidden rounded-full ring-1 ring-slate-200">{data.byPriority.map(p => {
              const total = data.byPriority.reduce((a, b) => a + b.count, 0) || 1;
              const pct = (p.count / total) * 100;
              const color = p.name === 'CRITICAL' ? '#e11d48' : p.name === 'HIGH' ? '#ea580c' : p.name === 'MEDIUM' ? '#d97706' : '#94a3b8';
              return pct > 0 ? <div key={p.name} style={{ width: `${pct}%`, background: color }} title={`${p.name}: ${p.count}`} /> : null;
            })}</div>
            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[9px] font-semibold text-slate-500">{data.byPriority.map(p => <span key={p.name}>{p.name}: {p.count}</span>)}</div>
          </div>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-5">
        <Card className="xl:col-span-2">
          <CardHeader icon={PieIcon} title="Status composition" subtitle="Live snapshot of the whole pipeline" />
          <div className="flex h-56 items-center justify-center">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={data.byStatus} dataKey="count" nameKey="name" innerRadius={52} outerRadius={80} paddingAngle={3} strokeWidth={2}>
                  {data.byStatus.map((entry, i) => <Cell key={i} fill={STATUS_COLORS[entry.key] ?? PIE_COLORS[i % PIE_COLORS.length]} />)}
                </Pie>
                <Tooltip contentStyle={{ borderRadius: 12, fontSize: 11 }} />
                <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 10 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card className="xl:col-span-3">
          <CardHeader icon={Award} title="Workforce throughput" subtitle="Assigned load vs verified closures per crew" />
          <div className="h-56 px-2 pb-3 pt-2">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.workerStats} layout="vertical" margin={{ top: 4, right: 12, left: 8, bottom: 0 }} barSize={10}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" horizontal={false} />
                <XAxis type="number" hide allowDecimals={false} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 9.5, fill: '#475569' }} axisLine={false} tickLine={false} width={64} />
                <Tooltip cursor={{ fill: 'rgba(12,26,51,.05)' }} contentStyle={{ borderRadius: 12, fontSize: 11 }} />
                <Legend wrapperStyle={{ fontSize: 10 }} />
                <Bar dataKey="assigned" name="Assigned" fill="#0c1a33" radius={[0, 6, 6, 0]} barSize={8} />
                <Bar dataKey="done" name="Verified jobs" fill="#f2b33d" radius={[0, 6, 6, 0]} barSize={8} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>
    </div>
  );
}
