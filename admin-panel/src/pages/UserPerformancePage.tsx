import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { Performance } from '../lib/types';

export default function UserPerformancePage() {
  const [rows, setRows] = useState<Performance[]>([]);
  useEffect(() => { (async () => {
    const { data } = await supabase.from('admin_user_performance').select('*').limit(200);
    setRows((data ?? []) as any);
  })(); }, []);

  return (
    <div className="p-8">
      <h1 className="text-3xl font-black">User Performance</h1>
      <p className="text-muted mb-6">Latest 200 attempts</p>
      <div className="bg-panel border border-border rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-border/40 text-muted text-[11px] tracking-widest">
            <tr>
              <th className="p-3 text-left">User</th>
              <th className="p-3 text-left">Test</th>
              <th className="p-3 text-center">Score</th>
              <th className="p-3 text-center">Accuracy</th>
              <th className="p-3 text-center">Duration</th>
              <th className="p-3 text-left">Submitted</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.attempt_id} className="border-t border-border hover:bg-border/20">
                <td className="p-3 font-mono text-xs text-muted">{r.user_id?.slice(0, 8)}…</td>
                <td className="p-3">{r.test_title}</td>
                <td className="p-3 text-center font-bold">{r.score}/{r.question_count}</td>
                <td className="p-3 text-center">
                  <span className={`px-2 py-1 rounded font-black ${r.accuracy_pct >= 70 ? 'bg-success/20 text-success' : r.accuracy_pct >= 40 ? 'bg-primary/20 text-primary' : 'bg-danger/20 text-danger'}`}>
                    {r.accuracy_pct}%
                  </span>
                </td>
                <td className="p-3 text-center text-muted">{Math.floor((r.duration_seconds || 0) / 60)}m</td>
                <td className="p-3 text-muted text-xs">{new Date(r.submitted_at).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
