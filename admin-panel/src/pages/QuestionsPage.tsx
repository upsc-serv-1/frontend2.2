import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { Plus, Trash2, Edit3, Save, X } from 'lucide-react';
import type { Question } from '../lib/types';

const empty: Partial<Question> = {
  question_text: '', options: { a: '', b: '', c: '', d: '' }, correct_answer: 'a',
  explanation_markdown: '', subject: '', micro_topic: '', section_group: '', is_pyq: false,
  is_upsc_cse: false, is_allied: false, is_others: false,
};

export default function QuestionsPage() {
  const [rows, setRows] = useState<Question[]>([]);
  const [editing, setEditing] = useState<Partial<Question> | null>(null);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async () => {
    let q = supabase.from('questions').select('*').order('id', { ascending: false }).limit(200);
    if (search) q = q.ilike('question_text', `%${search}%`);
    const { data } = await q;
    setRows((data ?? []) as any);
  };
  useEffect(() => { load(); }, []);

  const save = async () => {
    if (!editing) return;
    setBusy(true);
    const payload: any = { ...editing };
    if (editing.id) {
      await supabase.from('questions').update(payload).eq('id', editing.id);
    } else {
      await supabase.from('questions').insert(payload);
    }
    setBusy(false); setEditing(null); load();
  };

  const remove = async (id: string) => {
    if (!confirm('Delete this question?')) return;
    await supabase.from('questions').delete().eq('id', id);
    load();
  };

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-black">Questions</h1>
          <p className="text-muted">{rows.length} loaded</p>
        </div>
        <div className="flex gap-2">
          <input className="bg-panel border border-border rounded px-3 py-2 text-sm" placeholder="Search…"
            value={search} onChange={e => setSearch(e.target.value)} onBlur={load} onKeyDown={e => e.key === 'Enter' && load()} />
          <button onClick={() => setEditing(empty)} className="flex items-center gap-2 bg-primary text-black font-bold px-4 py-2 rounded">
            <Plus size={16} /> New
          </button>
        </div>
      </div>

      <div className="bg-panel border border-border rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-border/40 text-muted text-[11px] tracking-widest">
            <tr><th className="p-3 text-left">Q</th><th className="p-3 text-left">Subject</th><th className="p-3 text-left">Micro topic</th><th className="p-3 text-left">PYQ</th><th className="p-3"></th></tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id} className="border-t border-border hover:bg-border/20">
                <td className="p-3 max-w-md truncate">{r.question_text}</td>
                <td className="p-3 text-muted">{r.subject}</td>
                <td className="p-3 text-muted">{r.micro_topic}</td>
                <td className="p-3">{r.is_pyq ? <span className="text-success">✓</span> : <span className="text-muted">—</span>}</td>
                <td className="p-3 text-right whitespace-nowrap">
                  <button onClick={() => setEditing(r)} className="p-2 text-muted hover:text-primary"><Edit3 size={16} /></button>
                  <button onClick={() => remove(r.id)} className="p-2 text-muted hover:text-danger"><Trash2 size={16} /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50">
          <div className="bg-panel border border-border rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-auto">
            <div className="flex items-center justify-between p-5 border-b border-border">
              <h2 className="text-xl font-black">{editing.id ? 'Edit' : 'New'} Question</h2>
              <button onClick={() => setEditing(null)}><X /></button>
            </div>
            <div className="p-5 space-y-4">
              <Field label="Question text"><textarea rows={3} className="w-full bg-bg border border-border rounded p-3" value={editing.question_text || ''} onChange={e => setEditing({ ...editing, question_text: e.target.value })} /></Field>
              <div className="grid grid-cols-2 gap-3">
                {(['a', 'b', 'c', 'd'] as const).map(k => (
                  <Field key={k} label={`Option ${k.toUpperCase()}`}>
                    <input className="w-full bg-bg border border-border rounded p-2"
                      value={(editing.options as any)?.[k] || ''}
                      onChange={e => setEditing({ ...editing, options: { ...(editing.options as any), [k]: e.target.value } })} />
                  </Field>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Correct answer">
                  <select className="w-full bg-bg border border-border rounded p-2" value={editing.correct_answer || 'a'} onChange={e => setEditing({ ...editing, correct_answer: e.target.value })}>
                    {['a', 'b', 'c', 'd'].map(k => <option key={k} value={k}>{k.toUpperCase()}</option>)}
                  </select>
                </Field>
                <Field label="Subject"><input className="w-full bg-bg border border-border rounded p-2" value={editing.subject || ''} onChange={e => setEditing({ ...editing, subject: e.target.value })} /></Field>
                <Field label="Micro topic"><input className="w-full bg-bg border border-border rounded p-2" value={editing.micro_topic || ''} onChange={e => setEditing({ ...editing, micro_topic: e.target.value })} /></Field>
                <Field label="Section group"><input className="w-full bg-bg border border-border rounded p-2" value={editing.section_group || ''} onChange={e => setEditing({ ...editing, section_group: e.target.value })} /></Field>
              </div>
              <Field label="Explanation (markdown)"><textarea rows={5} className="w-full bg-bg border border-border rounded p-3 font-mono text-sm" value={editing.explanation_markdown || ''} onChange={e => setEditing({ ...editing, explanation_markdown: e.target.value })} /></Field>
              <div className="flex gap-4 flex-wrap">
                <Toggle label="PYQ" v={!!editing.is_pyq} onChange={v => setEditing({ ...editing, is_pyq: v })} />
                <Toggle label="UPSC CSE" v={!!editing.is_upsc_cse} onChange={v => setEditing({ ...editing, is_upsc_cse: v })} />
                <Toggle label="Allied" v={!!editing.is_allied} onChange={v => setEditing({ ...editing, is_allied: v })} />
                <Toggle label="Others" v={!!editing.is_others} onChange={v => setEditing({ ...editing, is_others: v })} />
              </div>
            </div>
            <div className="flex gap-2 p-5 border-t border-border">
              <button onClick={() => setEditing(null)} className="flex-1 py-3 border border-border rounded font-bold">Cancel</button>
              <button disabled={busy} onClick={save} className="flex-1 py-3 bg-primary text-black font-black rounded flex items-center justify-center gap-2 disabled:opacity-50"><Save size={16} /> SAVE</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><div className="text-[10px] tracking-widest text-muted font-bold mb-1">{label.toUpperCase()}</div>{children}</label>;
}
function Toggle({ label, v, onChange }: { label: string; v: boolean; onChange: (v: boolean) => void }) {
  return <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={v} onChange={e => onChange(e.target.checked)} />{label}</label>;
}
