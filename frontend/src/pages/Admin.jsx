import React, { useState } from 'react';
import { api, errMsg, fmt, Badge, Btn, Card, Input, Spinner, STATUS, useFetch, useToast } from '../lib.jsx';

const TABS = [['overview', 'Overview'], ['guardians', 'Guardian Verification'], ['users', 'Users'], ['requests', 'Requests & Reports'], ['gate', 'Gate Log'], ['settings', 'College Settings']];

export default function Admin() {
  const [tab, setTab] = useState('overview');
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">Admin Dashboard</h1>
      <div className="flex gap-2 overflow-x-auto">{TABS.map(([k, l]) => <button key={k} onClick={() => setTab(k)} className={`whitespace-nowrap px-3 py-1.5 rounded-lg text-sm ${tab === k ? 'bg-blue-600 text-white' : 'bg-white border'}`}>{l}</button>)}</div>
      {tab === 'overview' && <Overview />}{tab === 'guardians' && <Guardians />}{tab === 'users' && <Users />}
      {tab === 'requests' && <Requests />}{tab === 'gate' && <Gate />}{tab === 'settings' && <Settings />}
    </div>
  );
}

function Overview() {
  const { data, loading } = useFetch('/admin/stats');
  if (loading) return <Spinner />;
  if (!data) return <Card title="Overview"><p className="text-sm text-rose-600">Unable to load admin statistics. Please refresh and try again.</p></Card>;
  const box = (l, v) => <div key={l} className="bg-white rounded-xl border p-4"><div className="text-2xl font-bold">{v ?? 0}</div><div className="text-xs text-slate-500">{l}</div></div>;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">{box('Students', data.students)}{box('Mentors', data.mentors)}{box('Guards', data.guards)}{box('Guardian numbers to verify', data.unverifiedGuardians)}</div>
      <Card title="Requests by status"><div className="grid grid-cols-2 md:grid-cols-3 gap-2">{Object.keys(STATUS).map((s) => <div key={s} className="flex justify-between text-sm border rounded-lg px-3 py-2"><Badge status={s} /><b>{data.byStatus[s] || 0}</b></div>)}</div></Card>
    </div>
  );
}

function Guardians() {
  const [f, setF] = useState('false');
  const { data, loading, reload } = useFetch(`/admin/guardian-links?verified=${f}`, [f]);
  const toast = useToast();
  const set = async (id, verified) => { try { await api.patch(`/admin/guardian-links/${id}/verify`, { verified }); reload(); } catch (e) { toast(errMsg(e), 'err'); } };
  return (
    <Card title="Verify guardian mobile numbers" right={<select value={f} onChange={(e) => setF(e.target.value)} className="border rounded px-2 py-1 text-sm"><option value="false">Unverified</option><option value="true">Verified</option><option value="all">All</option></select>}>
      <p className="text-xs text-slate-500 mb-2">Confirm each number with the parent (call / admission record) before verifying. Unverified numbers cannot approve outpasses.</p>
      {loading ? <Spinner /> : !data?.length ? 'Nothing to show.' : <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-left text-slate-500"><th>Student</th><th>Guardian</th><th>Relation</th><th>Mobile</th><th></th></tr></thead><tbody>
        {data.map((l) => <tr key={l.id} className="border-t"><td className="py-2">{l.student} ({l.enrollmentNo})</td><td>{l.guardian}</td><td>{l.relation}</td><td>{l.mobile}</td>
          <td className="text-right">{l.isVerified ? <Btn color="gray" onClick={() => set(l.id, false)}>Revoke</Btn> : <Btn color="green" onClick={() => set(l.id, true)}>Verify</Btn>}</td></tr>)}</tbody></table></div>}
    </Card>
  );
}

function Users() {
  const [role, setRole] = useState('STUDENT');
  const [q, setQ] = useState('');
  const { data, loading, reload } = useFetch(`/admin/users?role=${role}&q=${encodeURIComponent(q)}`, [role, q]);
  const { data: mentors } = useFetch('/admin/mentors');
  const toast = useToast();
  const [f, setF] = useState({ role: 'STUDENT', loginId: '', name: '', password: '', mobile: '', course: 'B.Tech', branch: '', semester: 1, department: '', mentorId: '' });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const create = async (e) => {
    e.preventDefault();
    try { await api.post('/admin/users', { ...f, semester: +f.semester, mobile: f.mobile || undefined, mentorId: f.mentorId || undefined }); toast('User created'); reload(); }
    catch (err) { toast(errMsg(err) + (err.response?.data?.details ? ': ' + JSON.stringify(err.response.data.details) : ''), 'err'); }
  };
  const assign = async (sid, mentorId) => { try { await api.patch(`/admin/students/${sid}/mentor`, { mentorId }); toast('Mentor assigned'); reload(); } catch (e) { toast(errMsg(e), 'err'); } };
  const toggle = async (u) => { try { await api.patch(`/admin/users/${u.id}/active`, { isActive: !u.isActive }); reload(); } catch (e) { toast(errMsg(e), 'err'); } };
  return (
    <div className="space-y-4">
      <Card title="Add user">
        <form onSubmit={create} className="grid sm:grid-cols-3 gap-3">
          <label className="text-sm">Role<select value={f.role} onChange={set('role')} className="mt-1 w-full rounded-lg border px-3 py-2">{['STUDENT', 'MENTOR', 'GUARD'].map((r) => <option key={r}>{r}</option>)}</select></label>
          <Input label={f.role === 'STUDENT' ? 'Enrollment No.' : 'Employee ID'} value={f.loginId} onChange={set('loginId')} required />
          <Input label="Full name" value={f.name} onChange={set('name')} required />
          <Input label="Initial password (min 8)" value={f.password} onChange={set('password')} required />
          <Input label="Mobile" value={f.mobile} onChange={set('mobile')} maxLength={10} />
          {f.role === 'STUDENT' && <><Input label="Course" value={f.course} onChange={set('course')} /><Input label="Branch" value={f.branch} onChange={set('branch')} /><Input label="Semester" type="number" value={f.semester} onChange={set('semester')} />
            <label className="text-sm">Mentor<select value={f.mentorId} onChange={set('mentorId')} className="mt-1 w-full rounded-lg border px-3 py-2"><option value="">-- none --</option>{mentors?.map((m) => <option key={m.id} value={m.id}>{m.user.name}</option>)}</select></label></>}
          {f.role === 'MENTOR' && <Input label="Department" value={f.department} onChange={set('department')} />}
          <div className="sm:col-span-3"><Btn>Create</Btn></div>
        </form>
      </Card>
      <Card title="Users" right={<div className="flex gap-2"><select value={role} onChange={(e) => setRole(e.target.value)} className="border rounded px-2 py-1 text-sm">{['STUDENT', 'MENTOR', 'GUARD', 'ADMIN'].map((r) => <option key={r}>{r}</option>)}</select><input placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} className="border rounded px-2 py-1 text-sm w-32" /></div>}>
        {loading ? <Spinner /> : <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-left text-slate-500"><th>ID</th><th>Name</th><th>Details</th><th>Mentor</th><th></th></tr></thead><tbody>
          {data?.map((u) => <tr key={u.id} className="border-t"><td className="py-2">{u.loginId}</td><td>{u.name}</td><td>{u.student ? `${u.student.course} ${u.student.branch} S${u.student.semester}` : u.mentor?.department || ''}</td>
            <td>{u.student && <select value={u.student.mentor?.id || ''} onChange={(e) => assign(u.student.id, e.target.value)} className="border rounded px-1 py-0.5"><option value="" disabled>assign</option>{mentors?.map((m) => <option key={m.id} value={m.id}>{m.user.name}</option>)}</select>}</td>
            <td className="text-right"><button onClick={() => toggle(u)} className={u.isActive ? 'text-rose-600' : 'text-emerald-600'}>{u.isActive ? 'Disable' : 'Enable'}</button></td></tr>)}</tbody></table></div>}
      </Card>
    </div>
  );
}

function Requests() {
  const [f, setF] = useState({ q: '', status: '', from: '', to: '' });
  const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v)).toString();
  const { data, loading } = useFetch(`/admin/requests?${qs}`, [qs]);
  const toast = useToast();
  const download = async (ext) => {
    try { const r = await api.get(`/admin/reports/requests.${ext}?${qs}`, { responseType: 'blob' }); const a = document.createElement('a'); a.href = URL.createObjectURL(r.data); a.download = `outpass-report.${ext}`; a.click(); }
    catch (e) { toast(errMsg(e), 'err'); }
  };
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <Card title="All requests" right={<div className="flex gap-2"><Btn color="gray" onClick={() => download('csv')}>CSV</Btn><Btn color="gray" onClick={() => download('pdf')}>PDF</Btn></div>}>
      <div className="grid sm:grid-cols-4 gap-2 mb-3">
        <input placeholder="Search name / enrollment" value={f.q} onChange={set('q')} className="border rounded-lg px-3 py-2 text-sm" />
        <select value={f.status} onChange={set('status')} className="border rounded-lg px-3 py-2 text-sm"><option value="">All statuses</option>{Object.entries(STATUS).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}</select>
        <input type="date" value={f.from} onChange={set('from')} className="border rounded-lg px-3 py-2 text-sm" /><input type="date" value={f.to} onChange={set('to')} className="border rounded-lg px-3 py-2 text-sm" />
      </div>
      {loading ? <Spinner /> : <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-left text-slate-500"><th>Student</th><th>Destination</th><th>Leave</th><th>Status</th><th>Exit</th><th>Return</th></tr></thead><tbody>
        {data?.map((r) => { const lg = r.digitalOutpass?.logs || []; const e = lg.find((l) => l.type === 'EXIT'), t = lg.find((l) => l.type === 'RETURN');
          return <tr key={r.id} className="border-t"><td className="py-2">{r.student.user.name}<div className="text-xs text-slate-500">{r.student.enrollmentNo}</div></td><td>{r.destination}</td><td>{fmt(r.leaveTime)}</td><td><Badge status={r.status} /></td><td>{e ? fmt(e.loggedAt) : '-'}</td><td>{t ? fmt(t.loggedAt) : '-'}</td></tr>; })}</tbody></table></div>}
    </Card>
  );
}

function Gate() {
  const { data, loading } = useFetch('/admin/movements');
  return <Card title="Exit / return records">{loading ? <Spinner /> : !data?.length ? 'No records.' : <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-left text-slate-500"><th>Time</th><th>Type</th><th>Student</th><th>Pass</th><th>Guard</th></tr></thead><tbody>
    {data.map((l) => <tr key={l.id} className="border-t"><td className="py-2">{fmt(l.at)}</td><td>{l.type}</td><td>{l.student} ({l.enrollmentNo})</td><td>{l.passNumber}</td><td>{l.guard}</td></tr>)}</tbody></table></div>}</Card>;
}

function Settings() {
  const { data, loading } = useFetch('/admin/settings');
  const toast = useToast();
  const [f, setF] = useState(null);
  const v = f || data;
  if (loading || !v) return <Spinner />;
  const save = async (e) => {
    e.preventDefault();
    try { await api.put('/admin/settings', { name: v.name, logoUrl: v.logoUrl || '', sealUrl: v.sealUrl || '' }); toast('Saved'); } catch (err) { toast(errMsg(err), 'err'); }
  };
  return (
    <Card title="College information"><form onSubmit={save} className="space-y-3 max-w-lg">
      <Input label="College name" value={v.name} onChange={(e) => setF({ ...v, name: e.target.value })} required />
      <Input label="Logo URL" value={v.logoUrl || ''} onChange={(e) => setF({ ...v, logoUrl: e.target.value })} />
      <Input label="Seal image URL" value={v.sealUrl || ''} onChange={(e) => setF({ ...v, sealUrl: e.target.value })} />
      <Btn>Save</Btn></form></Card>
  );
}
