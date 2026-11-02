import React, { useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { useAuth, useFetch, useToast, errMsg, Btn, Input } from '../lib.jsx';

export default function Login() {
  const { login } = useAuth();
  const toast = useToast();
  const { data: college } = useFetch('/public/college');
  const [f, setF] = useState({ loginId: '', password: '' });
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault(); setBusy(true);
    try { await login(f.loginId, f.password); } catch (err) { toast(errMsg(err), 'err'); setBusy(false); }
  };
  return (
    <div className="min-h-screen grid place-items-center bg-gradient-to-br from-slate-900 to-blue-900 p-4">
      <form onSubmit={submit} className="bg-white rounded-2xl shadow-xl p-8 w-full max-w-sm space-y-4">
        <div className="text-center">
          <ShieldCheck className="mx-auto text-blue-600" size={40} />
          <h1 className="text-xl font-bold mt-2">Smart Digital Outpass</h1>
          <p className="text-sm text-slate-500">{college?.name}</p>
        </div>
        <Input label="Enrollment No. / Employee ID" value={f.loginId} onChange={(e) => setF({ ...f, loginId: e.target.value })} required />
        <Input label="Password" type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} required />
        <Btn className="w-full" disabled={busy}>{busy ? 'Signing in...' : 'Sign in'}</Btn>
        <p className="text-xs text-slate-400 text-center">Parents/guardians do not need to log in. Use the link sent by SMS.</p>
      </form>
    </div>
  );
}
