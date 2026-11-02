import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { prisma } from '../config/db.js';
import { env } from '../config/env.js';
import { validate } from '../middleware/validate.js';
import { requireAuth } from '../middleware/auth.js';
import { audit } from '../utils/audit.js';

const router = Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: 'Too many login attempts. Try again after 15 minutes.' },
});

const loginSchema = z.object({
  loginId: z.string().trim().min(3).max(50),
  password: z.string().min(6).max(100),
});

const publicUser = (u) => ({ id: u.id, loginId: u.loginId, name: u.name, role: u.role, email: u.email });

router.post('/login', loginLimiter, validate(loginSchema), async (req, res) => {
  const { loginId, password } = req.body;
  const user = await prisma.user.findUnique({ where: { loginId } });
  // Same message for unknown user / wrong password so IDs can't be guessed
  const ok = user && user.isActive && (await bcrypt.compare(password, user.passwordHash));
  if (!ok) {
    await audit({ action: 'LOGIN_FAILED', entity: 'User', meta: { loginId }, ip: req.ip });
    return res.status(401).json({ error: 'Invalid ID or password' });
  }
  const token = jwt.sign({ sub: user.id, role: user.role }, env.jwtSecret, { expiresIn: env.jwtExpiresIn });
  await audit({ actorId: user.id, action: 'LOGIN', entity: 'User', entityId: user.id, ip: req.ip });
  res.json({ token, user: publicUser(user) });
});

router.get('/me', requireAuth, async (req, res) => {
  const full = await prisma.user.findUnique({
    where: { id: req.user.id },
    include: { student: { include: { mentor: { include: { user: { select: { name: true } } } } } }, mentor: true },
  });
  res.json({ user: publicUser(full), student: full.student, mentor: full.mentor });
});

const pwSchema = z.object({ currentPassword: z.string(), newPassword: z.string().min(8).max(100) });
router.post('/change-password', requireAuth, validate(pwSchema), async (req, res) => {
  const ok = await bcrypt.compare(req.body.currentPassword, req.user.passwordHash);
  if (!ok) return res.status(400).json({ error: 'Current password is wrong' });
  await prisma.user.update({
    where: { id: req.user.id },
    data: { passwordHash: await bcrypt.hash(req.body.newPassword, 12) },
  });
  await audit({ actorId: req.user.id, action: 'PASSWORD_CHANGED', entity: 'User', entityId: req.user.id, ip: req.ip });
  res.json({ ok: true });
});

export default router;
