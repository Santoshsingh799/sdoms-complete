import crypto from 'crypto';
import { env } from '../config/env.js';

export const newToken = () => crypto.randomBytes(32).toString('base64url');
export const hashToken = (t) => crypto.createHash('sha256').update(t).digest('hex');
export const newVerifyId = () => crypto.randomBytes(16).toString('base64url');

export const signPass = (verifyId, requestId) =>
  crypto.createHmac('sha256', env.qrSecret).update(`${verifyId}.${requestId}`).digest('base64url').slice(0, 22);

export function safeEqual(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
