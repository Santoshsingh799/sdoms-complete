import { z } from 'zod';
import { prisma } from '../config/db.js';

export const mobileSchema = z.string().trim().regex(/^[6-9]\d{9}$/, 'Enter a valid 10-digit Indian mobile number');

export const collegeName = async () => (await prisma.collegeSettings.findUnique({ where: { id: 1 } }))?.name || 'College';

export const fmt = (d) => new Date(d).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' });
