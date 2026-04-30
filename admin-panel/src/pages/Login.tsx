import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { Lock } from 'lucide-react';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setErr(error.message);
    setBusy(false);
  };

  return (
    <div className="h-screen flex items-center justify-center bg-bg">
      <form onSubmit={submit} className="w-full max-w-sm bg-panel p-8 rounded-2xl border border-border">
        <div className="flex items-center gap-3 mb-6">
          <div className="p-2 bg-primary rounded-lg"><Lock className="text-black" size={20} /></div>
          <div>
            <div className="text-primary text-xs font-black tracking-widest">DR. UPSC</div>
            <div className="font-bold text-lg">Admin Sign-in</div>
          </div>
        </div>
        <input className="w-full p-3 mb-3 bg-bg border border-border rounded text-ink" type="email"
          placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} required />
        <input className="w-full p-3 mb-4 bg-bg border border-border rounded text-ink" type="password"
          placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} required />
        {err && <div className="text-danger text-sm mb-3">{err}</div>}
        <button disabled={busy} className="w-full py-3 bg-primary text-black font-black rounded disabled:opacity-50">
          {busy ? 'Signing in…' : 'SIGN IN'}
        </button>
        <p className="text-muted text-xs mt-4">Use your Supabase auth credentials. Account must exist in <code>admin_users</code>.</p>
      </form>
    </div>
  );
}
