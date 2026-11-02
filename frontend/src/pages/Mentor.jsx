import React, { useState } from 'react';
import { api, errMsg, fmt, Badge, Btn, Card, Spinner, useFetch, useToast } from '../lib.jsx';

export default function Mentor() {
  const [tab, setTab] = useState('pending');
  const { data, loading, reload } = useFetch(`/mentor/requests?status=${tab === 'pending' ? 'pending' : 'all'}`, [tab]);
  const toast = useToast();
  const [remark, setRemark] = useState({});
  const decide = async (id, decision) => {
    try { await api.post(`/mentor/requests/${id}/decision`, { decision, remark: remark[id] || undefined }); toast(decision === 'APPROVE' ? 'Approved. Pass generated.' : 'Rejected'); reload(); }
    catch (e) { toast(errMsg(e), 'err'); reload(); }
  };
  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        {[['pending', 'Pending my approval'], ['all', 'History']].map(([k, l]) => <button key={k} onClick={() => setTab(k)} className={`px-3 py-1.5 rounded-lg text-sm ${tab === k ? 'bg-blue-600 text-white' : 'bg-white border'}`}>{l}</button>)}
      </div>
      {loading ? <Spinner /> : !data?.length ? <Card>Nothing here.</Card> : data.map((r) => (
        <Card key={r.id} title={`${r.student.user.name} (${r.student.enrollmentNo})`} right={<Badge status={r.status} />}>
          <div className="grid sm:grid-cols-2 gap-1 text-sm">
            <div><b>Destination:</b> {r.destination}</div><div><b>Reason:</b> {r.reason}</div>
            <div><b>Leaving:</b> {fmt(r.leaveTime)}</div><div><b>Returning:</b> {fmt(r.returnTime)}</div>
            <div className="sm:col-span-2"><b>Guardian approval:</b> {r.guardianApprovals.filter((g) => g.decision === 'APPROVED').map((g) => `${g.guardian.name} at ${fmt(g.decidedAt)}`).join(', ') || '-'}</div>
            {r.mentorApproval?.remark && <div className="sm:col-span-2"><b>Your remark:</b> {r.mentorApproval.remark}</div>}
          </div>
          {r.status === 'PENDING_MENTOR' && (
            <div className="mt-3 flex flex-wrap gap-2">
              <input placeholder="Optional remark" value={remark[r.id] || ''} onChange={(e) => setRemark({ ...remark, [r.id]: e.target.value })} className="flex-1 min-w-40 rounded-lg border px-3 py-2 text-sm" />
              <Btn color="green" onClick={() => decide(r.id, 'APPROVE')}>Approve</Btn><Btn color="red" onClick={() => decide(r.id, 'REJECT')}>Reject</Btn>
            </div>
          )}
        </Card>
      ))}
    </div>
  );
}
