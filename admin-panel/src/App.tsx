import { useEffect, useState } from 'react';
import { Routes, Route, Navigate, NavLink, useNavigate } from 'react-router-dom';
import { supabase } from './lib/supabase';
import { LayoutDashboard, FileQuestion, FileText, Users, LogOut } from 'lucide-react';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import QuestionsPage from './pages/QuestionsPage';
import TestsPage from './pages/TestsPage';
import UserPerformancePage from './pages/UserPerformancePage';

export default function App() {
  const [session, setSession] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      setSession(session);
      if (session?.user) {
        const { data } = await supabase.from('admin_users').select('role').eq('user_id', session.user.id).maybeSingle();
        setIsAdmin(!!data);
      }
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange(async (_e, s) => {
      setSession(s);
      if (s?.user) {
        const { data } = await supabase.from('admin_users').select('role').eq('user_id', s.user.id).maybeSingle();
        setIsAdmin(!!data);
      } else setIsAdmin(false);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  if (loading) return <div className="h-screen flex items-center justify-center text-muted">Loading…</div>;
  if (!session) return <Routes><Route path="*" element={<Login />} /></Routes>;
  if (!isAdmin) return (
    <div className="h-screen flex flex-col items-center justify-center gap-4 text-center px-6">
      <h1 className="text-2xl font-bold">Not authorized</h1>
      <p className="text-muted max-w-md">Your account exists but is not in the <code>admin_users</code> table. Ask a super-admin to add you, then log in again.</p>
      <button className="px-4 py-2 bg-primary text-black font-bold rounded" onClick={() => supabase.auth.signOut()}>Sign out</button>
    </div>
  );

  return <Shell />;
}

function Shell() {
  const navigate = useNavigate();
  return (
    <div className="min-h-screen flex bg-bg">
      <aside className="w-64 border-r border-border bg-panel p-4 flex flex-col gap-1">
        <div className="px-3 py-4 mb-2">
          <div className="text-primary font-black text-xl">Dr. UPSC</div>
          <div className="text-muted text-[11px] tracking-widest font-bold">ADMIN PANEL</div>
        </div>
        <NavItem to="/dashboard" icon={<LayoutDashboard size={18} />}>Dashboard</NavItem>
        <NavItem to="/questions" icon={<FileQuestion size={18} />}>Questions</NavItem>
        <NavItem to="/tests" icon={<FileText size={18} />}>Tests</NavItem>
        <NavItem to="/users" icon={<Users size={18} />}>User Performance</NavItem>
        <div className="mt-auto">
          <button onClick={async () => { await supabase.auth.signOut(); navigate('/'); }}
            className="w-full flex items-center gap-2 px-3 py-2 text-muted hover:text-ink hover:bg-border/40 rounded transition">
            <LogOut size={16} /> Sign out
          </button>
        </div>
      </aside>
      <main className="flex-1 overflow-auto">
        <Routes>
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/questions" element={<QuestionsPage />} />
          <Route path="/tests" element={<TestsPage />} />
          <Route path="/users" element={<UserPerformancePage />} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </main>
    </div>
  );
}

function NavItem({ to, icon, children }: any) {
  return (
    <NavLink to={to} className={({ isActive }) =>
      `flex items-center gap-3 px-3 py-2 rounded font-semibold transition ${
        isActive ? 'bg-primary text-black' : 'text-muted hover:text-ink hover:bg-border/40'
      }`
    }>
      {icon}<span>{children}</span>
    </NavLink>
  );
}
