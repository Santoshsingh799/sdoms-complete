import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { prisma } from '../config/db.js';
import { hashToken } from '../utils/tokens.js';
import { notify } from '../utils/sms.js';
import { audit } from '../utils/audit.js';
import { validate } from '../middleware/validate.js';
import { collegeName, fmt } from '../utils/common.js';

// Public routes: no login. The unguessable one-time token in the link is the credential.
const router = Router();
router.use(rateLimit({ windowMs: 60 * 1000, max: 30, message: { error: 'Too many attempts' } }));

const load = (token) =>
  prisma.guardianApproval.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { guardian: true, request: { include: { student: { include: { user: true, mentor: { include: { user: true } } } } } } },
  });

function linkState(ga) {
  if (ga.decision === 'APPROVED' || ga.decision === 'REJECTED') return 'ALREADY_ANSWERED';
  if (ga.decision === 'EXPIRED' || ga.expiresAt < new Date()) return 'EXPIRED';
  if (ga.request.status !== 'PENDING_GUARDIAN') return 'CLOSED';
  return 'OPEN';
}

router.get('/:token', async (req, res) => {
  const ga = await load(req.params.token);
  if (!ga) return res.status(404).json({ state: 'INVALID', error: 'This link is not valid' });
  const r = ga.request;
  res.json({
    state: linkState(ga), college: await collegeName(), guardianName: ga.guardian.name,
    student: { name: r.student.user.name, enrollmentNo: r.student.enrollmentNo, course: r.student.course, branch: r.student.branch },
    destination: r.destination, reason: r.reason, leaveTime: r.leaveTime, returnTime: r.returnTime, yourDecision: ga.decision,
  });
});

router.post('/:token', validate(z.object({ decision: z.enum(['APPROVE', 'REJECT']) })), async (req, res) => {
  const ga = await load(req.params.token);
  if (!ga) return res.status(404).json({ error: 'This link is not valid' });
  const state = linkState(ga);
  if (state !== 'OPEN') return res.status(409).json({ state, error: 'This request has already been decided or the link has expired' });

  // the guardian must still be verified by the college at the moment of approval
  const link = await prisma.studentGuardian.findFirst({ where: { studentId: ga.request.studentId, guardianId: ga.guardianId, isVerified: true } });
  if (!link) return res.status(403).json({ error: 'This guardian is no longer verified' });

  const approve = req.body.decision === 'APPROVE';
  const r = ga.request;
  // First answer wins. updateMany with a status condition is atomic, so two guardians clicking together cannot both succeed.
  const won = await prisma.$transaction(async (tx) => {
    const moved = await tx.outpassRequest.updateMany({
      where: { id: r.id, status: 'PENDING_GUARDIAN' },
      data: { status: approve ? 'PENDING_MENTOR' : 'GUARDIAN_REJECTED' },
    });
    if (!moved.count) return false;
    await tx.guardianApproval.update({ where: { id: ga.id }, data: { decision: approve ? 'APPROVED' : 'REJECTED', decidedAt: new Date(), decidedIp: req.ip } });
    await tx.guardianApproval.updateMany({ where: { requestId: r.id, decision: 'PENDING' }, data: { decision: 'EXPIRED' } });
    if (approve) await tx.mentorApproval.create({ data: { requestId: r.id, mentorId: r.student.mentorId } });
    return true;
  });
  if (!won) return res.status(409).json({ state: 'CLOSED', error: 'Another guardian has already answered this request' });

  await audit({ action: approve ? 'GUARDIAN_APPROVED' : 'GUARDIAN_REJECTED', entity: 'OutpassRequest', entityId: r.id, meta: { guardianId: ga.guardianId }, ip: req.ip });
  const who = ga.guardian.name;
  if (approve) {
    await notify({ requestId: r.id, mobile: r.student.mentor?.user.mobile, event: 'MENTOR_APPROVAL_REQUEST',
      message: `Outpass request from ${r.student.user.name} (${r.student.enrollmentNo}) to ${r.destination} is approved by guardian ${who}. Please review in your mentor dashboard.` });
    await notify({ requestId: r.id, mobile: r.student.mobile, event: 'GUARDIAN_APPROVED', message: `Your outpass was approved by ${who}. Waiting for mentor approval.` });
  } else {
    await notify({ requestId: r.id, mobile: r.student.mobile, event: 'GUARDIAN_REJECTED', message: `Your outpass request to ${r.destination} was rejected by ${who}.` });
    await notify({ requestId: r.id, mobile: r.student.mentor?.user.mobile, event: 'GUARDIAN_REJECTED', message: `Outpass request of ${r.student.user.name} was rejected by guardian ${who}.` });
  }
  res.json({ ok: true, decision: req.body.decision, decidedAt: fmt(new Date()) });
});

export default router;
