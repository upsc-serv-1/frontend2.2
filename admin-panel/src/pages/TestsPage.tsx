import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { Plus, Trash2, Edit3, Save, X } from 'lucide-react';
import type { Test } from '../lib/types';

const empty: Partial<Test> = { title: '', provider: '', institute: '', program_name: '', question_count: 0, default_minutes: 60 };

export default function TestsPage() {
  const [rows, setRows] = useState<Test[]>([]);
  const [editing, setEditing] = useState<Partial<Test> | null>(null);

  const load = async () => {
    const { data } = await supabase.from('tests').select('*').order('created_at', { ascending: false });
    setRows((data ?? []) as any);
  };
  useEffect(() => { load(); }, []);

  const save = async () => {
    if (!editing) return;
    if (editing.id) await supabase.from('tests').update(editing).eq('id', editing.id);
    else await supabase.from('tests').insert(editing);
    setEditing(null); load();
  };

  return (
    <div className="p-8">
      <div className="flex justify-between items-center mb-6">
        <div><h1 className="text-3xl font-black">Test Papers</h1><p className="text-muted">{rows.length} tests</p></div>
        <button onClick={() => setEditing(empty)} className="flex items-center gap-2 bg-primary text-black font-bold px-4 py-2 rounded"><Plus size={16} /> New</button>
      </div>

      <div className="bg-panel border border-border rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-border/40 text-muted text-[11px] tracking-widest">
            <tr><th className="p-3 text-left">Title</th><th className="p-3 text-left">Institute</th><th className="p-3 text-left">Program</th><th className="p-3">Q's</th><th className="p-3">Min</th><th></th></tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id} className="border-t border-border hover:bg-border/20">
                <td className="p-3 font-semibold">{r.title}</td>
                <td className="p-3 text-muted">{r.institute}</td>
                <td className="p-3 text-muted">{r.program_name}</td>
                <td className="p-3 text-center">{r.question_count}</td>
                <td className="p-3 text-center">{r.default_minutes}</td>
                <td className="p-3 text-right whitespace-nowrap">
                  <button onClick={() => setEditing(r)} className="p-2 text-muted hover:text-primary"><Edit3 size={16} /></button>
                  <button onClick={async () => { if (confirm('Delete?')) { await supabase.from('tests').delete().eq('id', r.id); load(); } }} className="p-2 text-muted hover:text-danger"><Trash2 size={16} /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50">
          <div className="bg-panel border border-border rounded-2xl w-full max-w-lg">
            <div className="flex justify-between items-center p-5 border-b border-border">
              <h2 className="text-xl font-black">{editing.id ? 'Edit' : 'New'} Test</h2>
              <button onClick={() => setEditing(null)}><X /></button>
            </div>
            <div className="p-5 space-y-3">
              <Input label="Title" v={editing.title || ''} on={v => setEditing({ ...editing, title: v })} />
              <Input label="Provider" v={editing.provider || ''} on={v => setEditing({ ...editing, provider: v })} />
              <Input label="Institute" v={editing.institute || ''} on={v => setEditing({ ...editing, institute: v })} />
              <Input label="Program name" v={editing.program_name || ''} on={v => setEditing({ ...editing, program_name: v })} />
              <div className="grid grid-cols-2 gap-3">
                <Input label="Question count" type="number" v={String(editing.question_count ?? 0)} on={v => setEditing({ ...editing, question_count: parseInt(v) || 0 })} />
                <Input label="Default minutes" type="number" v={String(editing.default_minutes ?? 60)} on={v => setEditing({ ...editing, default_minutes: parseInt(v) || 0 })} />
              </div>
            </div>
            <div className="flex gap-2 p-5 border-t border-border">
              <button onClick={() => setEditing(null)} className="flex-1 py-3 border border-border rounded font-bold">Cancel</button>
              <button onClick={save} className="flex-1 py-3 bg-primary text-black font-black rounded flex items-center justify-center gap-2"><Save size={16} /> SAVE</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Input({ label, v, on, type = 'text' }: { label: string; v: string; on: (v: string) => void; type?: string }) {
  return (
    <label className="block">
      <div className="text-[10px] tracking-widest text-muted font-bold mb-1">{label.toUpperCase()}</div>
      <input type={type} className="w-full bg-bg border border-border rounded p-2" value={v} onChange={e => on(e.target.value)} />
    </label>
  );
}
