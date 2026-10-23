import { HashRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useEffect, type ReactNode } from 'react';
import { StoreProvider, useStore } from './lib/store';
import { ToastProvider } from './components/Toast';
import Shell from './components/Shell';
import Landing from './pages/Landing';
import BootstrapAdmin from './pages/BootstrapAdmin';
import CitizenOverview from './pages/citizen/CitizenOverview';
import CitizenReport from './pages/citizen/CitizenReport';
import CitizenReports from './pages/citizen/CitizenReports';
import WorkerOverview from './pages/worker/WorkerOverview';
import WorkerJobs from './pages/worker/WorkerJobs';
import AdminOverview from './pages/admin/AdminOverview';
import AdminReview from './pages/admin/AdminReview';
import AdminVerification from './pages/admin/AdminVerification';
import AdminComplaints from './pages/admin/AdminComplaints';
import AdminWorkers from './pages/admin/AdminWorkers';
import AdminAnalytics from './pages/admin/AdminAnalytics';
import AdminSettings from './pages/admin/AdminSettings';
import AdminActivity from './pages/admin/AdminActivity';

type Role = 'citizen' | 'worker' | 'admin';

function RequireRole({ role, children }: { role: Role | Role[]; children: ReactNode }) {
  const { currentUser, ready } = useStore();
  const location = useLocation();
  const allowed = Array.isArray(role) ? role : [role];
  if (!ready) {
    return <div className="flex min-h-screen items-center justify-center bg-paper"><p className="font-mono2 text-xs uppercase tracking-widest text-slate-400">Initialising CivicXon…</p></div>;
  }
  if (!currentUser) return <Navigate to="/" replace state={{ from: location.pathname }} />;
  if (!allowed.includes(currentUser.role)) {
    const home = currentUser.role === 'admin' ? '/admin' : currentUser.role === 'worker' ? '/worker' : '/citizen';
    return <Navigate to={home} replace />;
  }
  return <>{children}</>;
}

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);
  return null;
}

export default function App() {
  return (
    <StoreProvider>
      <ToastProvider>
        <HashRouter>
          <ScrollToTop />
          <Routes>
            <Route path="/" element={<Landing />} />
            <Route path="/bootstrap-admin" element={<BootstrapAdmin />} />

            {/* ── CITIZEN PORTAL ── */}
            <Route path="/citizen" element={<RequireRole role="citizen"><Shell /></RequireRole>}>
              <Route index element={<CitizenOverview />} />
              <Route path="report" element={<CitizenReport />} />
              <Route path="reports" element={<CitizenReports />} />
            </Route>

            {/* ── WORKER PORTAL ── */}
            <Route path="/worker" element={<RequireRole role="worker"><Shell /></RequireRole>}>
              <Route index element={<WorkerOverview />} />
              <Route path="jobs" element={<WorkerJobs view="active" />} />
              <Route path="rework" element={<WorkerJobs view="rework" />} />
            </Route>

            {/* ── ADMIN PORTAL ── */}
            <Route path="/admin" element={<RequireRole role="admin"><Shell /></RequireRole>}>
              <Route index element={<AdminOverview />} />
              <Route path="review" element={<AdminReview />} />
              <Route path="verification" element={<AdminVerification />} />
              <Route path="complaints" element={<AdminComplaints />} />
              <Route path="workers" element={<AdminWorkers />} />
              <Route path="analytics" element={<AdminAnalytics />} />
              <Route path="settings" element={<AdminSettings />} />
              <Route path="activity" element={<AdminActivity />} />
            </Route>

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </HashRouter>
      </ToastProvider>
    </StoreProvider>
  );
}
