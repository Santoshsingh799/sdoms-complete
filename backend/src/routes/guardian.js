import { Router } from 'express';
import { prisma } from '../config/db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { audit } from '../utils/audit.js';
import { notify } from '../utils/sms.js';
import { z } from 'zod';

const router = Router();
router.use(requireAuth, requireRole('GUARDIAN'));

async function getGuardian(userId) {
  const guardian = await prisma.guardian.findUnique({ where: { userId } });
  if (!guardian) throw Object.assign(new Error('Guardian profile not found'), { status: 404 });
  return guardian;
}

const include = {
  student: { include: { user: { select: { name: true, loginId: true } } } },
  guardianApprovals: { include: { guardian: { select: { name: true } } } },
};

router.get('/requests', async (req, res) => {
  const guardian = await getGuardian(req.user.id);
  const approvals = await prisma.guardianApproval.findMany({
    where: { guardianId: guardian.id },
    include: { request: { include } },
    orderBy: { createdAt: 'desc' },
  });
  res.json(approvals.map((a) => ({ ...a.request, guardianDecision: a.decision, guardianApprovalId: a.id })));
});

router.post('/requests/:id/decision', validate(z.object({ decision: z.enum(['APPROVE', 'REJECT']) })), async (req, res) => {
  const guardian = await getGuardian(req.user.id);
  const approval = await prisma.guardianApproval.findFirst({
    where: { id: req.params.id, guardianId: guardian.id },
    include: { request: { include: { student: { include: { user: true, mentor: { include: { user: true } } } } } } },
  });
  if (!approval) return res.status(404).json({ error: 'Request not found' });
  if (approval.decision !== 'PENDING' || approval.expiresAt < new Date() || approval.request.status !== 'PENDING_GUARDIAN') {
    return res.status(409).json({ error: 'This request is no longer available' });
  }
  const approved = req.body.decision === 'APPROVE';
  const won = await prisma.$transaction(async (tx) => {
    const moved = await tx.outpassRequest.updateMany({
      where: { id: approval.requestId, status: 'PENDING_GUARDIAN' },
      data: { status: approved ? 'PENDING_MENTOR' : 'GUARDIAN_REJECTED' },
    });
    if (!moved.count) return false;
    await tx.guardianApproval.update({
      where: { id: approval.id },
      data: { decision: approved ? 'APPROVED' : 'REJECTED', decidedAt: new Date(), decidedIp: req.ip },
    });
    await tx.guardianApproval.updateMany({ where: { requestId: approval.requestId, decision: 'PENDING' }, data: { decision: 'EXPIRED' } });
    if (approved) await tx.mentorApproval.create({ data: { requestId: approval.requestId, mentorId: approval.request.student.mentorId } });
    return true;
  });
  if (!won) return res.status(409).json({ error: 'Another guardian has already answered this request' });
  await audit({ actorId: req.user.id, action: approved ? 'GUARDIAN_APPROVED' : 'GUARDIAN_REJECTED', entity: 'OutpassRequest', entityId: approval.requestId, ip: req.ip });
  const { request } = approval;
  if (approved) await notify({ requestId: request.id, mobile: request.student.mentor?.user.mobile, event: 'MENTOR_APPROVAL_REQUEST', message: `Outpass request from ${request.student.user.name} was approved by guardian. Please review in your mentor dashboard.` });
  await notify({ requestId: request.id, mobile: request.student.mobile, event: approved ? 'GUARDIAN_APPROVED' : 'GUARDIAN_REJECTED', message: `Your guardian ${approved ? 'approved' : 'rejected'} your outpass request.` });
  res.json({ ok: true, decision: req.body.decision });
});

export default router;
