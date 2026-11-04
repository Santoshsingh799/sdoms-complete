import 'express-async-errors';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { env } from './config/env.js';
import authRoutes from './routes/auth.js';
import outpassRoutes from './routes/outpass.js';
import guardianLinkRoutes from './routes/guardianLink.js';
import guardianRoutes from './routes/guardian.js';
import mentorRoutes from './routes/mentor.js';
import guardRoutes from './routes/guard.js';
import adminRoutes from './routes/admin.js';
import notificationRoutes from './routes/notifications.js';
import { collegeName } from './utils/common.js';

const app = express();
app.set('trust proxy', 1);
app.use(helmet());
app.use(cors({ origin: env.clientUrl }));
app.use(express.json({ limit: '100kb' }));
app.use(rateLimit({ windowMs: 60 * 1000, max: 200 }));

app.get('/api/health', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ ok: true, service: 'SDOMS' });
});
app.use('/api/auth', authRoutes);
app.get('/api/public/college', async (_req, res) => res.json({ name: await collegeName() }));
app.use('/api/notifications', notificationRoutes);
app.use('/api/outpass', outpassRoutes);
app.use('/api/g', guardianLinkRoutes);
app.use('/api/guardian', guardianRoutes);
app.use('/api/mentor', mentorRoutes);
app.use('/api/guard', guardRoutes);
app.use('/api/admin', adminRoutes);

app.use((_req, res) => res.status(404).json({ error: 'Not found' }));
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Something went wrong' });
});

export default app;
