import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../config/db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { newVerifyId, signPass } from '../utils/tokens.js';
import { notify } from '../utils/sms.js';
import { audit } from '../utils/audit.js';
import { crypto_randomInt } from '../utils/common2.js';

const router = Router();
router.use(requireAuth, requireRole('MENTOR'));

const include = {
  student: { include: { user: { select: { name: true } } } },
  guardianApprovals: { include: { guardian: { select: { name: true, mobile: true } } } },
  mentorApproval: true,
};

router.get('/requests', async (req, res) => {
  const m = await prisma.mentor.findUnique({ where: { userId: req.user.id } });
  const pendingOnly = req.query.status !== 'all';
  const list = await prisma.outpassRequest.findMany({
    where: { student: { mentorId: m.id }, ...(pendingOnly ? { status: 'PENDING_MENTOR' } : { mentorApproval: { isNot: null } }) },
    orderBy: { createdAt: 'desc' }, include,
  });
  res.json(list);
});

const decisionSchema = z.object({ decision: z.enum(['APPROVE', 'REJECT']), remark: z.string().trim().max(300).optional() });

router.post('/requests/:id/decision', validate(decisionSchema), async (req, res) => {
  const m = await prisma.mentor.findUnique({ where: { userId: req.user.id } });
  const approve = req.body.decision === 'APPROVE';
  const req0 = await prisma.outpassRequest.findFirst({ where: { id: req.params.id, student: { mentorId: m.id } }, include: { student: { include: { user: true } } } });
  if (!req0) return res.status(404).json({ error: 'Request not found' });

  const pass = await prisma.$transaction(async (tx) => {
    // atomic status gate: a pass can only be issued once, and only after guardian approval
    const moved = await tx.outpassRequest.updateMany({ where: { id: req0.id, status: 'PENDING_MENTOR' }, data: { status: approve ? 'APPROVED' : 'MENTOR_REJECTED' } });
    if (!moved.count) return null;
    await tx.mentorApproval.update({ where: { requestId: req0.id }, data: { decision: approve ? 'APPROVED' : 'REJECTED', remark: req.body.remark, decidedAt: new Date() } });
    if (!approve) return { rejected: true };
    const verifyId = newVerifyId();
    return tx.digitalOutpass.create({
      data: {
        requestId: req0.id, verifyId, signature: signPass(verifyId, req0.id),
        passNumber: `OP-${new Date().getFullYear()}-${crypto_randomInt()}`,
        validFrom: new Date(req0.leaveTime.getTime() - 60 * 60 * 1000),
        validUntil: new Date(req0.returnTime.getTime() + 2 * 60 * 60 * 1000),
      },
    });
  });
  if (!pass) return res.status(409).json({ error: 'This request is not waiting for mentor approval' });

  await audit({ actorId: req.user.id, action: approve ? 'MENTOR_APPROVED' : 'MENTOR_REJECTED', entity: 'OutpassRequest', entityId: req0.id, ip: req.ip });
  await notify({
    requestId: req0.id, mobile: req0.student.mobile, event: approve ? 'QR_GENERATED' : 'MENTOR_REJECTED',
    message: approve ? `Your outpass ${pass.passNumber} is approved. Open your dashboard to download the QR pass.` : `Your outpass request was rejected by your mentor.${req.body.remark ? ' Remark: ' + req.body.remark : ''}`,
  });
  res.json({ ok: true, passNumber: pass.passNumber });
});

export default router;
