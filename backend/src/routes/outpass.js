import { Router } from 'express';
import { z } from 'zod';
import QRCode from 'qrcode';
import PDFDocument from 'pdfkit';
import { prisma } from '../config/db.js';
import { env } from '../config/env.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { newToken, hashToken } from '../utils/tokens.js';
import { notify } from '../utils/sms.js';
import { audit } from '../utils/audit.js';
import { mobileSchema, collegeName, fmt } from '../utils/common.js';

const router = Router();
router.use(requireAuth, requireRole('STUDENT'));

const getStudent = (userId) => prisma.student.findUnique({ where: { userId }, include: { user: true } });
const ACTIVE = ['PENDING_GUARDIAN', 'PENDING_MENTOR', 'APPROVED', 'EXITED'];

// ---- guardians (student side). New numbers stay unverified until admin verifies them ----
router.get('/guardians', async (req, res) => {
  const s = await getStudent(req.user.id);
  const links = await prisma.studentGuardian.findMany({ where: { studentId: s.id }, include: { guardian: true }, orderBy: { createdAt: 'asc' } });
  res.json(links.map((l) => ({ id: l.id, name: l.guardian.name, mobile: l.guardian.mobile, relation: l.relation, isVerified: l.isVerified })));
});

const guardianSchema = z.object({
  name: z.string().trim().min(2).max(80),
  mobile: mobileSchema,
  relation: z.enum(['Father', 'Mother', 'Brother', 'Sister', 'Other Guardian']),
});
router.post('/guardians', validate(guardianSchema), async (req, res) => {
  const s = await getStudent(req.user.id);
  const count = await prisma.studentGuardian.count({ where: { studentId: s.id } });
  if (count >= 5) return res.status(400).json({ error: 'Maximum 5 guardians allowed' });
  const { name, mobile, relation } = req.body;
  const guardian = await prisma.guardian.upsert({ where: { mobile }, update: {}, create: { name, mobile } });
  const dup = await prisma.studentGuardian.findUnique({ where: { studentId_guardianId: { studentId: s.id, guardianId: guardian.id } } });
  if (dup) return res.status(409).json({ error: 'This number is already in your list' });
  const link = await prisma.studentGuardian.create({ data: { studentId: s.id, guardianId: guardian.id, relation } });
  await audit({ actorId: req.user.id, action: 'GUARDIAN_ADDED', entity: 'StudentGuardian', entityId: link.id, ip: req.ip });
  res.status(201).json({ id: link.id, isVerified: false, message: 'Added. It can be used after college admin verifies the number.' });
});

router.delete('/guardians/:id', async (req, res) => {
  const s = await getStudent(req.user.id);
  const r = await prisma.studentGuardian.deleteMany({ where: { id: req.params.id, studentId: s.id } });
  if (!r.count) return res.status(404).json({ error: 'Not found' });
  await audit({ actorId: req.user.id, action: 'GUARDIAN_REMOVED', entity: 'StudentGuardian', entityId: req.params.id, ip: req.ip });
  res.json({ ok: true });
});

// ---- requests ----
const createSchema = z.object({
  destination: z.string().trim().min(2).max(200),
  reason: z.string().trim().min(3).max(500),
  leaveTime: z.coerce.date(),
  returnTime: z.coerce.date(),
  emergencyMobile: mobileSchema,
  guardianLinkIds: z.array(z.string()).min(1, 'Select at least 1 guardian').max(5).refine((a) => new Set(a).size === a.length, 'Duplicate guardian'),
});

async function sendGuardianLinks(request, student, approvals) {
  const college = await collegeName();
  for (const { token, guardian } of approvals) {
    await notify({
      requestId: request.id, mobile: guardian.mobile, event: 'GUARDIAN_APPROVAL_REQUEST',
      message: `${college}: ${student.user.name} (${student.enrollmentNo}) requested an outpass to ${request.destination} on ${fmt(request.leaveTime)}.`,
      link: `${env.clientUrl}/g/${token}`,
    });
  }
}

router.post('/', validate(createSchema), async (req, res) => {
  const s = await getStudent(req.user.id);
  const b = req.body;
  if (!s.mentorId) return res.status(400).json({ error: 'No mentor assigned to you yet. Contact college admin.' });
  if (b.leaveTime <= new Date()) return res.status(400).json({ error: 'Leaving time must be in the future' });
  if (b.returnTime <= b.leaveTime) return res.status(400).json({ error: 'Return time must be after leaving time' });
  const open = await prisma.outpassRequest.findFirst({ where: { studentId: s.id, status: { in: ACTIVE } } });
  if (open) return res.status(409).json({ error: 'You already have an active outpass request. Complete or cancel it first.' });

  const links = await prisma.studentGuardian.findMany({ where: { id: { in: b.guardianLinkIds }, studentId: s.id }, include: { guardian: true } });
  if (links.length !== b.guardianLinkIds.length) return res.status(400).json({ error: 'Invalid guardian selection' });
  const unverified = links.filter((l) => !l.isVerified);
  if (unverified.length) return res.status(400).json({ error: `Not verified by college yet: ${unverified.map((l) => l.guardian.name).join(', ')}` });

  const approvals = links.map((l) => ({ token: newToken(), guardian: l.guardian }));
  const expiresAt = new Date(Date.now() + env.guardianLinkHours * 3600 * 1000);
  const request = await prisma.outpassRequest.create({
    data: {
      studentId: s.id, destination: b.destination, reason: b.reason, leaveTime: b.leaveTime, returnTime: b.returnTime, emergencyMobile: b.emergencyMobile,
      guardianApprovals: { create: approvals.map((a) => ({ guardianId: a.guardian.id, tokenHash: hashToken(a.token), expiresAt })) },
    },
  });
  await audit({ actorId: req.user.id, action: 'REQUEST_CREATED', entity: 'OutpassRequest', entityId: request.id, ip: req.ip });
  await sendGuardianLinks(request, s, approvals);
  res.status(201).json(request);
});

const listInclude = { guardianApprovals: { include: { guardian: { select: { name: true } } } }, mentorApproval: true, digitalOutpass: { select: { passNumber: true } } };

router.get('/', async (req, res) => {
  const s = await getStudent(req.user.id);
  res.json(await prisma.outpassRequest.findMany({ where: { studentId: s.id }, orderBy: { createdAt: 'desc' }, include: listInclude }));
});

async function ownRequest(req) {
  const s = await getStudent(req.user.id);
  const r = await prisma.outpassRequest.findFirst({ where: { id: req.params.id, studentId: s.id }, include: { ...listInclude, digitalOutpass: true } });
  return { s, r };
}

router.get('/:id', async (req, res) => {
  const { r } = await ownRequest(req);
  if (!r) return res.status(404).json({ error: 'Not found' });
  res.json(r);
});

router.post('/:id/resend', async (req, res) => {
  const { s, r } = await ownRequest(req);
  if (!r) return res.status(404).json({ error: 'Not found' });
  if (r.status !== 'PENDING_GUARDIAN') return res.status(400).json({ error: 'Only requests waiting for guardian approval can be resent' });
  const pending = await prisma.guardianApproval.findMany({ where: { requestId: r.id, decision: 'PENDING' }, include: { guardian: true } });
  const expiresAt = new Date(Date.now() + env.guardianLinkHours * 3600 * 1000);
  const approvals = [];
  for (const p of pending) {
    const token = newToken(); // old link stops working because the hash is replaced
    await prisma.guardianApproval.update({ where: { id: p.id }, data: { tokenHash: hashToken(token), expiresAt } });
    approvals.push({ token, guardian: p.guardian });
  }
  await sendGuardianLinks(r, s, approvals);
  await audit({ actorId: req.user.id, action: 'REQUEST_RESENT', entity: 'OutpassRequest', entityId: r.id, ip: req.ip });
  res.json({ ok: true, resent: approvals.length });
});

router.post('/:id/cancel', async (req, res) => {
  const { r } = await ownRequest(req);
  if (!r) return res.status(404).json({ error: 'Not found' });
  const done = await prisma.$transaction(async (tx) => {
    const u = await tx.outpassRequest.updateMany({ where: { id: r.id, status: { in: ['PENDING_GUARDIAN', 'PENDING_MENTOR', 'APPROVED'] } }, data: { status: 'CANCELLED' } });
    if (!u.count) return false;
    await tx.guardianApproval.updateMany({ where: { requestId: r.id, decision: 'PENDING' }, data: { decision: 'EXPIRED' } });
    await tx.digitalOutpass.updateMany({ where: { requestId: r.id }, data: { isCancelled: true } });
    return true;
  });
  if (!done) return res.status(400).json({ error: 'This request cannot be cancelled now' });
  await audit({ actorId: req.user.id, action: 'REQUEST_CANCELLED', entity: 'OutpassRequest', entityId: r.id, ip: req.ip });
  res.json({ ok: true });
});

// ---- approved pass: JSON for screen, PDF for download ----
const qrText = (p) => `${p.verifyId}.${p.signature}`;

async function passData(r, student) {
  const p = r.digitalOutpass;
  return {
    college: await collegeName(),
    passNumber: p.passNumber, status: r.status, isCancelled: p.isCancelled,
    student: { name: student.user.name, enrollmentNo: student.enrollmentNo, course: student.course, branch: student.branch, semester: student.semester },
    destination: r.destination, reason: r.reason, leaveTime: r.leaveTime, returnTime: r.returnTime,
    validFrom: p.validFrom, validUntil: p.validUntil, issuedAt: p.issuedAt,
    guardianApproval: r.guardianApprovals.find((g) => g.decision === 'APPROVED')?.guardian.name || null,
    mentorApproval: r.mentorApproval?.decision, qr: await QRCode.toDataURL(qrText(p), { margin: 1, width: 300 }),
  };
}

router.get('/:id/pass', async (req, res) => {
  const { s, r } = await ownRequest(req);
  if (!r?.digitalOutpass) return res.status(404).json({ error: 'Outpass not issued yet' });
  res.json(await passData(r, s));
});

router.get('/:id/pass.pdf', async (req, res) => {
  const { s, r } = await ownRequest(req);
  if (!r?.digitalOutpass) return res.status(404).json({ error: 'Outpass not issued yet' });
  const d = await passData(r, s);
  const doc = new PDFDocument({ size: 'A5', margin: 30 });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${d.passNumber}.pdf"`);
  doc.pipe(res);
  doc.fontSize(16).text(d.college, { align: 'center' }).fontSize(11).text('DIGITAL OUTPASS', { align: 'center' }).moveDown();
  doc.fontSize(10);
  const rows = [['Pass No', d.passNumber], ['Name', d.student.name], ['Enrollment', d.student.enrollmentNo], ['Course', `${d.student.course} - ${d.student.branch} (Sem ${d.student.semester})`],
    ['Destination', d.destination], ['Reason', d.reason], ['Leaving', fmt(d.leaveTime)], ['Returning', fmt(d.returnTime)], ['Guardian approval', d.guardianApproval || '-'], ['Mentor approval', d.mentorApproval || '-']];
  rows.forEach(([k, v]) => doc.font('Helvetica-Bold').text(`${k}: `, { continued: true }).font('Helvetica').text(String(v)));
  doc.image(Buffer.from(d.qr.split(',')[1], 'base64'), doc.page.width - 150, 60, { width: 110 });
  // vector college seal, drawn only by the server
  const cx = 90, cy = doc.y + 60;
  doc.save().lineWidth(2).strokeColor('#1d4ed8').circle(cx, cy, 45).stroke().circle(cx, cy, 38).stroke();
  doc.fillColor('#1d4ed8').fontSize(8).text('DIGITALLY APPROVED', cx - 45, cy - 14, { width: 90, align: 'center' }).text(d.passNumber, cx - 45, cy + 2, { width: 90, align: 'center' }).restore();
  doc.end();
});

export default router;
