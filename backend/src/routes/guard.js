import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../config/db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { signPass, safeEqual } from '../utils/tokens.js';
import { notify } from '../utils/sms.js';
import { audit } from '../utils/audit.js';

const router = Router();
router.use(requireAuth, requireRole('GUARD'));

const include = { request: { include: { student: { include: { user: true } }, mentorApproval: true, guardianApprovals: { include: { guardian: true } } } } };

// Decide what a scanned code means right now. Returns { result, reason, outpass, next }
async function evaluate(code) {
  const [verifyId, sig] = String(code).trim().split('.');
  if (!verifyId || !sig) return { result: 'INVALID', reason: 'Not an outpass QR code' };
  const outpass = await prisma.digitalOutpass.findUnique({ where: { verifyId }, include });
  if (!outpass || !safeEqual(sig, signPass(verifyId, outpass.requestId))) return { result: 'INVALID', reason: 'Signature check failed' };
  const status = outpass.request.status;
  const now = new Date();
  if (outpass.isCancelled || status === 'CANCELLED') return { result: 'CANCELLED', outpass };
  if (status === 'RETURNED') return { result: 'ALREADY_USED', reason: 'Student already returned', outpass };
  if (status === 'EXITED') return { result: 'VALID', next: 'RETURN', outpass }; // returning is allowed even after expiry
  if (status !== 'APPROVED') return { result: 'INVALID', reason: 'Outpass not approved', outpass };
  if (now > outpass.validUntil) return { result: 'EXPIRED', outpass };
  if (now < outpass.validFrom) return { result: 'INVALID', reason: 'Outpass is not valid yet', outpass };
  return { result: 'VALID', next: 'EXIT', outpass };
}

const view = (e) => ({
  result: e.result, reason: e.reason, next: e.next,
  pass: e.outpass && {
    verifyId: e.outpass.verifyId, passNumber: e.outpass.passNumber, validUntil: e.outpass.validUntil,
    student: { name: e.outpass.request.student.user.name, enrollmentNo: e.outpass.request.student.enrollmentNo, course: e.outpass.request.student.course },
    destination: e.outpass.request.destination, leaveTime: e.outpass.request.leaveTime, returnTime: e.outpass.request.returnTime,
    guardianApproved: e.outpass.request.guardianApprovals.some((g) => g.decision === 'APPROVED'),
    mentorApproved: e.outpass.request.mentorApproval?.decision === 'APPROVED', status: e.outpass.request.status,
  },
});

router.post('/scan', validate(z.object({ code: z.string().min(5).max(200) })), async (req, res) => {
  const e = await evaluate(req.body.code);
  await prisma.qrVerification.create({ data: { outpassId: e.outpass?.id, guardUserId: req.user.id, result: e.result } });
  res.json(view(e));
});

async function move(req, res, type) {
  const e = await evaluate(req.body.code);
  if (e.result !== 'VALID' || e.next !== type) {
    await prisma.qrVerification.create({ data: { outpassId: e.outpass?.id, guardUserId: req.user.id, result: e.result === 'VALID' ? 'ALREADY_USED' : e.result } });
    return res.status(409).json({ error: e.result === 'VALID' ? `Cannot mark ${type.toLowerCase()} now` : `Outpass is ${e.result}`, ...view(e) });
  }
  const o = e.outpass;
  try {
    await prisma.$transaction(async (tx) => {
      const u = await tx.outpassRequest.updateMany({ where: { id: o.requestId, status: type === 'EXIT' ? 'APPROVED' : 'EXITED' }, data: { status: type === 'EXIT' ? 'EXITED' : 'RETURNED' } });
      if (!u.count) throw new Error('RACE');
      await tx.exitReturnLog.create({ data: { outpassId: o.id, guardUserId: req.user.id, type } }); // unique(outpassId,type) blocks duplicates
    });
  } catch {
    return res.status(409).json({ error: 'Already recorded (duplicate scan)' });
  }
  await audit({ actorId: req.user.id, action: type === 'EXIT' ? 'STUDENT_EXITED' : 'STUDENT_RETURNED', entity: 'DigitalOutpass', entityId: o.id, ip: req.ip });
  const s = o.request.student;
  await notify({ requestId: o.requestId, mobile: s.mobile, event: type === 'EXIT' ? 'STUDENT_EXITED' : 'STUDENT_RETURNED',
    message: type === 'EXIT' ? `${s.user.name} left the college gate.` : `${s.user.name} has returned to the college.` });
  res.json({ ok: true, type, at: new Date() });
}
const codeBody = validate(z.object({ code: z.string().min(5).max(200) }));
router.post('/exit', codeBody, (req, res) => move(req, res, 'EXIT'));
router.post('/return', codeBody, (req, res) => move(req, res, 'RETURN'));

router.get('/recent', async (_req, res) => {
  const logs = await prisma.exitReturnLog.findMany({ take: 20, orderBy: { loggedAt: 'desc' }, include: { outpass: { include: { request: { include: { student: { include: { user: { select: { name: true } } } } } } } } } });
  res.json(logs.map((l) => ({ id: l.id, type: l.type, at: l.loggedAt, name: l.outpass.request.student.user.name, passNumber: l.outpass.passNumber })));
});

export default router;
