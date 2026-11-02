import React from 'react';
import { api, errMsg, fmt, Badge, Btn, Card, Spinner, useFetch, useToast } from '../lib.jsx';

export default function Guardian() {
  const { data, loading, reload } = useFetch('/guardian/requests');
  const toast = useToast();
  const decide = async (id, decision) => {
    try { await api.post(`/guardian/requests/${id}/decision`, { decision }); toast(decision === 'APPROVE' ? 'Approved' : 'Rejected'); reload(); }
    catch (e) { toast(errMsg(e), 'err'); reload(); }
  };
  if (loading) return <Spinner />;
  return <div className="space-y-4">
    <h1 className="text-2xl font-bold">Family approvals</h1>
    {!data?.length ? <Card>No outpass requests.</Card> : data.map((r) => (
      <Card key={r.id} title={`${r.student.user.name} (${r.student.enrollmentNo})`} right={<Badge status={r.status} />}>
        <div className="grid sm:grid-cols-2 gap-1 text-sm">
          <div><b>Destination:</b> {r.destination}</div><div><b>Reason:</b> {r.reason}</div>
          <div><b>Leaving:</b> {fmt(r.leaveTime)}</div><div><b>Returning:</b> {fmt(r.returnTime)}</div>
        </div>
        {r.status === 'PENDING_GUARDIAN' && r.guardianDecision === 'PENDING' && <div className="mt-4 flex gap-2"><Btn color="red" onClick={() => decide(r.guardianApprovalId, 'REJECT')}>Reject</Btn><Btn color="green" onClick={() => decide(r.guardianApprovalId, 'APPROVE')}>Approve</Btn></div>}
      </Card>
    ))}
  </div>;
}
