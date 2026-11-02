import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../config/db.js';
import { env } from '../config/env.js';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';

const router = Router();

router.get('/push-key', (_req, res) => {
  res.json({ publicKey: env.vapidPublicKey || null });
});

router.post('/push-subscriptions', requireAuth, validate(z.object({
  endpoint: z.string().url(),
  keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }),
})), async (req, res) => {
  const { endpoint, keys } = req.body;
  await prisma.webPushSubscription.upsert({
    where: { endpoint },
    update: { userId: req.user.id, p256dh: keys.p256dh, auth: keys.auth },
    create: { userId: req.user.id, endpoint, p256dh: keys.p256dh, auth: keys.auth },
  });
  res.status(201).json({ ok: true });
});

router.delete('/push-subscriptions', requireAuth, validate(z.object({ endpoint: z.string().url() })), async (req, res) => {
  await prisma.webPushSubscription.deleteMany({ where: { endpoint: req.body.endpoint, userId: req.user.id } });
  res.json({ ok: true });
});

export default router;
