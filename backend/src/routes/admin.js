import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import PDFDocument from 'pdfkit';
import { prisma } from '../config/db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { audit } from '../utils/audit.js';
import { mobileSchema, fmt } from '../utils/common.js';

const router = Router();
router.use(requireAuth, requireRole('ADMIN'));

router.get('/stats', async (_req, res) => {
  const [byStatus, students, mentors, guards, unverified] = await Promise.all([
    prisma.outpassRequest.groupBy({ by: ['status'], _count: true }),
    prisma.student.count(), prisma.mentor.count(), prisma.user.count({ where: { role: 'GUARD' } }),
    prisma.studentGuardian.count({ where: { isVerified: false } }),
  ]);
  res.json({ byStatus: Object.fromEntries(byStatus.map((s) => [s.status, s._count])), students, mentors, guards, unverifiedGuardians: unverified });
});

// ---- users ----
router.get('/users', async (req, res) => {
  const role = z.enum(['STUDENT', 'MENTOR', 'GUARD', 'ADMIN']).safeParse(req.query.role);
  const q = String(req.query.q || '').trim();
  const users = await prisma.user.findMany({
    where: { ...(role.success && { role: role.data }), ...(q && { OR: [{ name: { contains: q, mode: 'insensitive' } }, { loginId: { contains: q, mode: 'insensitive' } }] }) },
    orderBy: { createdAt: 'desc' }, take: 200,
    select: { id: true, loginId: true, name: true, role: true, mobile: true, isActive: true, student: { select: { id: true, course: true, branch: true, semester: true, mentor: { select: { id: true, user: { select: { name: true } } } } } }, mentor: { select: { id: true, department: true } } },
  });
  res.json(users);
});

const createUser = z.object({
  role: z.enum(['STUDENT', 'MENTOR', 'GUARD']),
  loginId: z.string().trim().min(3).max(30), name: z.string().trim().min(2).max(80),
  password: z.string().min(8).max(100), mobile: mobileSchema.optional(),
  course: z.string().optional(), branch: z.string().optional(), semester: z.coerce.number().int().min(1).max(12).optional(),
  mentorId: z.string().optional(), department: z.string().optional(),
}).superRefine((d, c) => {
  if (d.role === 'STUDENT' && !(d.course && d.branch && d.semester && d.mobile)) c.addIssue({ code: 'custom', message: 'Student needs course, branch, semester, mobile' });
  if (d.role === 'MENTOR' && !d.department) c.addIssue({ code: 'custom', message: 'Mentor needs department' });
});
router.post('/users', validate(createUser), async (req, res) => {
  const d = req.body;
  if (await prisma.user.findUnique({ where: { loginId: d.loginId } })) return res.status(409).json({ error: 'This ID already exists' });
  const user = await prisma.user.create({
    data: {
      loginId: d.loginId, name: d.name, role: d.role, mobile: d.mobile, passwordHash: await bcrypt.hash(d.password, 12),
      ...(d.role === 'STUDENT' && { student: { create: { enrollmentNo: d.loginId, course: d.course, branch: d.branch, semester: d.semester, mobile: d.mobile, mentorId: d.mentorId || null } } }),
      ...(d.role === 'MENTOR' && { mentor: { create: { department: d.department } } }),
    },
  });
  await audit({ actorId: req.user.id, action: 'USER_CREATED', entity: 'User', entityId: user.id, meta: { role: d.role }, ip: req.ip });
  res.status(201).json({ id: user.id });
});

router.patch('/users/:id/active', validate(z.object({ isActive: z.boolean() })), async (req, res) => {
  if (req.params.id === req.user.id) return res.status(400).json({ error: 'You cannot disable your own account' });
  await prisma.user.update({ where: { id: req.params.id }, data: { isActive: req.body.isActive } });
  await audit({ actorId: req.user.id, action: 'USER_ACTIVE_CHANGED', entity: 'User', entityId: req.params.id, meta: req.body, ip: req.ip });
  res.json({ ok: true });
});

router.patch('/students/:id/mentor', validate(z.object({ mentorId: z.string() })), async (req, res) => {
  await prisma.student.update({ where: { id: req.params.id }, data: { mentorId: req.body.mentorId } });
  await audit({ actorId: req.user.id, action: 'MENTOR_ASSIGNED', entity: 'Student', entityId: req.params.id, meta: req.body, ip: req.ip });
  res.json({ ok: true });
});

router.get('/mentors', async (_req, res) => {
  res.json(await prisma.mentor.findMany({ include: { user: { select: { name: true, loginId: true } } } }));
});

// ---- guardian verification (the key anti-fraud step) ----
router.get('/guardian-links', async (req, res) => {
  const where = req.query.verified === 'false' ? { isVerified: false } : req.query.verified === 'true' ? { isVerified: true } : {};
  const links = await prisma.studentGuardian.findMany({ where, orderBy: { createdAt: 'desc' }, take: 300, include: { guardian: true, student: { include: { user: { select: { name: true } } } } } });
  res.json(links.map((l) => ({ id: l.id, guardian: l.guardian.name, mobile: l.guardian.mobile, relation: l.relation, isVerified: l.isVerified, student: l.student.user.name, enrollmentNo: l.student.enrollmentNo })));
});
router.patch('/guardian-links/:id/verify', validate(z.object({ verified: z.boolean() })), async (req, res) => {
  await prisma.studentGuardian.update({ where: { id: req.params.id }, data: { isVerified: req.body.verified, verifiedBy: req.user.id, verifiedAt: req.body.verified ? new Date() : null } });
  await audit({ actorId: req.user.id, action: req.body.verified ? 'GUARDIAN_VERIFIED' : 'GUARDIAN_UNVERIFIED', entity: 'StudentGuardian', entityId: req.params.id, ip: req.ip });
  res.json({ ok: true });
});

// ---- requests, logs, reports ----
async function findRequests(q) {
  const from = q.from ? new Date(q.from) : null, to = q.to ? new Date(String(q.to) + 'T23:59:59') : null;
  const text = String(q.q || '').trim();
  return prisma.outpassRequest.findMany({
    where: {
      ...(q.status && { status: String(q.status) }),
      ...((from || to) && { createdAt: { ...(from && { gte: from }), ...(to && { lte: to }) } }),
      ...(text && { student: { OR: [{ enrollmentNo: { contains: text, mode: 'insensitive' } }, { user: { name: { contains: text, mode: 'insensitive' } } }] } }),
    },
    orderBy: { createdAt: 'desc' }, take: 1000,
    include: { student: { include: { user: { select: { name: true } } } }, digitalOutpass: { include: { logs: true } } },
  });
}
router.get('/requests', async (req, res) => res.json(await findRequests(req.query)));

router.get('/movements', async (_req, res) => {
  const logs = await prisma.exitReturnLog.findMany({ take: 300, orderBy: { loggedAt: 'desc' }, include: { guard: { select: { name: true } }, outpass: { include: { request: { include: { student: { include: { user: { select: { name: true } } } } } } } } } });
  res.json(logs.map((l) => ({ id: l.id, type: l.type, at: l.loggedAt, guard: l.guard.name, student: l.outpass.request.student.user.name, enrollmentNo: l.outpass.request.student.enrollmentNo, passNumber: l.outpass.passNumber })));
});

router.get('/audit', async (_req, res) => res.json(await prisma.auditLog.findMany({ take: 200, orderBy: { createdAt: 'desc' } })));

const rowsFor = (list) => list.map((r) => [r.student.user.name, r.student.enrollmentNo, r.destination, fmt(r.leaveTime), fmt(r.returnTime), r.status,
  r.digitalOutpass?.logs.find((l) => l.type === 'EXIT') ? fmt(r.digitalOutpass.logs.find((l) => l.type === 'EXIT').loggedAt) : '',
  r.digitalOutpass?.logs.find((l) => l.type === 'RETURN') ? fmt(r.digitalOutpass.logs.find((l) => l.type === 'RETURN').loggedAt) : '']);
const HEAD = ['Student', 'Enrollment', 'Destination', 'Leave', 'Return', 'Status', 'Exited at', 'Returned at'];

router.get('/reports/requests.csv', async (req, res) => {
  const esc = (v) => { let s = String(v ?? ''); if (/^[=+\-@]/.test(s)) s = "'" + s; return `"${s.replace(/"/g, '""')}"`; }; // blocks CSV formula injection
  const csv = [HEAD, ...rowsFor(await findRequests(req.query))].map((r) => r.map(esc).join(',')).join('\n');
  res.setHeader('Content-Type', 'text/csv'); res.setHeader('Content-Disposition', 'attachment; filename="outpass-report.csv"');
  res.send(csv);
});

router.get('/reports/requests.pdf', async (req, res) => {
  const rows = rowsFor(await findRequests(req.query));
  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 30 });
  res.setHeader('Content-Type', 'application/pdf'); res.setHeader('Content-Disposition', 'attachment; filename="outpass-report.pdf"');
  doc.pipe(res);
  doc.fontSize(14).text('Outpass Report').fontSize(8).moveDown(0.5);
  const w = [90, 60, 100, 100, 100, 90, 100, 100];
  const line = (cells, bold) => { let x = 30; const y = doc.y; doc.font(bold ? 'Helvetica-Bold' : 'Helvetica'); cells.forEach((c, i) => { doc.text(String(c), x, y, { width: w[i] - 4, height: 10, ellipsis: true }); x += w[i]; }); doc.y = y + 14; };
  line(HEAD, true);
  rows.forEach((r) => { if (doc.y > 540) { doc.addPage(); } line(r, false); });
  doc.end();
});

// ---- college settings ----
router.get('/settings', async (_req, res) => res.json(await prisma.collegeSettings.findUnique({ where: { id: 1 } })));
router.put('/settings', validate(z.object({ name: z.string().trim().min(2).max(120), logoUrl: z.string().url().max(500).optional().or(z.literal('')), sealUrl: z.string().url().max(500).optional().or(z.literal('')) })), async (req, res) => {
  const s = await prisma.collegeSettings.update({ where: { id: 1 }, data: req.body });
  await audit({ actorId: req.user.id, action: 'SETTINGS_UPDATED', entity: 'CollegeSettings', entityId: '1', ip: req.ip });
  res.json(s);
});

export default router;
