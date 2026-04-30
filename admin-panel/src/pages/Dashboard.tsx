import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { FileQuestion, FileText, Users, Trophy } from 'lucide-react';

export default function Dashboard() {
  const [stats, setStats] = useState({ questions: 0, tests: 0, attempts: 0, avgAcc: 0 });
  useEffect(() => { (async () => {
    const [{ count: q }, { count: t }, { count: a }, { data: perfRows }] = await Promise.all([
      supabase.from('questions').select('*', { count: 'exact', head: true }),
      supabase.from('tests').select('*', { count: 'exact', head: true }),
      supabase.from('test_attempts').select('*', { count: 'exact', head: true }),
      supabase.from('admin_user_performance').select('accuracy_pct').limit(500),
    ]);
    const avgAcc = perfRows?.length ? Math.round(perfRows.reduce((s, r: any) => s + (r.accuracy_pct || 0), 0) / perfRows.length) : 0;
    setStats({ questions: q || 0, tests: t || 0, attempts: a || 0, avgAcc });
  })(); }, []);

  return (
    <div className="p-8">
      <h1 className="text-3xl font-black mb-1">Dashboard</h1>
      <p className="text-muted mb-6">Platform overview</p>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card icon={<FileQuestion className="text-primary" />} value={stats.questions} label="Total Questions" />
        <Card icon={<FileText className="text-primary" />} value={stats.tests} label="Test Papers" />
        <Card icon={<Users className="text-primary" />} value={stats.attempts} label="Total Attempts" />
        <Card icon={<Trophy className="text-primary" />} value={`${stats.avgAcc}%`} label="Avg Accuracy" />
      </div>
    </div>
  );
}

function Card({ icon, value, label }: any) {
  return (
    <div className="bg-panel border border-border rounded-xl p-5">
      <div className="flex items-center justify-between mb-4">{icon}</div>
      <div className="text-3xl font-black">{value}</div>
      <div className="text-muted text-xs font-bold tracking-widest mt-1">{label.toUpperCase()}</div>
    </div>
  );
}
