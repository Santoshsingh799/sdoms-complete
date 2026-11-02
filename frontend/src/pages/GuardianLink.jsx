import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { CheckCircle2, XCircle, Clock } from 'lucide-react';
import { api, errMsg, fmt, Spinner } from '../lib.jsx';

// Public page opened from the SMS link. No login, no app.
export default function GuardianLink() {
  const { token } = useParams();
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const [done, setDone] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { api.get(`/g/${token}`).then((r) => setD(r.data)).catch((e) => setErr(errMsg(e))); }, [token]);

  const decide = async (decision) => {
    if (!confirm(decision === 'APPROVE' ? 'Approve this outpass?' : 'Reject this outpass?')) return;
    setBusy(true);
    try { await api.post(`/g/${token}`, { decision }); setDone(decision); }
    catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  };

  const Row = ({ k, v }) => <div className="flex justify-between gap-4 py-2 border-b border-slate-100 text-sm"><span className="text-slate-500">{k}</span><span className="font-medium text-right">{v}</span></div>;
  if (!d && !err) return <Spinner />;
  const msgs = { ALREADY_ANSWERED: 'You have already answered this request.', EXPIRED: 'This link has expired.', CLOSED: 'This request has already been decided by another guardian.' };
  return (
    <div className="min-h-screen bg-slate-100 p-4 grid place-items-center">
      <div className="bg-white w-full max-w-md rounded-2xl shadow-lg p-6">
        {err && !d && <div className="text-center text-rose-600"><XCircle className="mx-auto mb-2" size={40} />{err}</div>}
        {d && (
          <>
            <div className="text-center mb-4"><div className="text-xs uppercase tracking-wide text-slate-500">{d.college}</div><h1 className="text-lg font-bold">Outpass request</h1><p className="text-sm text-slate-500">Hello {d.guardianName}</p></div>
            <Row k="Student" v={d.student.name} /><Row k="Enrollment" v={d.student.enrollmentNo} /><Row k="Course" v={`${d.student.course}, ${d.student.branch}`} />
            <Row k="Destination" v={d.destination} /><Row k="Reason" v={d.reason} /><Row k="Leaving" v={fmt(d.leaveTime)} /><Row k="Returning" v={fmt(d.returnTime)} />
            {done ? (
              <div className={`mt-5 text-center ${done === 'APPROVE' ? 'text-emerald-600' : 'text-rose-600'}`}>
                {done === 'APPROVE' ? <CheckCircle2 className="mx-auto" size={44} /> : <XCircle className="mx-auto" size={44} />}
                <p className="font-semibold mt-1">{done === 'APPROVE' ? 'Approved. Thank you!' : 'Rejected.'}</p>
                <p className="text-xs text-slate-500">You can close this page.</p>
              </div>
            ) : d.state === 'OPEN' ? (
              <>
                {err && <p className="text-rose-600 text-sm mt-3">{err}</p>}
                <div className="grid grid-cols-2 gap-3 mt-5">
                  <button disabled={busy} onClick={() => decide('REJECT')} className="rounded-xl bg-rose-600 py-4 text-lg font-bold text-white disabled:opacity-50">REJECT</button>
                  <button disabled={busy} onClick={() => decide('APPROVE')} className="rounded-xl bg-emerald-600 py-4 text-lg font-bold text-white disabled:opacity-50">APPROVE</button>
                </div>
              </>
            ) : <div className="mt-5 text-center text-slate-600"><Clock className="mx-auto mb-1" />{msgs[d.state]}</div>}
          </>
        )}
      </div>
    </div>
  );
}
