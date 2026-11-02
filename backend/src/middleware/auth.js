import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { prisma } from '../config/db.js';

export async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Login required' });
  try {
    const payload = jwt.verify(token, env.jwtSecret);
    const user = await prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || !user.isActive) return res.status(401).json({ error: 'Account disabled or not found' });
    req.user = user;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired session' });
  }
}

// Role-based access control: requireRole('ADMIN', 'MENTOR')
export const requireRole = (...roles) => (req, res, next) => {
  if (!req.user || !roles.includes(req.user.role)) {
    return res.status(403).json({ error: 'You do not have permission for this action' });
  }
  next();
};
