import { prisma } from '../config/db.js';

export async function audit({ actorId = null, action, entity, entityId = null, meta = null, ip = null }) {
  try {
    await prisma.auditLog.create({ data: { actorId, action, entity, entityId, meta, ip } });
  } catch (e) {
    console.error('audit failed', e.message);
  }
}
