import webpush from 'web-push';
import { prisma } from '../config/db.js';
import { env } from '../config/env.js';

const enabled = Boolean(env.vapidPublicKey && env.vapidPrivateKey);
if (enabled) webpush.setVapidDetails(env.vapidSubject, env.vapidPublicKey, env.vapidPrivateKey);

export async function sendPush(userId, payload) {
  if (!enabled || !userId) return false;
  const subscriptions = await prisma.webPushSubscription.findMany({ where: { userId } });
  let sent = false;
  for (const subscription of subscriptions) {
    try {
      await webpush.sendNotification({
        endpoint: subscription.endpoint,
        keys: { p256dh: subscription.p256dh, auth: subscription.auth },
      }, JSON.stringify(payload));
      sent = true;
    } catch (error) {
      if (error.statusCode === 404 || error.statusCode === 410) {
        await prisma.webPushSubscription.delete({ where: { id: subscription.id } });
      } else {
        console.error('Web Push failed:', error.message);
      }
    }
  }
  return sent;
}

export { enabled as pushEnabled };
