import 'dotenv/config';

const required = ['DATABASE_URL', 'JWT_SECRET', 'QR_SIGNING_SECRET'];
for (const k of required) {
  if (!process.env[k]) throw new Error(`Missing env variable: ${k}`);
}

export const env = {
  port: Number(process.env.PORT || 5000),
  jwtSecret: process.env.JWT_SECRET,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '8h',
  clientUrl: process.env.CLIENT_URL || 'http://localhost:5173',
  smsProvider: process.env.SMS_PROVIDER || 'dev',
  vapidPublicKey: process.env.VAPID_PUBLIC_KEY || '',
  vapidPrivateKey: process.env.VAPID_PRIVATE_KEY || '',
  vapidSubject: process.env.VAPID_SUBJECT || 'mailto:admin@example.com',
  qrSecret: process.env.QR_SIGNING_SECRET,
  guardianLinkHours: Number(process.env.GUARDIAN_LINK_EXPIRY_HOURS || 24),
};
