import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Download, QrCode, RefreshCw, X, Trash2, Plus, BadgeCheck, Clock } from 'lucide-react';
import { api, errMsg, fmt, Badge, Btn, Card, Input, Spinner, useFetch, useToast } from '../lib.jsx';

function Seal({ passNumber, college }) {
  return (
    <svg viewBox="0 0 120 120" className="w-24 h-24 text-blue-700">
      <circle cx="60" cy="60" r="54" fill="none" stroke="currentColor" strokeWidth="3" />
      <circle cx="60" cy="60" r="46" fill="none" stroke="currentColor" strokeWidth="1" />
      <text x="60" y="46" textAnchor="middle" fontSize="8" fill="currentColor">{(college || '').slice(0, 22)}</text>
      <text x="60" y="64" textAnchor="middle" fontSize="10" fontWeight="bold" fill="currentColor">APPROVED</text>
      <text x="60" y="80" textAnchor="middle" fontSize="7" fill="currentColor">{passNumber}</text>
    </svg>
  );
}

function PassModal({ id, onClose }) {
  const { data: p, loading } = useFetch(`/outpass/${id}/pass`);
  const toast = useToast();
  const download = async () => {
    try {
      const r = await api.get(`/outpass/${id}/pass.pdf`, { responseType: 'blob' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(r.data); a.download = `${p.passNumber}.pdf`; a.click();
    } catch (e) { toast(errMsg(e), 'err'); }
  };
  return (
    <div className="fixed inset-0 bg-black/50 z-40 grid place-items-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-md p-5 max-h-[90vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between"><h3 className="font-bold">Digital Outpass</h3><button onClick={onClose}><X /></button></div>
        {loading || !p ? <Spinner /> : (
          <div className="text-sm mt-2">
            <div className="text-center"><div className="text-xs uppercase text-slate-500">{p.college}</div><div className="font-mono font-bold">{p.passNumber}</div></div>
            <div className="flex justify-center my-2"><img src={p.qr} alt="QR" className="w-48 h-48" /></div>
            {p.isCancelled && <p className="text-center text-rose-600 font-semibold">CANCELLED</p>}
            <div className="space-y-1">
              <div><b>{p.student.name}</b> ({p.student.enrollmentNo})</div>
              <div>{p.student.course}, {p.student.branch}, Sem {p.student.semester}</div>
              <div><b>To:</b> {p.destination} - {p.reason}</div>
              <div><b>Leave:</b> {fmt(p.leaveTime)}</div><div><b>Return:</b> {fmt(p.returnTime)}</div>
              <div><b>Guardian:</b> {p.guardianApproval || '-'} | <b>Mentor:</b> {p.mentorApproval}</div>
            </div>
            <div className="flex items-center justify-between mt-3"><Seal passNumber={p.passNumber} college={p.college} /><Btn onClick={download}><Download size={14} className="inline mr-1" />PDF</Btn></div>
          </div>
        )}
      </div>
    </div>
  );
}

export function StudentHome() {
  const { data, loading, reload } = useFetch('/outpass');
  const [pass, setPass] = useState(null);
  const toast = useToast();
  const act = async (id, what, okMsg) => {
    try { await api.post(`/outpass/${id}/${what}`); toast(okMsg); reload(); } catch (e) { toast(errMsg(e), 'err'); }
  };
  if (loading) return <Spinner />;
  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center"><h1 className="text-xl font-bold">My Outpasses</h1><Btn onClick={reload} color="gray"><RefreshCw size={14} className="inline mr-1" />Refresh</Btn></div>
      {!data?.length && <Card>No requests yet. Create one from "New Request".</Card>}
      {data?.map((r) => (
        <Card key={r.id} title={r.destination} right={<Badge status={r.status} />}>
          <div className="text-sm grid sm:grid-cols-2 gap-1">
            <div><b>Reason:</b> {r.reason}</div><div><b>Leaving:</b> {fmt(r.leaveTime)}</div><div><b>Returning:</b> {fmt(r.returnTime)}</div>
            <div className="flex items-center gap-1"><Clock size={14} /> Guardians: {r.guardianApprovals.map((g) => `${g.guardian.name} (${g.decision.toLowerCase()})`).join(', ')}</div>
            {r.mentorApproval?.remark && <div className="sm:col-span-2"><b>Mentor remark:</b> {r.mentorApproval.remark}</div>}
          </div>
          <div className="flex flex-wrap gap-2 mt-3">
            {r.digitalOutpass && ['APPROVED', 'EXITED', 'RETURNED'].includes(r.status) && <Btn onClick={() => setPass(r.id)}><QrCode size={14} className="inline mr-1" />View / Download pass</Btn>}
            {r.status === 'PENDING_GUARDIAN' && <Btn color="gray" onClick={() => act(r.id, 'resend', 'SMS sent again')}>Resend SMS</Btn>}
            {['PENDING_GUARDIAN', 'PENDING_MENTOR', 'APPROVED'].includes(r.status) && <Btn color="red" onClick={() => confirm('Cancel this request?') && act(r.id, 'cancel', 'Cancelled')}>Cancel</Btn>}
          </div>
        </Card>
      ))}
      {pass && <PassModal id={pass} onClose={() => setPass(null)} />}
    </div>
  );
}

export function NewRequest() {
  const { data: gs, loading } = useFetch('/outpass/guardians');
  const { data: me } = useFetch('/auth/me');
  const nav = useNavigate();
  const toast = useToast();
  const [sel, setSel] = useState([]);
  const [f, setF] = useState({ destination: '', reason: '', leaveTime: '', returnTime: '', emergencyMobile: '' });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const toggle = (id) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const submit = async (e) => {
    e.preventDefault(); setBusy(true);
    try {
      await api.post('/outpass', { ...f, leaveTime: new Date(f.leaveTime).toISOString(), returnTime: new Date(f.returnTime).toISOString(), guardianLinkIds: sel });
      toast('Request sent. SMS delivered to selected guardians.'); nav('/student');
    } catch (e) { toast(errMsg(e) + (e.response?.data?.details ? ' (check form fields)' : ''), 'err'); setBusy(false); }
  };
  if (loading) return <Spinner />;
  const s = me?.student, u = me?.user;
  return (
    <form onSubmit={submit} className="space-y-4 max-w-2xl">
      <h1 className="text-xl font-bold">New Outpass Request</h1>
      <Card title="Your details">
        <div className="grid sm:grid-cols-2 gap-1 text-sm text-slate-600">
          <div>Name: <b>{u?.name}</b></div><div>Enrollment: <b>{s?.enrollmentNo}</b></div><div>Course: <b>{s?.course}</b></div>
          <div>Branch: <b>{s?.branch}</b></div><div>Semester: <b>{s?.semester}</b></div><div>Mobile: <b>{s?.mobile}</b></div>
        </div>
      </Card>
      <Card title="Trip details">
        <div className="grid sm:grid-cols-2 gap-3">
          <Input label="Destination" value={f.destination} onChange={set('destination')} required />
          <Input label="Emergency contact number" value={f.emergencyMobile} onChange={set('emergencyMobile')} inputMode="numeric" maxLength={10} required />
          <Input label="Leaving date & time" type="datetime-local" value={f.leaveTime} onChange={set('leaveTime')} required />
          <Input label="Expected return date & time" type="datetime-local" value={f.returnTime} onChange={set('returnTime')} required />
          <div className="sm:col-span-2"><Input label="Reason for leaving" value={f.reason} onChange={set('reason')} required /></div>
        </div>
      </Card>
      <Card title="Send approval request to (select 1-5)">
        {!gs?.length ? <p className="text-sm">Add guardians first in "My Guardians".</p> : gs.map((g) => (
          <label key={g.id} className={`flex items-center gap-3 py-2 border-b last:border-0 ${!g.isVerified && 'opacity-50'}`}>
            <input type="checkbox" disabled={!g.isVerified} checked={sel.includes(g.id)} onChange={() => toggle(g.id)} />
            <span className="flex-1">{g.name} <span className="text-slate-500 text-sm">({g.relation}, ******{g.mobile.slice(-4)})</span></span>
            {g.isVerified ? <span className="text-emerald-600 text-xs flex items-center gap-1"><BadgeCheck size={14} />Verified</span> : <span className="text-amber-600 text-xs">Awaiting college verification</span>}
          </label>
        ))}
        <p className="text-xs text-slate-500 mt-2">Only one guardian's approval is needed. All selected guardians get the SMS.</p>
      </Card>
      <Btn disabled={busy || !sel.length}>{busy ? 'Submitting...' : 'Submit request'}</Btn>
    </form>
  );
}

export function MyGuardians() {
  const { data, loading, reload } = useFetch('/outpass/guardians');
  const toast = useToast();
  const [f, setF] = useState({ name: '', mobile: '', relation: 'Father' });
  const add = async (e) => {
    e.preventDefault();
    try { const r = await api.post('/outpass/guardians', f); toast(r.data.message); setF({ name: '', mobile: '', relation: 'Father' }); reload(); } catch (e) { toast(errMsg(e), 'err'); }
  };
  const del = async (id) => { try { await api.delete(`/outpass/guardians/${id}`); reload(); } catch (e) { toast(errMsg(e), 'err'); } };
  return (
    <div className="space-y-4 max-w-2xl">
      <h1 className="text-xl font-bold">My Guardians</h1>
      <Card title="Saved (max 5)">
        {loading ? <Spinner /> : !data?.length ? 'None added.' : data.map((g) => (
          <div key={g.id} className="flex items-center gap-3 py-2 border-b last:border-0 text-sm">
            <div className="flex-1"><b>{g.name}</b> - {g.relation} - {g.mobile}</div>
            {g.isVerified ? <span className="text-emerald-600 flex items-center gap-1"><BadgeCheck size={14} />Verified</span> : <span className="text-amber-600">Pending verification</span>}
            <button onClick={() => del(g.id)} className="text-rose-600"><Trash2 size={16} /></button>
          </div>
        ))}
      </Card>
      <Card title="Add guardian">
        <form onSubmit={add} className="grid sm:grid-cols-3 gap-3 items-end">
          <Input label="Name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required />
          <Input label="Mobile (10 digits)" value={f.mobile} onChange={(e) => setF({ ...f, mobile: e.target.value })} maxLength={10} required />
          <label className="text-sm"><span className="text-slate-600">Relation</span>
            <select value={f.relation} onChange={(e) => setF({ ...f, relation: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2">
              {['Father', 'Mother', 'Brother', 'Sister', 'Other Guardian'].map((r) => <option key={r}>{r}</option>)}</select></label>
          <Btn className="sm:col-span-3 w-fit"><Plus size={14} className="inline mr-1" />Add</Btn>
        </form>
        <p className="text-xs text-slate-500 mt-2">New numbers must be verified by college admin before they can approve outpasses.</p>
      </Card>
    </div>
  );
}
